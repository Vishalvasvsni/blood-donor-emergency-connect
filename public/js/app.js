// ---------------------------------------------------------------------------
// Shared helpers used across every page: API wrapper, auth/session state,
// navbar rendering, and small utilities.
// ---------------------------------------------------------------------------

const API_BASE = '/api';

const Auth = {
  getToken() { return localStorage.getItem('bdec_token'); },
  setSession(token, donor) {
    localStorage.setItem('bdec_token', token);
    localStorage.setItem('bdec_donor', JSON.stringify(donor));
  },
  getDonor() {
    const raw = localStorage.getItem('bdec_donor');
    return raw ? JSON.parse(raw) : null;
  },
  updateDonor(donor) { localStorage.setItem('bdec_donor', JSON.stringify(donor)); },
  logout() {
    localStorage.removeItem('bdec_token');
    localStorage.removeItem('bdec_donor');
    window.location.href = '/index.html';
  },
  isLoggedIn() { return !!this.getToken(); },
};

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = Auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function timeAgo(dateStr) {
  const then = new Date(dateStr.replace(' ', 'T') + 'Z');
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function renderNavbar(activePage = '') {
  const el = document.getElementById('navbar');
  if (!el) return;
  const loggedIn = Auth.isLoggedIn();
  const donor = Auth.getDonor();

  let linkHtml = '';
  let rightHtml = '';

  if (loggedIn) {
    const links = [
      { href: '/index.html', label: 'Home', key: 'home' },
      { href: '/search.html', label: 'Find Donors', key: 'search' },
      { href: '/requests.html', label: 'Emergency Requests', key: 'requests' },
    ];
    linkHtml = links
      .map((l) => `<a href="${l.href}" class="${activePage === l.key ? 'active' : ''}">${l.label}</a>`)
      .join('');
    rightHtml = `<a href="/dashboard.html" class="${activePage === 'dashboard' ? 'active' : ''}">${donor ? initials(donor.name) + ' · ' : ''}Dashboard</a>
       <button id="navLogoutBtn">Log out</button>`;
  } else {
    // Logged-out visitors can browse the public homepage and reach
    // login/register — everything else requires an account.
    linkHtml = `<a href="/index.html" class="${activePage === 'home' ? 'active' : ''}">Home</a>`;
    rightHtml = `<a href="/login.html">Log in</a><a href="/register.html" class="nav-cta">Register / Sign Up</a>`;
  }

  el.innerHTML = `
    <nav class="navbar">
      <div class="container">
        <a href="/index.html" class="brand"><span class="drop">🩸</span> Blood Donor Emergency Connect</a>
        <button class="hamburger" id="hamburgerBtn" aria-label="Menu">☰</button>
        <div class="nav-links" id="navLinks">
          ${linkHtml}
          ${rightHtml}
        </div>
      </div>
    </nav>
  `;

  document.getElementById('hamburgerBtn')?.addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
  });
  document.getElementById('navLogoutBtn')?.addEventListener('click', () => Auth.logout());
}

function showAlert(elId, message, type = 'error') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type} show`;
}

function hideAlert(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = 'alert';
}

function getBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

// The entire site sits behind an account wall: nobody can see or use any
// page (including the homepage) until they've registered or logged in.
// Call this at the very top of every page except login.html/register.html.
function guardAuth() {
  if (!Auth.isLoggedIn()) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.replace(`/login.html?next=${next}`);
  }
}

// The homepage itself stays public (visitors can browse it and choose to
// log in / register), but its call-to-action buttons should change once
// someone is already signed in — no point showing "Create Free Account"
// to a logged-in user.
function applyHeroState() {
  const el = document.getElementById('heroButtons');
  if (!el) return;
  if (Auth.isLoggedIn()) {
    el.innerHTML = `
      <a href="/search.html" class="btn btn-white">Find a Donor</a>
      <a href="/dashboard.html" class="btn btn-outline-white">My Dashboard</a>
    `;
  }
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
