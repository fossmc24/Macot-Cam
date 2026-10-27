// =====================================================================
//  ADMIN STORE — everything that needs to be logged in.
//
//  The main app never loads this file; it only ever reads published
//  records through js/store.js. Here we use the Supabase SDK for auth,
//  file upload and the writes that Row Level Security guards.
//
//  Only the public anon key is ever used. The service_role key must never
//  appear in this repo.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PARTS_TABLE, VERSIONS_TABLE, ASSET_BUCKET, isConfigured } from './config.js';
import { normalizeRecord } from './calibration.js';

let client = null;
export function sb() {
  if (!isConfigured()) throw new Error('Supabase is not configured yet — see SETUP.md and fill in js/config.js.');
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

// ---------------------------------------------------------------------
//  Auth
// ---------------------------------------------------------------------
export async function currentUser() {
  if (!isConfigured()) return null;
  const { data } = await sb().auth.getUser();
  return data ? data.user : null;
}
export async function signInWithPassword(email, password) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
export async function signInWithLink(email) {
  const { error } = await sb().auth.signInWithOtp({
    email, options: { emailRedirectTo: location.href.split('#')[0] }
  });
  if (error) throw error;
}
export async function signOut() { await sb().auth.signOut(); }

// Am I actually on the admin list? Writes will fail otherwise.
export async function isAdmin() {
  try {
    const { error } = await sb().from(PARTS_TABLE).select('id').limit(1);
    if (error) return false;
    const { data, error: e2 } = await sb().rpc('is_mascot_admin');
    return e2 ? false : !!data;
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------
//  Records
// ---------------------------------------------------------------------
const rowToRecord = row => normalizeRecord(Object.assign({}, row.record, {
  id: row.id, published: row.published, version: row.version, updatedAt: row.updated_at
}));

// Everything, drafts included (RLS lets admins see unpublished rows).
export async function listAll() {
  const { data, error } = await sb().from(PARTS_TABLE).select('*').order('slot').order('name');
  if (error) throw error;
  return (data || []).map(rowToRecord);
}

export async function saveRecord(rec, { publish = null, label = null } = {}) {
  const user = await currentUser();
  const next = normalizeRecord(rec);
  if (publish !== null) next.published = publish;
  next.version = (next.version || 0) + 1;
  next.updatedAt = new Date().toISOString();

  const row = {
    id: next.id, name: next.name, slot: next.slot, type: next.type,
    asset_url: next.assetUrl, record: next, published: next.published,
    version: next.version, updated_at: next.updatedAt, updated_by: user ? user.id : null
  };
  const { error } = await sb().from(PARTS_TABLE).upsert(row, { onConflict: 'id' });
  if (error) throw error;

  // Keep a copy so a bad change can be undone.
  await sb().from(VERSIONS_TABLE).insert({
    part_id: next.id, record: next, version: next.version,
    published: next.published, label, created_by: user ? user.id : null
  });
  return next;
}

export async function deleteRecord(id) {
  const { error } = await sb().from(PARTS_TABLE).delete().eq('id', id);
  if (error) throw error;
}

export async function listVersions(id, limit = 40) {
  const { data, error } = await sb().from(VERSIONS_TABLE)
    .select('version_id, record, version, published, label, created_at')
    .eq('part_id', id).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// The newest version that was published — what "Revert to last published" uses.
export async function lastPublished(id) {
  const { data, error } = await sb().from(VERSIONS_TABLE)
    .select('record').eq('part_id', id).eq('published', true)
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data && data[0] ? normalizeRecord(data[0].record) : null;
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

// SVG is drawn through an <img>, which cannot run scripts, but we also strip
// anything active on the way into storage so the stored file is clean too.
export function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('That SVG could not be read.');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('That file is not an SVG.');
  const BAD_TAGS = ['script', 'foreignobject', 'iframe', 'embed', 'object', 'animate', 'set', 'handler'];
  doc.querySelectorAll('*').forEach(el => {
    if (BAD_TAGS.includes(el.nodeName.toLowerCase())) { el.remove(); return; }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = (a.value || '').trim().toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'xlink:href') && !(v.startsWith('#') || v.startsWith('data:image/'))) el.removeAttribute(a.name);
      else if (v.includes('javascript:')) el.removeAttribute(a.name);
    }
  });
  return new XMLSerializer().serializeToString(doc);
}

// ---------------------------------------------------------------------
//  Security self-check
//
//  Asks the question an attacker would: with nothing but the public anon
//  key, can I read drafts, or write anything? Runs with plain fetch so the
//  signed-in session is NOT used — this is what a stranger can do.
// ---------------------------------------------------------------------
export async function securityCheck() {
  const anon = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  const base = `${SUPABASE_URL}/rest/v1`;
  const out = [];
  const add = (name, pass, detail) => out.push({ name, pass, detail });
  const testId = '__security_check__';

  // 1. Published parts must be readable by anyone — the app depends on it.
  try {
    const r = await fetch(`${base}/${PARTS_TABLE}?select=id&published=is.true&limit=1`, { headers: anon });
    add('Anyone can read published parts', r.ok, r.ok ? 'HTTP ' + r.status : 'HTTP ' + r.status + ' — the app will fall back to built-ins');
  } catch (e) { add('Anyone can read published parts', false, String(e)); }

  // 2. Drafts must NOT be readable without being an admin.
  try {
    const r = await fetch(`${base}/${PARTS_TABLE}?select=id&published=is.false&limit=5`, { headers: anon });
    const rows = r.ok ? await r.json() : [];
    add('Drafts are hidden from the public', r.ok && rows.length === 0,
      r.ok ? (rows.length ? rows.length + ' draft(s) leaked!' : 'none visible') : 'HTTP ' + r.status);
  } catch (e) { add('Drafts are hidden from the public', false, String(e)); }

  // 3. Inserting must be refused.
  let inserted = false;
  try {
    const r = await fetch(`${base}/${PARTS_TABLE}`, {
      method: 'POST',
      headers: { ...anon, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ id: testId, name: 'security check', slot: 'head', type: 'builtin', record: {}, published: false })
    });
    inserted = r.ok;
    add('Strangers cannot add parts', !r.ok, r.ok ? 'ALLOWED — this is wrong' : 'refused with HTTP ' + r.status);
  } catch (e) { add('Strangers cannot add parts', true, 'refused (' + e.message + ')'); }

  // 4. Updating an existing row must be refused.
  try {
    const r = await fetch(`${base}/${PARTS_TABLE}?id=neq.${testId}`, {
      method: 'PATCH',
      headers: { ...anon, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name: 'hacked' })
    });
    add('Strangers cannot change parts', !r.ok, r.ok ? 'ALLOWED — this is wrong' : 'refused with HTTP ' + r.status);
  } catch (e) { add('Strangers cannot change parts', true, 'refused (' + e.message + ')'); }

  // 5. Uploading a file must be refused.
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${ASSET_BUCKET}/__security_check__.txt`, {
      method: 'POST', headers: { ...anon, 'Content-Type': 'text/plain' }, body: 'no'
    });
    add('Strangers cannot upload files', !r.ok, r.ok ? 'ALLOWED — this is wrong' : 'refused with HTTP ' + r.status);
  } catch (e) { add('Strangers cannot upload files', true, 'refused (' + e.message + ')'); }

  // Tidy up if the rules let something through.
  if (inserted) {
    try { await sb().from(PARTS_TABLE).delete().eq('id', testId); } catch (_) {}
  }
  return out;
}

export function publicUrl(path) {
  return sb().storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Returns the public URL the calibration record should point at.
export async function uploadAsset(file, id) {
  const kind = assetKind(file);
  if (!kind) throw new Error('Use a PNG, SVG, GLB or GLTF file.');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const path = `${id}/${Date.now()}.${ext}`;
  let body = file, contentType = file.type || undefined;
  if (kind === 'svg') {
    body = new Blob([sanitizeSvg(await file.text())], { type: 'image/svg+xml' });
    contentType = 'image/svg+xml';
  }
  if (kind === 'glb') contentType = ext === 'glb' ? 'model/gltf-binary' : 'model/gltf+json';
  if (kind === 'png') contentType = 'image/png';
  const { error } = await sb().storage.from(ASSET_BUCKET)
    .upload(path, body, { contentType, upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  return { path, url: publicUrl(path), kind };
}

export async function deleteAssetAt(url) {
  if (!url) return;
  const marker = `/object/public/${ASSET_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return;
  await sb().storage.from(ASSET_BUCKET).remove([decodeURIComponent(url.slice(i + marker.length))]);
}
