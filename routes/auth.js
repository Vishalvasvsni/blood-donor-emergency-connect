const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');
const { VALID_GROUPS } = require('../utils/blood');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function publicDonor(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return rest;
}

// Checks ADMIN_EMAIL on every register/login (not just server startup) so
// promotion is instant and doesn't depend on a restart — important on hosts
// like Render's free tier where a restart can wipe a non-persistent database.
// ADMIN_EMAIL can hold more than one address, comma-separated, e.g.
// "owner@example.com, cofounder@example.com" — every matching account gets
// promoted. Beyond this bootstrap list, existing admins can also promote
// any other user from the Admin Panel (see routes/admin.js), so the total
// number of admins isn't limited to what's in this env var.
function adminEmailList() {
  return (process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
}

async function promoteIfAdminEmail(donor) {
  if (adminEmailList().includes(donor.email) && !donor.is_admin) {
    await db.run('UPDATE donors SET is_admin = 1 WHERE id = ?', [donor.id]);
    donor.is_admin = 1;
  }
  return donor;
}

// POST /api/auth/register  — donor OR seeker (non-donor) registration.
// Everyone must have an account to use the site, so `role` distinguishes
// people who want to donate from people who only want to search / post
// emergency requests.
router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, blood_group, city, state, latitude, longitude, age, gender } = req.body;
  const accountRole = role === 'seeker' ? 'seeker' : 'donor';

  if (!name || !email || !password || !phone || !city || !state) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  if (accountRole === 'donor') {
    if (!blood_group || !VALID_GROUPS.includes(blood_group)) {
      return res.status(400).json({ error: 'Please select a valid blood group.' });
    }
  } else if (blood_group && !VALID_GROUPS.includes(blood_group)) {
    return res.status(400).json({ error: 'Invalid blood group.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const phoneRe = /^[0-9+\-\s]{7,15}$/;
  if (!phoneRe.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await db.get('SELECT id FROM donors WHERE email = ?', [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const password_hash = bcrypt.hashSync(password, 10);

  const info = await db.run(
    `INSERT INTO donors (name, email, password_hash, phone, role, blood_group, city, state, latitude, longitude, age, gender, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name.trim(),
      normalizedEmail,
      password_hash,
      phone.trim(),
      accountRole,
      accountRole === 'donor' ? blood_group : (blood_group || null),
      city.trim(),
      state.trim(),
      latitude ?? null,
      longitude ?? null,
      age ?? null,
      gender ?? null,
      accountRole === 'donor' ? 1 : 0,
    ]
  );

  const donor = await db.get('SELECT * FROM donors WHERE id = ?', [info.lastInsertRowid]);
  await promoteIfAdminEmail(donor);
  const token = jwt.sign({ id: donor.id }, JWT_SECRET, { expiresIn: '30d' });

  res.status(201).json({ token, donor: publicDonor(donor) });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const donor = await db.get('SELECT * FROM donors WHERE email = ?', [email.toLowerCase().trim()]);
  if (!donor || !bcrypt.compareSync(password, donor.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  await promoteIfAdminEmail(donor);

  const token = jwt.sign({ id: donor.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, donor: publicDonor(donor) });
}));

// GET /api/auth/me — used by frontend to restore session
router.get('/me', asyncHandler(async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const donor = await db.get('SELECT * FROM donors WHERE id = ?', [payload.id]);
    if (!donor) return res.status(401).json({ error: 'Account not found.' });
    await promoteIfAdminEmail(donor);
    res.json({ donor: publicDonor(donor) });
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
}));

module.exports = router;
