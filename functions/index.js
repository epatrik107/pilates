// ============================================================
//  BALANCE STUDIO – Firebase Cloud Functions
//
//  1. onBookingCreated  – foglalás visszaigazoló email
//  2. sendDailyReminders – 24 órás emlékeztető (naponta 08:00)
//  3. sendBirthdayEmails – születésnapi email (naponta 09:00)
//
//  Deploy:
//    firebase functions:secrets:set RESEND_API_KEY
//    firebase deploy --only functions
// ============================================================

const { onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onSchedule }        = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret }      = require('firebase-functions/params');
const admin                 = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// API kulcs Firebase Secret-ként tárolva (nem kódban!)
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const RESEND_FROM = 'Balance Studio <noreply@balance-studio.hu>';
const ADMIN_EMAIL = 'balance.szonja@gmail.com'; // Átírható az admin valós email címére
const SITE_URL    = 'https://balance-studio.hu';
const REGION      = 'europe-west1';

// ── Magyar hónapnevek ────────────────────────────────────────
const HU_MONTHS = [
  'január','február','március','április','május','június',
  'július','augusztus','szeptember','október','november','december'
];

function htmlEscape(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function icsEscape(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/([;,])/g, '\\$1');
}

function singleLineText(value = '') {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeDisplayName(name) {
  return String(name || 'Felhasználó')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 100) || 'Felhasználó';
}

function requireAuth(request, { verified = false } = {}) {
  const auth = request.auth;
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'Bejelentkezés szükséges.');
  }
  if (verified && auth.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Csak megerősített email címmel használható.');
  }
  return auth.uid;
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `Hiányzó vagy hibás mező: ${fieldName}.`);
  }
  return value.trim();
}

async function isAdminUser(uid) {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists && snap.data().role === 'admin';
}

function getClassStartDate(classData) {
  return new Date(`${classData.date}T${classData.startTime || '00:00'}:00`);
}

function canCancelBookingData(data, now = new Date()) {
  if (!data.classStartTimestamp) return true;
  const classStart = data.classStartTimestamp.toDate
    ? data.classStartTimestamp.toDate()
    : new Date(data.classStartTimestamp);
  const bookedAt = data.bookedAt?.toDate
    ? data.bookedAt.toDate()
    : data.bookedAt
      ? new Date(data.bookedAt)
      : null;
  return now < new Date(classStart.getTime() - 24 * 60 * 60 * 1000)
    || (bookedAt && now < new Date(bookedAt.getTime() + 5 * 60 * 1000));
}

function formatHungarianDate(dateStr) {
  // dateStr: YYYY-MM-DD → "2026. április 14."
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${year}. ${HU_MONTHS[month - 1]} ${day}.`;
}

// ── Resend API hívás (Node 22 beépített fetch) ───────────────
async function sendEmail({ apiKey, to, subject, html, attachments }) {
  const body = { from: RESEND_FROM, to, subject, html };
  if (attachments && attachments.length) body.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error: ${err}`);
  }
  return res.json();
}

