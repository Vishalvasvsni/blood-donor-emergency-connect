const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const { phoneKey, DONATION_COOLDOWN_DAYS } = require('../utils/donor');

// ---------------------------------------------------------------------------
// Database connection.
//
// - Local development: uses a plain SQLite file on disk (same as before).
// - Production: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (free, permanent
//   cloud database from turso.tech) and every read/write goes there instead
//   — this is what makes donor/user data survive Render's free-tier
//   restarts, redeploys, and spin-downs, which wipe local files.
//
// Both modes speak the exact same SQL dialect (libSQL = SQLite), so the rest
// of the app doesn't need to know or care which one is active.
// ---------------------------------------------------------------------------

const dbDir = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const localDbPath = process.env.DB_PATH || path.join(dbDir, 'blood_donor.db');

const usingTurso = !!process.env.TURSO_DATABASE_URL;
const client = usingTurso
  ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: `file:${localDbPath}` });

// ---------------------------------------------------------------------------
// Small async helpers so route files can stay close to the familiar
// prepare/get/all/run shape, just with `await` in front. All queries use
// positional `?` placeholders — pass values in an array in the same order
// as the placeholders appear in the SQL.
// ---------------------------------------------------------------------------
async function get(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows[0] || null;
}

async function all(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows;
}

async function run(sql, args = []) {
  const result = await client.execute({ sql, args });
  return {
    // lastInsertRowid comes back as a BigInt from libsql — convert to a
    // regular Number since IDs here are always small, safe integers, and
    // BigInt can't be sent through JSON.stringify (used in every response).
    lastInsertRowid: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
    changes: result.rowsAffected,
  };
}

// Donors paused automatically after a donation are switched back on once
// their cool-down date arrives. Run lazily (before searches etc.) rather than
// on a timer, so it still works when a free host has put the app to sleep.
async function releaseExpiredCooldowns() {
  await client.execute(
    `UPDATE donors SET is_active = 1, auto_paused = 0, cooldown_until = NULL
     WHERE auto_paused = 1 AND cooldown_until IS NOT NULL AND cooldown_until <= date('now')`
  );
}

