const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

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
        role            TEXT    NOT NULL DEFAULT 'donor' CHECK(role IN ('donor','seeker')),
        blood_group     TEXT    CHECK(blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
        city            TEXT    NOT NULL,
        state           TEXT    NOT NULL,
        latitude        REAL,
        longitude       REAL,
        is_active       INTEGER NOT NULL DEFAULT 1,
        last_donation_date TEXT,
        age             INTEGER,
        gender          TEXT,
        is_admin        INTEGER NOT NULL DEFAULT 0,
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

    CREATE INDEX IF NOT EXISTS idx_donors_blood_group ON donors(blood_group);
    CREATE INDEX IF NOT EXISTS idx_donors_city ON donors(city);
    CREATE INDEX IF NOT EXISTS idx_donors_active ON donors(is_active);
    CREATE INDEX IF NOT EXISTS idx_requests_blood_group ON emergency_requests(blood_group);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON emergency_requests(status);
  `);

  // Lightweight migrations for databases created before these columns existed.
  const columns = (await all('PRAGMA table_info(donors)')).map((c) => c.name);
  if (!columns.includes('role')) {
    await client.execute("ALTER TABLE donors ADD COLUMN role TEXT NOT NULL DEFAULT 'donor'");
  }
  if (!columns.includes('is_admin')) {
    await client.execute('ALTER TABLE donors ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  }

  console.log(`🗄️  Database ready (${usingTurso ? 'Turso cloud — persistent' : `local file: ${localDbPath}`})`);
}

module.exports = { get, all, run, initDb, usingTurso };
