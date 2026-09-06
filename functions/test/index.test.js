'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SERVER_TIMESTAMP,
  createFirestoreMock,
  loadFunctions
} = require('./helpers/load-functions');

function callableRequest({ uid = 'user-1', verified = true, email = 'user@example.com', name = 'Teszt Elek', data = {} } = {}) {
  return {
    auth: {
      uid,
      token: { email_verified: verified, email, name }
    },
    data
  };
}

function assertHttpsCode(expectedCode) {
  return (error) => {
    assert.equal(error.code, expectedCode);
    return true;
  };
}

test('input helpers escape untrusted content and prevent header newlines', () => {
  const { __test } = loadFunctions();

  assert.equal(__test.htmlEscape(`<tag a="x">Tom & 'Jerry'</tag>`), '&lt;tag a=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/tag&gt;');
  assert.equal(__test.icsEscape('A\\B, C; D\nE'), 'A\\\\B\\, C\\; D\\nE');
  assert.equal(__test.singleLineText(' Pilates\r\nBcc: attacker@example.com '), 'Pilates Bcc: attacker@example.com');
  assert.equal(__test.sanitizeDisplayName('  <Teszt Elek>  '), 'Teszt Elek');
  assert.equal(__test.sanitizeDisplayName('<>'), 'Felhasználó');
  assert.equal(__test.sanitizeDisplayName('x'.repeat(120)).length, 100);
});

test('callable validation rejects missing auth, unverified email and invalid strings', () => {
  const { __test } = loadFunctions();

  assert.throws(() => __test.requireAuth({}), assertHttpsCode('unauthenticated'));
  assert.throws(
    () => __test.requireAuth({ auth: { uid: 'u1', token: { email_verified: false } } }, { verified: true }),
    assertHttpsCode('failed-precondition')
  );
  assert.equal(__test.requireAuth({ auth: { uid: 'u1', token: {} } }), 'u1');
  assert.equal(__test.requireString('  class-1 ', 'classId'), 'class-1');
  assert.throws(() => __test.requireString('   ', 'classId'), assertHttpsCode('invalid-argument'));
  assert.throws(() => __test.requireString(12, 'classId'), assertHttpsCode('invalid-argument'));
});

test('cancellation policy preserves the 48-hour cutoff and five-minute grace period', () => {
  const { __test } = loadFunctions();
  const now = new Date('2026-06-22T10:00:00.000Z');
  const timestamp = (value) => ({ toDate: () => new Date(value) });

  assert.equal(__test.canCancelBookingData({}, now), true, 'legacy bookings without a start timestamp remain cancellable');
  assert.equal(__test.canCancelBookingData({ classStartTimestamp: timestamp('2026-06-24T10:00:01.000Z') }, now), true);
  assert.equal(Boolean(__test.canCancelBookingData({ classStartTimestamp: timestamp('2026-06-24T10:00:00.000Z') }, now)), false);
  assert.equal(__test.canCancelBookingData({
    classStartTimestamp: timestamp('2026-06-22T12:00:00.000Z'),
    bookedAt: timestamp('2026-06-22T09:55:01.000Z')
  }, now), true);
  assert.equal(__test.canCancelBookingData({
    classStartTimestamp: timestamp('2026-06-22T12:00:00.000Z'),
    bookedAt: timestamp('2026-06-22T09:55:00.000Z')
  }, now), false);
});

test('calendar helpers format Hungarian dates, escape ICS fields and roll duration into the next day', () => {
  const { __test } = loadFunctions();

  assert.equal(__test.formatHungarianDate('2026-04-14'), '2026. április 14.');
  const ics = __test.buildICS({
    classTitle: 'Reformer, Pro; A\nB\\C',
    classDate: '2026-06-30',
    classStartTime: '23:30',
    classDuration: 90,
    classLocation: 'Stúdió, 1',
    instructorName: 'Szonja'
  });
  assert.match(ics, /DTSTART;TZID=Europe\/Budapest:20260630T233000/);
  assert.match(ics, /DTEND;TZID=Europe\/Budapest:20260701T010000/);
  assert.ok(ics.includes('SUMMARY:Reformer\\, Pro\\; A\\nB\\\\C – Balance Studio'));
  assert.ok(ics.includes('LOCATION:Stúdió\\, 1'));

  const calendarUrl = new URL(__test.googleCalendarUrl({
    classTitle: 'Talaj Pilates',
    classDate: '2026-06-30',
    classStartTime: '09:15',
    classDuration: '45',
    instructorName: 'Szonja'
  }));
  assert.equal(calendarUrl.origin, 'https://calendar.google.com');
  assert.equal(calendarUrl.searchParams.get('dates'), '20260630T091500/20260630T100000');
  assert.equal(calendarUrl.searchParams.get('ctz'), 'Europe/Budapest');
});

