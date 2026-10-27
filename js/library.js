// =====================================================================
//  LIBRARY — puts the part registry together.
//
//  Built-in art (code) + calibration records (data) = what the app shows.
//  A record whose id matches a built-in part overrides its numbers; a
//  record with no matching built-in is an uploaded asset.
// =====================================================================
import { PARTS_2D, MOUTH_TIP_IDS } from './parts-builtin.js';
import { builtinRecords, mergeRecords, isRenderable, SLOT_KEYS } from './calibration.js';
import { fetchPublished } from './store.js';
import { DRAW_ORDER } from './placement.js';

// The code side: every built-in part, 2D and (once three.js is up) 3D.
export function makeParts(parts3D) {
  const parts = {};
  for (const slot of SLOT_KEYS) parts[slot] = [...(PARTS_2D[slot] || [])];
  if (parts3D) {
    for (const [slot, list] of Object.entries(parts3D)) {
      for (const p of list) { p.three = true; parts[slot].push(p); }
    }
  }
  // Mouth parts that react to the mouth opening all share the same hint.
  for (const id of MOUTH_TIP_IDS) {
    const p = parts.mouth.find(x => x.id === id);
    if (p) p.tip = 'open your mouth';
  }
  return parts;
}

// The data side. Never throws: a backend problem just means built-ins only.
//
// Pass `remote` to re-merge records you already fetched — the app does this
// once three.js has added the 3D parts, so startup only ever hits the
// network once.
export async function loadRecords(parts, remote) {
  const base = builtinRecords(parts);
  if (remote) return { records: mergeRecords(base, remote.records), source: remote.source, error: remote.error || null, remote };
  try {
    const got = await fetchPublished();
    return { records: mergeRecords(base, got.records), source: got.source, error: got.error || null, remote: got };
  } catch (e) {
    const empty = { records: [], source: 'offline', error: e };
    return { records: base, source: 'offline', error: e, remote: empty };
  }
}

// Which records belong in one tab, in a stable order: 3D first, then flat,
// then uploads — matching how the tray used to be sorted.
export function recordsForSlot(records, parts, slot) {
  const out = [];
  for (const rec of Object.values(records)) {
    if (rec.slot !== slot || !isRenderable(rec)) continue;
    const part = rec.type === 'builtin' ? (parts[slot] || []).find(p => p.id === rec.id) : null;
    if (rec.type === 'builtin' && !part) continue;    // record for art we don't have
    out.push({ rec, part });
  }
  const rank = e => (e.part && e.part.three ? 0 : e.rec.type === 'glb' ? 1 : e.rec.type === 'builtin' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || a.rec.name.localeCompare(b.rec.name));
}

export const allSlots = () => DRAW_ORDER;
