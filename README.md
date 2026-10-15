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
phone, role, blood group, city, join date) on a dedicated admin panel. **You
are not limited to one admin** — there are two ways to have more than one:

**Option A — bootstrap list via `ADMIN_EMAIL`:**
1. Set `ADMIN_EMAIL` to one email, or several separated by commas:
   - Locally: `ADMIN_EMAIL=owner@example.com, cofounder@example.com` in `.env`.
   - On Render: Dashboard → your service → Environment → add `ADMIN_EMAIL`
     with that same comma-separated value → Save.
2. Register (or log in, if the account already exists) with any of those
   exact emails. The promotion check runs on every register and every
   login, so it takes effect immediately — no restart needed, and the order
   (register-then-set-env-var, or the reverse) doesn't matter.

**Option B — promote from inside the Admin Panel (no env var editing):**
Once you have at least one admin account (via Option A), that admin can
open `/admin.html` and click **Make Admin** next to any other user's row to
grant them admin rights on the spot — no environment variables or restarts
involved. An admin can also click **Revoke Admin** to remove another
admin's access (you can't revoke your own from the panel, to avoid locking
yourself out — use `ADMIN_EMAIL` or ask another admin if you need that).

Logged in as an admin, you'll see a **👑 Admin** link in the navbar leading
to `/admin.html`, where you can:
- See every user's ID, name, email, phone, role, blood group, city, and
  join date, with search/filter by name, email, or role
- See summary counts (total users, donors, seekers, active donors)
- Promote another user to admin, revoke another admin's access, or delete
  a user (moderation)

---

## 5.6 Verification, health info, cool-down and blocking

**Verifying email and mobile number.** To register, a person must prove they
own both: they press *Send OTP*, receive a 6-digit code, and enter it. Codes
expire after 10 minutes, allow 5 wrong attempts, are stored hashed, and are
rate-limited (30 s between sends, 5 per hour per address/number, plus a
per-network cap). The server itself checks the verification before creating
the account, so it can't be bypassed from the browser. One account per
mobile number (`+91 98765 43210` and `09876543210` count as the same).
A ✔ Verified badge shows on donors in search. Accounts created before this
update stay usable but aren't marked verified. The mobile number can't be
edited from the dashboard afterwards.

Delivery setup (set these as environment variables on Render):

