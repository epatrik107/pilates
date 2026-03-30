const CACHE_NAME = 'balance-v14';
const STATIC_ASSETS = [
  'index.html',
  'about.html',
  'bookings.html',
  'prices.html',
  'login.html',
  'register.html',
  'profile.html',
  'admin.html',
  'privacy.html',
  'terms.html',
  'css/style.css',
  'js/firebase-config.js',
  'js/auth.js',
  'js/bookings.js',
  'js/classes.js',
  'js/ui.js',
  'js/waitlist.js',
  'js/export.js',
  'js/google-calendar.js',
  'img/szonja.png',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for Firebase/Google API calls
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('google.com')) {
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetched = fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
