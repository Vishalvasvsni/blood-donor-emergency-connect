const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const salesforce = require('../services/salesforce');
const blocklist = require('../services/blocklist');
const phoneemail = require('../services/phoneemail');

const router = express.Router();

// GET /api/admin/users — full list of everyone registered (donors + seekers)
router.get('/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await db.releaseExpiredCooldowns();
  const users = await db.all(`
    SELECT id, name, email, phone, role, blood_group, city, state,
           is_active, last_donation_date, cooldown_until, auto_paused, age, gender,
           has_sugar, has_bp, email_verified, phone_verified,
           is_admin, is_blocked, blocked_reason, created_at
    FROM donors
    ORDER BY created_at DESC
  `);

  res.json({ count: users.length, users });
}));

// GET /api/admin/summary — quick counts for an admin overview
router.get('/summary', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const totalUsers = (await db.get('SELECT COUNT(*) c FROM donors')).c;
  const totalDonors = (await db.get("SELECT COUNT(*) c FROM donors WHERE role = 'donor'")).c;
  const totalSeekers = (await db.get("SELECT COUNT(*) c FROM donors WHERE role = 'seeker'")).c;
  const activeDonors = (await db.get("SELECT COUNT(*) c FROM donors WHERE role = 'donor' AND is_active = 1 AND is_blocked = 0")).c;
  const totalBlocked = (await db.get('SELECT COUNT(*) c FROM donors WHERE is_blocked = 1')).c;
  const totalRequests = (await db.get('SELECT COUNT(*) c FROM emergency_requests')).c;
  const openRequests = (await db.get("SELECT COUNT(*) c FROM emergency_requests WHERE status = 'open'")).c;
  const totalContactReveals = (await db.get('SELECT COUNT(*) c FROM contact_logs')).c;
  const byGroup = await db.all("SELECT blood_group, COUNT(*) c FROM donors WHERE role = 'donor' GROUP BY blood_group");
  const byCity = await db.all('SELECT city, COUNT(*) c FROM donors GROUP BY city ORDER BY c DESC LIMIT 10');

  res.json({
    totalUsers, totalDonors, totalSeekers, activeDonors, totalBlocked,
    totalRequests, openRequests, totalContactReveals,
    byGroup, byCity,
  });
}));

// GET /api/admin/requests — every emergency request ever posted
router.get('/requests', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const requests = await db.all('SELECT * FROM emergency_requests ORDER BY created_at DESC');
  res.json({ count: requests.length, requests });
}));

// DELETE /api/admin/users/:id — remove a user (moderation)
router.delete('/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.donorId) {
    return res.status(400).json({ error: "You can't delete your own admin account from here." });
  }
  await db.run('DELETE FROM donors WHERE id = ?', [req.params.id]);
  res.json({ message: 'User deleted.' });
}));

// PATCH /api/admin/users/:id/promote — grant admin rights to any user.
// There's no limit on how many admins can exist — any current admin can
// promote any other registered user this way, at any time.
router.patch('/users/:id/promote', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const target = await db.get('SELECT id FROM donors WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await db.run('UPDATE donors SET is_admin = 1 WHERE id = ?', [req.params.id]);
  res.json({ message: 'User promoted to admin.' });
}));

// PATCH /api/admin/users/:id/demote — revoke admin rights from a user.
router.patch('/users/:id/demote', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.donorId) {
    return res.status(400).json({ error: "You can't remove your own admin rights from here." });
  }
  const target = await db.get('SELECT id FROM donors WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await db.run('UPDATE donors SET is_admin = 0 WHERE id = ?', [req.params.id]);
  res.json({ message: 'Admin rights revoked.' });
}));

// PATCH /api/admin/users/:id/block — block an account. The person is locked
// out immediately (even if they're logged in right now), disappears from
// search and the request board, and their email + mobile number go on the
// block list so they can't simply register again.
router.patch('/users/:id/block', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const target = await db.get('SELECT * FROM donors WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.donorId) return res.status(400).json({ error: "You can't block your own account." });
  if (target.is_admin) return res.status(400).json({ error: "Revoke this user's admin rights before blocking them." });

  const reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 200) : null;
  if (!target.is_blocked) {
    await db.run(
      "UPDATE donors SET is_blocked = 1, blocked_at = datetime('now'), blocked_reason = ? WHERE id = ?",
      [reason || null, target.id]
    );
    await blocklist.addBlock({
      donorId: target.id, email: target.email, phone: target.phone, reason, blockedBy: req.donorId,
    });
  }
  res.json({ message: `${target.name} has been blocked.` });
}));

