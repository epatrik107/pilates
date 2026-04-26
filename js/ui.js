import { auth, onAuthStateChanged } from './firebase-config.js';
import { logoutUser, getUserProfile, ensureUserProfile } from './auth.js';

// ── Dark mode ───────────────────────────────────────────────
const MOON_ICON = '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/></svg>';
const SUN_ICON = '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/></svg>';

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = next === 'dark' ? SUN_ICON : MOON_ICON;
}

function appendThemeToggle(navRight) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const li = document.createElement('li');
  li.className = 'nav-item';
  li.innerHTML = `<button id="theme-toggle" class="nav-link border-0 bg-transparent p-2" title="T\u00e9ma v\u00e1lt\u00e1s">${isDark ? SUN_ICON : MOON_ICON}</button>`;
  navRight.appendChild(li);
  li.querySelector('#theme-toggle').addEventListener('click', toggleTheme);
}

// ── XSS protection: HTML escape ─────────────────────────────
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Password strength validation ────────────────────────────
export function validatePassword(password) {
  const checks = [
    { ok: password.length >= 8,    msg: 'Minimum 8 karakter' },
    { ok: /[A-Z]/.test(password),  msg: 'Legalább egy nagybetű (A-Z)' },
    { ok: /[a-z]/.test(password),  msg: 'Legalább egy kisbetű (a-z)' },
    { ok: /[0-9]/.test(password),  msg: 'Legalább egy szám (0-9)' },
  ];
  const errors = checks.filter(c => !c.ok).map(c => c.msg);
  const strength = checks.filter(c => c.ok).length;
  return { valid: errors.length === 0, errors, strength, checks };
}

// ── Client-side rate limiter (UX only, not a security boundary) ─
// This deters casual abuse but is trivially bypassed (in-memory,
// resets on reload). Real protection comes from Firebase App Check
// (see firebase-config.js) which validates requests server-side.
const rateLimitMap = new Map();

export function checkRateLimit(action, maxAttempts = 5, windowMs = 60000) {
  const now   = Date.now();
  const entry = rateLimitMap.get(action) || { attempts: [], blockedUntil: 0 };

  if (now < entry.blockedUntil) {
    const waitSec = Math.ceil((entry.blockedUntil - now) / 1000);
    return { allowed: false, message: `Túl sok próbálkozás. Várj ${waitSec} másodpercet.` };
  }

  entry.attempts = entry.attempts.filter(t => now - t < windowMs);
  entry.attempts.push(now);

  if (entry.attempts.length > maxAttempts) {
    entry.blockedUntil = now + windowMs;
    entry.attempts = [];
    rateLimitMap.set(action, entry);
    return { allowed: false, message: 'Túl sok próbálkozás. Várj egy percet.' };
  }

  rateLimitMap.set(action, entry);
  return { allowed: true };
}

