const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');
const { VALID_GROUPS } = require('../utils/blood');

const router = express.Router();

function publicDonor(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return rest;
}

// POST /api/auth/register  — donor OR seeker (non-donor) registration.
// Everyone must have an account to use the site, so `role` distinguishes
// people who want to donate from people who only want to search / post
// emergency requests.
router.post('/register', (req, res) => {
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

  const existing = db.prepare('SELECT id FROM donors WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const password_hash = bcrypt.hashSync(password, 10);

  const stmt = db.prepare(`
    INSERT INTO donors (name, email, password_hash, phone, role, blood_group, city, state, latitude, longitude, age, gender, is_active)
    VALUES (@name, @email, @password_hash, @phone, @role, @blood_group, @city, @state, @latitude, @longitude, @age, @gender, @is_active)
  `);

  const info = stmt.run({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password_hash,
    phone: phone.trim(),
    role: accountRole,
    blood_group: accountRole === 'donor' ? blood_group : (blood_group || null),
    city: city.trim(),
    state: state.trim(),
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    age: age ?? null,
    gender: gender ?? null,
    is_active: accountRole === 'donor' ? 1 : 0,
  });

  const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(info.lastInsertRowid);
  const token = jwt.sign({ id: donor.id }, JWT_SECRET, { expiresIn: '30d' });

  res.status(201).json({ token, donor: publicDonor(donor) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const donor = db.prepare('SELECT * FROM donors WHERE email = ?').get(email.toLowerCase().trim());
  if (!donor || !bcrypt.compareSync(password, donor.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = jwt.sign({ id: donor.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, donor: publicDonor(donor) });
});

// GET /api/auth/me — used by frontend to restore session
router.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(payload.id);
    if (!donor) return res.status(401).json({ error: 'Account not found.' });
    res.json({ donor: publicDonor(donor) });
  } catch {
    res.status(401).json({ error: 'Session expired.' });
  }
});

module.exports = router;
