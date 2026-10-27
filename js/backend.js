// =====================================================================
//  BACKEND — one interface, two places to put things.
//
//  "local"    : this device only. No setup, no sign-in. What runs today.
//  "supabase" : shared with everyone, once js/config.js is filled in.
//
//  The record format is the same either way, so the switch costs an
//  export and an import rather than a re-calibration.
// =====================================================================
import { isConfigured } from './config.js';
import * as Local from './local-store.js';

export const mode = () => (isConfigured() ? 'supabase' : 'local');
export const isLocal = () => mode() === 'local';

// The Supabase module pulls in the Supabase SDK, so only load it if used.
let remote = null;
async function R() {
  if (!remote) remote = await import('./admin-store.js');
  return remote;
}

// ---------------------------------------------------------------------
//  Who you are
// ---------------------------------------------------------------------
export async function currentUser() {
  if (isLocal()) return { email: 'this device', local: true };
  return (await R()).currentUser();
}
export async function isAdmin() {
  if (isLocal()) return true;             // your own browser, your own parts
  return (await R()).isAdmin();
}
export async function signIn(email, password) {
  if (isLocal()) return { email: 'this device', local: true };
  return (await R()).signInWithPassword(email, password);
}
export async function signOut() {
  if (isLocal()) return;
  return (await R()).signOut();
}

// ---------------------------------------------------------------------
//  Records
// ---------------------------------------------------------------------
export async function listAll() {
  return isLocal() ? Local.listAll() : (await R()).listAll();
}
export async function saveRecord(rec, opts) {
  return isLocal() ? Local.saveRecord(rec, opts) : (await R()).saveRecord(rec, opts);
}
export async function deleteRecord(id) {
  return isLocal() ? Local.deleteRecord(id) : (await R()).deleteRecord(id);
}
export async function listVersions(id) {
  return isLocal() ? Local.listVersions(id) : (await R()).listVersions(id);
}
export async function lastPublished(id) {
  return isLocal() ? Local.lastPublished(id) : (await R()).lastPublished(id);
}

// ---------------------------------------------------------------------
//  Files
// ---------------------------------------------------------------------
export const EXT_TYPE = { png: 'png', svg: 'svg', glb: 'glb', gltf: 'glb' };
export const SIZE_WARN = { glb: 2 * 1024 * 1024, png: 1024 * 1024, svg: 1024 * 1024 };

export function assetKind(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXT_TYPE[ext] || null;
}

// Drawing an SVG through an <img> cannot run scripts, but we strip anything
// active before storing it so the stored file is clean too.
export function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('That SVG could not be read.');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('That file is not an SVG.');
  const BAD = ['script', 'foreignobject', 'iframe', 'embed', 'object', 'animate', 'set', 'handler'];
  doc.querySelectorAll('*').forEach(el => {
    if (BAD.includes(el.nodeName.toLowerCase())) { el.remove(); return; }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = (a.value || '').trim().toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'xlink:href') && !(v.startsWith('#') || v.startsWith('data:image/'))) el.removeAttribute(a.name);
      else if (v.includes('javascript:')) el.removeAttribute(a.name);
    }
  });
  return new XMLSerializer().serializeToString(doc);
}

export async function uploadAsset(file, id) {
  const kind = assetKind(file);
  if (!kind) throw new Error('Use a PNG, SVG, GLB or GLTF file.');
  let body = file;
  if (kind === 'svg') body = new Blob([sanitizeSvg(await file.text())], { type: 'image/svg+xml' });
  if (isLocal()) return Local.uploadAsset(file, id, kind, body);
  return (await R()).uploadAsset(file, id);
}

export async function deleteAssetAt(url) {
  return isLocal() ? Local.deleteAssetAt(url) : (await R()).deleteAssetAt(url);
}

// ---------------------------------------------------------------------
//  Backup, and the move to Supabase
// ---------------------------------------------------------------------
export const exportAll = () => Local.exportAll();
export const importAll = (p, o) => Local.importAll(p, o);
export const localStats = () => Local.stats();

// Push everything held locally up to Supabase, once it is configured.
export async function pushLocalToSupabase(onProgress = () => {}) {
  if (isLocal()) throw new Error('Fill in js/config.js first — see SETUP.md.');
  const r = await R();
  const dump = await Local.exportAll();
  const ids = Object.keys(dump.records);
  let done = 0, failed = [];
  for (const id of ids) {
    const rec = { ...dump.records[id] };
    try {
      // Re-upload the artwork so it stops pointing at this device.
      if (rec.assetUrl && rec.assetUrl.startsWith('local:')) {
        const a = dump.assets[rec.assetUrl.slice('local:'.length)];
        if (!a) throw new Error('its artwork is missing from this device');
        const blob = await (await fetch(a.data)).blob();
        const up = await r.uploadAsset(new File([blob], a.name, { type: blob.type }), id);
        rec.assetUrl = up.url;
      }
      await r.saveRecord(rec, { publish: rec.published, label: 'moved from this device' });
    } catch (e) {
      failed.push({ id, why: e.message || String(e) });
    }
    onProgress(++done, ids.length);
  }
  return { total: ids.length, failed };
}

export async function securityCheck() {
  if (isLocal()) {
    return [{
      name: 'Nothing is shared yet',
      pass: true,
      detail: 'Calibrations are on this device only, so there is nothing for a stranger to reach.'
    }];
  }
  return (await R()).securityCheck();
}
