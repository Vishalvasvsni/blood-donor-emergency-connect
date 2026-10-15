// ---------------------------------------------------------------------------
// Email verification with Firebase Authentication (free Spark plan).
//
// Firebase creates a throw-away account for the email, emails the person a
// verification link, and once they click it the account's emailVerified flag
// turns true. We then hand Firebase's signed ID token to OUR server, which
// checks Google's signature itself (routes/auth.js -> services/firebase.js).
// Your real user accounts and passwords stay in your own database — the
// Firebase account is deleted as soon as the check succeeds.
// ---------------------------------------------------------------------------
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, onAuthStateChanged, signOut, deleteUser,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

let auth;

// The throw-away account's password is random and never shown. We keep it in
// this browser so a retry (or page reload) can sign back in to the same account.
const pwKey = (email) => 'bdec_fb_pw:' + email;
function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

window.BDECFirebase = {
  init(config) {
    if (!auth) auth = getAuth(initializeApp(config));
  },

  // Resolves to the email of a verification already in progress in this
  // browser (e.g. the page was reloaded while waiting), or null.
  restore() {
    return new Promise((resolve) => {
      const off = onAuthStateChanged(auth, (u) => { off(); resolve(u ? u.email : null); });
    });
  },

  // Creates (or signs back in to) the throw-away account and emails the link.
  // -> { verified: true } if that email was already verified, else { verified: false }
  async startEmailVerification(rawEmail) {
    const email = rawEmail.trim().toLowerCase();
    let user;
    if (auth.currentUser && auth.currentUser.email === email) {
      user = auth.currentUser;
    } else {
      const stored = localStorage.getItem(pwKey(email));
      try {
        const password = stored || randomPassword();
        user = (await createUserWithEmailAndPassword(auth, email, password)).user;
        localStorage.setItem(pwKey(email), password);
      } catch (err) {
        if (err.code !== 'auth/email-already-in-use') throw err;
        if (!stored) {
          // A verification for this email was started from another browser/device.
          const e = new Error('Verification for this email was started elsewhere.');
          e.code = 'bdec/started-elsewhere';
          throw e;
        }
        user = (await signInWithEmailAndPassword(auth, email, stored)).user;
      }
    }
    await user.reload();
    if (user.emailVerified) return { verified: true };
    await sendEmailVerification(user);
    return { verified: false };
  },

  async resend() {
    if (!auth.currentUser) throw new Error('No verification in progress.');
    await sendEmailVerification(auth.currentUser);
  },

  // Returns Firebase's signed ID token once the link has been clicked, else null.
  async checkVerified() {
    const user = auth.currentUser;
    if (!user) return null;
    await user.reload();
    return user.emailVerified ? user.getIdToken(true) : null;
  },

  // Verification succeeded and our server accepted it: remove the throw-away account.
  async finish() { await this.cancel(); },

  // Abandon / clean up (also used when the person edits the email).
  async cancel() {
    const user = auth && auth.currentUser;
    const email = user && user.email;
    try { if (user) await deleteUser(user); } catch (e) { /* needs a recent sign-in; harmless */ }
    try { await signOut(auth); } catch (e) { /* ignore */ }
    if (email) localStorage.removeItem(pwKey(email));
  },
};

window.dispatchEvent(new Event('bdec-firebase-ready'));
