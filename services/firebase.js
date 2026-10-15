// ---------------------------------------------------------------------------
// Firebase Authentication as the verification service.
//
// The browser verifies an email with Firebase (it creates a throw-away
// Firebase account and Firebase emails a verification link; the person clicks
// it) and ends up holding a Firebase ID token showing email_verified = true. We never trust what the browser SAYS it verified: this module checks
// the token's Google signature on the server and reads the verified
// email out of the signed claims. Only then do we hand back our own
// short-lived proof token that registration requires.
//
// Needs no secrets: verifying an ID token only needs the (public) project id
// and Google's published public keys.
//
// Env: FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID (all three
// turn it on), FIREBASE_APP_ID (optional).
// ---------------------------------------------------------------------------
const jwt = require('jsonwebtoken');
const { fetchWithTimeout } = require('../utils/http');

class ProofError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const projectId = () => process.env.FIREBASE_PROJECT_ID || '';
const certsUrl = () =>
  process.env.FIREBASE_CERTS_URL ||
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

function configured() {
  return !!(process.env.FIREBASE_API_KEY && process.env.FIREBASE_AUTH_DOMAIN && process.env.FIREBASE_PROJECT_ID);
}

// Email only, deliberately: Firebase's SMS verification needs a paid billing
// plan, whereas email-link verification is free. Mobile numbers are verified
// through Phone.Email instead (services/phoneemail.js).
function enabledFor(channel) {
  return channel === 'email' && configured();
}

// These values are public by design (they ship in every Firebase web app).
function webConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    appId: process.env.FIREBASE_APP_ID || undefined,
  };
}

// Google's signing certificates, cached for as long as Google says to.
let certCache = { certs: null, expires: 0 };
async function getCerts(force) {
  if (!force && certCache.certs && Date.now() < certCache.expires) return certCache.certs;
  const res = await fetchWithTimeout(certsUrl());
  if (!res.ok) throw new Error(`Could not fetch Google signing keys (${res.status})`);
  const certs = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  certCache = { certs, expires: Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000 };
  return certs;
}

// Returns the verified claims, or throws ProofError (bad/expired token) or a
// plain Error (couldn't reach Google).
async function verifyIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 6000) {
    throw new ProofError(400, 'Missing verification token.');
  }
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || decoded.header.alg !== 'RS256' || !decoded.header.kid) {
    throw new ProofError(400, 'Invalid verification token.');
  }

  let certs = await getCerts(false);
  let cert = certs[decoded.header.kid];
  if (!cert) { // Google rotates keys; refresh once before giving up
    certs = await getCerts(true);
    cert = certs[decoded.header.kid];
  }
  if (!cert) throw new ProofError(400, 'Invalid verification token.');

  let payload;
  try {
    payload = jwt.verify(idToken, cert, {
      algorithms: ['RS256'],
      audience: projectId(),
      issuer: `https://securetoken.google.com/${projectId()}`,
      clockTolerance: 10,
    });
  } catch {
    throw new ProofError(400, 'Verification expired or invalid. Please try again.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new ProofError(400, 'Invalid verification token.');

  // (No "signed in within N minutes" rule: with email verification the
  // person signs in first and may take a while to open the email. The token's
  // own 1-hour expiry, checked above, is the freshness limit.)
  return payload;
}

function emailFromClaims(claims) {
  const email = String(claims.email || '').toLowerCase().trim();
  if (!email) throw new ProofError(400, 'This verification does not include an email address.');
  if (claims.email_verified !== true) throw new ProofError(400, 'That email address has not been verified yet.');
  return email;
}

module.exports = { ProofError, configured, enabledFor, webConfig, verifyIdToken, emailFromClaims };
