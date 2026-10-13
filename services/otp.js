// ---------------------------------------------------------------------------
// One-time-password verification for email addresses and mobile numbers.
//
// Flow: send-otp -> user types the 6-digit code -> verify-otp returns a
// short-lived signed token -> registration must include both tokens, and the
// server checks them. Codes are stored hashed, expire after 10 minutes, allow
// 5 wrong attempts, and are rate limited per address/number.
//
// Delivery (all plain HTTPS — Render's free tier blocks SMTP):
//   email: Brevo transactional API   (BREVO_API_KEY + EMAIL_FROM)
//   SMS:   Fast2SMS (India) or Twilio (FAST2SMS_API_KEY / TWILIO_*)
// If a channel has no provider, OTP_DEV_MODE=true switches it to DEMO mode:
// the code is printed in the server log and returned to the browser. Demo
// mode proves nothing about who owns the email/number — never leave it on
// for real users.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');
const { fetchWithTimeout } = require('../utils/http');

const OTP_TTL_MIN = 10;
const RESEND_COOLDOWN_SEC = 30;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const DEV_MODE = process.env.OTP_DEV_MODE === 'true';
const APP_NAME = 'Blood Donor Emergency Connect';

class OtpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function verificationRequired() {
  return process.env.REQUIRE_VERIFICATION !== 'false';
}

function smsProvider() {
  if (process.env.FAST2SMS_API_KEY) return 'fast2sms';
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return 'twilio';
  return null;
}

// 'provider' = real delivery, 'dev' = demo mode, 'none' = not available
function channelMode(channel) {
  const configured = channel === 'email'
    ? !!(process.env.BREVO_API_KEY && process.env.EMAIL_FROM)
    : !!smsProvider();
  if (configured) return 'provider';
  return DEV_MODE ? 'dev' : 'none';
}

function hashCode(channel, target, code) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`${channel}:${target}:${code}`).digest('hex');
}

async function sendEmail(to, code) {
  const res = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: process.env.EMAIL_FROM_NAME || APP_NAME, email: process.env.EMAIL_FROM },
      to: [{ email: to }],
      subject: `${code} is your ${APP_NAME} verification code`,
      htmlContent:
        `<p>Your verification code is:</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p>` +
        `<p>It is valid for ${OTP_TTL_MIN} minutes. If you didn't request it, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

async function sendSms(phone10, code) {
  const provider = smsProvider();
  if (provider === 'fast2sms') {
    const res = await fetchWithTimeout('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: process.env.FAST2SMS_API_KEY, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ route: 'otp', variables_values: code, numbers: phone10 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.return === false) throw new Error(`Fast2SMS ${res.status}: ${JSON.stringify(data)}`);
    return;
  }
  // Twilio
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const res = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: `+${process.env.SMS_COUNTRY_CODE || '91'}${phone10}`,
      From: process.env.TWILIO_FROM,
      Body: `${code} is your ${APP_NAME} verification code. Valid for ${OTP_TTL_MIN} minutes.`,
    }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
}

// target = lower-cased email, or the 10-digit mobile number
async function sendOtp(channel, target) {
  const mode = channelMode(channel);
  if (mode === 'none') {
    throw new OtpError(503, `${channel === 'email' ? 'Email' : 'Mobile'} verification isn't set up on this server yet. Please contact the administrator.`);
  }

  const recent = await db.get(
    `SELECT id FROM otp_codes WHERE channel = ? AND target = ? AND created_at > datetime('now', ?)`,
    [channel, target, `-${RESEND_COOLDOWN_SEC} seconds`]
  );
  if (recent) throw new OtpError(429, `Please wait ${RESEND_COOLDOWN_SEC} seconds before requesting another code.`);

  const hourly = await db.get(
    `SELECT COUNT(*) c FROM otp_codes WHERE channel = ? AND target = ? AND created_at > datetime('now', '-1 hour')`,
    [channel, target]
  );
  if (hourly.c >= MAX_PER_HOUR) throw new OtpError(429, 'Too many codes requested. Please try again in an hour.');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const { lastInsertRowid } = await db.run(
    `INSERT INTO otp_codes (channel, target, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', ?))`,
    [channel, target, hashCode(channel, target, code), `+${OTP_TTL_MIN} minutes`]
  );

  if (mode === 'dev') {
    console.log(`[OTP DEMO MODE] ${channel} code for ${target}: ${code}`);
    return { mode, devOtp: code };
  }

  try {
    if (channel === 'email') await sendEmail(target, code);
    else await sendSms(target, code);
  } catch (err) {
    await db.run('DELETE FROM otp_codes WHERE id = ?', [lastInsertRowid]);
    console.error(`OTP ${channel} delivery failed:`, err.message);
    throw new OtpError(502, `We couldn't send the code right now. Please check the ${channel === 'email' ? 'email address' : 'number'} and try again in a moment.`);
  }
  return { mode };
}

async function verifyOtp(channel, target, code) {
  const row = await db.get(
    `SELECT * FROM otp_codes
     WHERE channel = ? AND target = ? AND consumed = 0 AND expires_at > datetime('now')
     ORDER BY id DESC LIMIT 1`,
    [channel, target]
  );
  if (!row) throw new OtpError(400, 'This code has expired or was never requested. Please request a new one.');
  if (row.attempts >= MAX_ATTEMPTS) throw new OtpError(429, 'Too many wrong attempts. Please request a new code.');

  const expected = Buffer.from(row.code_hash);
  const given = Buffer.from(hashCode(channel, target, String(code || '').trim()));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    await db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw new OtpError(400, 'Incorrect code. Please check it and try again.');
  }

  await db.run('UPDATE otp_codes SET consumed = 1 WHERE id = ?', [row.id]);
  return jwt.sign({ purpose: 'contact-verify', channel, target }, JWT_SECRET, { expiresIn: '30m' });
}

function isTokenValid(token, channel, target) {
  if (!token) return false;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return p.purpose === 'contact-verify' && p.channel === channel && p.target === target;
  } catch {
    return false;
  }
}

module.exports = { OtpError, DEV_MODE, verificationRequired, channelMode, sendOtp, verifyOtp, isTokenValid };
