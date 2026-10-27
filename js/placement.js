// =====================================================================
//  PLACEMENT — where a part sits on the face, and how a drag or pinch
//  turns into numbers.
//
//  This is the one place the maths lives. index.html and admin.html both
//  go through it, which is what makes a calibration done in the admin page
//  land in the same spot in the app.
//
//  A part's final position is built up in this order:
//    anchor landmark → turn with the head → mirror (for the 2nd instance)
//    → record offset + the user's own drag + this frame's reactions
//    → record rotation + reactions → record scale × the user's pinch
// =====================================================================
import { mid, dist } from './face.js';
import { evalReactions } from './calibration.js';

export const SLOTS = [
  { key: 'facial', label: 'Facial hair' },
  { key: 'ears',   label: 'Ears' },
  { key: 'cheeks', label: 'Cheeks' },
  { key: 'nose',   label: 'Nose' },
  { key: 'mouth',  label: 'Mouth' },
  { key: 'eyes',   label: 'Eyes' },
  { key: 'head',   label: 'Head' }
];
// Drawing order: first is furthest back. Matches the list above.
export const DRAW_ORDER = SLOTS.map(s => s.key);
export const TAB_ORDER = ['presets', 'head', 'ears', 'eyes', 'nose', 'mouth', 'cheeks', 'facial'];

export const blankSlot = () => ({ part: null, dx: 0, dy: 0, scale: 1, color: null });

// Resolve a record's anchor landmarks to one point on the face.
export function anchorPoint(pts, landmarks) {
  if (landmarks.length === 1) return pts[landmarks[0]];
  let p = pts[landmarks[0]];
  for (let i = 1; i < landmarks.length; i++) p = mid(p, pts[landmarks[i]]);
  return p;
}

// Every on-screen copy of one part: its anchor, which copy it is, and
// whether it is mirrored (sx = -1).
export function instancesOf(rec, pts, faceM) {
  const { landmarks, mode } = rec.anchor;
  if (mode === 'side') {
    // One ear per side of the face, each flipped so it points away from the nose.
    const ex = Math.cos(faceM.angle), ey = Math.sin(faceM.angle), nose = pts[1];
    return landmarks.map((n, inst) => {
      const a = pts[n];
      return { anchor: a, inst, sx: ((a.x - nose.x) * ex + (a.y - nose.y) * ey) >= 0 ? 1 : -1 };
    });
  }
  if (mode === 'pair') {
    return landmarks.map((n, inst) => ({ anchor: pts[n], inst, sx: inst === 1 ? -1 : 1 }));
  }
  const a = anchorPoint(pts, landmarks);
  // A single anchor with "mirror pair" on draws the art twice, flipped.
  return rec.mirror
    ? [{ anchor: a, inst: 0, sx: 1 }, { anchor: a, inst: 1, sx: -1 }]
    : [{ anchor: a, inst: 0, sx: 1 }];
}

// Walk every instance of every equipped part, back to front.
// view = { pts, faceM, mascot, records, parts }
export function forEachInstance(view, fn) {
  const { pts, faceM, mascot, records } = view;
  for (const slotKey of DRAW_ORDER) {
    const st = mascot[slotKey];
    if (!st || !st.part) continue;
    const rec = records[st.part];
    if (!rec || rec.slot !== slotKey) continue;
    const part = view.parts ? findPart(view.parts, slotKey, st.part) : null;
    if (rec.type === 'builtin' && !part) continue;      // art has gone missing
    for (const ins of instancesOf(rec, pts, faceM)) {
      fn({ slotKey, rec, part, state: st, ...ins });
    }
  }
}

export const findPart = (parts, slot, id) => (parts[slot] || []).find(p => p.id === id);

// The whole transform for one instance, in face units, after reactions.
export function resolveTransform(rec, state, f) {
  const react = evalReactions(rec, f);
  const total = rec.scale * state.scale;
  return {
    react,
    x: rec.offset.x + state.dx + react.offset.x,
    y: rec.offset.y + state.dy + react.offset.y,
    z: rec.offset.z + react.offset.z,
    rot: { x: rec.rotation.x + react.rotation.x, y: rec.rotation.y + react.rotation.y, z: rec.rotation.z + react.rotation.z },
    sx: total * react.scale.x * rec.stretch.x,
    sy: total * react.scale.y * rec.stretch.y,
    sz: total * react.scale.x * rec.stretch.z,
    opacity: react.opacity,
    visible: react.visible
  };
}

// Put a 2D canvas into the part's own frame. After this, draw at the
// origin in face units × s and +y is down, exactly as the built-ins expect.
export function applyTransform2D(g, ins, faceM, tr) {
  const s = faceM.size;
  g.translate(ins.anchor.x, ins.anchor.y);
  g.rotate(faceM.angle);
  g.scale(ins.sx, 1);
  g.translate(tr.x * s, tr.y * s);
  if (tr.rot.z) g.rotate(tr.rot.z);
  g.scale(tr.sx, tr.sy);
}

// Centre and radius of a part on screen, for tapping it.
export function hitCircle(rec, state, ins, faceM) {
  const s = faceM.size, h = rec.hit, total = rec.scale * state.scale;
  const lx = ins.sx * ((rec.offset.x + state.dx) * s + h.cx * s * total);
  const ly = (rec.offset.y + state.dy) * s + h.cy * s * total;
  const c = Math.cos(faceM.angle), n = Math.sin(faceM.angle);
  return {
    x: ins.anchor.x + lx * c - ly * n,
    y: ins.anchor.y + lx * n + ly * c,
    r: h.r * s * total
  };
}

// Screen point → canvas pixel. The canvas is stretched with object-fit: cover.
export function toCanvas(canvas, cx, cy) {
  const rect = canvas.getBoundingClientRect();
  const k = Math.max(rect.width / canvas.width, rect.height / canvas.height);
  const ox = (rect.width - canvas.width * k) / 2, oy = (rect.height - canvas.height * k) / 2;
  return { x: (cx - rect.left - ox) / k, y: (cy - rect.top - oy) / k, k };
}

// Which part a tap landed on: the smallest circle it falls inside.
export function hitTest(view, canvas, cx, cy, slack = 24) {
  if (!view.pts || !view.faceM) return null;
  const p = toCanvas(canvas, cx, cy);
  let best = null;
  forEachInstance(view, ins => {
    const hc = hitCircle(ins.rec, ins.state, ins, view.faceM);
    if (dist(p, hc) <= hc.r + slack / p.k && (!best || hc.r < best.r)) {
      best = { slot: ins.slotKey, inst: ins.inst, r: hc.r, sx: ins.sx };
    }
  });
  return best;
}

// A drag across the screen, in canvas pixels, as a move in face units
// within the head's own frame.
export function dragToFaceUnits(faceM, cdx, cdy, sx) {
  const c = Math.cos(faceM.angle), n = Math.sin(faceM.angle);
  return {
    dx: ((cdx * c + cdy * n) / faceM.size) * sx,
    dy: (-cdx * n + cdy * c) / faceM.size
  };
}