// ── iCal (.ics) generálás ────────────────────────────────────
function buildICS({ classTitle, classDate, classStartTime, classDuration, classLocation, instructorName }) {
  const [year, month, day] = classDate.split('-').map(Number);
  const [startHour, startMin] = (classStartTime || '09:00').split(':').map(Number);
  const durationMin = parseInt(classDuration) || 60;

  const pad = n => String(n).padStart(2, '0');
  const startDt = `${year}${pad(month)}${pad(day)}T${pad(startHour)}${pad(startMin)}00`;

  const endDate = new Date(year, month - 1, day, startHour, startMin + durationMin);
  const endDt   = `${endDate.getFullYear()}${pad(endDate.getMonth()+1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;

  const uid = `booking-${classDate}-${Date.now()}@balance-studio.hu`;
  const desc = `${classTitle} Pilates óra – Balance Studio${instructorName ? ` (Oktató: ${instructorName})` : ''}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Balance Studio//HU',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;TZID=Europe/Budapest:${startDt}`,
    `DTEND;TZID=Europe/Budapest:${endDt}`,
    `SUMMARY:${icsEscape(classTitle)} – Balance Studio`,
    `DESCRIPTION:${icsEscape(desc)}`,
    ...(classLocation ? [`LOCATION:${icsEscape(classLocation)}`] : []),
    `URL:${SITE_URL}/bookings.html`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

// ── Google Calendar link generálás ──────────────────────────
function googleCalendarUrl({ classTitle, classDate, classStartTime, classDuration, classLocation, instructorName }) {
  const [year, month, day] = classDate.split('-').map(Number);
  const [sh, sm] = (classStartTime || '09:00').split(':').map(Number);
  const durationMin = parseInt(classDuration) || 60;
  const pad = n => String(n).padStart(2, '0');
  const start = `${year}${pad(month)}${pad(day)}T${pad(sh)}${pad(sm)}00`;
  const endDate = new Date(year, month - 1, day, sh, sm + durationMin);
  const end = `${endDate.getFullYear()}${pad(endDate.getMonth()+1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
  const params = new URLSearchParams({
    action:   'TEMPLATE',
    text:     `${classTitle} – Balance Studio`,
    dates:    `${start}/${end}`,
    details:  `Pilates óra a Balance Studioban${instructorName ? `. Oktató: ${instructorName}` : ''}`,
    location: classLocation || '2500 Esztergom, Batthyány Lajos u. 13.',
    ctz:      'Europe/Budapest'
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ═══════════════════════════════════════════════════════════
//  EMAIL SABLONOK
// ═══════════════════════════════════════════════════════════

function emailWrapper(content) {
  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Balance Studio</title>
</head>
<body style="margin:0;padding:0;background:#fdf0e4;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf0e4;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fdfaf6;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(94,66,41,0.10);">
        <tr>
          <td style="background:#5e4229;padding:28px 32px;text-align:center;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#fdf8f2;letter-spacing:1px;font-family:Georgia,serif;">Balance Studio</h1>
            <p style="margin:6px 0 0;font-size:12px;color:#d4b896;letter-spacing:3px;text-transform:uppercase;">pilates</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="background:#f5ece0;padding:20px 32px;text-align:center;border-top:1px solid #e8d5be;">
            <p style="margin:0;font-size:13px;color:#9a7251;">Hamarosan találkozunk!</p>
            <p style="margin:4px 0 0;font-size:13px;color:#7d5a3c;font-weight:600;">Üdv: Szonja 🤍</p>
            <p style="margin:12px 0 0;font-size:11px;color:#b8916a;">
              <a href="${SITE_URL}" style="color:#7d5a3c;text-decoration:none;">balance-studio.hu</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function classDetailsTable({ classTitle, dateStr, classStartTime, classDuration, classLocation, instructorName }) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f5ece0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <tr><td style="padding:6px 0;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Óra neve</span><br>
        <strong style="font-size:16px;color:#3f2b17;">${htmlEscape(classTitle)}</strong>
      </td></tr>
      <tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Időpont</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${htmlEscape(dateStr)} ${htmlEscape(classStartTime)}</strong>
        ${classDuration ? `<span style="font-size:13px;color:#b8916a;"> (${htmlEscape(classDuration)} perc)</span>` : ''}
      </td></tr>
      ${classLocation ? `<tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Helyszín</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${htmlEscape(classLocation)}</strong>
      </td></tr>` : ''}
      ${instructorName ? `<tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Oktató</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${htmlEscape(instructorName)}</strong>
      </td></tr>` : ''}
    </table>`;
}

function adminBookingNotificationHtml(data, isCancellation = false) {
  const title = isCancellation ? '❌ Óra lemondás történt' : '✅ Új foglalás történt';
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:16px;color:#3f2b17;">Kedves Admin!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#5e4229;">
      <strong>${title}</strong>
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f5ece0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <tr><td style="padding:6px 0;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Felhasználó</span><br>
        <strong style="font-size:16px;color:#3f2b17;">${htmlEscape(data.userName)} (${htmlEscape(data.userEmail)})</strong>
      </td></tr>
      <tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Óra neve</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${htmlEscape(data.classTitle)}</strong>
      </td></tr>
      <tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Időpont</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${htmlEscape(data.dateStr)} ${htmlEscape(data.classStartTime)}</strong>
      </td></tr>
    </table>
  `);
}

function cancellationHtml(data) {
  const firstName = htmlEscape((data.userName || 'Kedves').split(' ').slice(-1)[0]);
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:16px;color:#3f2b17;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#5e4229;">
      Sikeresen lemondtad az alábbi órádat. Sajnáljuk, hogy most nem tudsz jönni, reméljük hamarosan újra látunk!
    </p>
    ${classDetailsTable(data)}
  `);
}

