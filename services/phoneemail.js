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
// The dashboard-generated button variant returns a user_json_url instead; both
// are supported (see phoneFromJsonUrl).
//
// Env: PHONE_EMAIL_CLIENT_ID (turns it on), PHONE_EMAIL_COUNTRY_CODES
// (default "91").
// ---------------------------------------------------------------------------
const { fetchWithTimeout } = require('../utils/http');

class ProofError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Trim stray whitespace/quotes: a Client ID pasted into Render with a trailing
// space, newline or quote makes Phone.Email reject it as "not authorized".
const clientId = () => (process.env.PHONE_EMAIL_CLIENT_ID || '').trim().replace(/^["']+|["']+$/g, '').trim();
// Extra hosts allowed for the JSON link — for automated tests only.
const extraHosts = () => (process.env.PHONE_EMAIL_EXTRA_JSON_HOSTS || '').split(',').map((x) => x.trim()).filter(Boolean);
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

// The dashboard-generated "Sign in with Phone" button gives the page a
// user_json_url (e.g. https://user.phone.email/user_abc123.json). The browser
// supplies that address, so it is locked down hard: only Phone.Email's own
// host, https, a plain "<name>.json" path, and no redirects. Otherwise someone
// could point us at their own server and "verify" any number.
async function readUserJson(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { throw new ProofError(400, 'Invalid verification link.'); }
  const extras = extraHosts();
  const hostOk = u.host === 'user.phone.email' || extras.includes(u.host);
  const protocolOk = u.protocol === 'https:' || (extras.includes(u.host) && u.protocol === 'http:');
  if (!hostOk || !protocolOk || u.username || u.password || !/^\/[A-Za-z0-9_.\-]+\.json$/.test(u.pathname)) {
    throw new ProofError(400, 'Invalid verification link.');
  }
  const res = await fetchWithTimeout(u.toString(), { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) throw new ProofError(400, 'Invalid verification link.');   // never follow redirects
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new ProofError(400, 'Mobile verification failed or has expired. Please try again.');
  return data;
}

async function phoneFromJsonUrl(url) {
  const data = await readUserJson(url);
  return normalisePhone(data.user_country_code, data.user_phone_number);
}

// Admin diagnostic: asks Phone.Email's API about a made-up token, so the
// admin can see whether it is reachable and how it reacts to our Client ID.
async function probe() {
  try {
    const form = new FormData();
    form.append('access_token', 'diagnostic-check');
    form.append('client_id', clientId());
    const res = await fetchWithTimeout(apiUrl(), { method: 'POST', body: form });
    return { reachable: true, httpStatus: res.status, body: (await res.text()).slice(0, 300) };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}

module.exports = { ProofError, enabledFor, clientId, phoneFromAccessToken, phoneFromJsonUrl, probe };
