// =====================================================================
//  2D RENDERER — draws the flat parts onto the camera canvas.
//
//  Two kinds of flat part:
//    • built-in art, which draws itself with canvas code
//    • uploaded PNG / SVG, drawn as a billboard that tilts with the head
//
//  A billboard is one face unit wide at scale 1, so scale 0.5 makes it half
//  the width of the face. Height follows the image's own aspect ratio.
// =====================================================================
import { applyTransform2D, resolveTransform, forEachInstance, hitCircle } from './placement.js';

// ---------------------------------------------------------------------
//  Image cache for uploaded art
// ---------------------------------------------------------------------
const images = new Map();   // url → { img, ready, failed }

export function getImage(url) {
  if (!url) return null;
  let e = images.get(url);
  if (!e) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    e = { img, ready: false, failed: false };
    img.onload = () => { e.ready = img.naturalWidth > 0; e.failed = !e.ready; };
    img.onerror = () => { e.failed = true; };
    img.src = url;
    images.set(url, e);
  }
  return e;
}
export const imageReady = url => { const e = images.get(url); return !!(e && e.ready); };
export function preloadImages(records) {
  for (const rec of records) if (rec.type === 'png' || rec.type === 'svg') getImage(rec.assetUrl);
}

// Drawing an SVG through an <img> element is a static, script-free context,
// so uploaded SVGs cannot run anything here. Uploads are also sanitised on
// the way into storage — see sanitizeSvg in js/store.js.
function drawBillboard(g, s, rec, tr) {
  const e = getImage(rec.assetUrl);
  if (!e || !e.ready) return;
  const aspect = e.img.naturalWidth / e.img.naturalHeight;
  const dw = s, dh = s / (aspect || 1);
  g.drawImage(e.img, -dw / 2 - rec.pivot.x * s, -dh / 2 - rec.pivot.y * s, dw, dh);
}

// One instance of one part, already inside its own transform.
export function drawPartLocal(g, s, ins, tr, color) {
  if (ins.rec.type === 'builtin') {
    if (!ins.part) return;
    ins.part.draw(g, s, color, tr.f);
  } else if (ins.rec.type === 'png' || ins.rec.type === 'svg') {
    drawBillboard(g, s, ins.rec, tr);
  }
  // 'glb' is drawn by the 3D layer
}

// ---------------------------------------------------------------------
//  The main pass
// ---------------------------------------------------------------------
export function drawMascot(g, view, f) {
  const s = view.faceM.size;
  forEachInstance(view, ins => {
    if (ins.rec.type === 'glb') return;                  // handled by render3d
    if (ins.rec.type === 'builtin' && ins.part && ins.part.three) return;
    const tr = resolveTransform(ins.rec, ins.state, f);
    if (!tr.visible) return;
    g.save();
    applyTransform2D(g, ins, view.faceM, tr);
    if (tr.opacity < 1) g.globalAlpha = tr.opacity;
    f.sx = ins.sx;
    tr.f = f;
    drawPartLocal(g, s, ins, tr, ins.state.color || ins.rec.defaultColor);
    g.restore();
  });
}

export function drawDots(g, pts, canvasWidth, highlight) {
  const r = Math.max(1.5, canvasWidth / 500);
  g.fillStyle = 'rgba(126,226,168,.85)';
  for (const q of pts) { g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fill(); }
  if (highlight != null && pts[highlight]) {
    const q = pts[highlight];
    g.beginPath(); g.arc(q.x, q.y, r * 3.2, 0, Math.PI * 2);
    g.fillStyle = '#ffb020'; g.fill();
    g.lineWidth = Math.max(1.5, canvasWidth / 400); g.strokeStyle = '#1a1200'; g.stroke();
    g.font = `700 ${Math.max(11, Math.round(canvasWidth / 42))}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.lineWidth = Math.max(2, canvasWidth / 240); g.strokeStyle = 'rgba(0,0,0,.85)';
    g.strokeText(String(highlight), q.x, q.y - r * 4);
    g.fillStyle = '#ffffff'; g.fillText(String(highlight), q.x, q.y - r * 4);
  }
}

export function drawSelection(g, view, slotKey, canvasWidth, color = '#ffb020') {
  forEachInstance(view, ins => {
    if (ins.slotKey !== slotKey) return;
    const hc = hitCircle(ins.rec, ins.state, ins, view.faceM);
    g.save();
    g.setLineDash([canvasWidth / 80, canvasWidth / 120]);
    g.lineWidth = Math.max(2, canvasWidth / 300);
    g.strokeStyle = color;
    g.beginPath(); g.arc(hc.x, hc.y, hc.r, 0, Math.PI * 2); g.stroke();
    g.restore();
  });
}

export function roarIfMouthOpen(g, pts, faceM) {
  if (faceM.mouthOpen < 0.12) return;
  const s = faceM.size;
  g.save();
  g.translate(pts[1].x, pts[10].y); g.rotate(faceM.angle);
  g.font = `900 ${Math.round(s * .32)}px system-ui, -apple-system, sans-serif`;
  g.textAlign = 'center'; g.lineWidth = s * .05; g.strokeStyle = '#1b1b1b';
  g.strokeText('ROAR!', 0, -s * .7); g.fillStyle = '#ffb020'; g.fillText('ROAR!', 0, -s * .7);
  g.restore();
}

// ---------------------------------------------------------------------
//  Tray thumbnails
// ---------------------------------------------------------------------
export const THUMB_F = { gap: .1, w: .38, t: 0, brow: .5, blink: 0, swing: 0, bounce: 0, sx: 1 };

// A small picture of one part, drawn flat. 3D parts are handled by render3d.
export function thumb2D(rec, part, color, px = 60) {
  const d = Math.min(3, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = c.height = px * d;
  const g = c.getContext('2d');
  const frame = rec.hit.r || .4;
  const s = (c.width * .44) / Math.max(.08, frame);
  g.translate(c.width / 2, c.height / 2 - rec.hit.cy * s);
  const f = Object.assign({}, THUMB_F, part && part.thumbF);
  const ins = { rec, part, state: { dx: 0, dy: 0, scale: 1, color: null }, sx: 1, inst: 0 };
  const tr = { f, x: 0, y: 0, rot: { x: 0, y: 0, z: 0 }, sx: 1, sy: 1, opacity: 1, visible: true };
  if (rec.anchor.mode === 'side') {
    // Side ears draw one ear at a time; show a pair either side of an imaginary face.
    for (const k of [-1, 1]) {
      g.save(); g.translate(k * s * .45, 0); g.scale(k, 1);
      drawPartLocal(g, s, ins, tr, color);
      g.restore();
    }
  } else if (rec.mirror) {
    for (const k of [-1, 1]) { g.save(); g.scale(k, 1); drawPartLocal(g, s, ins, tr, color); g.restore(); }
  } else {
    drawPartLocal(g, s, ins, tr, color);
  }
  return c;
}

// A "still loading" / "no art" placeholder tile.
export function thumbPlaceholder(label, px = 60) {
  const d = Math.min(3, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = c.height = px * d;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.font = `700 ${13 * d}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, c.width / 2, c.height / 2);
  return c;
}
