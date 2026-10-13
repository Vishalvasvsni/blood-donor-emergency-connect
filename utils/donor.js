// ---------------------------------------------------------------------------
// Shared helpers for donor data: contact normalisation, the donation
// cool-down rule, and what each kind of caller is allowed to see.
// ---------------------------------------------------------------------------

// After donating, a donor is hidden from search for this many days, then
// listed again automatically. Change with the DONATION_COOLDOWN_DAYS env var.
const DONATION_COOLDOWN_DAYS = Math.max(1, parseInt(process.env.DONATION_COOLDOWN_DAYS, 10) || 30);

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// "+91 98765-43210", "09876543210" and "9876543210" are all the same number.
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function isValidPhone(phone) {
  const s = String(phone || '');
  const digits = s.replace(/\D/g, '');
  return /^[0-9+\-\s()]+$/.test(s) && digits.length >= 10 && digits.length <= 13;
}

// Used for block-list matching so a blocked person can't just register again
// with name+tag@gmail.com or n.a.m.e@gmail.com.
function emailKey(email) {
  const [rawLocal = '', rawDomain = ''] = String(email || '').toLowerCase().trim().split('@');
  let local = rawLocal.split('+')[0];
  let domain = rawDomain;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

// Accepts true/false, 1/0, "yes"/"no"; anything else (including "") is null.
function parseYesNo(v) {
  if (v === true || v === 1 || v === '1' || v === 'yes' || v === 'Yes' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'no' || v === 'No' || v === 'false') return 0;
  return null;
}

function cooldownActive(row) {
  return !!(row.auto_paused && row.cooldown_until && row.cooldown_until > todayUTC());
}

// The donor's own view of their account (never includes the password hash).
function ownView(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  const active = cooldownActive(row);
  return {
    ...rest,
    cooldown_active: active,
    available_from: active ? row.cooldown_until : null,
    cooldown_days: DONATION_COOLDOWN_DAYS,
  };
}

// What OTHER logged-in users see in search results. Explicit allow-list: no
// email, phone, exact coordinates, admin flags, etc. (phone only via the
// logged "Reveal Contact" action).
function searchView(row, { distance_km = null, exact_match = null } = {}) {
  return {
    id: row.id,
    name: row.name,
    blood_group: row.blood_group,
    city: row.city,
    state: row.state,
    has_sugar: row.has_sugar,
    has_bp: row.has_bp,
    verified: !!(row.email_verified && row.phone_verified),
    distance_km,
    exact_match,
  };
}

module.exports = {
  DONATION_COOLDOWN_DAYS, todayUTC, addDays, isValidDateStr,
  phoneKey, isValidPhone, emailKey, parseYesNo, cooldownActive, ownView, searchView,
};
