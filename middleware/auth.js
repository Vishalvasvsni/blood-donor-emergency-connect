const jwt = require('jsonwebtoken');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const BLOCKED_MESSAGE = 'Your account has been blocked by the administrator.';

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

  const user = await db.get('SELECT id, is_blocked FROM donors WHERE id = ?', [payload.id]);
  if (!user) {
    return res.status(401).json({ error: 'This account no longer exists. Please log in again.' });
  }
  if (user.is_blocked) {
    return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
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

module.exports = { requireAuth, requireAdmin, JWT_SECRET, BLOCKED_MESSAGE };
