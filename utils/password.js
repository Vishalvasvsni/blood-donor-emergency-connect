// ---------------------------------------------------------------------------
// Password rules. Deliberately light: easy for people to follow, but rules out
// the passwords that get guessed first. Applied whenever a password is SET
// (sign-up, changing it, resetting it) — never when logging in, so existing
// accounts keep working.
// ---------------------------------------------------------------------------
const RULES_TEXT = 'Use at least 8 characters, with at least one letter and one number.';

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty123', 'qwertyuiop',
  '12345678', '123456789', '1234567890', '11111111', '00000000', '87654321', 'abcd1234', 'abc12345',
  'iloveyou', 'welcome1', 'welcome123', 'admin123', 'admin1234', 'letmein1', 'india123', 'india@123',
  'donor123', 'blood123', 'test1234', 'user1234', 'pass1234', 'secret123', 'changeme1',
]);

// Returns an error message, or null if the password is acceptable.
function validatePassword(pw, { email = '' } = {}) {
  if (typeof pw !== 'string' || !pw) return 'Please enter a password.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 64 || Buffer.byteLength(pw, 'utf8') > 72) return 'Password is too long (64 characters at most).';
  if (!/[A-Za-z]/.test(pw)) return 'Password must include at least one letter.';
  if (!/\d/.test(pw)) return 'Password must include at least one number.';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Please choose a less obvious one.';
  const local = String(email).toLowerCase().split('@')[0];
  if (local.length >= 4 && lower.includes(local)) return 'Password should not contain your email name.';
  return null;
}

module.exports = { validatePassword, RULES_TEXT };
