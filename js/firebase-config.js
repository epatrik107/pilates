import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

// ============================================================
//  FIREBASE CONFIGURATION
//  IMPORTANT: This apiKey is a PUBLIC identifier – it only
//  tells the code which Firebase project to connect to.
//  Security is enforced by Firestore Security Rules, NOT this key.
//  NEVER put secret keys (Stripe, SendGrid, etc.) here!
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
// ============================================================
const googleCalendarConfig = {
  clientId: "443002743783-oihpqtepcddfobor5abprjk5gh54ra0r.apps.googleusercontent.com",
  apiKey:   "AIzaSyD2lNojoM0RLDFFDWK4qwKOZwppGgRNp6E",
};

// ============================================================
//  FIREBASE APP CHECK CONFIGURATION (recommended)
//  Protects against quota exhaustion (Denial of Wallet).
//  reCAPTCHA v3 runs invisibly without disrupting users.
//  → Google Cloud Console: reCAPTCHA Enterprise, or
//  → Firebase Console: App Check → reCAPTCHA v3
// ============================================================
const appCheckConfig = {
  recaptchaSiteKey: "",  // e.g. "6Lc..." – if empty, App Check is disabled
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// App Check initialization (if configured)
if (appCheckConfig.recaptchaSiteKey) {
  import('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-check.js')
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckConfig.recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true
      });
    })
    .catch(err => console.warn('App Check init failed:', err));
}

export { app, auth, db, onAuthStateChanged, googleCalendarConfig, appCheckConfig };
