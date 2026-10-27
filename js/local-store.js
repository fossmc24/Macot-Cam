// =====================================================================
//  LOCAL STORE — the backend when there is no backend.
//
//  Calibration records live in localStorage; uploaded artwork lives in
//  IndexedDB (localStorage is far too small for a GLB). Everything stays
//  on this one device, in this one browser.
//
//  This is what runs until Supabase is set up. The record format is
//  identical, so switching later is an export and an import, not a
//  re-calibration — see exportAll() / importAll().
// =====================================================================
import { normalizeRecord } from './calibration.js';

const PARTS_KEY = 'mascot-local-parts-v1';
const DB_NAME = 'mascot-local-assets';
const DB_STORE = 'files';
const MAX_VERSIONS = 30;

// ---------------------------------------------------------------------
//  IndexedDB for the uploaded files
// ---------------------------------------------------------------------
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return dbPromise;
}

async function idbPut(key, value) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function idbDel(key) {
  const d = await db();
  return new Promise(res => {
    const tx = d.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
async function idbKeys() {
  const d = await db();
  return new Promise(res => {
    const tx = d.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).getAllKeys();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}

// ---------------------------------------------------------------------
//  The record table
// ---------------------------------------------------------------------
function readAll() {
  try {
    const got = JSON.parse(localStorage.getItem(PARTS_KEY) || 'null');
    if (got && got.records) return { records: got.records, versions: got.versions || {} };
  } catch (_) {}
  return { records: {}, versions: {} };
}
function writeAll(data) {
  try { localStorage.setItem(PARTS_KEY, JSON.stringify(data)); return true; }
  catch (e) { throw new Error('This device is out of storage space for calibrations.'); }
}

// An uploaded file is referenced as local:<id>. Object URLs do not survive
// a reload, so we mint fresh ones each time the page loads.
const LOCAL_PREFIX = 'local:';
export const isLocalAsset = url => typeof url === 'string' && url.startsWith(LOCAL_PREFIX);
const objectUrls = new Map();     // local:<id> → blob URL for this page load

export async function resolveAssets(records) {
  for (const rec of records) {
    if (!isLocalAsset(rec.assetUrl)) continue;
    const key = rec.assetUrl;
    if (!objectUrls.has(key)) {
      const got = await idbGet(key.slice(LOCAL_PREFIX.length));
      if (!got || !got.blob) continue;              // file is gone; the part just won't draw
      objectUrls.set(key, URL.createObjectURL(got.blob));
    }
    rec.storedUrl = key;                            // what gets saved
    rec.assetUrl = objectUrls.get(key);             // what the renderer uses
  }
  return records;
}

// Put the stored reference back before saving, so object URLs never persist.
const forStorage = rec => {
  const out = { ...rec };
  if (out.storedUrl) { out.assetUrl = out.storedUrl; delete out.storedUrl; }
  return out;
};

export async function listAll() {
  const { records } = readAll();
  return resolveAssets(Object.values(records).map(normalizeRecord));
}

export async function listPublished() {
  const { records } = readAll();
  return resolveAssets(Object.values(records).map(normalizeRecord).filter(r => r.published));
}

export async function saveRecord(rec, { publish = null, label = null } = {}) {
  const data = readAll();
  const next = normalizeRecord(forStorage(rec));
  if (publish !== null) next.published = publish;
  next.version = (next.version || 0) + 1;
  next.updatedAt = new Date().toISOString();

  data.records[next.id] = next;
  const list = data.versions[next.id] || [];
  list.unshift({
    version_id: Date.now(), part_id: next.id, record: next,
    version: next.version, published: next.published, label,
    created_at: next.updatedAt
  });
  data.versions[next.id] = list.slice(0, MAX_VERSIONS);
  writeAll(data);
  return (await resolveAssets([normalizeRecord(next)]))[0];
}

export async function deleteRecord(id) {
  const data = readAll();
  delete data.records[id];
  delete data.versions[id];
  writeAll(data);
}

export async function listVersions(id) {
  return (readAll().versions[id] || []);
}

export async function lastPublished(id) {
  const v = (readAll().versions[id] || []).find(x => x.published);
  return v ? (await resolveAssets([normalizeRecord(v.record)]))[0] : null;
}

// ---------------------------------------------------------------------
//  Files
// ---------------------------------------------------------------------
export async function uploadAsset(file, id, kind, body) {
  const assetId = id + '-' + Date.now();
  const blob = body || file;
  await idbPut(assetId, { blob, name: file.name, kind, at: Date.now() });
  const stored = LOCAL_PREFIX + assetId;
  const url = URL.createObjectURL(blob);
  objectUrls.set(stored, url);
  return { path: stored, url, kind, stored };
}

export async function deleteAssetAt(url) {
  // Accept either the stored reference or the live object URL.
  let stored = isLocalAsset(url) ? url : null;
  if (!stored) for (const [k, v] of objectUrls) if (v === url) { stored = k; break; }
  if (!stored) return;
  const live = objectUrls.get(stored);
  if (live) { URL.revokeObjectURL(live); objectUrls.delete(stored); }
  await idbDel(stored.slice(LOCAL_PREFIX.length));
}

// ---------------------------------------------------------------------
//  Moving to Supabase later
// ---------------------------------------------------------------------
const blobToDataUrl = b => new Promise(res => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.readAsDataURL(b);
});

// One file holding every calibration and every uploaded file.
export async function exportAll() {
  const { records, versions } = readAll();
  const assets = {};
  for (const key of await idbKeys()) {
    const got = await idbGet(key);
    if (got && got.blob) assets[key] = { name: got.name, kind: got.kind, data: await blobToDataUrl(got.blob) };
  }
  return {
    format: 'mascot-cam-calibration',
    version: 1,
    exportedAt: new Date().toISOString(),
    records, versions, assets
  };
}

export async function importAll(payload, { replace = false } = {}) {
  if (!payload || payload.format !== 'mascot-cam-calibration') {
    throw new Error('That is not a Mascot Cam calibration file.');
  }
  const data = replace ? { records: {}, versions: {} } : readAll();
  for (const [key, a] of Object.entries(payload.assets || {})) {
    const res = await fetch(a.data);
    await idbPut(key, { blob: await res.blob(), name: a.name, kind: a.kind, at: Date.now() });
  }
  for (const [id, rec] of Object.entries(payload.records || {})) data.records[id] = rec;
  for (const [id, v] of Object.entries(payload.versions || {})) data.versions[id] = v;
  writeAll(data);
  return Object.keys(payload.records || {}).length;
}

export function stats() {
  const { records } = readAll();
  const all = Object.values(records);
  return {
    total: all.length,
    published: all.filter(r => r.published).length,
    drafts: all.filter(r => !r.published).length
  };
}

export function clearAllLocal() {
  try { localStorage.removeItem(PARTS_KEY); } catch (_) {}
}
