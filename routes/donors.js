const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { compatibleDonorGroupsFor, distanceKm, VALID_GROUPS } = require('../utils/blood');

const router = express.Router();

function publicDonor(row, { withPhone = false } = {}) {
  if (!row) return row;
  const { password_hash, phone, ...rest } = row;
  return withPhone ? { ...rest, phone } : rest;
}

// ---------------------------------------------------------------------------
// GET /api/donors/search — search by blood group + city/proximity.
// Requires a logged-in account (donor or seeker) — the entire site sits
// behind an account wall, so every search is tied to a registered user.
// (Objective 2: search for available donors by blood group and proximity)
// ---------------------------------------------------------------------------
router.get('/search', requireAuth, (req, res) => {
  const { blood_group, city, lat, lng, exact_match_only, max_km } = req.query;

  let rows = db.prepare("SELECT * FROM donors WHERE is_active = 1 AND role = 'donor'").all();

  if (blood_group) {
    if (!VALID_GROUPS.includes(blood_group)) {
      return res.status(400).json({ error: 'Invalid blood group.' });
    }
    if (exact_match_only === 'true') {
      rows = rows.filter((d) => d.blood_group === blood_group);
    } else {
      // Show compatible donor groups by default, so a patient needing A+
      // also sees O+ / O- / A- donors, ranked with exact matches first.
      const compatible = compatibleDonorGroupsFor(blood_group);
      rows = rows.filter((d) => compatible.includes(d.blood_group));
    }
  }

  if (city) {
    const c = city.toLowerCase().trim();
    rows = rows.filter(
      (d) => d.city.toLowerCase().includes(c) || d.state.toLowerCase().includes(c)
    );
  }

  const userLat = lat ? parseFloat(lat) : null;
  const userLng = lng ? parseFloat(lng) : null;

  rows = rows.map((d) => {
    const dist = userLat !== null && userLng !== null ? distanceKm(userLat, userLng, d.latitude, d.longitude) : null;
    return { ...publicDonor(d), distance_km: dist !== null ? Math.round(dist * 10) / 10 : null, exact_match: blood_group ? d.blood_group === blood_group : null };
  });

  if (max_km && userLat !== null && userLng !== null) {
    const maxD = parseFloat(max_km);
    rows = rows.filter((d) => d.distance_km === null || d.distance_km <= maxD);
  }

  // Rank: exact blood group match first, then by distance (nulls last), then newest
  rows.sort((a, b) => {
    if (a.exact_match !== b.exact_match) return a.exact_match ? -1 : 1;
    if (a.distance_km !== null && b.distance_km !== null) return a.distance_km - b.distance_km;
    if (a.distance_km !== null) return -1;
    if (b.distance_km !== null) return 1;
    return 0;
  });

  res.json({ count: rows.length, donors: rows });
});

// ---------------------------------------------------------------------------
// POST /api/donors/:id/reveal-contact — consent-based contact reveal.
// Requires login so every reveal is attributable to a real account, and the
// requester's own name/phone are pulled from their session automatically.
// ---------------------------------------------------------------------------
router.post('/:id/reveal-contact', requireAuth, (req, res) => {
  const donor = db.prepare("SELECT * FROM donors WHERE id = ? AND is_active = 1 AND role = 'donor'").get(req.params.id);
  if (!donor) return res.status(404).json({ error: 'Donor not found or currently unavailable.' });

  const requester = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  const { reason } = req.body || {};

  db.prepare(
    'INSERT INTO contact_logs (donor_id, requester_name, requester_phone, reason) VALUES (?, ?, ?, ?)'
  ).run(donor.id, requester ? requester.name : 'Unknown user', requester ? requester.phone : null, reason || null);

  res.json({ name: donor.name, phone: donor.phone, blood_group: donor.blood_group, city: donor.city });
});

// ---------------------------------------------------------------------------
// Authenticated self-service (donors and seekers)
// ---------------------------------------------------------------------------

// GET /api/donors/me/profile
router.get('/me/profile', requireAuth, (req, res) => {
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  res.json({ donor: publicDonor(donor, { withPhone: true }) });
});