test('sendEmail uses the Resend contract and reports non-success responses without a real network call', async () => {
  const { __test } = loadFunctions();
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({ id: 'email-1' }) };
    };
    const result = await __test.sendEmail({
      apiKey: 'secret-test-key',
      to: 'recipient@example.com',
      subject: 'Teszt',
      html: '<p>teszt</p>',
      attachments: [{ filename: 'event.ics', content: 'Ym9keQ==' }]
    });

    assert.deepEqual(result, { id: 'email-1' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'https://api.resend.com/emails');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer secret-test-key');
    assert.deepEqual(JSON.parse(calls[0][1].body).attachments, [{ filename: 'event.ics', content: 'Ym9keQ==' }]);

    globalThis.fetch = async () => ({ ok: false, text: async () => 'rejected by test double' });
    await assert.rejects(
      () => __test.sendEmail({ apiKey: 'key', to: 'x@example.com', subject: 'x', html: 'x' }),
      /Resend API error: rejected by test double/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createBooking atomically creates a sanitized booking and increments capacity', async () => {
  const firestore = createFirestoreMock({
    'classes/class-1': {
      title: 'Reformer Pilates',
      date: '2999-06-30',
      startTime: '09:00',
      duration: '50',
      maxCapacity: 8,
      currentBookings: 2,
      location: 'Nagyterem',
      instructorName: 'Szonja'
    }
  });
  const functions = loadFunctions({ db: firestore.db });

  const result = await functions.createBooking(callableRequest({
    name: '  <Teszt Elek>  ',
    data: { classId: ' class-1 ' }
  }));

  assert.deepEqual(result, { bookingId: 'auto-1' });
  assert.equal(firestore.getData('users/user-1').name, 'Teszt Elek');
  assert.equal(firestore.getData('classes/class-1').currentBookings, 3);
  const booking = firestore.getData('bookings/auto-1');
  assert.equal(booking.userId, 'user-1');
  assert.equal(booking.userName, 'Teszt Elek');
  assert.equal(booking.classDuration, 50);
  assert.equal(booking.bookedAt, SERVER_TIMESTAMP);
  assert.equal(booking.classStartTimestamp.toDate().getFullYear(), 2999);
  assert.deepEqual(firestore.writes.map((write) => write.operation), ['set', 'set', 'update']);
});

test('createBooking rejects duplicate, full, archived and unauthenticated requests without writes', async (t) => {
  await t.test('duplicate booking', async () => {
    const firestore = createFirestoreMock({
      'users/user-1': { name: 'Teszt Elek', email: 'user@example.com' },
      'classes/class-1': { date: '2999-06-30', startTime: '09:00', maxCapacity: 8, currentBookings: 1 },
      'bookings/existing': { userId: 'user-1', classId: 'class-1' }
    });
    const functions = loadFunctions({ db: firestore.db });
    await assert.rejects(
      () => functions.createBooking(callableRequest({ data: { classId: 'class-1' } })),
      assertHttpsCode('already-exists')
    );
    assert.equal(firestore.writes.length, 0);
  });

  await t.test('full class', async () => {
    const firestore = createFirestoreMock({
      'users/user-1': { name: 'Teszt Elek' },
      'classes/class-1': { date: '2999-06-30', startTime: '09:00', maxCapacity: 2, currentBookings: 2 }
    });
    const functions = loadFunctions({ db: firestore.db });
    await assert.rejects(
      () => functions.createBooking(callableRequest({ data: { classId: 'class-1' } })),
      assertHttpsCode('resource-exhausted')
    );
    assert.equal(firestore.writes.length, 0);
  });

  await t.test('archived class', async () => {
    const firestore = createFirestoreMock({
      'users/user-1': { name: 'Teszt Elek' },
      'classes/class-1': { date: '2999-06-30', startTime: '09:00', maxCapacity: 2, currentBookings: 0, archived: true }
    });
    const functions = loadFunctions({ db: firestore.db });
    await assert.rejects(
      () => functions.createBooking(callableRequest({ data: { classId: 'class-1' } })),
      assertHttpsCode('failed-precondition')
    );
    assert.equal(firestore.writes.length, 0);
  });

  await t.test('unverified user', async () => {
    const firestore = createFirestoreMock();
    const functions = loadFunctions({ db: firestore.db });
    await assert.rejects(
      () => functions.createBooking(callableRequest({ verified: false, data: { classId: 'class-1' } })),
      assertHttpsCode('failed-precondition')
    );
    assert.equal(firestore.writes.length, 0);
  });
});

