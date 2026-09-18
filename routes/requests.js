const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { compatibleDonorGroupsFor, distanceKm, VALID_GROUPS } = require('../utils/blood');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// POST /api/requests — any logged-in account (patient/hospital/NGO) can
// broadcast an urgent need. Requires login like the rest of the site.
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const {
    patient_name, blood_group, units_needed, hospital_name,
    city, state, latitude, longitude, contact_name, contact_phone, urgency, message,
  } = req.body;

  if (!patient_name || !blood_group || !hospital_name || !city || !state || !contact_name || !contact_phone) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  if (!VALID_GROUPS.includes(blood_group)) {
    return res.status(400).json({ error: 'Invalid blood group.' });
  }

  const info = await db.run(
    `INSERT INTO emergency_requests
      (patient_name, blood_group, units_needed, hospital_name, city, state, latitude, longitude, contact_name, contact_phone, urgency, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      patient_name,
      blood_group,
      units_needed || 1,
      hospital_name,
      city,
      state,
      latitude ?? null,
      longitude ?? null,
      contact_name,
      contact_phone,
      urgency || 'high',
      message || null,
    ]
  );

  const created = await db.get('SELECT * FROM emergency_requests WHERE id = ?', [info.lastInsertRowid]);

  // Find matching compatible & active donors nearby to suggest to the requester
  const compatibleGroups = compatibleDonorGroupsFor(blood_group);
  let matches = (await db.all("SELECT * FROM donors WHERE is_active = 1 AND role = 'donor'"))
    .filter((d) => compatibleGroups.includes(d.blood_group));

  matches = matches.map((d) => ({
    id: d.id,
    name: d.name,
    blood_group: d.blood_group,
    city: d.city,
    state: d.state,
    distance_km: latitude && longitude ? (() => {
      const dist = distanceKm(latitude, longitude, d.latitude, d.longitude);
      return dist !== null ? Math.round(dist * 10) / 10 : null;
    })() : null,
  }));
  matches.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));

  res.status(201).json({ request: created, matchingDonorsCount: matches.length, topMatches: matches.slice(0, 5) });
}));

// GET /api/requests — board of emergency requests. Requires login.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status = 'open', blood_group, city } = req.query;
  let rows = await db.all('SELECT * FROM emergency_requests ORDER BY created_at DESC');

  if (status !== 'all') rows = rows.filter((r) => r.status === status);
  if (blood_group) rows = rows.filter((r) => r.blood_group === blood_group);
  if (city) {
    const c = city.toLowerCase();
    rows = rows.filter((r) => r.city.toLowerCase().includes(c) || r.state.toLowerCase().includes(c));
  }

  res.json({ count: rows.length, requests: rows });
}));

// PATCH /api/requests/:id/status — mark fulfilled/expired. Requires login
// (kept open to any logged-in account, not just the original poster, since
// this is an academic-scope project without a full ownership model).
router.patch('/:id/status', requireAuth, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['open', 'fulfilled', 'expired'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const existing = await db.get('SELECT * FROM emergency_requests WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Request not found.' });

  await db.run('UPDATE emergency_requests SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ message: 'Status updated.' });
}));

module.exports = router;