// ── Toast notifications ─────────────────────────────────────
export function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const bgMap = { success: 'bg-success', error: 'bg-danger', info: 'bg-info', warning: 'bg-warning text-dark' };
  const toast = document.createElement('div');
  toast.className = `alert ${bgMap[type] || 'bg-info'} text-white py-2 px-3 rounded shadow-sm small fw-medium`;
  toast.style.cssText = 'transform:translateX(120%);opacity:0;transition:all 0.3s';
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)'; toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Confirmation modal ──────────────────────────────────────
export function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop-custom';
    overlay.innerHTML = `
      <div class="bg-white rounded-3 shadow-lg p-4" style="max-width:400px;width:100%">
        <p class="mb-4">${escapeHtml(message)}</p>
        <div class="d-flex justify-content-end gap-2">
          <button id="confirm-no" class="btn btn-outline-secondary btn-sm">Mégse</button>
          <button id="confirm-yes" class="btn btn-danger btn-sm">Igen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#confirm-yes').onclick = () => close(true);
    overlay.querySelector('#confirm-no').onclick  = () => close(false);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

// ── Loading spinner ─────────────────────────────────────────
export function showLoading(container) {
  container.innerHTML = `
    <div class="d-flex justify-content-center py-5">
      <div class="spinner-border spinner-sage" role="status" style="width:2.5rem;height:2.5rem;border-width:3px">
        <span class="visually-hidden">Betöltés...</span>
      </div>
    </div>`;
}

// ── Navbar initialization (Bootstrap) ───────────────────────
export function initNavbar() {
  initCookieConsent();

  const navLinks = document.getElementById('nav-links');
  const navRight = document.getElementById('nav-right');
  if (!navLinks || !navRight) return;

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      navLinks.innerHTML = `
        <li class="nav-item"><a href="index.html" class="nav-link">Órarend</a></li>
        <li class="nav-item"><a href="prices.html" class="nav-link">Árlista</a></li>
        <li class="nav-item"><a href="class-types.html" class="nav-link">Óratípusok</a></li>
        <li class="nav-item"><a href="faq.html" class="nav-link">GYIK</a></li>
        <li class="nav-item"><a href="about.html" class="nav-link">Rólam</a></li>`;
      navRight.innerHTML = `
        <li class="nav-item"><a href="login.html" class="nav-link">Bejelentkezés</a></li>
        <li class="nav-item"><a href="register.html" class="nav-link btn-sage ms-md-1">Regisztráció</a></li>`;
      appendThemeToggle(navRight);
      return;
    }

    const profile = await ensureUserProfile(user);
    const role = profile?.role || 'user';
    const name = profile?.name || user.displayName || 'Felhasználó';

    navLinks.innerHTML = `
      <li class="nav-item"><a href="index.html" class="nav-link">Órarend</a></li>
      <li class="nav-item"><a href="prices.html" class="nav-link">Árlista</a></li>
      <li class="nav-item"><a href="class-types.html" class="nav-link">Óratípusok</a></li>
      <li class="nav-item"><a href="faq.html" class="nav-link">GYIK</a></li>
      <li class="nav-item"><a href="about.html" class="nav-link">Rólam</a></li>
      ${role === 'admin' ? '<li class="nav-item"><a href="admin.html" class="nav-link">Admin</a></li>' : '<li class="nav-item"><a href="bookings.html" class="nav-link">Foglalásaim</a></li>'}
      <li class="nav-item"><a href="profile.html" class="nav-link">Profilom</a></li>`;

    navRight.innerHTML = `
      <li class="nav-item d-flex align-items-center">
        <span class="navbar-text me-2 small fw-medium text-sage d-none d-lg-inline">Szia, ${escapeHtml(name)}!</span>
      </li>
      <li class="nav-item">
        <button id="logout-btn" class="nav-link text-danger fw-medium border-0 bg-transparent">Kijelentkezés</button>
      </li>`;
    appendThemeToggle(navRight);

    document.querySelectorAll('#logout-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await logoutUser();
        window.location.href = 'login.html';
      });
    });
  });
}

// ── Page protection (auth guard) ────────────────────────────
export function requireAuth(callback) {
  onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    if (!user.emailVerified) {
      window.location.href = 'login.html?verified=required';
      return;
    }
    callback(user);
  });
}

export function requireAdmin(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    const profile = await getUserProfile(user.uid);
    if (profile?.role !== 'admin') {
      window.location.href = 'index.html';
      showToast('Nincs jogosultságod az oldal megtekintéséhez!', 'error');
      return;
    }
    callback(user, profile);
  });
}

// ── GDPR Cookie Consent Banner ──────────────────────────────
export function initCookieConsent() {
  if (localStorage.getItem('cookie-consent')) return;

  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.innerHTML = `
    <div class="cookie-banner-inner">
      <p class="mb-2 mb-sm-0">Az oldal sütiket használ a működéshez (bejelentkezés, munkamenet).
        Részletek: <a href="privacy.html" class="text-sage fw-medium">Adatvédelem</a></p>
      <div class="d-flex gap-2">
        <button id="cookie-accept" class="btn btn-sm btn-sage">Elfogadom</button>
        <button id="cookie-reject" class="btn btn-sm btn-sage-outline">Csak szükségesek</button>
      </div>
    </div>`;
  document.body.appendChild(banner);

  const dismiss = (val) => {
    localStorage.setItem('cookie-consent', val);
    banner.style.transform = 'translateY(100%)';
    setTimeout(() => banner.remove(), 300);
  };
  banner.querySelector('#cookie-accept').onclick = () => dismiss('all');
  banner.querySelector('#cookie-reject').onclick = () => dismiss('essential');
}

// ── Helper functions ────────────────────────────────────────
export function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('hu-HU', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
}

export function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric', weekday: 'short' });
}

export function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