| Channel | Provider | Variables | Cost |
|---|---|---|---|
| Email | [Brevo](https://www.brevo.com) HTTPS API | `BREVO_API_KEY`, `EMAIL_FROM` (a sender you verified in Brevo) | Free, 300/day |
| SMS | Fast2SMS (India) | `FAST2SMS_API_KEY` | Paid per SMS |
| SMS | Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Trial only reaches numbers you pre-verify |

Render's free tier blocks SMTP ports (25/465/587), which is why email uses an
HTTPS API instead of Gmail/SMTP. **If you set nothing, sign-up shows
"verification not set up" and nobody can register.** For a demo, set
`OTP_DEV_MODE=true`: any channel without a provider shows its code on screen
instead of sending it (a yellow "Demo mode" banner appears). That proves
nothing about who owns the email/number, so don't leave it on for real users.
You can mix them — real email via Brevo plus demo-mode SMS is allowed.
`REQUIRE_VERIFICATION=false` switches verification off completely.

**Sugar and BP.** Donors answer two Yes/No questions at sign-up (and can edit
them on the dashboard). Other logged-in users see them as chips on each donor
in search. Search results expose only name, blood group, city/state, distance,
the Sugar/BP answers and the verified badge — never email, phone or exact
location (the phone appears only through the logged *Reveal Contact* action).

**Donation cool-down.** When a donor saves a last-donation date, they are
switched off automatically and hidden from search for `DONATION_COOLDOWN_DAYS`
days (default 30) after that date; the toggle is locked while resting, then
switched back on automatically when the period ends (checked whenever the app
is used, so it works even when a free host has put the app to sleep). Note
that medical guidance for whole-blood donation is usually longer (around 3
months) — adjust `DONATION_COOLDOWN_DAYS` if you want that. It relies on the
date the donor enters.

**Blocking (admin).** In the Admin Panel, *Block* locks an account out at once
(even if they're logged in right now), removes them from search and the
request board, and puts their email and mobile number on a block list so they
can't register again — including `name+tag@gmail.com` / dotted-Gmail tricks and
different phone formats. Deleting a blocked account doesn't lift the block.
*Unblock*, or *Remove from list*, reverses it. Admins can't be blocked
(revoke admin rights first).

---

## 5.7 Free verification: Firebase (email) + Phone.Email (mobile)

This is the zero-cost way to run the sign-up verification. Each channel uses
its own provider, and the server decides which applies (Firebase for email if
its variables are set; Phone.Email for mobile if its Client ID is set;
otherwise the older Brevo / Fast2SMS / Twilio / demo modes).

**How it stays safe.** The browser never gets to say "this number/email is
verified". Firebase's signed ID token (email) and Phone.Email's access token
(mobile) are checked **on our server** — Google's signature for the former, a
server-to-server call to Phone.Email for the latter. Only then does the server
issue the proof that registration requires. Your real accounts and passwords
stay in your own database; the throw-away Firebase account is deleted as soon
as the check succeeds.

### Email — Firebase (free on the Spark plan)
1. Go to <https://console.firebase.google.com> → **Add project** (name it,
   skip Google Analytics). Stay on the free **Spark** plan.
2. **Build → Authentication → Get started → Sign-in method → Email/Password**:
   switch on the first toggle (Email/Password) and **Save**. Leave
   "Email link (passwordless)" OFF.
3. **Project settings (gear icon) → General → Your apps → Web (`</>`)** →
   register an app (any nickname, no hosting) → copy `apiKey`, `authDomain`,
   `projectId` and `appId` from the config shown.
4. **Authentication → Templates → Email address verification → edit (pencil)**:
   change the wording so people know why they got it (e.g. "Verify your email
   for Blood Donor Emergency Connect. Ignore this if you didn't ask for it").
   Optional but recommended.
5. **Authentication → Settings → Authorized domains → Add domain**: your
   `<service>.onrender.com` address (harmless, avoids surprises).
6. On **Render → your service → Environment** add `FIREBASE_API_KEY`,
   `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` → Save.

Limits (Firebase's published free-plan quotas): **1000 verification emails/day**.
Don't use "Email link sign-in" instead — on the free plan that is capped at
**5 emails/day**. Verification emails come from
`noreply@<project>.firebaseapp.com` and often land in **Spam** — tell people to
check there.

### Mobile — Phone.Email
1. Create an account at <https://www.phone.email> and open the dashboard.
2. Copy your **Client ID** (shown in the dashboard; look under profile / the
   "Sign in with Phone" button settings). If the dashboard asks for your
   website or redirect URL, give it
   `https://<service>.onrender.com/register.html`.
3. On Render add `PHONE_EMAIL_CLIENT_ID` = that Client ID → Save.

Cost, per Phone.Email's pricing page: **1000 free SMS per month for India for
the first 6 months**; after that SMS to India is charged (about $0.14 each).
When the free period ends, either top up a small balance, or switch mobile
verification to Fast2SMS (set `FAST2SMS_API_KEY` and remove
`PHONE_EMAIL_CLIENT_ID`). Only +91 numbers are accepted by default
(`PHONE_EMAIL_COUNTRY_CODES`).

### Known limitations (be upfront about these in your viva)
- Email verification is "click the link we emailed", not a typed code. Someone
  could trigger a verification email to an address they don't own; it only
  counts if the real owner clicks it. The template wording in step 4 helps.
- A verification started in one browser/device can't be continued from
  another (the email shows "started elsewhere"). If someone is stuck: Firebase
  console → Authentication → Users → delete the stale entry for that email.
- Each mobile verification uses one SMS from the free quota, even if the
  person then abandons sign-up.
- Phone.Email and Firebase are third-party services; people's number/email
  pass through them.

---

## 6. API Reference (for evaluators / viva)

| Method | Endpoint                              | Auth | Description |
|--------|----------------------------------------|------|--------------|
| POST   | `/api/auth/register`                    | –    | Register a donor or seeker account |
| GET    | `/api/auth/verification-config`          | –    | Whether OTP verification is on, and real/demo mode per channel |
| POST   | `/api/auth/send-otp`                     | –    | Send a 6-digit code to an email or mobile number |
| POST   | `/api/auth/verify-otp`                   | –    | Check the code, returns a short-lived verification token |
| POST   | `/api/auth/precheck`                     | –    | Is this email/number free to use? (called before Firebase sends anything) |
| POST   | `/api/auth/firebase/verify`              | –    | Check a Firebase ID token for a verified email; returns a proof token |
| POST   | `/api/auth/phoneemail/verify`            | –    | Exchange a Phone.Email access token for a verified mobile number; returns a proof token |
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
| PATCH  | `/api/admin/users/:id/block`             | Admin| Block a user (logs them out, hides them, blocks re-registration) |
| PATCH  | `/api/admin/users/:id/unblock`           | Admin| Lift a block |
| GET    | `/api/admin/blocked`                     | Admin| List blocked emails / mobile numbers |
| DELETE | `/api/admin/blocked/:id`                 | Admin| Remove an entry from the block list |
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
