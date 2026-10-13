// Emails / mobile numbers an admin has blocked. A blocked person can't log
// in, and can't register again with the same email or mobile number — even
// if their account is later deleted, because the block lives in its own table.
const db = require('../config/db');
const { emailKey, phoneKey } = require('../utils/donor');

async function isContactBlocked({ email, phone }) {
  const conditions = [];
  const args = [];
  if (email) { conditions.push('email = ?'); args.push(emailKey(email)); }
  if (phone) { conditions.push('phone_norm = ?'); args.push(phoneKey(phone)); }
  if (!conditions.length) return false;
  return !!(await db.get(`SELECT id FROM blocked_contacts WHERE ${conditions.join(' OR ')}`, args));
}

async function addBlock({ donorId, email, phone, reason, blockedBy }) {
  await db.run(
    `INSERT INTO blocked_contacts (donor_id, email, phone_norm, email_original, phone_original, reason, blocked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [donorId, emailKey(email), phoneKey(phone), email, phone, reason || null, blockedBy]
  );
}

async function removeByDonor(donorId) {
  await db.run('DELETE FROM blocked_contacts WHERE donor_id = ?', [donorId]);
}

module.exports = { isContactBlocked, addBlock, removeByDonor };
