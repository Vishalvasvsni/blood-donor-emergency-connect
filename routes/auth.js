const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET, BLOCKED_MESSAGE } = require('../middleware/auth');
const { VALID_GROUPS } = require('../utils/blood');
const { phoneKey, isValidPhone, parseYesNo, ownView } = require('../utils/donor');
const asyncHandler = require('../utils/asyncHandler');
const salesforce = require('../services/salesforce');
const otp = require('../services/otp');
const blocklist = require('../services/blocklist');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_BLOCKED_MESSAGE =
  'This email or mobile number has been blocked by the administrator and cannot be used to register.';

// Syncs a donor/seeker to Salesforce as a Contact. Deliberately swallows any
// Salesforce error — a CRM outage should never stop someone from
// registering or logging into the actual app. Updates the donor row (and
// the in-memory object) with the Salesforce Contact Id on success.
async function syncContactToSalesforce(donor) {
  if (!salesforce.SF_ENABLED) return;
  try {
    const contactId = await salesforce.upsertContact(donor);
    if (contactId && contactId !== donor.salesforce_contact_id) {
      await db.run('UPDATE donors SET salesforce_contact_id = ? WHERE id = ?', [contactId, donor.id]);
      donor.salesforce_contact_id = contactId;
    }
  } catch (err) {
    console.error('Salesforce contact sync failed:', err.message);
  }
}

// Checks ADMIN_EMAIL on every register/login (not just server startup) so
// promotion is instant and doesn't depend on a restart. ADMIN_EMAIL can hold
// more than one address, comma-separated. Beyond this bootstrap list, existing
// admins can also promote any other user from the Admin Panel.
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

// Light per-IP cap on "send OTP" so nobody can burn your SMS/email quota by
// hammering random numbers. (Per-address limits live in services/otp.js.)
const ipHits = new Map();
function ipLimited(ip, max = 30) {
  const now = Date.now();
  const recent = (ipHits.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  const limited = recent.length >= max;
  if (!limited) recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 5000) ipHits.clear();
  return limited;
}

// Turns the raw "target" the browser sent into the canonical value we store
// OTPs against, or returns an { error } to send back.
function normaliseTarget(channel, target) {
  if (channel === 'email') {
    const email = String(target || '').toLowerCase().trim();
    return EMAIL_RE.test(email) ? { value: email } : { error: 'Please enter a valid email address.' };
  }
  if (channel === 'phone') {
    return isValidPhone(target) ? { value: phoneKey(target) } : { error: 'Please enter a valid 10-digit mobile number.' };
  }
  return { error: 'Invalid verification channel.' };
}

// GET /api/auth/verification-config — lets the sign-up page know whether
// OTP verification is on and whether each channel is real or demo mode.
router.get('/verification-config', (req, res) => {
  res.json({
    required: otp.verificationRequired(),
    email: otp.channelMode('email'),
    phone: otp.channelMode('phone'),
  });
});