// ── 1. Foglalás visszaigazolás (lemondás gomb + naptár) ──────
function bookingConfirmationHtml(data) {
  const firstName = htmlEscape((data.userName || 'Kedves').split(' ').slice(-1)[0]);
  const gcalUrl = googleCalendarUrl(data);
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:16px;color:#3f2b17;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#5e4229;">
      Bejelentkeztél egy órára, amelyet ezúton megerősítek neked:
    </p>
    ${classDetailsTable(data)}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td align="center" style="padding-bottom:10px;">
          <a href="${gcalUrl}" target="_blank"
             style="display:inline-block;background:#7d5a3c;color:#fdf8f2;text-decoration:none;
                    font-size:14px;font-weight:600;padding:11px 28px;border-radius:50px;">
            📅 Hozzáadás Google Naptárhoz
          </a>
        </td>
      </tr>
      <tr>
        <td align="center">
          <p style="margin:0;font-size:12px;color:#b8916a;">
            Vagy nyisd meg a mellékelt <strong>.ics</strong> fájlt az Apple / Outlook naptárhoz
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 20px;font-size:14px;color:#5c3d2e;line-height:1.7;">
      Amennyiben meggondolod magad és érvényteleníteni szeretnéd a bejelentkezésedet,
      ezt az óra kezdete előtt <strong>24 órával</strong> megteheted az alábbi gombra kattintva.
      Ha ezt követően mondanád le az órát, kérünk jelezd nekünk, azonban ilyen esetben
      (24 órán belüli lemondás vagy lemondás nélküli mulasztás) ez fizetési kötelezettséggel járhat.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr><td align="center">
        <a href="${SITE_URL}/bookings.html"
           style="display:inline-block;background:#c0392b;color:#ffffff;text-decoration:none;
                  font-size:15px;font-weight:600;padding:12px 32px;border-radius:50px;">
          Foglalás törlése
        </a>
      </td></tr>
    </table>
  `);
}

// ── 2. 24 órás emlékeztető (lemondás gomb NÉLKÜL) ───────────
function reminderHtml(data) {
  const firstName = htmlEscape((data.userName || 'Kedves').split(' ').slice(-1)[0]);
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:16px;color:#3f2b17;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#5e4229;">
      Emlékeztetünk, hogy holnap Pilates óra vár rád! 🧘
    </p>
    ${classDetailsTable(data)}
    <p style="margin:0;font-size:14px;color:#5c3d2e;line-height:1.7;">
      Ha már nem tudsz részt venni, kérünk jelezd nekünk telefonon vagy emailben, mert a 24 órán belüli
      lemondás fizetési kötelezettséggel jár.
    </p>
  `);
}

