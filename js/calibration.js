// =====================================================================
//  CALIBRATION RECORDS — how a part is described as DATA rather than code.
//
//  Every part, built-in or uploaded, has one of these. The admin page edits
//  them; the main app reads them. Because both pages run the same placement
//  maths over the same record, a part calibrated in the admin page lands in
//  exactly the same spot in the app.
//
//  All offsets, sizes and tap circles are in FACE UNITS:
//  1 unit = the distance between landmarks 234 and 454 (the face's width).
//  That makes a fit hold on any face, at any distance from the camera.
// =====================================================================

export const SLOT_KEYS = ['facial', 'ears', 'cheeks', 'nose', 'mouth', 'eyes', 'head'];

// Where each slot attaches by default. For mode 'single', several landmarks
// mean "use their midpoint". For 'pair', each landmark gets its own instance
// (the second mirrored). For 'side', the two landmarks are the sides of the
// face and each instance is flipped to point away from the nose.
export const SLOT_ANCHORS = {
  facial: { landmarks: [13], mode: 'single' },
  ears:   { landmarks: [10], mode: 'single' },
  cheeks: { landmarks: [205, 425], mode: 'pair' },
  nose:   { landmarks: [1], mode: 'single' },
  mouth:  { landmarks: [13, 14], mode: 'single' },
  eyes:   { landmarks: [33, 263], mode: 'single' },
  head:   { landmarks: [10], mode: 'single' }
};
export const SIDE_ANCHOR = { landmarks: [234, 454], mode: 'side' };

export const ASSET_TYPES = ['builtin', 'png', 'svg', 'glb'];

// What a reaction can read, and what it can drive.
export const REACTION_INPUTS = [
  { key: 'mouthGap', label: 'Mouth open', from: f => f.gap },
  { key: 'brow',     label: 'Eyebrows up', from: f => f.brow },
  { key: 'blink',    label: 'Blink',       from: f => f.blink },
  { key: 'swing',    label: 'Head swing',  from: f => f.swing },
  { key: 'bounce',   label: 'Head bounce', from: f => f.bounce }
];
export const REACTION_PROPS = [
  { key: 'rotation.z', label: 'Tilt (roll)',   unit: 'radians' },
  { key: 'rotation.x', label: 'Tip forward',   unit: 'radians' },
  { key: 'rotation.y', label: 'Turn sideways', unit: 'radians' },
  { key: 'offset.x',   label: 'Move across',   unit: 'face units' },
  { key: 'offset.y',   label: 'Move up/down',  unit: 'face units' },
  { key: 'offset.z',   label: 'Move in/out',   unit: 'face units' },
  { key: 'scale',      label: 'Grow',          unit: '× amount' },
  { key: 'scale.x',    label: 'Grow wider',    unit: '× amount' },
  { key: 'scale.y',    label: 'Grow taller',   unit: '× amount' },
  { key: 'opacity',    label: 'Fade',          unit: '× amount' },
  { key: 'visible',    label: 'Show only when in range', unit: '' }
];
const INPUT_BY_KEY = Object.fromEntries(REACTION_INPUTS.map(i => [i.key, i]));

export const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const vec3 = (v, d = 0) => ({ x: num(v && v.x, d), y: num(v && v.y, d), z: num(v && v.z, d) });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Fill in every field so the rest of the code never has to check for gaps.
export function normalizeRecord(r) {
  const slot = SLOT_KEYS.includes(r.slot) ? r.slot : 'head';
  const type = ASSET_TYPES.includes(r.type) ? r.type : 'png';
  const anchor = r.anchor && Array.isArray(r.anchor.landmarks) && r.anchor.landmarks.length
    ? { landmarks: r.anchor.landmarks.map(n => n | 0).filter(n => n >= 0 && n < 478),
        mode: ['single', 'pair', 'side'].includes(r.anchor.mode) ? r.anchor.mode : 'single' }
    : { ...SLOT_ANCHORS[slot] };
  if (!anchor.landmarks.length) anchor.landmarks = [...SLOT_ANCHORS[slot].landmarks];
  return {
    id: String(r.id || '').trim(),
    name: String(r.name || r.id || 'Untitled').trim(),
    slot, type,
    assetUrl: r.assetUrl || null,
    thumbUrl: r.thumbUrl || null,
    anchor,
    offset: vec3(r.offset),
    rotation: vec3(r.rotation),
    scale: num(r.scale, 1),
    pivot: { x: num(r.pivot && r.pivot.x, 0), y: num(r.pivot && r.pivot.y, 0) },
    mirror: !!r.mirror,
    followHeadTurn: r.followHeadTurn !== false,
    colorable: r.colorable !== false,
    defaultColor: r.defaultColor || '#ffb81c',
    hit: {
      cx: num(r.hit && r.hit.cx, 0),
      cy: num(r.hit && r.hit.cy, 0),
      r: Math.max(.02, num(r.hit && r.hit.r, .4))
    },
    tip: r.tip || null,
    reactions: Array.isArray(r.reactions) ? r.reactions.map(normalizeReaction).filter(Boolean) : [],
    published: !!r.published,
    version: num(r.version, 1),
    updatedAt: r.updatedAt || null
  };
}