// POST /api/auth/send-otp  { channel: 'email'|'phone', target }
router.post('/send-otp', asyncHandler(async (req, res) => {
  const { channel, target } = req.body || {};
  if (!otp.verificationRequired()) {
    return res.status(400).json({ error: 'Verification is not required on this server.' });
  }
  const t = normaliseTarget(channel, target);
  if (t.error) return res.status(400).json({ error: t.error });

  const blockArgs = channel === 'email' ? { email: t.value } : { phone: t.value };
  if (await blocklist.isContactBlocked(blockArgs)) {
    return res.status(403).json({ error: CONTACT_BLOCKED_MESSAGE, blocked: true });
  }

  const taken = channel === 'email'
    ? await db.get('SELECT id FROM donors WHERE email = ?', [t.value])
    : await db.get('SELECT id FROM donors WHERE phone_norm = ?', [t.value]);
  if (taken) {
    return res.status(409).json({
      error: channel === 'email'
        ? 'An account with this email already exists. Please log in.'
        : 'An account with this mobile number already exists. Please log in.',
    });
  }

  if (ipLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many verification requests from this network. Please try again later.' });
  }

  try {
    const result = await otp.sendOtp(channel, t.value);
    res.json({ sent: true, mode: result.mode, ...(result.devOtp ? { dev_otp: result.devOtp } : {}) });
  } catch (err) {
    if (err instanceof otp.OtpError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

// POST /api/auth/verify-otp  { channel, target, code } -> { token }
router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { channel, target, code } = req.body || {};
  const t = normaliseTarget(channel, target);
  if (t.error) return res.status(400).json({ error: t.error });
  if (!/^\d{6}$/.test(String(code || '').trim())) {
    return res.status(400).json({ error: 'Please enter the 6-digit code.' });
  }
  try {
    const token = await otp.verifyOtp(channel, t.value, code);
    res.json({ verified: true, token });
  } catch (err) {
    if (err instanceof otp.OtpError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

// POST /api/auth/register  — donor OR seeker (non-donor) registration.
router.post('/register', asyncHandler(async (req, res) => {
  const {
    name, email, password, phone, role, blood_group, city, state, latitude, longitude, age, gender,
    has_sugar, has_bp, email_token, phone_token,
  } = req.body;
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

  const sugar = parseYesNo(has_sugar);
  const bp = parseYesNo(has_bp);
  if (accountRole === 'donor' && (sugar === null || bp === null)) {
    return res.status(400).json({ error: 'Please answer both the Sugar and BP questions (Yes or No).' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const pKey = phoneKey(phone);

  if (await blocklist.isContactBlocked({ email: normalizedEmail, phone: pKey })) {
    return res.status(403).json({ error: CONTACT_BLOCKED_MESSAGE, blocked: true });
  }

  if (await db.get('SELECT id FROM donors WHERE email = ?', [normalizedEmail])) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  if (await db.get('SELECT id FROM donors WHERE phone_norm = ?', [pKey])) {
    return res.status(409).json({ error: 'An account with this mobile number already exists.' });
  }

  // Both contact details must have been verified with an OTP, and the tokens
  // must be for exactly the email/number being registered.
  let verified = 0;
  if (otp.verificationRequired()) {
    if (!otp.isTokenValid(email_token, 'email', normalizedEmail)) {
      return res.status(400).json({ error: 'Please verify your email address with the OTP first.' });
    }
    if (!otp.isTokenValid(phone_token, 'phone', pKey)) {
      return res.status(400).json({ error: 'Please verify your mobile number with the OTP first.' });
    }
    verified = 1;
  }

  const password_hash = bcrypt.hashSync(password, 10);

  const info = await db.run(
    `INSERT INTO donors
       (name, email, password_hash, phone, phone_norm, role, blood_group, city, state, latitude, longitude,
        age, gender, has_sugar, has_bp, email_verified, phone_verified, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name.trim(),
      normalizedEmail,
      password_hash,
      phone.trim(),
      pKey,
      accountRole,
      accountRole === 'donor' ? blood_group : (blood_group || null),
      city.trim(),
      state.trim(),
      latitude ?? null,
      longitude ?? null,
      age ?? null,
      gender ?? null,
      sugar,
      bp,
      verified,
      verified,
      accountRole === 'donor' ? 1 : 0,
    ]
  );

  const donor = await db.get('SELECT * FROM donors WHERE id = ?', [info.lastInsertRowid]);
  await promoteIfAdminEmail(donor);
  await syncContactToSalesforce(donor);
  const token = jwt.sign({ id: donor.id }, JWT_SECRET, { expiresIn: '30d' });

  res.status(201).json({ token, donor: ownView(donor) });
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
  if (donor.is_blocked) {
    return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
  }
  await promoteIfAdminEmail(donor);
  // Only backfill accounts that predate Salesforce being configured, or that
  // failed to sync at register time — avoids an API call on every login.
  if (!donor.salesforce_contact_id) await syncContactToSalesforce(donor);
  await db.releaseExpiredCooldowns();
  const fresh = await db.get('SELECT * FROM donors WHERE id = ?', [donor.id]);
  fresh.is_admin = donor.is_admin;

  const token = jwt.sign({ id: donor.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, donor: ownView(fresh) });
}));

// GET /api/auth/me — used by frontend to restore session
router.get('/me', asyncHandler(async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired.' });
  }
  await db.releaseExpiredCooldowns();
  const donor = await db.get('SELECT * FROM donors WHERE id = ?', [payload.id]);
  if (!donor) return res.status(401).json({ error: 'Account not found.' });
  if (donor.is_blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
  await promoteIfAdminEmail(donor);
  res.json({ donor: ownView(donor) });
}));

module.exports = router;
