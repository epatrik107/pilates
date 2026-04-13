import {
  collection, addDoc, getDocs, getDoc, deleteDoc, updateDoc, doc,
  query, where, orderBy, serverTimestamp, runTransaction, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db } from './firebase-config.js';
import { removeEventFromGoogleCalendar, isGoogleCalendarAPIConfigured } from './google-calendar.js';

const bookingsRef = collection(db, 'bookings');

// ═══════════════════════════════════════════════════════════
//  CREATE BOOKING – Using Firestore Transaction
//  The transaction ensures that the capacity check and the
//  booking creation are ATOMIC. This prevents two concurrent
//  bookings from causing overbooking (race condition guard).
// ═══════════════════════════════════════════════════════════
export async function bookClass(user, classData) {
  const existing = await getUserBookingForClass(user.uid, classData.id);
  if (existing) {
    throw new Error('Már foglaltál erre az órára!');
  }

  const classRef = doc(db, 'classes', classData.id);
  const classStartDate = new Date(`${classData.date}T${classData.startTime || '00:00'}:00`);

  const newBookingRef = await runTransaction(db, async (transaction) => {
    const classSnap = await transaction.get(classRef);
    if (!classSnap.exists()) {
      throw new Error('Az óra nem létezik vagy törölve lett!');
    }

    const current = classSnap.data().currentBookings || 0;
    const max     = classSnap.data().maxCapacity || 0;

    if (current >= max) {
      throw new Error('Az óra már betelt!');
    }

    const bookingRef = doc(collection(db, 'bookings'));

    transaction.set(bookingRef, {
      userId:           user.uid,
      userName:         user.displayName || 'Névtelen',
      userEmail:        user.email,
      classId:          classData.id,
      classTitle:       classData.title,
      classDate:        classData.date,
      classStartTime:   classData.startTime,
      classDuration:    parseInt(classData.duration) || 60,
      classLocation:    classData.location || '',
      instructorName:   classData.instructorName || '',
      classDescription: classData.description || '',
      classStartTimestamp: Timestamp.fromDate(classStartDate),
      calendarEventId:  null,
      bookedAt:         serverTimestamp()
    });

    transaction.update(classRef, {
      currentBookings: current + 1
    });

    return bookingRef;
  });

  return newBookingRef;
}

// ── Save Google Calendar event ID to a booking ──────────────
export async function saveCalendarEventId(bookingId, calendarEventId) {
  const ref = doc(db, 'bookings', bookingId);
  await updateDoc(ref, { calendarEventId });
}

// ═══════════════════════════════════════════════════════════
//  CANCEL BOOKING – Using Firestore Transaction
//  Atomic deletion + counter decrement to prevent
//  inconsistent state between the booking and the counter.
// ═══════════════════════════════════════════════════════════
export async function cancelBooking(bookingId, classId) {
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

  const bookingRef = doc(db, 'bookings', bookingId);
  const classRef   = doc(db, 'classes', classId);

  await runTransaction(db, async (transaction) => {
    const classSnap = await transaction.get(classRef);

    transaction.delete(bookingRef);

    if (classSnap.exists()) {
      const current = classSnap.data().currentBookings || 0;
      transaction.update(classRef, {
        currentBookings: Math.max(0, current - 1)
      });
    }
  });
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
  const classRef = doc(db, 'classes', classData.id);
  const classStartDate = new Date(`${classData.date}T${classData.startTime || '00:00'}:00`);

  const newBookingRef = await runTransaction(db, async (transaction) => {
    const classSnap = await transaction.get(classRef);
    if (!classSnap.exists()) throw new Error('Az óra nem létezik!');

    const current = classSnap.data().currentBookings || 0;
    const max     = classSnap.data().maxCapacity || 0;
    if (current >= max) throw new Error('Az óra már betelt!');

    const bookingRef = doc(collection(db, 'bookings'));

    transaction.set(bookingRef, {
      userId:              targetUser.uid,
      userName:            targetUser.name || 'Névtelen',
      userEmail:           targetUser.email || '',
      classId:             classData.id,
      classTitle:          classData.title,
      classDate:           classData.date,
      classStartTime:      classData.startTime,
      classDuration:       parseInt(classData.duration) || 60,
      classLocation:       classData.location || '',
      instructorName:      classData.instructorName || '',
      classDescription:    classData.description || '',
      classStartTimestamp: Timestamp.fromDate(classStartDate),
      calendarEventId:     null,
      bookedAt:            serverTimestamp(),
      bookedByAdmin:       true
    });

    transaction.update(classRef, { currentBookings: current + 1 });
    return bookingRef;
  });

  return newBookingRef;
}