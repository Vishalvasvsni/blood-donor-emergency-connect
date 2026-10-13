const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { compatibleDonorGroupsFor, distanceKm, VALID_GROUPS } = require('../utils/blood');
const {
  DONATION_COOLDOWN_DAYS, todayUTC, addDays, isValidDateStr, parseYesNo, ownView, searchView,
} = require('../utils/donor');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/donors/search — search by blood group + city/proximity.
// Only donors who are switched on, not paused after a recent donation, and
// not blocked are listed. Results contain an explicit allow-list of fields
// (see searchView) — including the Sugar/BP yes/no answers — never the
// donor's email, phone number, or exact coordinates.
// ---------------------------------------------------------------------------
router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const { blood_group, city, lat, lng, exact_match_only, max_km } = req.query;

  await db.releaseExpiredCooldowns();
  let rows = await db.all("SELECT * FROM donors WHERE is_active = 1 AND role = 'donor' AND is_blocked = 0");

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
    return searchView(d, {
      distance_km: dist !== null ? Math.round(dist * 10) / 10 : null,
      exact_match: blood_group ? d.blood_group === blood_group : null,
    });
  });

  if (max_km && userLat !== null && userLng !== null) {
    const maxD = parseFloat(max_km);
    rows = rows.filter((d) => d.distance_km === null || d.distance_km <= maxD);
  }

  // Rank: exact blood group match first, then by distance (nulls last)
  rows.sort((a, b) => {
    if (a.exact_match !== b.exact_match) return a.exact_match ? -1 : 1;
    if (a.distance_km !== null && b.distance_km !== null) return a.distance_km - b.distance_km;
    if (a.distance_km !== null) return -1;
    if (b.distance_km !== null) return 1;
    return 0;
  });

  res.json({ count: rows.length, donors: rows });
}));

// ---------------------------------------------------------------------------
// POST /api/donors/:id/reveal-contact — consent-based contact reveal.
// Requires login so every reveal is attributable to a real account.
// ---------------------------------------------------------------------------
router.post('/:id/reveal-contact', requireAuth, asyncHandler(async (req, res) => {
  await db.releaseExpiredCooldowns();
  const donor = await db.get(
    "SELECT * FROM donors WHERE id = ? AND is_active = 1 AND role = 'donor' AND is_blocked = 0",
    [req.params.id]
  );
  if (!donor) return res.status(404).json({ error: 'Donor not found or currently unavailable.' });

  const requester = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  const { reason } = req.body || {};

  await db.run(
    'INSERT INTO contact_logs (donor_id, requester_name, requester_phone, reason) VALUES (?, ?, ?, ?)',
    [donor.id, requester ? requester.name : 'Unknown user', requester ? requester.phone : null, reason || null]
  );

  res.json({ name: donor.name, phone: donor.phone, blood_group: donor.blood_group, city: donor.city });
}));

// ---------------------------------------------------------------------------
// Authenticated self-service (donors and seekers)
// ---------------------------------------------------------------------------

// GET /api/donors/me/profile
router.get('/me/profile', requireAuth, asyncHandler(async (req, res) => {
  await db.releaseExpiredCooldowns();
  const donor = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  res.json({ donor: ownView(donor) });
}));

// PATCH /api/donors/me/availability — toggle on/off and record the last
// donation date. Saving a donation date within the cool-down window switches
// the donor off automatically (hidden from search) until the window ends,
// then they're switched back on without having to do anything.
router.patch('/me/availability', requireAuth, asyncHandler(async (req, res) => {
  await db.releaseExpiredCooldowns();
  const { is_active, last_donation_date } = req.body;
  const donor = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  if (!donor) return res.status(404).json({ error: 'Donor not found.' });
  if (donor.role !== 'donor') {
    return res.status(400).json({ error: 'Only donor accounts have an availability status. Switch to a donor account first.' });
  }

  let isActive = donor.is_active;
  let autoPaused = donor.auto_paused;
  let cooldownUntil = donor.cooldown_until;
  let lastDate = donor.last_donation_date;
  let cooldownJustApplied = false;
  let message = 'Availability updated.';

  if (last_donation_date !== undefined) {
    if (last_donation_date === null || last_donation_date === '') {
      lastDate = null;
      if (autoPaused) { isActive = 1; autoPaused = 0; cooldownUntil = null; }
    } else {
      if (!isValidDateStr(last_donation_date)) {
        return res.status(400).json({ error: 'Please enter a valid date.' });
      }
      if (last_donation_date > todayUTC()) {
        return res.status(400).json({ error: 'Last donation date cannot be in the future.' });
      }
      lastDate = last_donation_date;
      const until = addDays(lastDate, DONATION_COOLDOWN_DAYS);
      if (until > todayUTC()) {
        isActive = 0; autoPaused = 1; cooldownUntil = until; cooldownJustApplied = true;
        message = `Thank you for donating! You're hidden from search until ${until} and will be listed again automatically.`;
      } else {
        if (autoPaused) isActive = 1;
        autoPaused = 0; cooldownUntil = null;
      }
    }
  }

  // A manual toggle in the same request is ignored if a new cool-down was
  // just applied (the toggle the browser sent is stale by then).
  if (typeof is_active === 'boolean' && !cooldownJustApplied) {
    if (is_active) {
      if (autoPaused && cooldownUntil && cooldownUntil > todayUTC()) {
        return res.status(400).json({
          error: `You donated recently. You'll be listed again automatically on ${cooldownUntil}.`,
          available_from: cooldownUntil,
        });
      }
      isActive = 1;
    } else if (!autoPaused) {
      isActive = 0;
    }
  }

  await db.run(
    'UPDATE donors SET is_active = ?, auto_paused = ?, cooldown_until = ?, last_donation_date = ? WHERE id = ?',
    [isActive, autoPaused, cooldownUntil, lastDate, req.donorId]
  );

  const updated = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  res.json({ donor: ownView(updated), message });
}));