// ── 3. Születésnapi email (50% kedvezmény email felmutatással) ──
function birthdayHtml({ userName }) {
  const firstName = htmlEscape((userName || 'Kedves').split(' ').slice(-1)[0]);
  return emailWrapper(`
    <p style="margin:0 0 8px;font-size:28px;text-align:center;">🎂</p>
    <p style="margin:0 0 16px;font-size:16px;color:#3f2b17;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#7d5a3c;">
      Boldog születésnapot kívánok! 🎉
    </p>
    <p style="margin:0 0 20px;font-size:15px;color:#5c3d2e;line-height:1.7;">
      Születésnapod alkalmából ajándékba kapod a következő
      <strong>Talaj Pilates</strong> órádat <strong style="color:#7d5a3c;">50% kedvezménnyel!</strong>
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f5ece0;border-radius:8px;padding:24px;margin-bottom:24px;text-align:center;">
      <tr><td>
        <p style="margin:0 0 8px;font-size:15px;color:#5e4229;font-weight:600;">Hogyan váltsd be?</p>
        <p style="margin:0;font-size:14px;color:#5c3d2e;line-height:1.7;">
          Mutasd fel ezt az emailt az óra előtt személyesen, és érvényesítjük a kedvezményt.
          Az ajándék egyszer használható, és a születésnapodat követő 30 napig érvényes.
        </p>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${SITE_URL}/bookings.html"
           style="display:inline-block;background:#7d5a3c;color:#fdf8f2;text-decoration:none;
                  font-size:15px;font-weight:600;padding:12px 32px;border-radius:50px;">
          Foglalj most
        </a>
      </td></tr>
    </table>
  `);
}

// ═══════════════════════════════════════════════════════════
//  SECURE CLIENT OPERATIONS
//  Foglalas/lemondas csak szerveroldali tranzakcioban tortenik.
// ═══════════════════════════════════════════════════════════
exports.createBooking = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request, { verified: true });
  const classId = requireString(request.data?.classId, 'classId');
  const userRef = db.collection('users').doc(uid);
  const classRef = db.collection('classes').doc(classId);
  const existingQuery = db.collection('bookings')
    .where('userId', '==', uid)
    .where('classId', '==', classId)
    .limit(1);

  return db.runTransaction(async (transaction) => {
    const [userSnap, classSnap, existingSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(classRef),
      transaction.get(existingQuery)
    ]);

    if (!classSnap.exists) {
      throw new HttpsError('not-found', 'Az óra nem található.');
    }
    if (!existingSnap.empty) {
      throw new HttpsError('already-exists', 'Már foglaltál erre az órára.');
    }

    const cls = classSnap.data();
    const classStartDate = getClassStartDate(cls);
    if (cls.archived === true || Number.isNaN(classStartDate.getTime()) || classStartDate <= new Date()) {
      throw new HttpsError('failed-precondition', 'Erre az órára már nem lehet foglalni.');
    }

    const current = Number(cls.currentBookings) || 0;
    const max = Number(cls.maxCapacity) || 0;
    if (current >= max) {
      throw new HttpsError('resource-exhausted', 'Az óra már betelt.');
    }

    const profile = userSnap.exists ? userSnap.data() : {
      name: sanitizeDisplayName(request.auth.token.name),
      email: request.auth.token.email || '',
      role: 'user',
      createdAt: new Date().toISOString()
    };
    if (!userSnap.exists) {
      transaction.set(userRef, profile);
    }

    const bookingRef = db.collection('bookings').doc();
    transaction.set(bookingRef, {
      userId: uid,
      userName: sanitizeDisplayName(profile.name),
      userEmail: request.auth.token.email || profile.email || '',
      classId,
      classTitle: cls.title || '',
      classDate: cls.date || '',
      classStartTime: cls.startTime || '',
      classDuration: Number(cls.duration) || 60,
      classLocation: cls.location || '',
      instructorName: cls.instructorName || '',
      classDescription: cls.description || '',
      classStartTimestamp: admin.firestore.Timestamp.fromDate(classStartDate),
      calendarEventId: null,
      reminderSent: false,
      bookedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.update(classRef, { currentBookings: current + 1 });

    return { bookingId: bookingRef.id };
  });
});

