// ═══════════════════════════════════════════════════════════
//  GOOGLE CALENDAR INTEGRATION
//  Two methods: 1) Simple URL link  2) Full API sync
// ═══════════════════════════════════════════════════════════

const SCOPES = 'https://www.googleapis.com/auth/calendar.events';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

let tokenClient = null;
let gapiLoaded  = false;
let gisLoaded   = false;
let apiReady    = false;

// ── 1) SIMPLE URL METHOD (always works, no setup needed) ────

export function generateGoogleCalendarUrl(classData) {
  const start = toGCalDateStr(classData.date, classData.startTime);
  const end   = toGCalDateStr(classData.date, classData.startTime, classData.duration || 60);

  const params = new URLSearchParams({
    action:   'TEMPLATE',
    text:     classData.title,
    dates:    `${start}/${end}`,
    details:  `Edzo: ${classData.instructorName || ''}\n${classData.description || ''}\n\nFoglalva a Balance Studio alkalmazasbol`,
    location: classData.location || 'Balance Studio',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function toGCalDateStr(dateStr, timeStr, addMinutes = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min]  = timeStr.split(':').map(Number);
  const dt = new Date(y, m - 1, d, h, min + addMinutes);

  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
}

// ── 2) FULL GOOGLE CALENDAR API (optional, requires setup) ──

export function isGoogleCalendarAPIConfigured() {
  return apiReady;
}

export async function initGoogleCalendarAPI(clientId, apiKey) {
  if (!clientId || !apiKey) return false;

  try {
    await waitForGapi();
    await waitForGis();

    await new Promise((resolve, reject) => {
      window.gapi.load('client', { callback: resolve, onerror: reject });
    });

    await window.gapi.client.init({
      apiKey,
      discoveryDocs: [DISCOVERY_DOC],
    });
    gapiLoaded = true;

    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => {},
    });
    gisLoaded = true;

    apiReady = true;
    return true;
  } catch (err) {
    console.warn('Google Calendar API init failed:', err);
    return false;
  }
}

function waitForGapi(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.gapi) return resolve();
    const start = Date.now();
    const check = setInterval(() => {
      if (window.gapi) { clearInterval(check); resolve(); }
      else if (Date.now() - start > timeout) { clearInterval(check); reject(new Error('GAPI load timeout')); }
    }, 100);
  });
}

function waitForGis(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const start = Date.now();
    const check = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(check); resolve(); }
      else if (Date.now() - start > timeout) { clearInterval(check); reject(new Error('GIS load timeout')); }
    }, 100);
  });
}

function ensureAccessToken() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error('Token client not initialized'));

    tokenClient.callback = (resp) => {
      if (resp.error) reject(new Error(resp.error_description || resp.error));
      else resolve(resp);
    };

    const token = window.gapi.client.getToken();
    if (!token) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  });
}

// ── Add event to Google Calendar (API) ──────────────────────
export async function addEventToGoogleCalendar(classData) {
  if (!apiReady) throw new Error('Google Calendar API nincs inicializalva');

  await ensureAccessToken();

  const startDT = `${classData.date}T${classData.startTime}:00`;
  const endDate = new Date(startDT);
  endDate.setMinutes(endDate.getMinutes() + (parseInt(classData.duration) || 60));

  const endDT = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}T${String(endDate.getHours()).padStart(2,'0')}:${String(endDate.getMinutes()).padStart(2,'0')}:00`;

  const event = {
    summary:     classData.title,
    description: [
      `Edzo: ${classData.instructorName || ''}`,
      classData.description || '',
      '',
      'Foglalva a Balance Studio alkalmazasbol'
    ].filter(Boolean).join('\n'),
    location: classData.location || 'Balance Studio',
    start: { dateTime: startDT, timeZone: 'Europe/Budapest' },
    end:   { dateTime: endDT,   timeZone: 'Europe/Budapest' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
    colorId: '2',
  };

  const response = await window.gapi.client.calendar.events.insert({
    calendarId: 'primary',
    resource: event,
  });

  return response.result.id;
}

// ── Remove event from Google Calendar (API) ─────────────────
export async function removeEventFromGoogleCalendar(eventId) {
  if (!apiReady || !eventId) return false;

  try {
    await ensureAccessToken();
    await window.gapi.client.calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
    return true;
  } catch (err) {
    console.warn('Google Calendar event removal failed:', err);
    return false;
  }
}

// ── Revoke Google access ────────────────────────────────────
export function revokeGoogleAccess() {
  const token = window.gapi?.client?.getToken();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken(null);
  }
}
