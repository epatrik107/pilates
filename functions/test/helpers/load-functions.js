'use strict';

const fs = require('node:fs');
const path = require('node:path');

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
  }
}

class TestTimestamp {
  constructor(date) {
    this.date = new Date(date);
  }

  toDate() {
    return new Date(this.date);
  }
}

const SERVER_TIMESTAMP = Object.freeze({ __serverTimestamp: true });

function snapshot(ref, value) {
  return {
    id: ref.id,
    ref,
    exists: value !== undefined,
    data: () => value
  };
}

function createFirestoreMock(initialDocuments = {}) {
  const documents = new Map(Object.entries(initialDocuments));
  const writes = [];
  let autoId = 0;

  function documentRef(collectionName, id) {
    const resolvedId = id || `auto-${++autoId}`;
    const ref = {
      kind: 'document',
      collectionName,
      id: resolvedId,
      path: `${collectionName}/${resolvedId}`
    };
    ref.get = async () => snapshot(ref, documents.get(ref.path));
    ref.update = async (patch) => {
      const current = documents.get(ref.path) || {};
      documents.set(ref.path, { ...current, ...patch });
      writes.push({ operation: 'update', ref, data: patch });
    };
    return ref;
  }

  function querySnapshot(query) {
    let entries = [...documents.entries()]
      .filter(([key]) => key.startsWith(`${query.collectionName}/`))
      .map(([key, value]) => {
        const id = key.slice(query.collectionName.length + 1);
        return snapshot(documentRef(query.collectionName, id), value);
      });

    for (const [field, operator, expected] of query.filters) {
      if (operator !== '==') throw new Error(`Unsupported test operator: ${operator}`);
      entries = entries.filter((entry) => entry.data()?.[field] === expected);
    }
    if (query.limitValue !== undefined) entries = entries.slice(0, query.limitValue);

    return {
      docs: entries,
      size: entries.length,
      empty: entries.length === 0
    };
  }

  function queryRef(collectionName, filters = [], limitValue) {
    return {
      kind: 'query',
      collectionName,
      filters,
      limitValue,
      where(field, operator, value) {
        return queryRef(collectionName, [...filters, [field, operator, value]], limitValue);
      },
      limit(value) {
        return queryRef(collectionName, filters, value);
      },
      async get() {
        return querySnapshot(this);
      }
    };
  }

  const transaction = {
    async get(ref) {
      if (ref.kind === 'query') return querySnapshot(ref);
      return snapshot(ref, documents.get(ref.path));
    },
    set(ref, data) {
      documents.set(ref.path, data);
      writes.push({ operation: 'set', ref, data });
    },
    update(ref, patch) {
      const current = documents.get(ref.path) || {};
      documents.set(ref.path, { ...current, ...patch });
      writes.push({ operation: 'update', ref, data: patch });
    },
    delete(ref) {
      documents.delete(ref.path);
      writes.push({ operation: 'delete', ref });
    }
  };

  const db = {
    collection(collectionName) {
      const query = queryRef(collectionName);
      return {
        doc: (id) => documentRef(collectionName, id),
        where: query.where.bind(query),
        get: query.get.bind(query)
      };
    },
    async runTransaction(callback) {
      return callback(transaction);
    }
  };

  return {
    db,
    writes,
    getData: (pathName) => documents.get(pathName),
    hasDocument: (pathName) => documents.has(pathName)
  };
}

function loadFunctions({ db = createFirestoreMock().db, secretValue = 'test-resend-key' } = {}) {
  const indexPath = path.resolve(__dirname, '../../index.js');
  const source = fs.readFileSync(indexPath, 'utf8');
  const exposeForTests = `
module.exports.__test = {
  htmlEscape,
  icsEscape,
  singleLineText,
  sanitizeDisplayName,
  requireAuth,
  requireString,
  getClassStartDate,
  canCancelBookingData,
  formatHungarianDate,
  sendEmail,
  buildICS,
  googleCalendarUrl,
  bookingConfirmationHtml
};`;

  const passthrough = (...args) => args.at(-1);
  const firestore = Object.assign(() => db, {
    Timestamp: { fromDate: (date) => new TestTimestamp(date) },
    FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP }
  });
  const firebaseAdmin = { initializeApp() {}, firestore };
  const modules = {
    'firebase-functions/v2/firestore': {
      onDocumentCreated: passthrough,
      onDocumentDeleted: passthrough
    },
    'firebase-functions/v2/scheduler': { onSchedule: passthrough },
    'firebase-functions/v2/https': {
      onCall: passthrough,
      HttpsError: TestHttpsError
    },
    'firebase-functions/params': {
      defineSecret: () => ({ value: () => secretValue })
    },
    'firebase-admin': firebaseAdmin
  };
  const testRequire = (moduleName) => {
    if (Object.hasOwn(modules, moduleName)) return modules[moduleName];
    throw new Error(`Unexpected module import in test harness: ${moduleName}`);
  };

  const testModule = { exports: {} };
  const compile = new Function('exports', 'require', 'module', '__filename', '__dirname', `${source}\n${exposeForTests}`);
  compile(testModule.exports, testRequire, testModule, indexPath, path.dirname(indexPath));
  return testModule.exports;
}

module.exports = {
  SERVER_TIMESTAMP,
  TestHttpsError,
  TestTimestamp,
  createFirestoreMock,
  loadFunctions
};
