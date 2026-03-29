import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app-check.js';

// ============================================================
//  FIREBASE CONFIGURATION
//  This apiKey is a PUBLIC identifier – it tells the SDK which
//  Firebase project to connect to. Security is enforced by
//  Firestore Security Rules + App Check, NOT by hiding this key.
//  NEVER put secret keys (Stripe, SendGrid, etc.) here!
//
//  PRODUCTION: Restrict this key in Google Cloud Console →
//  APIs & Services → Credentials → Edit key → Application
//  restrictions → HTTP referrers → add your domain(s)
//  (e.g. balance-studio.hu/*, *.balance-studio.hu/*)
//  This prevents third parties from using your key.
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyD2lNojoM0RLDFFDWK4qwKOZwppGgRNp6E",
  authDomain:        "pilates-studi.firebaseapp.com",
  projectId:         "pilates-studi",
  storageBucket:     "pilates-studi.firebasestorage.app",
  messagingSenderId: "443002743783",
  appId:             "1:443002743783:web:5aa16692892014739d6b42",
  measurementId:     "G-M4RYV0YC1S"
};

// ============================================================
//  GOOGLE CALENDAR API CONFIGURATION (optional)
//  PRODUCTION: Also restrict this key's HTTP referrers in
//  Google Cloud Console (same steps as the Firebase key above).
// ============================================================
const googleCalendarConfig = {
  clientId: "443002743783-oihpqtepcddfobor5abprjk5gh54ra0r.apps.googleusercontent.com",
  apiKey:   "AIzaSyD2lNojoM0RLDFFDWK4qwKOZwppGgRNp6E",
};

// ============================================================
//  FIREBASE APP CHECK CONFIGURATION (recommended for production)
//  Protects against quota exhaustion (Denial of Wallet) and
//  automated abuse. reCAPTCHA v3 runs invisibly.
//
//  Setup steps (100% free):
//  1. https://www.google.com/recaptcha/admin → Create
//     → reCAPTCHA v3 → add your domain(s) → Submit
//  2. Copy the Site Key (starts with "6Lc...")
//  3. Firebase Console → App Check → Register reCAPTCHA v3
//     provider with the same site key
//  4. Firebase Console → App Check → Enforce for Firestore & Auth
//  5. Paste the site key below
//
//  WARNING: Without this, bots can exhaust your free-tier quota
//  by flooding Firestore reads/writes (Denial of Wallet attack).
// ============================================================
const appCheckConfig = {
  recaptchaSiteKey: "6LcAEZ0sAAAAAIV4SAuZQBIGRkCWWS4CkEmcyTed",
};

const app = initializeApp(firebaseConfig);

// App Check MUST be initialized before auth/firestore so the
// interceptor is registered before any network requests go out.
if (appCheckConfig.recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckConfig.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

const auth = getAuth(app);
const db   = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export { app, auth, db, onAuthStateChanged, googleCalendarConfig, appCheckConfig };
