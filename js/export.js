import {
  collection, getDocs, query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { db } from './firebase-config.js';

function downloadCSV(csvContent, filename) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeCSV(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export async function exportBookingsCSV(startDate, endDate) {
  const q = query(
    collection(db, 'bookings'),
    where('classDate', '>=', startDate),
    where('classDate', '<=', endDate),
    orderBy('classDate'),
    orderBy('classStartTime')
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => d.data());

  const header = 'Név,Email,Óra,Dátum,Időpont,Helyszín,Oktató,Megjelent';
  const lines = rows.map(r => [
    escapeCSV(r.userName),
    escapeCSV(r.userEmail),
    escapeCSV(r.classTitle),
    escapeCSV(r.classDate),
    escapeCSV(r.classStartTime),
    escapeCSV(r.classLocation),
    escapeCSV(r.instructorName),
    r.attended === true ? 'Igen' : r.attended === false ? 'Nem' : ''
  ].join(','));

  downloadCSV([header, ...lines].join('\n'), `foglalasok_${startDate}_${endDate}.csv`);
  return rows.length;
}

export async function exportUsersCSV() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('name')));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const header = 'Név,Email,Szerepkör,Regisztráció';
  const lines = rows.map(r => [
    escapeCSV(r.name),
    escapeCSV(r.email),
    r.role === 'admin' ? 'Admin' : 'Tag',
    escapeCSV(r.createdAt || '')
  ].join(','));

  downloadCSV([header, ...lines].join('\n'), `ugyfelek_${new Date().toISOString().split('T')[0]}.csv`);
  return rows.length;
}
