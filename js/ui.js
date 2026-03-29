import { auth, onAuthStateChanged } from './firebase-config.js';
import { logoutUser, getUserProfile, ensureUserProfile } from './auth.js';

// ── XSS protection: HTML escape ─────────────────────────────
// All user input MUST be passed through this function before
// being inserted into innerHTML. Prevents injection of
// <script> tags or other malicious code into the page.
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

// ── Client-side rate limiter ────────────────────────────────
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
let toastTimer = null;

export function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed top-5 right-5 z-[9999] flex flex-col gap-2';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-sage-600 text-white',
    error:   'bg-red-500 text-white',
    info:    'bg-sky-500 text-white',
    warning: 'bg-amber-500 text-white'
  };

  toast.className = `px-5 py-3 rounded-lg shadow-lg text-sm font-medium transform transition-all duration-300 translate-x-full opacity-0 ${colors[type] || colors.info}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Confirmation modal ──────────────────────────────────────
export function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[9998] flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 transform transition-all scale-95 opacity-0" id="confirm-box">
        <p class="text-gray-800 text-base mb-6">${escapeHtml(message)}</p>
        <div class="flex gap-3 justify-end">
          <button id="confirm-no"  class="px-5 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition text-sm font-medium">Mégse</button>
          <button id="confirm-yes" class="px-5 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition text-sm font-medium">Igen</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.querySelector('#confirm-box').classList.remove('scale-95', 'opacity-0');
    });

    const close = (val) => {
      overlay.querySelector('#confirm-box').classList.add('scale-95', 'opacity-0');
      setTimeout(() => { overlay.remove(); resolve(val); }, 200);
    };

    overlay.querySelector('#confirm-yes').onclick = () => close(true);
    overlay.querySelector('#confirm-no').onclick  = () => close(false);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

// ── Loading spinner ─────────────────────────────────────────
export function showLoading(container) {
  container.innerHTML = `
    <div class="flex justify-center items-center py-20">
      <div class="w-10 h-10 border-4 border-sage-200 border-t-sage-600 rounded-full animate-spin"></div>
    </div>
  `;
}

// ── Navbar initialization ───────────────────────────────────
export function initNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;

  onAuthStateChanged(auth, async (user) => {
    const mobileMenu = document.getElementById('mobile-menu');
    const desktopNav = document.getElementById('desktop-nav');
    const mobileNav  = document.getElementById('mobile-nav');

    if (!user) {
      const guestLinks = `
        <a href="index.html"    class="nav-link">Órarend</a>
        <a href="about.html"    class="nav-link">Rólam</a>
        <a href="login.html"    class="nav-link">Bejelentkezés</a>
        <a href="register.html" class="nav-link nav-link-primary">Regisztráció</a>
      `;
      if (desktopNav) desktopNav.innerHTML = guestLinks;
      if (mobileNav)  mobileNav.innerHTML  = guestLinks;
      return;
    }

    const profile = await ensureUserProfile(user);
    const role    = profile?.role || 'user';
    const name    = profile?.name || user.displayName || 'Felhasználó';

    let links = `<a href="index.html" class="nav-link">Órarend</a>
      <a href="about.html" class="nav-link">Rólam</a>`;
    if (role === 'admin') {
      links += `<a href="admin.html" class="nav-link">Admin</a>`;
    }
    links += `
      <a href="profile.html" class="nav-link">Profilom</a>
      <span class="hidden lg:inline text-sm text-sage-700 font-medium px-2">Szia, ${escapeHtml(name)}!</span>
      <button id="logout-btn" class="nav-link text-red-500 hover:text-red-600">Kijelentkezés</button>
    `;

    if (desktopNav) desktopNav.innerHTML = links;
    if (mobileNav)  mobileNav.innerHTML  = links;

    document.querySelectorAll('#logout-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await logoutUser();
        window.location.href = 'login.html';
      });
    });
  });

  const toggle = document.getElementById('menu-toggle');
  const menu   = document.getElementById('mobile-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      menu.classList.toggle('hidden');
    });
  }
}

// ── Page protection (auth guard) ────────────────────────────
export function requireAuth(callback) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    callback(user);
  });
}

export function requireAdmin(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    const profile = await getUserProfile(user.uid);
    if (profile?.role !== 'admin') {
      window.location.href = 'index.html';
      showToast('Nincs jogosultságod az oldal megtekintéséhez!', 'error');
      return;
    }
    callback(user, profile);
  });
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
  return d.toLocaleDateString('hu-HU', {
    month: 'short', day: 'numeric', weekday: 'short'
  });
}

export function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