// PATCH /api/donors/me/availability — toggle active/inactive (Objective 5).
// Only meaningful for donor-role accounts.
router.patch('/me/availability', requireAuth, (req, res) => {
  const { is_active, last_donation_date } = req.body;
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  if (!donor) return res.status(404).json({ error: 'Donor not found.' });
  if (donor.role !== 'donor') {
    return res.status(400).json({ error: 'Only donor accounts have an availability status. Switch to a donor account first.' });
  }

  const newActive = typeof is_active === 'boolean' ? (is_active ? 1 : 0) : donor.is_active;
  const newLastDonation = last_donation_date !== undefined ? last_donation_date : donor.last_donation_date;

  db.prepare('UPDATE donors SET is_active = ?, last_donation_date = ? WHERE id = ?').run(
    newActive,
    newLastDonation,
    req.donorId
  );

  const updated = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  res.json({ donor: publicDonor(updated, { withPhone: true }) });
});

// PATCH /api/donors/me/become-donor — lets a seeker account opt in to donate
router.patch('/me/become-donor', requireAuth, (req, res) => {
  const { blood_group } = req.body;
  if (!blood_group || !VALID_GROUPS.includes(blood_group)) {
    return res.status(400).json({ error: 'Please select a valid blood group.' });
  }
  db.prepare("UPDATE donors SET role = 'donor', blood_group = ?, is_active = 1 WHERE id = ?").run(blood_group, req.donorId);
  const updated = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  res.json({ donor: publicDonor(updated, { withPhone: true }) });
});

// PATCH /api/donors/me/profile — edit profile details
router.patch('/me/profile', requireAuth, (req, res) => {
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  if (!donor) return res.status(404).json({ error: 'Donor not found.' });

  const { name, phone, city, state, latitude, longitude, age, gender, blood_group } = req.body;
  const normalizedBloodGroup = blood_group === '' ? null : blood_group;
  if (normalizedBloodGroup && !VALID_GROUPS.includes(normalizedBloodGroup)) {
    return res.status(400).json({ error: 'Invalid blood group.' });
  }

  db.prepare(`
    UPDATE donors SET
      name = @name, phone = @phone, city = @city, state = @state,
      latitude = @latitude, longitude = @longitude, age = @age, gender = @gender,
      blood_group = @blood_group
    WHERE id = @id
  `).run({
    id: req.donorId,
    name: name ?? donor.name,
    phone: phone ?? donor.phone,
    city: city ?? donor.city,
    state: state ?? donor.state,
    latitude: latitude ?? donor.latitude,
    longitude: longitude ?? donor.longitude,
    age: age ?? donor.age,
    gender: gender ?? donor.gender,
    blood_group: normalizedBloodGroup !== undefined ? normalizedBloodGroup : donor.blood_group,
  });

  const updated = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  res.json({ donor: publicDonor(updated, { withPhone: true }) });
});

// PATCH /api/donors/me/password
router.patch('/me/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.donorId);
  if (!donor || !bcrypt.compareSync(current_password || '', donor.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  const password_hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE donors SET password_hash = ? WHERE id = ?').run(password_hash, req.donorId);
  res.json({ message: 'Password updated successfully.' });
});

// GET /api/donors/me/contact-activity — who viewed my contact info
router.get('/me/contact-activity', requireAuth, (req, res) => {
  const logs = db
    .prepare('SELECT * FROM contact_logs WHERE donor_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.donorId);
  res.json({ logs });
});

// DELETE /api/donors/me — account deletion
router.delete('/me', requireAuth, (req, res) => {
  db.prepare('DELETE FROM donors WHERE id = ?').run(req.donorId);
  res.json({ message: 'Account deleted.' });
});

// GET /api/donors/stats — platform-wide aggregate counts only (no personal
// data), so this stays public and is shown on the homepage to everyone,
// logged in or not.
router.get('/stats', (req, res) => {
  const totalDonors = db.prepare("SELECT COUNT(*) c FROM donors WHERE role = 'donor'").get().c;
  const activeDonors = db.prepare("SELECT COUNT(*) c FROM donors WHERE role = 'donor' AND is_active = 1").get().c;
  const totalRequests = db.prepare('SELECT COUNT(*) c FROM emergency_requests').get().c;
  const openRequests = db.prepare("SELECT COUNT(*) c FROM emergency_requests WHERE status = 'open'").get().c;
  const byGroup = db
    .prepare("SELECT blood_group, COUNT(*) c FROM donors WHERE role = 'donor' AND is_active = 1 GROUP BY blood_group")
    .all();
  res.json({ totalDonors, activeDonors, totalRequests, openRequests, byGroup });
});

module.exports = router;
