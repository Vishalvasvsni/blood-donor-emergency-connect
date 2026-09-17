const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB_PATH can be set to point at a mounted persistent disk in production
// (e.g. Render: /var/data/blood_donor.db). Defaults to the local ./database
// folder for local development.
const dbDir = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dbDir, 'blood_donor.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema — matches the synopsis: donor registration (blood group, contact,
// location), availability status, emergency requests, and a consent-based
// contact log (so donors know who viewed their contact details).
// ---------------------------------------------------------------------------

db.exec(`
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
    is_active       INTEGER NOT NULL DEFAULT 1,     -- availability toggle (Objective 5)
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

// Lightweight migration: older databases created before the `role` column
// existed won't have it. Add it if missing so upgrades don't break.
const donorColumns = db.prepare("PRAGMA table_info(donors)").all().map((c) => c.name);
if (!donorColumns.includes('role')) {
  db.exec("ALTER TABLE donors ADD COLUMN role TEXT NOT NULL DEFAULT 'donor'");
}
if (!donorColumns.includes('is_admin')) {
  db.exec("ALTER TABLE donors ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
}

// ---------------------------------------------------------------------------
// Owner/admin bootstrap: set ADMIN_EMAIL in your environment (.env locally,
// or the Render dashboard in production) to the email you registered with.
// On every server start, that account is promoted to admin automatically —
// no manual SQL needed. Change ADMIN_EMAIL and restart to switch owners.
// ---------------------------------------------------------------------------
if (process.env.ADMIN_EMAIL) {
  db.prepare('UPDATE donors SET is_admin = 1 WHERE email = ?').run(
    process.env.ADMIN_EMAIL.toLowerCase().trim()
  );
}

module.exports = db;
