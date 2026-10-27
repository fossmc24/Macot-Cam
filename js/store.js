// =====================================================================
//  STORE (read side) — fetches the published calibration records.
//
//  Deliberately plain: one fetch against Supabase's REST endpoint, no SDK.
//  The main app must never break because of the backend, so every failure
//  here falls back to the cache, and then to the built-in parts.
// =====================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY, PARTS_TABLE, FETCH_TIMEOUT_MS, isConfigured } from './config.js';
import { normalizeRecord } from './calibration.js';

const CACHE_KEY = 'mascot-parts-cache-v1';

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const got = JSON.parse(raw);
    return Array.isArray(got && got.records) ? got : null;
  } catch (_) { return null; }
}

function writeCache(records) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), records })); } catch (_) {}
}

export function restHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + SUPABASE_ANON_KEY
  }, extra);
}

// Published records only. Returns [] rather than throwing.
export async function fetchPublished() {
  if (!isConfigured()) return { records: [], source: 'none' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${SUPABASE_URL}/rest/v1/${PARTS_TABLE}`
      + '?select=record&published=is.true&order=slot.asc';
    const res = await fetch(url, { headers: restHeaders(), signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const records = rows.map(r => r.record).filter(Boolean).map(normalizeRecord);
    writeCache(records);
    return { records, source: 'network' };
  } catch (e) {
    const cached = readCache();
    if (cached) return { records: cached.records.map(normalizeRecord), source: 'cache' };
    return { records: [], source: 'offline', error: e };
  } finally {
    clearTimeout(timer);
  }
}

// Used by the admin page so a publish shows up in the app straight away.
export function primeCache(records) { writeCache(records); }
export function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (_) {} }
