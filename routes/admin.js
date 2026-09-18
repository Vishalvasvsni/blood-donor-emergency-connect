const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/admin/users — full list of everyone registered (donors + seekers)
router.get('/users', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const users = await db.all(`
    SELECT id, name, email, phone, role, blood_group, city, state,
           is_active, last_donation_date, age, gender, is_admin, created_at
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
  const activeDonors = (await db.get("SELECT COUNT(*) c FROM donors WHERE role = 'donor' AND is_active = 1")).c;
  const totalRequests = (await db.get('SELECT COUNT(*) c FROM emergency_requests')).c;
  const openRequests = (await db.get("SELECT COUNT(*) c FROM emergency_requests WHERE status = 'open'")).c;
  const totalContactReveals = (await db.get('SELECT COUNT(*) c FROM contact_logs')).c;
  const byGroup = await db.all("SELECT blood_group, COUNT(*) c FROM donors WHERE role = 'donor' GROUP BY blood_group");
  const byCity = await db.all('SELECT city, COUNT(*) c FROM donors GROUP BY city ORDER BY c DESC LIMIT 10');

  res.json({
    totalUsers, totalDonors, totalSeekers, activeDonors,
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

module.exports = router;