exports.createAdminBooking = onCall({ region: REGION }, async (request) => {
  const adminUid = requireAuth(request, { verified: true });
  if (!(await isAdminUser(adminUid))) {
    throw new HttpsError('permission-denied', 'Admin jogosultság szükséges.');
  }

  const targetUserId = requireString(request.data?.targetUserId, 'targetUserId');
  const classId = requireString(request.data?.classId, 'classId');
  const targetUserRef = db.collection('users').doc(targetUserId);
  const classRef = db.collection('classes').doc(classId);
  const existingQuery = db.collection('bookings')
    .where('userId', '==', targetUserId)
    .where('classId', '==', classId)
    .limit(1);

  return db.runTransaction(async (transaction) => {
    const [targetUserSnap, classSnap, existingSnap] = await Promise.all([
      transaction.get(targetUserRef),
      transaction.get(classRef),
      transaction.get(existingQuery)
    ]);

    if (!targetUserSnap.exists) {
      throw new HttpsError('not-found', 'A felhasználó nem található.');
    }
    if (!classSnap.exists) {
      throw new HttpsError('not-found', 'Az óra nem található.');
    }
    if (!existingSnap.empty) {
      throw new HttpsError('already-exists', 'A felhasználónak már van foglalása erre az órára.');
    }

    const cls = classSnap.data();
    const current = Number(cls.currentBookings) || 0;
    const max = Number(cls.maxCapacity) || 0;
    if (current >= max) {
      throw new HttpsError('resource-exhausted', 'Az óra már betelt.');
    }

    const targetUser = targetUserSnap.data();
    const classStartDate = getClassStartDate(cls);
    if (Number.isNaN(classStartDate.getTime())) {
      throw new HttpsError('failed-precondition', 'Az óra időpontja hibás.');
    }
    const bookingRef = db.collection('bookings').doc();
    transaction.set(bookingRef, {
      userId: targetUserId,
      userName: sanitizeDisplayName(targetUser.name),
      userEmail: targetUser.email || '',
      classId,
      classTitle: cls.title || '',
      classDate: cls.date || '',
      classStartTime: cls.startTime || '',
      classDuration: Number(cls.duration) || 60,
      classLocation: cls.location || '',
      instructorName: cls.instructorName || '',
      classDescription: cls.description || '',
      classStartTimestamp: admin.firestore.Timestamp.fromDate(classStartDate),
      calendarEventId: null,
      reminderSent: false,
      bookedAt: admin.firestore.FieldValue.serverTimestamp(),
      bookedByAdmin: true
    });
    transaction.update(classRef, { currentBookings: current + 1 });

    return { bookingId: bookingRef.id };
  });
});

exports.cancelBooking = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request, { verified: true });
  const bookingId = requireString(request.data?.bookingId, 'bookingId');
  const actorIsAdmin = await isAdminUser(uid);
  const bookingRef = db.collection('bookings').doc(bookingId);

  return db.runTransaction(async (transaction) => {
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError('not-found', 'A foglalás nem található.');
    }

    const booking = bookingSnap.data();
    if (!actorIsAdmin && booking.userId !== uid) {
      throw new HttpsError('permission-denied', 'Ehhez a foglaláshoz nincs jogosultságod.');
    }
    if (!actorIsAdmin && !canCancelBookingData(booking)) {
      throw new HttpsError('failed-precondition', 'A foglalás már nem mondható le online.');
    }

    const classRef = db.collection('classes').doc(booking.classId);
    const classSnap = await transaction.get(classRef);
    transaction.delete(bookingRef);
    if (classSnap.exists) {
      const current = Number(classSnap.data().currentBookings) || 0;
      transaction.update(classRef, { currentBookings: Math.max(0, current - 1) });
    }

    return { cancelled: true };
  });
});