// PATCH /api/admin/users/:id/unblock — lift a block (also frees their email
// and mobile number for registration again).
router.patch('/users/:id/unblock', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const target = await db.get('SELECT id, name FROM donors WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await db.run('UPDATE donors SET is_blocked = 0, blocked_at = NULL, blocked_reason = NULL WHERE id = ?', [target.id]);
  await blocklist.removeByDonor(target.id);
  res.json({ message: `${target.name} has been unblocked.` });
}));

// GET /api/admin/blocked — every blocked email / mobile number, including
// those whose account has since been deleted.
router.get('/blocked', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const blocked = await db.all('SELECT * FROM blocked_contacts ORDER BY id DESC');
  res.json({ count: blocked.length, blocked });
}));

// DELETE /api/admin/blocked/:id — remove one entry from the block list.
router.delete('/blocked/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const entry = await db.get('SELECT * FROM blocked_contacts WHERE id = ?', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entry not found.' });
  await db.run('DELETE FROM blocked_contacts WHERE id = ?', [entry.id]);
  if (entry.donor_id) {
    await db.run('UPDATE donors SET is_blocked = 0, blocked_at = NULL, blocked_reason = NULL WHERE id = ?', [entry.donor_id]);
  }
  res.json({ message: 'Removed from the block list.' });
}));


// GET /api/admin/phoneemail-status — helps debug "You are not authorized" in the
// Phone.Email popup: shows which Client ID this server is really using (masked),
// the address to register in the Phone.Email dashboard, and how Phone.Email's
// API reacts to that Client ID right now.
router.get('/phoneemail-status', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!phoneemail.enabledFor('phone')) {
    return res.json({ configured: false });
  }
  const id = phoneemail.clientId();
  const raw = process.env.PHONE_EMAIL_CLIENT_ID || '';
  res.json({
    configured: true,
    clientIdMasked: id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : '(very short — is this the right value?)',
    clientIdLength: id.length,
    hadStrayCharacters: raw !== id,   // spaces / quotes were trimmed off
    siteAddress: `${req.protocol}://${req.get('host')}`,
    registerPage: `${req.protocol}://${req.get('host')}/register.html`,
    probe: await phoneemail.probe(),
  });
}));

// GET /api/admin/salesforce-status — quick way to verify the Salesforce
// connection is configured correctly, without needing to register a test
// user. Shows whether credentials are set and whether authentication
// actually succeeds against your org right now.
router.get('/salesforce-status', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!salesforce.SF_ENABLED) {
    return res.json({ configured: false, message: 'Salesforce environment variables are not set.' });
  }
  try {
    const auth = await salesforce.getAuth();
    res.json({ configured: true, connected: true, instanceUrl: auth.instanceUrl });
  } catch (err) {
    res.json({ configured: true, connected: false, error: err.message });
  }
}));

// POST /api/admin/salesforce-resync — manually (re)sync every existing user
// to Salesforce. Useful right after connecting Salesforce for the first
// time, so accounts created earlier aren't left out.
router.post('/salesforce-resync', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!salesforce.SF_ENABLED) {
    return res.status(400).json({ error: 'Salesforce is not configured.' });
  }
  const users = await db.all('SELECT * FROM donors');
  let synced = 0;
  const errors = [];
  for (const user of users) {
    try {
      const contactId = await salesforce.upsertContact(user);
      if (contactId && contactId !== user.salesforce_contact_id) {
        await db.run('UPDATE donors SET salesforce_contact_id = ? WHERE id = ?', [contactId, user.id]);
      }
      synced++;
    } catch (err) {
      errors.push({ userId: user.id, error: err.message });
    }
  }
  res.json({ total: users.length, synced, errors });
}));

module.exports = router;
