import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {
  doc, setDoc, getDoc
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

  return cred.user;
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

// ── Role check ──────────────────────────────────────────────
export async function isAdmin(uid) {
  const profile = await getUserProfile(uid);
  return profile?.role === 'admin';
}
