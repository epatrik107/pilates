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

// ── Resend API hívás (Node 20 beépített fetch) ───────────────
async function sendEmail({ apiKey, to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error: ${err}`);
  }
  return res.json();
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
<body style="margin:0;padding:0;background:#f5f7f2;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f2;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#4a6741;padding:28px 32px;text-align:center;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Balance Studio</h1>
            <p style="margin:4px 0 0;font-size:13px;color:#c8d9c2;">pilates</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="background:#f0f4ee;padding:20px 32px;text-align:center;border-top:1px solid #e0e8d8;">
            <p style="margin:0;font-size:13px;color:#5a7a52;">Hamarosan találkozunk!</p>
            <p style="margin:4px 0 0;font-size:13px;color:#4a6741;font-weight:600;">Üdv: Szonja</p>
            <p style="margin:12px 0 0;font-size:11px;color:#a0b898;">
              <a href="${SITE_URL}" style="color:#4a6741;text-decoration:none;">balance-studio.hu</a>
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
           style="background:#f0f4ee;border-radius:8px;padding:20px;margin-bottom:24px;">
      <tr><td style="padding:6px 0;">
        <span style="font-size:13px;color:#6b8a63;">Óra neve</span><br>
        <strong style="font-size:16px;color:#2d3a28;">${classTitle}</strong>
      </td></tr>
      <tr><td style="padding:6px 0;border-top:1px solid #dce8d4;">
        <span style="font-size:13px;color:#6b8a63;">Időpont</span><br>
        <strong style="font-size:15px;color:#2d3a28;">${dateStr} ${classStartTime}</strong>
        ${classDuration ? `<span style="font-size:13px;color:#8a9e82;"> (${classDuration} perc)</span>` : ''}
      </td></tr>
      ${classLocation ? `<tr><td style="padding:6px 0;border-top:1px solid #dce8d4;">
        <span style="font-size:13px;color:#6b8a63;">Helyszín</span><br>
        <strong style="font-size:15px;color:#2d3a28;">${classLocation}</strong>
      </td></tr>` : ''}
      ${instructorName ? `<tr><td style="padding:6px 0;border-top:1px solid #dce8d4;">
        <span style="font-size:13px;color:#6b8a63;">Oktató</span><br>
        <strong style="font-size:15px;color:#2d3a28;">${instructorName}</strong>
      </td></tr>` : ''}
    </table>`;
}

// ── 1. Foglalás visszaigazolás (lemondás gombbal) ────────────
function bookingConfirmationHtml(data) {
  const firstName = (data.userName || 'Kedves').split(' ').slice(-1)[0];
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:16px;color:#2d3a28;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a5240;">
      Bejelentkeztél egy órára, amelyet ezúton megerősítek neked:
    </p>
    ${classDetailsTable(data)}
    <p style="margin:0 0 20px;font-size:14px;color:#4a5240;line-height:1.7;">
      Amennyiben meggondolod magad és érvényteleníteni szeretnéd a bejelentkezésedet,
      ezt az óra kezdete előtt <strong>24 órával</strong> megteheted az alábbi gombra kattintva.
      Ha ezt követően mondanád le az órát, kérünk jelezd nekünk, azonban ilyen esetben
      (24 órán belüli lemondás vagy lemondás nélküli mulasztás) ez fizetési kötelezettséggel járhat.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr><td align="center">
        <a href="${SITE_URL}/bookings.html"
           style="display:inline-block;background:#e8433a;color:#ffffff;text-decoration:none;
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
    <p style="margin:0 0 16px;font-size:16px;color:#2d3a28;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a5240;">
      Emlékeztetünk, hogy holnap pilates óra vár rád! 🧘
    </p>
    ${classDetailsTable(data)}
    <p style="margin:0;font-size:14px;color:#4a5240;line-height:1.7;">
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
    <p style="margin:0 0 16px;font-size:16px;color:#2d3a28;">Kedves <strong>${firstName}</strong>!</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#4a6741;">
      Boldog születésnapot kívánok! 🎉
    </p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a5240;line-height:1.7;">
      Születésnapod alkalmából ajándékba kapod a következő
      <strong>Talaj Pilates</strong> órádat <strong style="color:#4a6741;">50% kedvezménnyel!</strong>
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f0f4ee;border-radius:8px;padding:24px;margin-bottom:24px;text-align:center;">
      <tr><td>
        <p style="margin:0 0 8px;font-size:15px;color:#4a5240;font-weight:600;">Hogyan váltsd be?</p>
        <p style="margin:0;font-size:14px;color:#4a5240;line-height:1.7;">
          Mutasd fel ezt az emailt az óra előtt személyesen, és érvényesítjük a kedvezményt.
          Az ajándék egyszer használható, és a születésnapodat követő 30 napig érvényes.
        </p>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${SITE_URL}/bookings.html"
           style="display:inline-block;background:#4a6741;color:#ffffff;text-decoration:none;
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

    try {
      await sendEmail({
        apiKey:   RESEND_API_KEY.value(),
        to:       userEmail,
        subject:  `Foglalás visszaigazolva – ${classTitle} (${dateStr} ${classStartTime})`,
        html:     bookingConfirmationHtml({ userName, classTitle, dateStr, classStartTime, classDuration, classLocation, instructorName })
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
