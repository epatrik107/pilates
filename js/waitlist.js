import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, where, orderBy, serverTimestamp, getCountFromServer
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db } from './firebase-config.js';

const waitlistRef = collection(db, 'waitlist');

export async function joinWaitlist(user, classData) {
  const existing = await getUserWaitlistEntry(user.uid, classData.id);
  if (existing) throw new Error('Már feliratkoztál a várólistára!');

  const countSnap = await getCountFromServer(
    query(waitlistRef, where('classId', '==', classData.id))
  );
  const position = countSnap.data().count + 1;

  return await addDoc(waitlistRef, {
    userId:     user.uid,
    userName:   user.displayName || 'Névtelen',
    userEmail:  user.email,
    classId:    classData.id,
    classTitle: classData.title,
    classDate:  classData.date,
    position,
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
  const today = new Date().toISOString().split('T')[0];
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