test('cancelBooking enforces ownership and cutoff while allowing an admin override', async (t) => {
  await t.test('rejects another user', async () => {
    const firestore = createFirestoreMock({
      'users/user-1': { role: 'user' },
      'bookings/booking-1': { userId: 'other-user', classId: 'class-1' }
    });
    const functions = loadFunctions({ db: firestore.db });
    await assert.rejects(
      () => functions.cancelBooking(callableRequest({ data: { bookingId: 'booking-1' } })),
      assertHttpsCode('permission-denied')
    );
    assert.equal(firestore.writes.length, 0);
  });

  await t.test('rejects a late user cancellation outside the grace period', async () => {
    const now = Date.now();
    const firestore = createFirestoreMock({
      'users/user-1': { role: 'user' },
      'bookings/booking-1': {
        userId: 'user-1',
        classId: 'class-1',
        classStartTimestamp: new Date(now + 23 * 60 * 60 * 1000),
        bookedAt: new Date(now - 10 * 60 * 1000)
      }
    });
    const functions = loadFunctions({ db: firestore.db });
    await assert.rejects(
      () => functions.cancelBooking(callableRequest({ data: { bookingId: 'booking-1' } })),
      assertHttpsCode('failed-precondition')
    );
    assert.equal(firestore.writes.length, 0);
  });

  await t.test('admin can cancel late and the counter never goes below zero', async () => {
    const firestore = createFirestoreMock({
      'users/admin-1': { role: 'admin' },
      'bookings/booking-1': {
        userId: 'other-user',
        classId: 'class-1',
        classStartTimestamp: new Date(Date.now() - 60_000)
      },
      'classes/class-1': { currentBookings: 0 }
    });
    const functions = loadFunctions({ db: firestore.db });
    const result = await functions.cancelBooking(callableRequest({
      uid: 'admin-1',
      data: { bookingId: 'booking-1' }
    }));

    assert.deepEqual(result, { cancelled: true });
    assert.equal(firestore.hasDocument('bookings/booking-1'), false);
    assert.equal(firestore.getData('classes/class-1').currentBookings, 0);
    assert.deepEqual(firestore.writes.map((write) => write.operation), ['delete', 'update']);
  });
});

test('booking trigger sends mocked user/admin emails, escapes HTML and strips subject newlines', async () => {
  const functions = loadFunctions({ secretValue: 'isolated-test-key' });
  const originalFetch = globalThis.fetch;
  const calls = [];
  const originalLog = console.log;

  try {
    console.log = () => {};
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ id: `email-${calls.length}` }) };
    };
    await functions.onBookingCreated({
      data: {
        data: () => ({
          userEmail: 'user@example.com',
          userName: '<Teszt Elek>',
          classTitle: 'Pilates\r\nBcc: attacker@example.com',
          classDate: '2026-06-30',
          classStartTime: '09:00',
          classDuration: 50,
          classLocation: 'Nagyterem',
          instructorName: 'Szonja'
        })
      }
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.url), [
      'https://api.resend.com/emails',
      'https://api.resend.com/emails'
    ]);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer isolated-test-key');
    assert.equal(calls[0].body.to, 'user@example.com');
    assert.equal(calls[1].body.to, 'balance.szonja@gmail.com');
    assert.doesNotMatch(calls[0].body.subject, /[\r\n]/);
    assert.match(calls[0].body.html, /Elek&gt;/);
    assert.doesNotMatch(calls[0].body.html, /<Teszt Elek>/);
    assert.match(calls[0].body.html, /48 órával/);
    assert.equal(calls[0].body.attachments[0].filename, 'Balance-Studio-foglalás.ics');
    assert.match(Buffer.from(calls[0].body.attachments[0].content, 'base64').toString(), /BEGIN:VCALENDAR/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test('booking trigger skips incomplete data and contains external email failures', async () => {
  const functions = loadFunctions();
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const errors = [];
  let fetchCount = 0;

  try {
    console.warn = () => {};
    console.error = (...args) => errors.push(args.join(' '));
    globalThis.fetch = async () => {
      fetchCount += 1;
      return { ok: false, text: async () => 'mocked outage' };
    };

    await functions.onBookingCreated({ data: { data: () => ({ classDate: '2026-06-30' }) } });
    assert.equal(fetchCount, 0);

    await assert.doesNotReject(() => functions.onBookingCreated({
      data: {
        data: () => ({
          userEmail: 'user@example.com',
          userName: 'Teszt Elek',
          classTitle: 'Pilates',
          classDate: '2026-06-30',
          classStartTime: '09:00'
        })
      }
    }));
    assert.equal(fetchCount, 2);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /mocked outage/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test('daily reminders contact only unsent bookings and mark success after the mocked email resolves', async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const classDate = tomorrow.toISOString().split('T')[0];
  const firestore = createFirestoreMock({
    'bookings/new-reminder': {
      userEmail: 'new@example.com',
      userName: 'Teszt Elek',
      classTitle: 'Pilates',
      classDate,
      classStartTime: '09:00',
      reminderSent: false
    },
    'bookings/already-sent': {
      userEmail: 'old@example.com',
      classTitle: 'Pilates',
      classDate,
      reminderSent: true
    },
    'bookings/another-day': {
      userEmail: 'other@example.com',
      classDate: '2999-01-01',
      reminderSent: false
    }
  });
  const functions = loadFunctions({ db: firestore.db });
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const recipients = [];

  try {
    console.log = () => {};
    globalThis.fetch = async (_url, options) => {
      recipients.push(JSON.parse(options.body).to);
      return { ok: true, json: async () => ({ id: 'reminder-1' }) };
    };
    await functions.sendDailyReminders();

    assert.deepEqual(recipients, ['new@example.com']);
    assert.equal(firestore.getData('bookings/new-reminder').reminderSent, true);
    assert.equal(firestore.getData('bookings/already-sent').reminderSent, true);
    assert.equal(firestore.getData('bookings/another-day').reminderSent, false);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});
