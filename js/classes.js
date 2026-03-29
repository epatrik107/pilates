import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  getDocs, getDoc, query, where, orderBy, serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db } from './firebase-config.js';

const classesRef = collection(db, 'classes');

// ── Instructor photo (stored in public settings) ────────────
export async function getInstructorPhoto() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'studio'));
    return snap.exists() ? snap.data().instructorPhoto || '' : '';
  } catch { return ''; }
}

export async function saveInstructorPhoto(photoDataURL) {
  await setDoc(doc(db, 'settings', 'studio'), { instructorPhoto: photoDataURL }, { merge: true });
}

// ── Default class types (used when Firestore doc doesn't exist yet) ──
const DEFAULT_CLASS_TYPES = [
  { value: 'mat',      label: 'Mat Pilates', bgColor: '#e6edde', textColor: '#425634' },
  { value: 'reformer', label: 'Reformer',    bgColor: '#ede9fe', textColor: '#6d28d9' },
  { value: 'tower',    label: 'Tower',       bgColor: '#fef3c7', textColor: '#b45309' },
  { value: 'prenatal', label: 'Kismama',     bgColor: '#fce7f3', textColor: '#be185d' },
];

// ── Get class types from Firestore ───────────────────────────
export async function getClassTypes() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'classTypes'));
    if (snap.exists() && snap.data().types?.length) return snap.data().types;
  } catch (err) {
    console.warn('getClassTypes error:', err.message);
  }
  return DEFAULT_CLASS_TYPES;
}

// ── Save class types to Firestore (admin) ────────────────────
export async function saveClassTypes(types) {
  await setDoc(doc(db, 'settings', 'classTypes'), { types });
}

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
    instructorPhoto: data.instructorPhoto || '',
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

// ── Clone a week of classes (+7 days) ───────────────────────
export async function cloneWeekClasses(sourceMonday, instructorId, instructorName) {
  const sundayStr = addDays(sourceMonday, 6);
  const q = query(classesRef, where('date', '>=', sourceMonday), where('date', '<=', sundayStr), orderBy('date'));
  const snap = await getDocs(q);

  if (snap.empty) throw new Error('Nincs óra az adott héten!');

  const created = [];
  for (const d of snap.docs) {
    const src = d.data();
    const newDate = addDays(src.date, 7);
    const ref = await addDoc(classesRef, {
      title:           src.title,
      type:            src.type,
      date:            newDate,
      startTime:       src.startTime,
      duration:        src.duration,
      maxCapacity:     src.maxCapacity,
      currentBookings: 0,
      instructorId:    instructorId || src.instructorId,
      instructorName:  instructorName || src.instructorName,
      instructorPhoto: src.instructorPhoto || '',
      description:     src.description || '',
      location:        src.location || '',
      createdAt:       serverTimestamp()
    });
    created.push(ref.id);
  }
  return created;
}

// ── Create recurring classes (weekly for N weeks) ───────────
export async function createRecurringClasses(data, weeks) {
  const created = [];
  for (let i = 0; i < weeks; i++) {
    const date = addDays(data.date, i * 7);
    const ref = await addDoc(classesRef, {
      title:           data.title,
      type:            data.type,
      date,
      startTime:       data.startTime,
      duration:        parseInt(data.duration) || 60,
      maxCapacity:     parseInt(data.maxCapacity) || 10,
      currentBookings: 0,
      instructorId:    data.instructorId,
      instructorName:  data.instructorName,
      instructorPhoto: data.instructorPhoto || '',
      description:     data.description || '',
      location:        data.location || 'Stúdió',
      createdAt:       serverTimestamp()
    });
    created.push(ref.id);
  }
  return created;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
