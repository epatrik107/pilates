import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, where, orderBy, serverTimestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db } from './firebase-config.js';

const waitlistRef = collection(db, 'waitlist');

export async function joinWaitlist(user, classData) {
  const existing = await getUserWaitlistEntry(user.uid, classData.id);
  if (existing) throw new Error('Már feliratkoztál a várólistára!');

  return await addDoc(waitlistRef, {
    userId:     user.uid,
    userName:   user.displayName || 'Névtelen',
    userEmail:  user.email,
    classId:    classData.id,
    classTitle: classData.title,
    classDate:  classData.date,
    addedAt:    serverTimestamp()
  });
}

export async function leaveWaitlist(waitlistId) {
  await deleteDoc(doc(db, 'waitlist', waitlistId));
}

export async function getUserWaitlistEntry(userId, classId) {
  const q = query(waitlistRef, where('userId', '==', userId), where('classId', '==', classId));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function getUserWaitlistEntries(userId) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const q = query(
    waitlistRef,
    where('userId', '==', userId),
    where('classDate', '>=', today),
    orderBy('classDate')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getWaitlistForClass(classId) {
  const q = query(waitlistRef, where('classId', '==', classId), orderBy('addedAt'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Check if any of the user's waitlisted classes now have free spots
export async function checkWaitlistPromotions(userId, allClasses) {
  const entries = await getUserWaitlistEntries(userId);
  const promotable = [];

  for (const entry of entries) {
    const cls = allClasses.find(c => c.id === entry.classId);
    if (cls && cls.currentBookings < cls.maxCapacity) {
      promotable.push({ waitlistEntry: entry, classData: cls });
    }
  }
  return promotable;
}

// Real-time watcher: listens to class docs the user is waitlisted on.
// Calls onSpotFreed(entry, classData) whenever a full class gets a free spot.
// Returns an unsubscribe function.
export async function watchWaitlistedClasses(userId, onSpotFreed) {
  const entries = await getUserWaitlistEntries(userId);
  if (!entries.length) return () => {};

  const unsubscribers = [];
  const alreadyNotified = new Set();

  for (const entry of entries) {
    let firstSnapshot = true;
    const unsub = onSnapshot(doc(db, 'classes', entry.classId), (snap) => {
      if (firstSnapshot) { firstSnapshot = false; return; }
      if (!snap.exists()) return;
      const cls = { id: snap.id, ...snap.data() };
      if (cls.currentBookings < cls.maxCapacity && !alreadyNotified.has(cls.id)) {
        alreadyNotified.add(cls.id);
        onSpotFreed(entry, cls);
      }
    });
    unsubscribers.push(unsub);
  }

  return () => unsubscribers.forEach(fn => fn());
}