// ---------------------------------------------------------------------------
// Schema + migrations. Called once at server startup (see server.js).
// ---------------------------------------------------------------------------
async function initDb() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS donors (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        email           TEXT    NOT NULL UNIQUE,
        password_hash   TEXT    NOT NULL,
        phone           TEXT    NOT NULL,
        phone_norm      TEXT,
        role            TEXT    NOT NULL DEFAULT 'donor' CHECK(role IN ('donor','seeker')),
        blood_group     TEXT    CHECK(blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
        city            TEXT    NOT NULL,
        state           TEXT    NOT NULL,
        latitude        REAL,
        longitude       REAL,
        is_active       INTEGER NOT NULL DEFAULT 1,
        last_donation_date TEXT,
        auto_paused     INTEGER NOT NULL DEFAULT 0,
        cooldown_until  TEXT,
        age             INTEGER,
        gender          TEXT,
        has_sugar       INTEGER,
        has_bp          INTEGER,
        email_verified  INTEGER NOT NULL DEFAULT 0,
        phone_verified  INTEGER NOT NULL DEFAULT 0,
        is_admin        INTEGER NOT NULL DEFAULT 0,
        is_blocked      INTEGER NOT NULL DEFAULT 0,
        blocked_at      TEXT,
        blocked_reason  TEXT,
        salesforce_contact_id TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS emergency_requests (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_name    TEXT    NOT NULL,
        blood_group     TEXT    NOT NULL CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
        units_needed    INTEGER NOT NULL DEFAULT 1,
        hospital_name   TEXT    NOT NULL,
        city            TEXT    NOT NULL,
        state           TEXT    NOT NULL,
        latitude        REAL,
        longitude       REAL,
        contact_name    TEXT    NOT NULL,
        contact_phone   TEXT    NOT NULL,
        urgency         TEXT    NOT NULL DEFAULT 'high' CHECK(urgency IN ('low','medium','high','critical')),
        message         TEXT,
        status          TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','fulfilled','expired')),
        posted_by       INTEGER REFERENCES donors(id) ON DELETE SET NULL,
        salesforce_case_id TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        donor_id        INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
        requester_name  TEXT,
        requester_phone TEXT,
        reason          TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        channel         TEXT    NOT NULL CHECK(channel IN ('email','phone')),
        target          TEXT    NOT NULL,
        code_hash       TEXT    NOT NULL,
        expires_at      TEXT    NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        consumed        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Emails/mobile numbers an admin has blocked. Kept separately from the
    -- donors table so the block still holds even if the account is deleted.
    CREATE TABLE IF NOT EXISTS blocked_contacts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        donor_id        INTEGER,
        email           TEXT,
        phone_norm      TEXT,
        email_original  TEXT,
        phone_original  TEXT,
        reason          TEXT,
        blocked_by      INTEGER,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_donors_blood_group ON donors(blood_group);
    CREATE INDEX IF NOT EXISTS idx_donors_city ON donors(city);
    CREATE INDEX IF NOT EXISTS idx_donors_active ON donors(is_active);
    CREATE INDEX IF NOT EXISTS idx_requests_blood_group ON emergency_requests(blood_group);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON emergency_requests(status);
  `);

  // Lightweight migrations for databases created before these columns existed
  // (e.g. your live Turso database). Safe to run on every startup.
  const donorColumns = (await all('PRAGMA table_info(donors)')).map((c) => c.name);
  const donorMigrations = {
    role: "TEXT NOT NULL DEFAULT 'donor'",
    is_admin: 'INTEGER NOT NULL DEFAULT 0',
    salesforce_contact_id: 'TEXT',
    phone_norm: 'TEXT',
    has_sugar: 'INTEGER',
    has_bp: 'INTEGER',
    email_verified: 'INTEGER NOT NULL DEFAULT 0',
    phone_verified: 'INTEGER NOT NULL DEFAULT 0',
    is_blocked: 'INTEGER NOT NULL DEFAULT 0',
    blocked_at: 'TEXT',
    blocked_reason: 'TEXT',
    auto_paused: 'INTEGER NOT NULL DEFAULT 0',
    cooldown_until: 'TEXT',
  };
  for (const [name, definition] of Object.entries(donorMigrations)) {
    if (!donorColumns.includes(name)) {
      await client.execute(`ALTER TABLE donors ADD COLUMN ${name} ${definition}`);
    }
  }

  const requestColumns = (await all('PRAGMA table_info(emergency_requests)')).map((c) => c.name);
  if (!requestColumns.includes('posted_by')) {
    await client.execute('ALTER TABLE emergency_requests ADD COLUMN posted_by INTEGER REFERENCES donors(id) ON DELETE SET NULL');
  }
  if (!requestColumns.includes('salesforce_case_id')) {
    await client.execute('ALTER TABLE emergency_requests ADD COLUMN salesforce_case_id TEXT');
  }

  // Backfill the normalised phone number for accounts created before it existed.
  const missingNorm = await all('SELECT id, phone FROM donors WHERE phone_norm IS NULL');
  for (const row of missingNorm) {
    await client.execute({ sql: 'UPDATE donors SET phone_norm = ? WHERE id = ?', args: [phoneKey(row.phone), row.id] });
  }

  // One account per mobile number. If old test data already contains
  // duplicates this can't be created — registration still checks in code.
  try {
    await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_donors_phone_norm ON donors(phone_norm)');
  } catch (err) {
    console.warn('⚠️  Could not add unique index on phone numbers (duplicates exist?):', err.message);
  }
  await client.execute('CREATE INDEX IF NOT EXISTS idx_donors_blocked ON donors(is_blocked)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_otp_target ON otp_codes(channel, target)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_blocked_email ON blocked_contacts(email)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_blocked_phone ON blocked_contacts(phone_norm)');

  // Donors who already have a recent last-donation date start their
  // cool-down now, the same as if they had just entered it.
  await client.execute({
    sql: `UPDATE donors
          SET is_active = 0, auto_paused = 1, cooldown_until = date(last_donation_date, ?)
          WHERE role = 'donor' AND last_donation_date IS NOT NULL AND last_donation_date != ''
            AND auto_paused = 0 AND cooldown_until IS NULL
            AND date(last_donation_date, ?) > date('now')`,
    args: [`+${DONATION_COOLDOWN_DAYS} days`, `+${DONATION_COOLDOWN_DAYS} days`],
  });
  await releaseExpiredCooldowns();

  console.log(`🗄️  Database ready (${usingTurso ? 'Turso cloud — persistent' : `local file: ${localDbPath}`})`);
}

module.exports = { get, all, run, initDb, usingTurso, releaseExpiredCooldowns };
