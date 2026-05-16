import {
  collection, getDocs, getDoc, updateDoc, doc,
  query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db, functions, httpsCallable } from './firebase-config.js';
import { removeEventFromGoogleCalendar, isGoogleCalendarAPIConfigured } from './google-calendar.js';

const bookingsRef = collection(db, 'bookings');

// ═══════════════════════════════════════════════════════════
//  CREATE BOOKING
//  Capacity checks and writes run in a callable Cloud Function,
//  so the browser never updates booking counters directly.
// ═══════════════════════════════════════════════════════════
export async function bookClass(user, classData) {
  if (!user?.uid || !classData?.id) throw new Error('Hiányzó foglalási adat.');
  const createBooking = httpsCallable(functions, 'createBooking');
  return createBooking({ classId: classData.id });
}

// ── Save Google Calendar event ID to a booking ──────────────
export async function saveCalendarEventId(bookingId, calendarEventId) {
  const ref = doc(db, 'bookings', bookingId);
  await updateDoc(ref, { calendarEventId });
}

// ═══════════════════════════════════════════════════════════
//  CANCEL BOOKING
//  Google Calendar cleanup stays client-side; the booking delete
//  and counter decrement run server-side in one transaction.
// ═══════════════════════════════════════════════════════════
export async function cancelBooking(bookingId) {
  if (isGoogleCalendarAPIConfigured()) {
    try {
      const snap = await getDoc(doc(db, 'bookings', bookingId));
      if (snap.exists()) {
        const eventId = snap.data().calendarEventId;
        if (eventId) {
          await removeEventFromGoogleCalendar(eventId);
        }
      }
    } catch (err) {
      console.warn('Calendar event removal skipped:', err);
    }
  }

  const cancelBookingCallable = httpsCallable(functions, 'cancelBooking');
  await cancelBookingCallable({ bookingId });
}

// ── Get a single booking ────────────────────────────────────
export async function getBookingById(bookingId) {
  const snap = await getDoc(doc(db, 'bookings', bookingId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── Get user's booking for a specific class ─────────────────
export async function getUserBookingForClass(userId, classId) {
  const q    = query(bookingsRef, where('userId', '==', userId), where('classId', '==', classId));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ── Get all upcoming bookings for a user ────────────────────
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getUserBookings(userId) {
  const today = localToday();
  const q     = query(
    bookingsRef,
    where('userId', '==', userId),
    where('classDate', '>=', today),
    orderBy('classDate'),
    orderBy('classStartTime')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Get past bookings for a user ─────────────────────────────
export async function getUserPastBookings(userId) {
  const today = localToday();
  const q     = query(
    bookingsRef,
    where('userId', '==', userId),
    where('classDate', '<', today),
    orderBy('classDate', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Set attendance status (admin) ────────────────────────────
export async function setAttendance(bookingId, attended) {
  const ref = doc(db, 'bookings', bookingId);
  await updateDoc(ref, { attended });
}

// ── Get all bookings for a class (admin: participants list) ─
export async function getBookingsForClass(classId) {
  const q    = query(bookingsRef, where('classId', '==', classId), orderBy('bookedAt'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Get ALL bookings (admin: statistics) ─────────────────────
export async function getAllBookings() {
  const snap = await getDocs(query(bookingsRef, orderBy('classDate')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// ═══════════════════════════════════════════════════════════
//  ADMIN BOOKING – Book a class on behalf of a user
// ═══════════════════════════════════════════════════════════
export async function adminBookClass(targetUser, classData) {
  if (!targetUser?.uid || !classData?.id) throw new Error('Hiányzó admin foglalási adat.');
  const createAdminBooking = httpsCallable(functions, 'createAdminBooking');
  return createAdminBooking({ targetUserId: targetUser.uid, classId: classData.id });
}
