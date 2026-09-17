const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/users — full list of everyone registered (donors + seekers)
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, phone, role, blood_group, city, state,
           is_active, last_donation_date, age, gender, is_admin, created_at
    FROM donors
    ORDER BY created_at DESC
  `).all();

  res.json({ count: users.length, users });
});

// GET /api/admin/summary — quick counts for an admin overview
router.get('/summary', requireAuth, requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM donors').get().c;
  const totalDonors = db.prepare("SELECT COUNT(*) c FROM donors WHERE role = 'donor'").get().c;
  const totalSeekers = db.prepare("SELECT COUNT(*) c FROM donors WHERE role = 'seeker'").get().c;
  const activeDonors = db.prepare("SELECT COUNT(*) c FROM donors WHERE role = 'donor' AND is_active = 1").get().c;
  const totalRequests = db.prepare('SELECT COUNT(*) c FROM emergency_requests').get().c;
  const openRequests = db.prepare("SELECT COUNT(*) c FROM emergency_requests WHERE status = 'open'").get().c;
  const totalContactReveals = db.prepare('SELECT COUNT(*) c FROM contact_logs').get().c;
  const byGroup = db.prepare("SELECT blood_group, COUNT(*) c FROM donors WHERE role = 'donor' GROUP BY blood_group").all();
  const byCity = db.prepare('SELECT city, COUNT(*) c FROM donors GROUP BY city ORDER BY c DESC LIMIT 10').all();

  res.json({
    totalUsers, totalDonors, totalSeekers, activeDonors,
    totalRequests, openRequests, totalContactReveals,
    byGroup, byCity,
  });
});

// GET /api/admin/requests — every emergency request ever posted
router.get('/requests', requireAuth, requireAdmin, (req, res) => {
  const requests = db.prepare('SELECT * FROM emergency_requests ORDER BY created_at DESC').all();
  res.json({ count: requests.length, requests });
});

// DELETE /api/admin/users/:id — remove a user (moderation)
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.donorId) {
    return res.status(400).json({ error: "You can't delete your own admin account from here." });
  }
  db.prepare('DELETE FROM donors WHERE id = ?').run(req.params.id);
  res.json({ message: 'User deleted.' });
});

module.exports = router;
