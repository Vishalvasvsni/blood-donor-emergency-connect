// ---------------------------------------------------------------------------
// Salesforce integration.
//
// Syncs every registered user (donor or seeker) to Salesforce as a Contact,
// and every emergency request as a Case linked to that Contact. This is
// entirely additive: if Salesforce isn't configured (no env vars set), every
// function here is a no-op and the app behaves exactly as it did before —
// registration, login, and posting requests never fail or slow down because
// of a Salesforce problem.
//
// Auth: uses the OAuth 2.0 Username-Password flow, which is the simplest
// way to get a server (no user sitting at a browser) talking to Salesforce.
// You'll need a Connected App's Consumer Key/Secret, plus your Salesforce
// username and "password + security token" concatenated together — see the
// README section "Salesforce Integration" for the full setup walkthrough.
// ---------------------------------------------------------------------------

const API_VERSION = 'v59.0';
const REQUEST_TIMEOUT_MS = 10000; // never let a slow Salesforce call hang the user's request

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Salesforce request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const SF_ENABLED = !!(
  process.env.SALESFORCE_CLIENT_ID &&
  process.env.SALESFORCE_CLIENT_SECRET &&
  process.env.SALESFORCE_USERNAME &&
  process.env.SALESFORCE_PASSWORD
);

let cachedAuth = null; // { accessToken, instanceUrl }

async function authenticate() {
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.SALESFORCE_CLIENT_ID,
    client_secret: process.env.SALESFORCE_CLIENT_SECRET,
    username: process.env.SALESFORCE_USERNAME,
    password: process.env.SALESFORCE_PASSWORD, // your password + security token, concatenated
  });

  const res = await fetchWithTimeout(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce authentication failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedAuth = { accessToken: data.access_token, instanceUrl: data.instance_url };
  return cachedAuth;
}

async function getAuth() {
  if (!cachedAuth) await authenticate();
  return cachedAuth;
}

// Makes an authenticated request to the Salesforce REST API. Automatically
// re-authenticates once and retries if the cached token has expired (401).
async function sfRequest(method, path, body, isRetry = false) {
  const auth = await getAuth();
  const res = await fetchWithTimeout(`${auth.instanceUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !isRetry) {
    cachedAuth = null;
    return sfRequest(method, path, body, true);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce API error (${res.status}) on ${method} ${path}: ${text}`);
  }

  if (res.status === 204) return null; // no content, e.g. successful PATCH
  return res.json();
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return { firstName, lastName }; // Salesforce Contacts require a LastName
}

// Creates or updates a Salesforce Contact for this donor/seeker. Returns the
// Salesforce Contact Id (or null if Salesforce isn't configured).
async function upsertContact(donor) {
  if (!SF_ENABLED) return null;
  const { firstName, lastName } = splitName(donor.name);

  const payload = {
    FirstName: firstName,
    LastName: lastName,
    Email: donor.email,
    Phone: donor.phone,
    MailingCity: donor.city,
    MailingState: donor.state,
    Description: [
      `App role: ${donor.role}`,
      donor.blood_group ? `Blood group: ${donor.blood_group}` : null,
      `App user ID: ${donor.id}`,
    ].filter(Boolean).join(' | '),
  };

  if (donor.salesforce_contact_id) {
    await sfRequest('PATCH', `/services/data/${API_VERSION}/sobjects/Contact/${donor.salesforce_contact_id}`, payload);
    return donor.salesforce_contact_id;
  }

  const result = await sfRequest('POST', `/services/data/${API_VERSION}/sobjects/Contact`, payload);
  return result.id;
}

const URGENCY_TO_PRIORITY = { critical: 'High', high: 'High', medium: 'Medium', low: 'Low' };
const STATUS_TO_SF = { open: 'New', fulfilled: 'Closed', expired: 'Closed' };

// Creates a Salesforce Case for an emergency request, optionally linked to
// the poster's Contact. Returns the Salesforce Case Id.
async function createCase(request, posterContactId) {
  if (!SF_ENABLED) return null;

  const payload = {
    Subject: `Blood needed: ${request.blood_group} for ${request.patient_name}`,
    Description: [
      `Hospital: ${request.hospital_name}`,
      `Location: ${request.city}, ${request.state}`,
      `Units needed: ${request.units_needed}`,
      `Contact: ${request.contact_name} (${request.contact_phone})`,
      request.message ? `Message: ${request.message}` : null,
      `App request ID: ${request.id}`,
    ].filter(Boolean).join('\n'),
    Priority: URGENCY_TO_PRIORITY[request.urgency] || 'Medium',
    Status: STATUS_TO_SF[request.status] || 'New',
    Origin: 'Blood Donor Emergency Connect',
  };
  if (posterContactId) payload.ContactId = posterContactId;

  const result = await sfRequest('POST', `/services/data/${API_VERSION}/sobjects/Case`, payload);
  return result.id;
}

// Keeps the Salesforce Case's status aligned when a request is marked
// fulfilled/expired/reopened in the app.
async function updateCaseStatus(caseId, appStatus) {
  if (!SF_ENABLED || !caseId) return;
  await sfRequest('PATCH', `/services/data/${API_VERSION}/sobjects/Case/${caseId}`, {
    Status: STATUS_TO_SF[appStatus] || 'New',
  });
}

module.exports = { SF_ENABLED, upsertContact, createCase, updateCaseStatus, getAuth };
