# 🩸 Blood Donor Emergency Connect

A real-time, location-aware web platform that connects voluntary blood donors
with patients, hospitals, and NGOs — built as a BCA final-year project
(Vivekanand Global University, Jaipur, 2026-27).

This implements every point from the project synopsis: donor registration,
blood-group + proximity search, availability toggling, a consent-based
contact system, and an emergency request board — backed by a real database.

---

## 1. Tech Stack (as per synopsis §6)

| Layer          | Technology                                      |
|----------------|--------------------------------------------------|
| Frontend       | HTML5, CSS3, vanilla JavaScript (fetch API)       |
| Backend        | Node.js + Express.js                              |
| Database       | SQLite-compatible (via `@libsql/client`) — a local file for development, or [Turso](https://turso.tech) (free, permanent cloud database) in production |
| Auth           | JWT (`jsonwebtoken`) + password hashing (`bcryptjs`) |
| Hosting option | Render / Railway / Vercel / any Node host         |
| Version control| Git-ready (`.gitignore` included)                 |

> The synopsis lists Firebase or Node+MongoDB as options. This build uses
> **Node.js + SQLite** instead of MongoDB: it needs no external database
> service or account, runs with a single `npm install && npm start`, and is
> trivial for evaluators to run locally. The code is written with a thin,
> swappable data-access layer (`config/db.js`) — see §6 below for notes on
> migrating to MongoDB or Firebase if you'd prefer that for deployment.

---

## 2. Features (mapped to synopsis objectives)

0. **Account wall (login required for everything)** — the entire site,
   including the homepage, search, and the emergency request board, requires
   a registered account. Visitors choose one of two account types at sign-up:
   - **Donor** — required to select a blood group; appears in search results
     and can toggle availability.
   - **Seeker** (non-donor) — for patients/hospitals/NGOs who only want to
     search or post emergency requests; no blood group required. A seeker
     can upgrade to a donor anytime from their dashboard ("Become a Donor").
1. **Centralized donor registration** — name, blood group, phone, city/state,
   optional precise geolocation. (`Objective 1`)
2. **Real-time search by blood group + proximity** — includes a full blood
   compatibility matrix (e.g. a request for A+ also surfaces compatible O+/O-
   donors), ranked by exact match then distance (Haversine formula) using the
   browser's Geolocation API. (`Objective 2`)
3. **Faster donor discovery** — search + emergency request auto-matching
   return results in milliseconds instead of manual calling. (`Objective 3`)
4. **Mobile-friendly, low-literacy-friendly UI** — large buttons, simple
   forms, responsive design, no jargon. (`Objective 4`)
5. **Availability toggle** — donors switch Active/Inactive after donating,
   with a last-donation-date field. (`Objective 5`)

Additional features beyond the minimum scope:
- **Emergency Requests board** — patients/hospitals/NGOs can broadcast a
  need (blood group, hospital, urgency, units needed) without registering;
  the system immediately shows how many compatible donors are nearby.
- **Consent-based contact reveal with activity log** — a donor's phone
  number is only revealed on request, and every reveal is logged so the
  donor can see who viewed their contact (addresses the "privacy-respecting"
  novelty claim in the synopsis).
- **Admin panel for the platform owner** — set `ADMIN_EMAIL` to your
  registered email and you get a hidden `/admin.html` page listing every
  registered user (ID, name, email, phone, role, blood group, city, join
  date), plus platform-wide summary stats and the ability to remove a user.
  See "Admin Access" below.
- **Platform stats** on the homepage (total donors, active donors, requests
  fulfilled) for a quick health-of-system view during evaluation/demo.

---

## 3. Project Structure

```
blood-donor-connect/
├── server.js                 # Express app entry point
├── config/
│   └── db.js                 # SQLite connection + schema (donors, requests, contact_logs)
├── middleware/
│   └── auth.js                # JWT verification middleware
├── routes/
│   ├── auth.js                # POST /register, /login, GET /me
│   ├── donors.js               # search, profile, availability toggle, contact reveal
│   └── requests.js             # emergency request board (create/list/update status)
├── utils/
│   └── blood.js                # blood-compatibility matrix + Haversine distance
├── public/                    # static frontend (plain HTML/CSS/JS)
│   ├── index.html               # landing page + live stats
│   ├── register.html            # donor sign-up
│   ├── login.html
│   ├── dashboard.html           # donor self-service (availability, profile, activity log)
│   ├── search.html               # public donor search
│   ├── requests.html             # emergency request board
│   ├── css/style.css
│   └── js/app.js                 # shared API client, auth/session helpers
├── database/                   # SQLite file lives here at runtime (gitignored)
├── package.json
└── .env.example                 # copy to .env before running
```

---

## 4. Running Locally

**Requirements:** Node.js 18+ (tested on Node 22).

```bash
cd blood-donor-connect
npm install
cp .env.example .env      # edit JWT_SECRET before any real deployment
npm start
```

The app will be available at **http://localhost:3000**.

That's it — no external database server, no API keys, no Docker needed.
The SQLite file is created automatically on first run at
`database/blood_donor.db`.

### Quick smoke test (optional)
```bash
curl http://localhost:3000/api/health
# -> {"status":"ok","service":"Blood Donor Emergency Connect"}
```

---

## 5. Using the App

1. Open `http://localhost:3000` → **Register as a Donor** to create an
   account (blood group, phone, city, optional live location).
2. Go to **Find Donors** to search by blood group and city — try toggling
   "exact match only" to see the compatibility matching in action.
3. Log in and open **Dashboard** to toggle your availability off (simulating
   "just donated") and watch it disappear from search results.
4. Go to **Emergency Requests** → **Post Emergency Request** to simulate a
   hospital/patient broadcasting an urgent need. The app will immediately
   report how many compatible donors are nearby.

---

## 5.5 Admin Access

As the platform owner, you can see every registered user (ID, name, email,
phone, role, blood group, city, join date) on a dedicated admin panel:

1. **Set the `ADMIN_EMAIL` environment variable** to the email you want to
   use as your admin login:
   - Locally: add `ADMIN_EMAIL=you@example.com` to your `.env` file.
   - On Render: Dashboard → your service → Environment → add
     `ADMIN_EMAIL` = `you@example.com` → Save.
2. **Register (or log in, if you already have an account) with that exact
   email.** The promotion check runs on every register and every login, so
   it takes effect immediately — no server restart needed either way, and
   the order (register-then-set-env-var, or set-env-var-then-register)
   doesn't matter.
3. **Log in with that account** and you'll now see a **👑 Admin** link in
   the navbar, leading to `/admin.html`, where you can:
   - See every user's ID, name, email, phone, role, blood group, city, and
     join date, with search/filter by name, email, or role
   - See summary counts (total users, donors, seekers, active donors)
   - Delete a user if needed (moderation)

You can promote a different email later by changing `ADMIN_EMAIL` — the
previous admin flag isn't automatically removed from the old account, so
revoke it manually via the admin panel's delete button if you need to fully
replace ownership.

---

## 6. API Reference (for evaluators / viva)

| Method | Endpoint                              | Auth | Description |
|--------|----------------------------------------|------|--------------|
| POST   | `/api/auth/register`                    | –    | Register a donor or seeker account |
| POST   | `/api/auth/login`                       | –    | Log in, returns JWT |
| GET    | `/api/auth/me`                          | JWT  | Restore session |
| GET    | `/api/donors/search`                    | JWT  | Search donors by blood group / city / lat,lng |
| POST   | `/api/donors/:id/reveal-contact`         | JWT  | Consent-based contact reveal (logs the request) |
| GET    | `/api/donors/me/profile`                 | JWT  | Get own profile |
| PATCH  | `/api/donors/me/profile`                 | JWT  | Edit profile |
| PATCH  | `/api/donors/me/availability`            | JWT  | Toggle active/inactive (donor accounts only) |
| PATCH  | `/api/donors/me/become-donor`            | JWT  | Upgrade a seeker account to a donor |
| PATCH  | `/api/donors/me/password`                | JWT  | Change password |
| GET    | `/api/donors/me/contact-activity`        | JWT  | View who requested your contact |
| DELETE | `/api/donors/me`                         | JWT  | Delete account |
| GET    | `/api/donors/stats`                      | –    | Platform-wide stats (public, aggregate counts only) |
| POST   | `/api/requests`                          | JWT  | Post an emergency request |
| GET    | `/api/requests`                          | JWT  | List/filter emergency requests |
| PATCH  | `/api/requests/:id/status`                | JWT  | Mark fulfilled/expired |
| GET    | `/api/admin/users`                       | Admin| List every registered user |
| GET    | `/api/admin/summary`                     | Admin| Platform-wide counts |
| GET    | `/api/admin/requests`                    | Admin| Every emergency request ever posted |
| DELETE | `/api/admin/users/:id`                   | Admin| Remove a user |

---

## 7. Deployment (synopsis §6 — Hosting/Deployment)

The app is Node.js + a SQLite-compatible database, so it deploys cleanly to
any Node host. **Persistence matters here**: Render's free tier (and most
free hosts) wipe local files every time the service restarts, redeploys, or
spins down from inactivity — so without the Turso setup below, everyone
would need to re-register periodically. See §7.1 to fix that permanently,
for free.