// PATCH /api/donors/me/become-donor — lets a seeker account opt in to donate
router.patch('/me/become-donor', requireAuth, asyncHandler(async (req, res) => {
  const { blood_group, has_sugar, has_bp } = req.body;
  if (!blood_group || !VALID_GROUPS.includes(blood_group)) {
    return res.status(400).json({ error: 'Please select a valid blood group.' });
  }
  const sugar = parseYesNo(has_sugar);
  const bp = parseYesNo(has_bp);
  if (sugar === null || bp === null) {
    return res.status(400).json({ error: 'Please answer both the Sugar and BP questions (Yes or No).' });
  }
  await db.run(
    "UPDATE donors SET role = 'donor', blood_group = ?, has_sugar = ?, has_bp = ?, is_active = 1 WHERE id = ?",
    [blood_group, sugar, bp, req.donorId]
  );
  const updated = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  res.json({ donor: ownView(updated) });
}));

// PATCH /api/donors/me/profile — edit profile details.
// The mobile number and email can't be changed here: they were verified at
// registration, and changing them would break that guarantee.
router.patch('/me/profile', requireAuth, asyncHandler(async (req, res) => {
  const donor = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  if (!donor) return res.status(404).json({ error: 'Donor not found.' });

  const { name, city, state, latitude, longitude, age, gender, blood_group } = req.body;
  const normalizedBloodGroup = blood_group === '' ? null : blood_group;
  if (normalizedBloodGroup && !VALID_GROUPS.includes(normalizedBloodGroup)) {
    return res.status(400).json({ error: 'Invalid blood group.' });
  }

  const sugar = 'has_sugar' in req.body ? parseYesNo(req.body.has_sugar) : donor.has_sugar;
  const bp = 'has_bp' in req.body ? parseYesNo(req.body.has_bp) : donor.has_bp;
  if (donor.role === 'donor' && (sugar === null || bp === null)) {
    return res.status(400).json({ error: 'Please choose Yes or No for both Sugar and BP.' });
  }

  await db.run(
    `UPDATE donors SET
      name = ?, city = ?, state = ?, latitude = ?, longitude = ?, age = ?, gender = ?,
      blood_group = ?, has_sugar = ?, has_bp = ?
    WHERE id = ?`,
    [
      name ?? donor.name,
      city ?? donor.city,
      state ?? donor.state,
      latitude ?? donor.latitude,
      longitude ?? donor.longitude,
      age ?? donor.age,
      gender ?? donor.gender,
      normalizedBloodGroup !== undefined ? normalizedBloodGroup : donor.blood_group,
      sugar,
      bp,
      req.donorId,
    ]
  );

  const updated = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  res.json({ donor: ownView(updated) });
}));

// PATCH /api/donors/me/password
router.patch('/me/password', requireAuth, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  const donor = await db.get('SELECT * FROM donors WHERE id = ?', [req.donorId]);
  if (!donor || !bcrypt.compareSync(current_password || '', donor.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  const password_hash = bcrypt.hashSync(new_password, 10);
  await db.run('UPDATE donors SET password_hash = ? WHERE id = ?', [password_hash, req.donorId]);
  res.json({ message: 'Password updated successfully.' });
}));

// GET /api/donors/me/contact-activity — who viewed my contact info
router.get('/me/contact-activity', requireAuth, asyncHandler(async (req, res) => {
  const logs = await db.all(
    'SELECT * FROM contact_logs WHERE donor_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.donorId]
  );
  res.json({ logs });
}));

// DELETE /api/donors/me — account deletion
router.delete('/me', requireAuth, asyncHandler(async (req, res) => {
  await db.run('DELETE FROM donors WHERE id = ?', [req.donorId]);
  res.json({ message: 'Account deleted.' });
}));

// GET /api/donors/stats — platform-wide aggregate counts only (no personal
// data), so this stays public and is shown on the homepage to everyone.
router.get('/stats', asyncHandler(async (req, res) => {
  await db.releaseExpiredCooldowns();
  const totalDonors = (await db.get("SELECT COUNT(*) c FROM donors WHERE role = 'donor' AND is_blocked = 0")).c;
  const activeDonors = (await db.get("SELECT COUNT(*) c FROM donors WHERE role = 'donor' AND is_active = 1 AND is_blocked = 0")).c;
  const totalRequests = (await db.get('SELECT COUNT(*) c FROM emergency_requests')).c;
  const openRequests = (await db.get("SELECT COUNT(*) c FROM emergency_requests WHERE status = 'open'")).c;
  const byGroup = await db.all("SELECT blood_group, COUNT(*) c FROM donors WHERE role = 'donor' AND is_active = 1 AND is_blocked = 0 GROUP BY blood_group");
  res.json({ totalDonors, activeDonors, totalRequests, openRequests, byGroup });
}));

module.exports = router;
