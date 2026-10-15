// ---------------------------------------------------------------------------
// Phone.Email (https://www.phone.email): "Sign in with Phone" verification.
//
// The user verifies their mobile number inside Phone.Email's own popup (it
// sends the SMS). The popup hands the browser an access_token; THIS SERVER
// then exchanges it with Phone.Email for the verified number:
//
//   POST https://eapi.phone.email/getuser   (access_token + our client_id)
//     -> { status: 200, country_code: "+91", phone_no: "9876543210", ... }
//
// The browser never gets to say which number it verified.
//
// Env: PHONE_EMAIL_CLIENT_ID (turns it on), PHONE_EMAIL_COUNTRY_CODES
// (default "91").
// ---------------------------------------------------------------------------
const { fetchWithTimeout } = require('../utils/http');

class ProofError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const clientId = () => process.env.PHONE_EMAIL_CLIENT_ID || '';
const apiUrl = () => process.env.PHONE_EMAIL_API_URL || 'https://eapi.phone.email/getuser';

// Mobile numbers only. (Email goes through Firebase.)
function enabledFor(channel) {
  return channel === 'phone' && !!clientId();
}

function allowedCountryCodes() {
  return (process.env.PHONE_EMAIL_COUNTRY_CODES || '91').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
}

// -> { key: '9876543210', display: '+91 9876543210' }
function normalisePhone(countryCode, number) {
  const cc = String(countryCode || '').replace(/\D/g, '');
  const digits = String(number || '').replace(/\D/g, '');
  if (!cc || !digits) throw new ProofError(400, 'Phone.Email did not return a mobile number. Please try again.');
  const allowed = allowedCountryCodes();
  if (!allowed.includes(cc)) {
    throw new ProofError(400, `Only mobile numbers with country code ${allowed.map((c) => '+' + c).join(' or ')} can be registered.`);
  }
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  if (national.length !== 10) throw new ProofError(400, 'That does not look like a valid 10-digit mobile number.');
  return { key: national, display: `+${cc} ${national}` };
}

async function phoneFromAccessToken(accessToken) {
  if (!accessToken || accessToken.length > 2000) throw new ProofError(400, 'Missing verification token.');
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('client_id', clientId());
  const res = await fetchWithTimeout(apiUrl(), { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status !== 200) {
    throw new ProofError(400, 'Mobile verification failed or has expired. Please try again.');
  }
  return normalisePhone(data.country_code, data.phone_no);
}

module.exports = { ProofError, enabledFor, clientId, phoneFromAccessToken };
