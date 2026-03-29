import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {
  doc, setDoc, getDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { auth, db } from './firebase-config.js';

// ── Input sanitization ──────────────────────────────────────
function sanitizeName(name) {
  return name
    .replace(/[<>]/g, '')
    .replace(/&/g, '&amp;')
    .trim()
    .slice(0, 100);
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
  } catch (profileErr) {
    console.warn('Profile update failed (non-critical):', profileErr);
  }

  try {
    const writePromise = setDoc(doc(db, 'users', cred.user.uid), {
      name: cleanName,
      email,
      role: 'user',
      createdAt: serverTimestamp()
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore write timed out')), 8000)
    );
    await Promise.race([writePromise, timeoutPromise]);
  } catch (firestoreErr) {
    console.error('Firestore user profile write failed:', firestoreErr);
  }

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
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

// ── Role check ──────────────────────────────────────────────
export async function isAdmin(uid) {
  const profile = await getUserProfile(uid);
  return profile?.role === 'admin';
}