function normalizeReaction(x) {
  if (!x || !INPUT_BY_KEY[x.input]) return null;
  if (!REACTION_PROPS.some(p => p.key === x.property)) return null;
  return {
    input: x.input,
    property: x.property,
    amount: num(x.amount, 1),
    min: num(x.min, 0),
    max: num(x.max, 1)
  };
}

// ---------------------------------------------------------------------
//  Built-in defaults: turn the hard-coded numbers into records, so the
//  admin page can re-adjust parts that were originally placed by eye.
// ---------------------------------------------------------------------
export function builtinRecord(slot, part) {
  return normalizeRecord({
    id: part.id,
    name: part.name,
    slot,
    type: 'builtin',
    anchor: part.side ? SIDE_ANCHOR : SLOT_ANCHORS[slot],
    offset: { x: 0, y: 0, z: 0 },      // the artwork already bakes in its own position
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    mirror: false,
    followHeadTurn: true,
    colorable: true,
    defaultColor: part.color,
    hit: part.hit || { cx: 0, cy: part.cy, r: part.r },
    tip: part.tip || null,
    reactions: [],                      // built-ins keep their own reaction code
    published: true,
    version: 1
  });
}

// Every built-in part as a record, keyed by id.
export function builtinRecords(parts) {
  const out = {};
  for (const [slot, list] of Object.entries(parts)) {
    for (const part of list) out[part.id] = builtinRecord(slot, part);
  }
  return out;
}

// Remote records win over the built-in defaults, field by field, so an
// override only has to carry what it actually changes.
export function mergeRecords(base, remote) {
  const out = { ...base };
  for (const r of remote || []) {
    if (!r || !r.id) continue;
    const prev = out[r.id];
    out[r.id] = normalizeRecord(prev && prev.type === 'builtin' && r.type === 'builtin'
      ? { ...prev, ...r, hit: { ...prev.hit, ...(r.hit || {}) } }
      : r);
  }
  return out;
}

// ---------------------------------------------------------------------
//  Reactions — "input → property × amount" rules, evaluated each frame.
//  Returns the extra transform an uploaded asset should get this frame.
// ---------------------------------------------------------------------
export function evalReactions(rec, f) {
  const out = {
    offset: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    opacity: 1,
    visible: true
  };
  for (const rx of rec.reactions || []) {
    const src = INPUT_BY_KEY[rx.input];
    if (!src) continue;
    const raw = num(src.from(f), 0);
    if (rx.property === 'visible') {
      const inRange = raw >= rx.min && raw <= rx.max;
      if (rx.amount < 0 ? inRange : !inRange) out.visible = false;
      continue;
    }
    const v = clamp(raw, rx.min, rx.max) * rx.amount;
    switch (rx.property) {
      case 'rotation.x': out.rotation.x += v; break;
      case 'rotation.y': out.rotation.y += v; break;
      case 'rotation.z': out.rotation.z += v; break;
      case 'offset.x': out.offset.x += v; break;
      case 'offset.y': out.offset.y += v; break;
      case 'offset.z': out.offset.z += v; break;
      case 'scale': out.scale.x *= 1 + v; out.scale.y *= 1 + v; break;
      case 'scale.x': out.scale.x *= 1 + v; break;
      case 'scale.y': out.scale.y *= 1 + v; break;
      case 'opacity': out.opacity = clamp(out.opacity * (1 + v), 0, 1); break;
    }
  }
  return out;
}

// A fresh record for a newly uploaded asset.
export function newRecord(slot, name, type, assetUrl) {
  return normalizeRecord({
    id: slugId(name),
    name, slot, type, assetUrl,
    anchor: SLOT_ANCHORS[slot],
    offset: { x: 0, y: 0, z: 0 },
    scale: type === 'glb' ? 1 : 0.5,
    hit: { cx: 0, cy: 0, r: .35 },
    followHeadTurn: true,
    colorable: false,
    published: false,
    version: 1
  });
}

export function slugId(name) {
  const base = String(name || 'part').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part';
  return base + '-' + Math.random().toString(36).slice(2, 7);
}

// A record is only usable by the app once it has somewhere to get its art.
export const isRenderable = rec =>
  rec.type === 'builtin' || !!rec.assetUrl;
