const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const BLOCKED_MESSAGE = 'Your account has been blocked by the administrator.';

// Login sessions are tied to the account's CURRENT password: the token carries
// a fingerprint of the password hash, so the instant the password is changed
// or reset, every older session stops working.
function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);
}

function signSession(donor) {
  return jwt.sign({ id: donor.id, pv: passwordFingerprint(donor.password_hash) }, JWT_SECRET, { expiresIn: '30d' });
}

// Sessions created before this existed have no fingerprint; for those, fall
// back to "was the password changed after the token was issued?".
function sessionStillValid(payload, user) {
  if (payload.pv) return payload.pv === passwordFingerprint(user.password_hash);
  return !(user.password_changed_at && (payload.iat || 0) < user.password_changed_at);
}

// Checks the login token AND the live account state on every request, so an
// admin blocking someone (or deleting them) takes effect immediately — not
// whenever their old token happens to expire.
const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  const user = await db.get('SELECT id, is_blocked, password_changed_at, password_hash FROM donors WHERE id = ?', [payload.id]);
  if (!user) {
    return res.status(401).json({ error: 'This account no longer exists. Please log in again.' });
  }
  if (user.is_blocked) {
    return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
  }
  // Changing or resetting the password signs out every older session.
  if (!sessionStillValid(payload, user)) {
    return res.status(401).json({ error: 'Your password was changed. Please log in again.' });
  }

  req.donorId = user.id;
  next();
});

// Must run after requireAuth. Only lets the platform owner (is_admin = 1)
// through — see promoteIfAdminEmail() in routes/auth.js for how that flag
// gets set (checked on every register/login against ADMIN_EMAIL).
const requireAdmin = asyncHandler(async (req, res, next) => {
  const donor = await db.get('SELECT is_admin FROM donors WHERE id = ?', [req.donorId]);
  if (!donor || !donor.is_admin) {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
});

module.exports = { requireAuth, requireAdmin, JWT_SECRET, BLOCKED_MESSAGE, signSession, sessionStillValid, passwordFingerprint };
