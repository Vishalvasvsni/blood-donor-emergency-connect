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
| Database       | SQLite (via `better-sqlite3`) — file-based, zero setup |
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

---

## 7. Deployment (synopsis §6 — Hosting/Deployment)

Because this is plain Node.js + a file-based SQLite database, it deploys
cleanly to any Node host:

- **Render** — New Web Service → connect repo → Build: `npm install` →
  Start: `npm start`. Add a persistent disk mounted at `/database` if you
  want donor data to survive redeploys (otherwise SQLite resets on redeploy,
  which is fine for an academic demo).
- **Railway** — same idea; Railway volumes work well for the SQLite file.
- **Vercel/Netlify** are better suited to the static frontend only — for the
  full app (with the Express API), Render/Railway/Fly.io are simpler.

Before deploying:
1. Set a strong, random `JWT_SECRET` in the platform's environment
   variables (never commit `.env`).
2. If you need the data to survive restarts on a serverless/ephemeral
   filesystem, either use a mounted volume, or swap `config/db.js` for a
   hosted database (see below).

### Migrating to Firebase or MongoDB (optional, per synopsis §6 alternatives)
All database access is isolated to `config/db.js` and the route files. To
switch to MongoDB, replace `config/db.js` with a Mongoose connection and
adjust the `db.prepare(...).get()/.run()/.all()` calls in `routes/*.js` to
Mongoose model calls — the route logic (validation, compatibility matching,
distance ranking) stays the same. This keeps the option open for the
"Scope"/future-enhancements section of the synopsis (e.g. hospital
inventory integration) without a rewrite.

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