exports.deleteOwnAccountData = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const bookingsQuery = db.collection('bookings').where('userId', '==', uid);
  const waitlistQuery = db.collection('waitlist').where('userId', '==', uid);
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const [bookingsSnap, waitlistSnap] = await Promise.all([
      transaction.get(bookingsQuery),
      transaction.get(waitlistQuery)
    ]);

    for (const bookingDoc of bookingsSnap.docs) {
      const booking = bookingDoc.data();
      const classRef = db.collection('classes').doc(booking.classId);
      const classSnap = await transaction.get(classRef);
      transaction.delete(bookingDoc.ref);
      if (classSnap.exists) {
        const current = Number(classSnap.data().currentBookings) || 0;
        transaction.update(classRef, { currentBookings: Math.max(0, current - 1) });
      }
    }

    waitlistSnap.docs.forEach((docSnap) => transaction.delete(docSnap.ref));
    transaction.delete(userRef);
    return { deletedBookings: bookingsSnap.size, deletedWaitlistEntries: waitlistSnap.size };
  });
});

// ═══════════════════════════════════════════════════════════
//  1. FOGLALÁS VISSZAIGAZOLÁS
//     Firestore trigger: új /bookings/{id} dokumentum létrejön
// ═══════════════════════════════════════════════════════════
exports.onBookingCreated = onDocumentCreated(
  { document: 'bookings/{bookingId}', secrets: [RESEND_API_KEY], region: REGION },
  async (event) => {
    const data = event.data.data();
    const { userEmail, userName, classTitle, classDate, classStartTime, classDuration, classLocation, instructorName } = data;

    if (!userEmail || !classDate) {
      console.warn('onBookingCreated: missing email or date, skipping');
      return;
    }

    const dateStr = formatHungarianDate(classDate);
    const icsContent = buildICS({ classTitle, classDate, classStartTime, classDuration, classLocation, instructorName });
    const icsBase64  = Buffer.from(icsContent).toString('base64');

    try {
      await sendEmail({
        apiKey:   RESEND_API_KEY.value(),
        to:       userEmail,
        subject:  `Foglalás visszaigazolva – ${singleLineText(classTitle)} (${dateStr} ${singleLineText(classStartTime)})`,
        html:     bookingConfirmationHtml({ userName, classTitle, classDate, dateStr, classStartTime, classDuration, classLocation, instructorName }),
        attachments: [{
          filename: 'Balance-Studio-foglalás.ics',
          content:  icsBase64
        }]
      });
      console.log(`Booking confirmation sent to ${userEmail}`);
    } catch (err) {
      console.error('onBookingCreated email error:', err.message);
    }

    try {
      await sendEmail({
        apiKey:   RESEND_API_KEY.value(),
        to:       ADMIN_EMAIL,
        subject:  `Új foglalás: ${singleLineText(userName)} – ${singleLineText(classTitle)} (${dateStr})`,
        html:     adminBookingNotificationHtml({ ...data, dateStr })
      });
      console.log(`Booking admin notification sent to ${ADMIN_EMAIL}`);
    } catch (err) {
      console.error('onBookingCreated admin email error:', err.message);
    }
  }
);

// ═══════════════════════════════════════════════════════════
//  1.1 FOGLALÁS TÖRLÉS
//     Firestore trigger: /bookings/{id} dokumentum törlődik
// ═══════════════════════════════════════════════════════════
exports.onBookingDeleted = onDocumentDeleted(
  { document: 'bookings/{bookingId}', secrets: [RESEND_API_KEY], region: REGION },
  async (event) => {
    const data = event.data.data();
    if (!data) return;

    const { userEmail, userName, classTitle, classDate, classStartTime, classDuration, classLocation, instructorName } = data;

    if (!userEmail || !classDate) return;

    const dateStr = formatHungarianDate(classDate);

    try {
      await sendEmail({
        apiKey:   RESEND_API_KEY.value(),
        to:       userEmail,
        subject:  `Foglalás lemondva – ${singleLineText(classTitle)} (${dateStr})`,
        html:     cancellationHtml({ userName, classTitle, classDate, dateStr, classStartTime, classDuration, classLocation, instructorName })
      });
      console.log(`Cancellation confirmation sent to ${userEmail}`);
    } catch (err) {
      console.error('onBookingDeleted user email error:', err.message);
    }

    try {
      await sendEmail({
        apiKey:   RESEND_API_KEY.value(),
        to:       ADMIN_EMAIL,
        subject:  `Lemondás: ${singleLineText(userName)} – ${singleLineText(classTitle)} (${dateStr})`,
        html:     adminBookingNotificationHtml({ ...data, dateStr }, true)
      });
      console.log(`Cancellation admin notification sent to ${ADMIN_EMAIL}`);
    } catch (err) {
      console.error('onBookingDeleted admin email error:', err.message);
    }
  }
);

