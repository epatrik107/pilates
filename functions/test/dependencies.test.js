'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('production Firebase SDK graph loads all deployed function entrypoints', async () => {
  const admin = require('firebase-admin');
  const functions = require('../index.js');

  assert.deepEqual(Object.keys(functions).sort(), [
    'cancelBooking',
    'createAdminBooking',
    'createBooking',
    'deleteOwnAccountData',
    'onBookingCreated',
    'onBookingDeleted',
    'sendBirthdayEmails',
    'sendDailyReminders'
  ]);
  assert.ok(admin.apps.length > 0);
  assert.equal(typeof admin.firestore().collection, 'function');

  await Promise.all(admin.apps.map((app) => app.delete()));
});

test('security override preserves the UUID v4 API consumed by Google Cloud dependencies', () => {
  const { v4, validate, version } = require('uuid');
  const { makeUUID } = require('google-gax/build/src/util');

  const directId = v4();
  const googleGaxId = makeUUID();
  assert.equal(validate(directId), true);
  assert.equal(version(directId), 4);
  assert.equal(validate(googleGaxId), true);
  assert.equal(version(googleGaxId), 4);
});
