import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  verifyBeforeUpdateEmail,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithCredential
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {
  doc, setDoc, getDoc, deleteDoc, updateDoc,
  collection, query, where, getDocs, runTransaction
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';

// Wraps any promise with a timeout to prevent Firestore hangs
function withTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

// ── Input sanitization ──────────────────────────────────────
function sanitizeName(name) {
  return name
    .replace(/[<>]/g, '')
    .replace(/&/g, '&amp;')
    .trim()
    .slice(0, 100);
}

// ── Ensure user profile exists in Firestore ─────────────────
// Called on every page load via initNavbar; creates the profile
// document if it doesn't exist yet (fallback for failed writes).
export async function ensureUserProfile(user) {
  if (!user) return null;
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await withTimeout(getDoc(ref));
    if (snap.exists()) return snap.data();

    const profile = {
      name: user.displayName || 'Felhasználó',
      email: user.email || '',
      role: 'user',
      createdAt: new Date().toISOString()
    };
    withTimeout(setDoc(ref, profile)).catch(e => console.warn('ensureUserProfile setDoc:', e));
    return profile;
  } catch (err) {
    console.warn('ensureUserProfile timeout/error:', err.message);
    return { name: user.displayName || 'Felhasználó', email: user.email || '', role: 'user' };
  }
}

// ── Action code settings (links point to our domain, not firebaseapp.com) ───
const actionCodeSettings = {
  url: 'https://balance-studio.hu/login.html',
  handleCodeInApp: false
};

// ── Registration ────────────────────────────────────────────
export async function registerUser(name, email, password) {
  const cleanName = sanitizeName(name);
  if (cleanName.length < 1) {
    throw new Error('A név nem lehet üres!');
  }

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  try {
    await updateProfile(cred.user, { displayName: cleanName });
  } catch (e) {
    console.warn('Profile update failed:', e);
  }

  // Fire and forget — ensureUserProfile will retry on next page load
  setDoc(doc(db, 'users', cred.user.uid), {
    name: cleanName,
    email,
    role: 'user',
    createdAt: new Date().toISOString()
  }).catch(e => console.warn('Firestore profile write:', e));

  sendEmailVerification(cred.user, actionCodeSettings).catch(e => console.warn('Verification email:', e));

  return cred.user;
}

// ── Email verification ──────────────────────────────────────
export async function resendVerificationEmail() {
  const user = auth.currentUser;
  if (!user) throw new Error('Nincs bejelentkezve.');
  if (user.emailVerified) throw new Error('Az email cím már megerősítve.');
  await sendEmailVerification(user, actionCodeSettings);
}

// ── Password reset ──────────────────────────────────────────
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email, actionCodeSettings);
}

// ── Email change (sends verification to the new address) ────
export async function changeEmail(newEmail) {
  const user = auth.currentUser;
  if (!user) throw new Error('Nincs bejelentkezve.');
  await verifyBeforeUpdateEmail(user, newEmail);
  await updateDoc(doc(db, 'users', user.uid), { email: newEmail });
}

// ── Google Sign-In ──────────────────────────────────────────
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref).catch(() => null);
  if (!snap || !snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || 'Felhasználó',
      email: user.email || '',
      role: 'user',
      createdAt: new Date().toISOString()
    });
  }
  return user;
}

// ── Link password provider to Google-only account ───────────
export async function linkPasswordToAccount(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('Nincs bejelentkezve.');
  const credential = EmailAuthProvider.credential(user.email, password);
  await linkWithCredential(user, credential);
}

// ── Login ───────────────────────────────────────────────────
export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ── Logout ──────────────────────────────────────────────────
export async function logoutUser() {
  await signOut(auth);
}

// ── Get user profile from Firestore ─────────────────────────
export async function getUserProfile(uid) {
  try {
    const snap = await withTimeout(getDoc(doc(db, 'users', uid)));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn('getUserProfile timeout/error:', err.message);
    return null;
  }
}

// ── Update user photo (Base64 data URL) ─────────────────────
export async function updateUserPhoto(uid, photoURL) {
  await updateDoc(doc(db, 'users', uid), { photoURL });
}

// ── Role check ──────────────────────────────────────────────
export async function isAdmin(uid) {
  const profile = await getUserProfile(uid);
  return profile?.role === 'admin';
}

// ── Re-authenticate before sensitive operations ─────────────
export async function reauthenticate(user, password) {
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

// ── Delete account ──────────────────────────────────────────
// 1) Cancel all bookings (decrement class counters atomically)
// 2) Delete profile document
// 3) Delete Firebase Auth account
export async function deleteAccount(user) {
  const uid = user.uid;

  const bookingsSnap = await getDocs(
    query(collection(db, 'bookings'), where('userId', '==', uid))
  );

  for (const bookingDoc of bookingsSnap.docs) {
    const data = bookingDoc.data();
    const classRef = doc(db, 'classes', data.classId);
    const bookingRef = doc(db, 'bookings', bookingDoc.id);

    await runTransaction(db, async (transaction) => {
      const classSnap = await transaction.get(classRef);
      transaction.delete(bookingRef);
      if (classSnap.exists()) {
        const current = classSnap.data().currentBookings || 0;
        transaction.update(classRef, { currentBookings: Math.max(0, current - 1) });
      }
    });
  }

  await deleteDoc(doc(db, 'users', uid));
  await deleteUser(user);
}