// ═══════════════════════════════════════════════════════════
//  2. 24 ÓRÁS EMLÉKEZTETŐ
//     Minden nap 08:00-kor (Budapest) küldi el a másnapi
//     foglalásokhoz az emlékeztetőt. Egyszeri küldés
//     garantálva a reminderSent flag-gel.
// ═══════════════════════════════════════════════════════════
exports.sendDailyReminders = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'Europe/Budapest', secrets: [RESEND_API_KEY], region: REGION },
  async () => {
    // Holnap dátuma YYYY-MM-DD formátumban
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const snap = await db.collection('bookings')
      .where('classDate', '==', tomorrowStr)
      .get();

    const docsToRemind = snap.docs.filter(d => d.data().reminderSent !== true);
    console.log(`Sending reminders for ${docsToRemind.length} bookings on ${tomorrowStr} (${snap.docs.length} total tomorrow)`);

    const results = await Promise.allSettled(
      docsToRemind.map(async (docSnap) => {
        const d = docSnap.data();
        if (!d.userEmail) return;

        await sendEmail({
          apiKey:  RESEND_API_KEY.value(),
          to:      d.userEmail,
          subject: `Emlékeztető – holnap ${singleLineText(d.classStartTime)}: ${singleLineText(d.classTitle)}`,
          html:    reminderHtml({
            userName:       d.userName,
            classTitle:     d.classTitle,
            dateStr:        formatHungarianDate(d.classDate),
            classStartTime: d.classStartTime,
            classDuration:  d.classDuration,
            classLocation:  d.classLocation,
            instructorName: d.instructorName
          })
        });

        await docSnap.ref.update({ reminderSent: true });
        console.log(`Reminder sent to ${d.userEmail} for ${d.classTitle}`);
      })
    );

    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length) console.error(`${errors.length} reminder(s) failed`);
  }
);

// ═══════════════════════════════════════════════════════════
//  3. SZÜLETÉSNAPI EMAIL
//     Minden nap 09:00-kor (Budapest) megnézi, kinek van ma
//     születésnapja (birthdayMonthDay == "MM-DD"), és küld
//     egy 50% kedvezményes emailt. Évente egyszer küld
//     (lastBirthdayEmailYear flag).
// ═══════════════════════════════════════════════════════════
exports.sendBirthdayEmails = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'Europe/Budapest', secrets: [RESEND_API_KEY], region: REGION },
  async () => {
    const today       = new Date();
    const month       = String(today.getMonth() + 1).padStart(2, '0');
    const day         = String(today.getDate()).padStart(2, '0');
    const monthDay    = `${month}-${day}`;
    const currentYear = today.getFullYear();

    const snap = await db.collection('users')
      .where('birthdayMonthDay', '==', monthDay)
      .get();

    console.log(`Birthday check: ${snap.docs.length} users have birthday on ${monthDay}`);

    const results = await Promise.allSettled(
      snap.docs.map(async (docSnap) => {
        const d = docSnap.data();
        if (!d.email) return;
        if (d.lastBirthdayEmailYear === currentYear) return; // már ment ebben az évben

        await sendEmail({
          apiKey:  RESEND_API_KEY.value(),
          to:      d.email,
          subject: 'Boldog születésnapot! 🎂 Ajándék vár rád – Balance Studio',
          html:    birthdayHtml({ userName: d.name })
        });

        await docSnap.ref.update({ lastBirthdayEmailYear: currentYear });
        console.log(`Birthday email sent to ${d.email}`);
      })
    );

    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length) console.error(`${errors.length} birthday email(s) failed`);
  }
);
