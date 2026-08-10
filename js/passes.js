// ═══════════════════════════════════════════════════════════
//  BÉRLETEK (PASSES)
//  users/{uid}/passes/{passId}
//  { totalSessions, remainingSessions, note, status, createdAt, updatedAt }
//  status: 'active' | 'used'
//  Írni csak admin tud (Firestore rules), a user a sajátját olvashatja.
// ═══════════════════════════════════════════════════════════
import {
  collection, collectionGroup, getDocs, addDoc, updateDoc, deleteDoc, doc,
  query, where, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db } from './firebase-config.js';

function passesRef(userId) {
  return collection(db, 'users', userId, 'passes');
}

// ── Aktív bérlet lekérése (max 1 lehet) ─────────────────────
export async function getActivePass(userId) {
  if (!userId) return null;
  const q = query(passesRef(userId), where('status', '==', 'active'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// ── Összes AKTÍV bérlet lekérése egy lekérdezéssel (admin) ──
// Szűrő nélküli collection-group query (nem igényel egyedi
// indexet), a szűrés kliens oldalon történik.
// Visszaad: { userId: pass } map
export async function getAllActivePasses() {
  const snap = await getDocs(query(collectionGroup(db, 'passes')));
  const map = {};
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.status !== 'active') return;
    const userId = d.ref.parent.parent.id;
    map[userId] = { id: d.id, ...data };
  });
  return map;
}

// ── Bérlet hozzáadása (admin) ───────────────────────────────
// Ha van még aktív bérlet, azt 'used'-ra állítja, hogy mindig
// legfeljebb egy aktív bérlet legyen.
export async function addPass(userId, totalSessions, note = '') {
  const total = Number(totalSessions);
  if (!userId) throw new Error('Hiányzó felhasználó.');
  if (!Number.isInteger(total) || total < 1 || total > 1000) {
    throw new Error('Az alkalmak száma 1 és 1000 közötti egész szám legyen.');
  }
  const existing = await getActivePass(userId);
  if (existing) {
    await updateDoc(doc(db, 'users', userId, 'passes', existing.id), {
      status: 'used',
      updatedAt: serverTimestamp()
    });
  }
  const data = {
    totalSessions: total,
    remainingSessions: total,
    status: 'active',
    createdAt: serverTimestamp()
  };
  const trimmedNote = String(note || '').trim().slice(0, 200);
  if (trimmedNote) data.note = trimmedNote;
  const ref = await addDoc(passesRef(userId), data);
  return ref.id;
}

// ── Hátralévő alkalmak módosítása (admin, +/- delta) ────────
export async function adjustPass(userId, pass, delta) {
  if (!userId || !pass?.id) throw new Error('Hiányzó bérlet.');
  const next = Number(pass.remainingSessions) + Number(delta);
  if (!Number.isInteger(next) || next < 0 || next > Number(pass.totalSessions)) {
    throw new Error('A hátralévő alkalmak száma 0 és az összes alkalom között lehet.');
  }
  await updateDoc(doc(db, 'users', userId, 'passes', pass.id), {
    remainingSessions: next,
    updatedAt: serverTimestamp()
  });
  return next;
}

// ── Bérlet elvétele (admin) ─────────────────────────────────
export async function removePass(userId, passId) {
  if (!userId || !passId) throw new Error('Hiányzó bérlet.');
  await deleteDoc(doc(db, 'users', userId, 'passes', passId));
}
