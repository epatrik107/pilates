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

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule }        = require('firebase-functions/v2/scheduler');
const { defineSecret }      = require('firebase-functions/params');
const admin                 = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// API kulcs Firebase Secret-ként tárolva (nem kódban!)
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const RESEND_FROM = 'Balance Studio <noreply@balance-studio.hu>';
const SITE_URL    = 'https://balance-studio.hu';
const REGION      = 'europe-west1';

// ── Magyar hónapnevek ────────────────────────────────────────
const HU_MONTHS = [
  'január','február','március','április','május','június',
  'július','augusztus','szeptember','október','november','december'
];

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
    `SUMMARY:${classTitle} – Balance Studio`,
    `DESCRIPTION:${desc}`,
    ...(classLocation ? [`LOCATION:${classLocation}`] : []),
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
        <strong style="font-size:16px;color:#3f2b17;">${classTitle}</strong>
      </td></tr>
      <tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Időpont</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${dateStr} ${classStartTime}</strong>
        ${classDuration ? `<span style="font-size:13px;color:#b8916a;"> (${classDuration} perc)</span>` : ''}
      </td></tr>
      ${classLocation ? `<tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Helyszín</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${classLocation}</strong>
      </td></tr>` : ''}
      ${instructorName ? `<tr><td style="padding:6px 0;border-top:1px solid #e8d5be;">
        <span style="font-size:12px;color:#9a7251;text-transform:uppercase;letter-spacing:0.5px;">Oktató</span><br>
        <strong style="font-size:15px;color:#3f2b17;">${instructorName}</strong>
      </td></tr>` : ''}
    </table>`;
}

// ── 1. Foglalás visszaigazolás (lemondás gomb + naptár) ──────
function bookingConfirmationHtml(data) {
  const firstName = (data.userName || 'Kedves').split(' ').slice(-1)[0];
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
  const firstName = (data.userName || 'Kedves').split(' ').slice(-1)[0];
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:16px;color:#3f2b17;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#5e4229;">
      Emlékeztetünk, hogy holnap pilates óra vár rád! 🧘
    </p>
    ${classDetailsTable(data)}
    <p style="margin:0;font-size:14px;color:#5c3d2e;line-height:1.7;">
      Ha már nem tudsz részt venni, kérünk jelezd nekünk telefonon vagy emailben, mert a 24 órán belüli
      lemondás fizetési kötelezettséggel járhat.
    </p>
  `);
}

// ── 3. Születésnapi email (50% kedvezmény email felmutatással) ──
function birthdayHtml({ userName }) {
  const firstName = (userName || 'Kedves').split(' ').slice(-1)[0];
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
        subject:  `Foglalás visszaigazolva – ${classTitle} (${dateStr} ${classStartTime})`,
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
      .where('reminderSent', '!=', true)
      .get();

    console.log(`Sending reminders for ${snap.docs.length} bookings on ${tomorrowStr}`);

    const results = await Promise.allSettled(
      snap.docs.map(async (docSnap) => {
        const d = docSnap.data();
        if (!d.userEmail) return;

        await sendEmail({
          apiKey:  RESEND_API_KEY.value(),
          to:      d.userEmail,
          subject: `Emlékeztető – holnap ${d.classStartTime}: ${d.classTitle}`,
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
