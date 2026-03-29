import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db } from './firebase-config.js';

const classesRef = collection(db, 'classes');

// ── Create class (admin) ────────────────────────────────────
export async function createClass(data) {
  return await addDoc(classesRef, {
    title:           data.title,
    type:            data.type,
    date:            data.date,
    startTime:       data.startTime,
    duration:        parseInt(data.duration) || 60,
    maxCapacity:     parseInt(data.maxCapacity) || 10,
    currentBookings: 0,
    instructorId:    data.instructorId,
    instructorName:  data.instructorName,
    description:     data.description || '',
    location:        data.location || 'Stúdió',
    createdAt:       serverTimestamp()
  });
}

// ── Update class (admin) ────────────────────────────────────
export async function updateClass(classId, data) {
  if (data.duration != null) data.duration = parseInt(data.duration) || 60;
  if (data.maxCapacity != null) data.maxCapacity = parseInt(data.maxCapacity) || 10;
  if (data.currentBookings != null) data.currentBookings = parseInt(data.currentBookings) || 0;
  const ref = doc(db, 'classes', classId);
  return await updateDoc(ref, data);
}

// ── Delete class (admin) ────────────────────────────────────
export async function deleteClass(classId) {
  const ref = doc(db, 'classes', classId);
  return await deleteDoc(ref);
}

// ── Get upcoming classes ────────────────────────────────────
export async function getUpcomingClasses() {
  const today = new Date().toISOString().split('T')[0];
  const q     = query(classesRef, where('date', '>=', today), orderBy('date'), orderBy('startTime'));
  const snap  = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Get all classes (admin) ─────────────────────────────────
export async function getAllClasses() {
  const q    = query(classesRef, orderBy('date', 'desc'), orderBy('startTime', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Get single class ────────────────────────────────────────
export async function getClassById(classId) {
  const snap = await getDoc(doc(db, 'classes', classId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── Increment booking count ─────────────────────────────────
export async function incrementBookings(classId, delta) {
  const ref = doc(db, 'classes', classId);
  await updateDoc(ref, { currentBookings: increment(delta) });
}