- **Render (free tier)** — New → Blueprint → connect repo. Render reads
  `render.yaml` and auto-configures the build/start commands and a random
  `JWT_SECRET`.
- **Railway** — similar flow, and its free trial credit includes volumes if
  you'd rather use a persistent disk approach instead of Turso.
- **Vercel/Netlify** are better suited to the static frontend only — for the
  full app (with the Express API), Render/Railway/Fly.io are simpler.

### 7.1 Persistent Database with Turso (free, permanent, no restarts needed)

By default the app falls back to a local SQLite file, which is fine for
local development but resets on Render as described above. [Turso](https://turso.tech)
gives you a free, permanent, SQLite-compatible cloud database with no
30-day expiry — the app already supports it, you just need to create one
and point two environment variables at it.

1. Go to [turso.tech](https://turso.tech) and sign up (free, no card
   required).
2. From the dashboard, create a new database (any name, any region close to
   you — e.g. `blood-donor-connect`).
3. Open the database and find its **connection URL** — it looks like
   `libsql://blood-donor-connect-yourname.turso.io`.
4. Generate an **auth token** for it from the same dashboard (usually a
   "Create Token" or "Generate Token" button on the database's page).
5. On Render: your service → **Environment** tab → add:
   - `TURSO_DATABASE_URL` = the URL from step 3
   - `TURSO_AUTH_TOKEN` = the token from step 4
6. Save — Render redeploys automatically. From this point on, your data
   lives in Turso's cloud, not on Render's disk, so it survives every
   restart, redeploy, and spin-down permanently.

Locally, if you don't set these two variables, the app just uses the local
SQLite file as before — no changes needed for local development.

<details>
<summary>Alternative: persistent disk on a paid Render plan (no Turso needed)</summary>

If you'd rather pay for Render's Starter plan (~$7/month) than use an
external database, you can still do it the original way: set `DB_PATH` to
a path under a mounted persistent disk, and add a `disk:` block to
`render.yaml`:

```yaml
services:
  - type: web
    name: blood-donor-emergency-connect
    runtime: node
    plan: starter   # disks require a paid plan
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: JWT_SECRET
        generateValue: true
      - key: DB_PATH
        value: /var/data/blood_donor.db
      - key: NODE_VERSION
        value: 20.0.0
    disk:
      name: blood-donor-data
      mountPath: /var/data
      sizeGB: 1
```
Don't set `TURSO_DATABASE_URL` if you use this approach — the app checks
for Turso first and only falls back to the local file (governed by
`DB_PATH`) when Turso isn't configured.
</details>

### Migrating to MongoDB (optional, per synopsis §6 alternatives)
All database access is isolated to `config/db.js` (which exports simple
`get`/`all`/`run` helpers) and the route files. To switch to MongoDB,
replace `config/db.js` with a Mongoose connection exposing the same shape,
or refactor the route files to Mongoose model calls directly — the route
logic (validation, compatibility matching, distance ranking) stays the
same either way.

---

## 8. Notes for the Viva / Evaluation

- **Password security**: passwords are hashed with bcrypt (10 salt rounds),
  never stored or returned in plaintext.
- **Blood compatibility logic** lives in `utils/blood.js` and is unit-testable
  in isolation from the web layer.
- **Consent-based design**: contact numbers are never included in the public
  search response body — they're only released via a separate
  `reveal-contact` call, which is logged, mirroring "privacy-respecting" from
  the Novelty section.
- **Proximity search** uses the Haversine great-circle distance formula,
  matching the "location-inclusive platform" goal from the Research Gap
  section.

---

## 9. Future Enhancements (synopsis §9 — Scope)

- Hospital blood-bank inventory integration for real-time stock visibility
- SMS-based access for donors without smartphones (Twilio/Fast2SMS)
- Geolocation-based auto-matching notifications (push/SMS to nearby donors
  the moment a compatible emergency request is posted)
- Gamified recognition system for repeat donors
- Multi-language support
