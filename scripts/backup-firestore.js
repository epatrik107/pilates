#!/usr/bin/env node
// ============================================================
//  FIRESTORE BACKUP → LOCAL JSON (ingyenes, nem kell GCS bucket)
//
//  Használat:
//    1. Firebase Console → Project settings → Service accounts
//       → Generate new private key → mentsd ide:
//       scripts/serviceAccountKey.json  (gitignore-olva van!)
//    2. cd scripts && node backup-firestore.js
//
//  Eredmény: backups/backup-YYYY-MM-DD_HHmm/<collection>.json
//  Minden top-level collection + al-collection-ök rekurzívan.
//  Csak olvasásokat használ (free tier: 50k read/nap).
// ============================================================

const fs = require('fs');
const path = require('path');

// firebase-admin a functions/node_modules-ból, hogy ne kelljen külön install
let admin;
try {
  admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
} catch {
  admin = require('firebase-admin');
}

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('HIBA: nincs meg a scripts/serviceAccountKey.json');
  console.error('Firebase Console → Project settings → Service accounts → Generate new private key');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(keyPath)),
});
const db = admin.firestore();
// REST transport (gRPC helyett) – proxy-s környezetben is működik
db.settings({ preferRest: true });

// Firestore Timestamp / GeoPoint / DocumentReference → JSON-barát
function serialize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof admin.firestore.Timestamp) {
    return { __type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (value instanceof admin.firestore.GeoPoint) {
    return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (value.constructor && value.constructor.name === 'DocumentReference') {
    return { __type: 'reference', path: value.path };
  }
  if (Array.isArray(value)) return value.map(serialize);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
  return out;
}

async function dumpCollection(colRef, stats) {
  const docs = {};
  const snap = await colRef.get();
  for (const doc of snap.docs) {
    docs[doc.id] = { data: serialize(doc.data()), subcollections: {} };
    stats.docs++;
    const subs = await doc.ref.listCollections();
    for (const sub of subs) {
      docs[doc.id].subcollections[sub.id] = await dumpCollection(sub, stats);
    }
  }
  return docs;
}

(async () => {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const outDir = path.join(__dirname, '..', 'backups', `backup-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const collections = await db.listCollections();
  const stats = { docs: 0 };

  for (const col of collections) {
    process.stdout.write(`Exportálás: ${col.id} ... `);
    const data = await dumpCollection(col, stats);
    const file = path.join(outDir, `${col.id}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    console.log(`${Object.keys(data).length} dokumentum → ${path.relative(process.cwd(), file)}`);
  }

  fs.writeFileSync(
    path.join(outDir, '_meta.json'),
    JSON.stringify({ project: 'pilates-studi', exportedAt: now.toISOString(), totalDocs: stats.docs }, null, 2)
  );
  console.log(`\nKész: ${stats.docs} dokumentum összesen → ${outDir}`);
  process.exit(0);
})().catch((err) => {
  console.error('Backup hiba:', err.message);
  process.exit(1);
});
