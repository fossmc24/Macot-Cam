// =====================================================================
//  ADMIN — upload assets and calibrate them on a real face.
//
//  The preview here uses exactly the same modules as the app, and the
//  user's own drag/pinch state is held at zero, so what you line up on
//  screen IS the calibration record. Nothing is re-interpreted later.
// =====================================================================
import {
  loadTracker, getLandmarker, newFaceState, ingest, resetFace, faceInfo,
  detectStill, stateFromStill, nextStamp, dist, clamp
} from './face.js';
import {
  SLOTS, blankSlot, toCanvas, dragToFaceUnits, hitCircle, instancesOf
} from './placement.js';
import { drawMascot, drawDots, drawSelection, thumb2D, thumbPlaceholder, getImage } from './render2d.js';
import { createLayer, render3D, thumb3D, is3DRecord, clearThumbCache, loadGLTF } from './render3d.js';
import { makeParts } from './library.js';
import {
  normalizeRecord, builtinRecords, mergeRecords, newRecord, slugId,
  REACTION_INPUTS, REACTION_PROPS, SLOT_ANCHORS, SIDE_ANCHOR, SLOT_KEYS
} from './calibration.js';
import * as Store from './backend.js';
import { primeCache, fetchPublished } from './store.js';

const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('out'), ctx = canvas.getContext('2d');

const COLORS = ['#7a4a24', '#f08a1c', '#c8102e', '#0b3d91', '#00843d', '#ffb81c', '#6a2c91', '#1b1b1b', '#ffffff'];

let parts = makeParts(null);
let layer = null;
let records = {};              // everything the admin can see, keyed by id
let current = null;            // working copy of the record being calibrated
let savedJson = '';            // to spot unsaved changes
let user = null, admin = false;

let showDots = false, stageMode = 'move';   // move | hit | anchor
let camOn = false, frozen = null;
let faces = [];                // saved test faces
let faceIndex = -1;            // -1 = live camera
let gridOpen = false;

const liveFace = newFaceState();
const FACES_KEY = 'mascot-admin-faces-v1';

// Manual overrides so reactions can be tried out on a frozen face.
const sim = { on: false, mouthGap: .1, brow: 0, blink: 0, swing: 0, bounce: 0 };

// ---------------------------------------------------------------------
//  Little UI helpers
// ---------------------------------------------------------------------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n[k] = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}

let toastTimer = null;
function toast(msg, kind = '') {
  const old = document.querySelector('.toast'); if (old) old.remove();
  const t = el('div', { class: 'toast ' + kind, text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 2800);
}

// Browser confirm() is unreliable on iOS, so ask inside the page.
function ask({ title, body, okText = 'OK', okClass = 'primary', fields = [], extra = null }) {
  return new Promise(res => {
    const inputs = {};
    const card = el('div', { class: 'card' },
      el('h2', { text: title }),
      body ? el('p', { class: 'small muted', text: body }) : null,
      extra,
      ...fields.map(f => {
        const input = f.options
          ? el('select', {}, ...f.options.map(o => el('option', { value: o.value, text: o.label, selected: o.value === f.value })))
          : el('input', { type: f.type || 'text', value: f.value || '', placeholder: f.placeholder || '' });
        inputs[f.key] = input;
        return el('div', {}, el('label', { class: 'small muted', text: f.label }), input);
      }),
      el('div', { class: 'row' },
        el('button', { class: 'ghost grow', text: 'Cancel', onclick: () => { sheet.remove(); res(null); } }),
        el('button', {
          class: okClass + ' grow', text: okText,
          onclick: () => {
            const out = {};
            for (const [k, i] of Object.entries(inputs)) out[k] = i.value;
            sheet.remove(); res(fields.length ? out : true);
          }
        })
      )
    );
    const sheet = el('div', { class: 'sheet', onclick: e => { if (e.target === sheet) { sheet.remove(); res(null); } } }, card);
    document.body.append(sheet);
    const first = Object.values(inputs)[0];
    if (first) setTimeout(() => first.focus(), 50);
  });
}

// label + slider + number box + nudge buttons, all in face units.
//
// min/max only size the SLIDER. If a value lands outside it — typed in, or
// nudged past the end — the slider widens to take it rather than refusing.
// A part that needs to sit a long way back should never be stopped by where
// a slider happens to end; hardMin/hardMax are the only real limits.
function numRow(label, get, set, {
  min = -1, max = 1, step = .005, nudge = .005, digits = 3,
  hardMin = -Infinity, hardMax = Infinity
} = {}) {
  let lo = min, hi = max;
  const range = el('input', { type: 'range', min: lo, max: hi, step, value: get() });
  const box = el('input', { type: 'number', step, value: (+get()).toFixed(digits) });

  const fit = n => {
    // Grow in halves so the slider keeps a round, stable span.
    if (n < lo) { lo = Math.min(Math.floor(n * 2) / 2, lo); range.min = lo; }
    if (n > hi) { hi = Math.max(Math.ceil(n * 2) / 2, hi); range.max = hi; }
  };
  const push = v => {
    let n = +v;
    if (!isFinite(n)) n = +get() || 0;
    n = clamp(n, hardMin, hardMax);
    fit(n);
    set(n);
    range.value = n; box.value = n.toFixed(digits);
    markDirty();
  };
  range.oninput = () => push(range.value);
  box.onchange = () => push(box.value);
  const row = el('div', { class: 'num' },
    el('label', { text: label }),
    range,
    el('div', { class: 'box' },
      el('button', { class: 'nudge', text: '−', onclick: () => push(+get() - nudge), 'aria-label': label + ' smaller' }),
      box,
      el('button', { class: 'nudge', text: '+', onclick: () => push(+get() + nudge), 'aria-label': label + ' bigger' })
    )
  );
  row.refresh = () => { const n = +get(); fit(n); range.value = n; box.value = n.toFixed(digits); };
  return row;
}

function toggle(label, get, set) {
  const b = el('button', { class: get() ? 'on' : 'ghost', text: label });
  b.onclick = () => { set(!get()); b.className = get() ? 'on' : 'ghost'; markDirty(); refreshStageNeeds(); };
  return b;
}

// ---------------------------------------------------------------------
//  Camera and the stage
// ---------------------------------------------------------------------
async function openCamera() {
  if (camOn) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    camOn = true;
    $('camBtn').textContent = 'Camera on';
    loadTracker().catch(e => toast('Face tracker failed: ' + e.message, 'bad'));
  } catch (e) {
    toast('Could not start the camera: ' + e.message, 'bad');
  }
}

// What the stage is showing right now.
function source() {
  if (faceIndex >= 0 && faces[faceIndex]) {
    const f = faces[faceIndex];
    return { kind: 'test', img: f.img, w: f.still.w, h: f.still.h, face: f.faceState, name: f.name };
  }
  if (frozen) return { kind: 'frozen', img: frozen.canvas, w: frozen.canvas.width, h: frozen.canvas.height, face: frozen.face, name: 'Frozen' };
  return { kind: 'live', w: video.videoWidth, h: video.videoHeight, face: liveFace, name: 'Live' };
}

function buildView(src, rec = current) {
  const mascot = {};
  for (const s of SLOTS) mascot[s.key] = blankSlot();
  if (rec) mascot[rec.slot] = { part: rec.id, dx: 0, dy: 0, scale: 1, color: rec.previewColor || rec.defaultColor };
  return {
    pts: src.face.pts, faceM: src.face.faceM, mascot,
    records: Object.assign({}, records, rec ? { [rec.id]: rec } : {}), parts,
    canvasWidth: canvas.width, canvasHeight: canvas.height
  };
}

// The face readings a part sees, with any manual overrides applied.
function infoFor(src) {
  const f = faceInfo(src.face);
  if (sim.on) {
    f.gap = sim.mouthGap; f.brow = sim.brow; f.blink = sim.blink;
    f.swing = sim.swing; f.bounce = sim.bounce;
  }
  return f;
}

function loop() {
  requestAnimationFrame(loop);
  const src = source();

  // Live camera: pull a frame and track it.
  if (src.kind === 'live') {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { setStageTag(camOn ? 'Starting camera…' : 'Camera off — tap Camera', false); return; }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, w, h); ctx.restore();
    const lm = getLandmarker();
    if (lm && video.currentTime !== loop.lastT) {
      loop.lastT = video.currentTime;
      const res = lm.detectForVideo(video, nextStamp());
      const got = res.faceLandmarks && res.faceLandmarks[0];
      if (got) { ingest(liveFace, got, w, h, true, res.faceBlendshapes && res.faceBlendshapes[0]); setStageTag('Live · face found', true); }
      else { resetFace(liveFace); setStageTag('Live · looking for a face…', false); }
    }
  } else {
    if (canvas.width !== src.w || canvas.height !== src.h) { canvas.width = src.w; canvas.height = src.h; }
    ctx.drawImage(src.img, 0, 0, src.w, src.h);
    setStageTag(src.name + (src.face.pts ? ' · face found' : ' · no face'), !!src.face.pts);
  }

  if (!src.face.pts || !src.face.faceM) return;
  const view = buildView(src);
  if (showDots) drawDots(ctx, src.face.pts, canvas.width, stageMode === 'anchor' && current ? current.anchor.landmarks[0] : null);
  if (current) {
    const f = infoFor(src);
    drawMascot(ctx, view, f);
    if (layer && render3D(layer, view, f, src.kind === 'live')) ctx.drawImage(layer.renderer.domElement, 0, 0);
    drawSelection(ctx, view, current.slot, canvas.width, stageMode === 'hit' ? '#7ee2a8' : '#ffb020');
    if (stageMode === 'hit') drawHitHandles(view);
  }
  updateMeters(src);
}

function drawHitHandles(view) {
  for (const ins of instancesOf(current, view.pts, view.faceM)) {
    const hc = hitCircle(current, view.mascot[current.slot], ins, view.faceM);
    ctx.save();
    ctx.fillStyle = '#7ee2a8';
    ctx.beginPath(); ctx.arc(hc.x, hc.y, Math.max(4, canvas.width / 180), 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hc.x + hc.r, hc.y, Math.max(5, canvas.width / 150), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function setStageTag(text, ok) {
  const t = $('stageTag');
  if (t.textContent !== text) t.textContent = text;
  t.classList.toggle('ok', !!ok);
}

// Hold the current frame so you can fiddle without holding still.
function freeze() {
  const src = source();
  if (src.kind !== 'live') { frozen = null; faceIndex = -1; updateFaceNav(); $('freezeBtn').textContent = 'Freeze'; return; }
  if (!liveFace.pts) { toast('No face to freeze yet.', 'bad'); return; }
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  // Keep the exact landmarks from this frame, with no further smoothing.
  const face = newFaceState();
  face.smooth = 1;
  face.pts = liveFace.pts.map(p => ({ ...p }));
  face.faceM = { ...liveFace.faceM };
  face.expr = { ...liveFace.expr };
  frozen = { canvas: c, face };
  $('freezeBtn').textContent = 'Unfreeze';
  updateFaceNav();
}

// ---------------------------------------------------------------------
//  Test faces
// ---------------------------------------------------------------------
function loadFaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(FACES_KEY) || '[]');
    faces = raw.map(f => hydrateFace(f)).filter(Boolean);
  } catch (_) { faces = []; }
}
function saveFaces() {
  try {
    localStorage.setItem(FACES_KEY, JSON.stringify(faces.map(f => ({ id: f.id, name: f.name, dataUrl: f.dataUrl, still: f.still }))));
  } catch (e) { toast('Could not save test faces (storage full?)', 'bad'); }
}
function hydrateFace(f) {
  if (!f || !f.still) return null;
  const img = new Image(); img.src = f.dataUrl;
  const out = { ...f, img, faceState: null };
  const build = () => { out.faceState = stateFromStill(f.still, f.still.w, f.still.h); };
  if (img.complete) build(); else img.onload = build;
  build();
  return out;
}

async function addFaceFromCanvas(name) {
  const src = source();
  if (src.kind === 'live' && !liveFace.pts) { toast('No face on screen to save.', 'bad'); return; }
  // Shrink a little so a dozen faces still fit in storage.
  const maxW = 720;
  const k = Math.min(1, maxW / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  const g = c.getContext('2d');
  // Re-draw just the photo, without the parts on top.
  if (src.kind === 'live') { g.save(); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(video, 0, 0, c.width, c.height); g.restore(); }
  else g.drawImage(src.img, 0, 0, c.width, c.height);
  await storeFaceFromCanvas(c, name || 'Face ' + (faces.length + 1), false);
}

async function storeFaceFromCanvas(c, name, mirror) {
  const still = await detectStill(c, c.width, c.height, mirror);
  if (!still) { toast('No face found in that picture.', 'bad'); return; }
  const f = hydrateFace({
    id: 'f' + Date.now(), name,
    dataUrl: c.toDataURL('image/jpeg', .82),
    still
  });
  faces.push(f); saveFaces(); updateFaceNav(); renderPane();
  toast('Saved "' + name + '"', 'good');
}

async function addFaceFromFile(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode().catch(() => {});
  if (!img.naturalWidth) { toast('Could not read that image.', 'bad'); return; }
  const maxW = 720, k = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  await storeFaceFromCanvas(c, file.name.replace(/\.[^.]+$/, '').slice(0, 24), false);
}

function updateFaceNav() {
  const nav = $('faceNav');
  nav.hidden = faces.length === 0;
  $('faceLabel').textContent = faceIndex >= 0 && faces[faceIndex]
    ? `${faces[faceIndex].name} (${faceIndex + 1}/${faces.length})`
    : (frozen ? 'Frozen' : 'Live');
}
function stepFace(d) {
  const n = faces.length;
  if (!n) return;
  // -1 is the live/frozen view, then each saved face in turn.
  faceIndex = faceIndex + d;
  if (faceIndex < -1) faceIndex = n - 1;
  if (faceIndex >= n) faceIndex = -1;
  updateFaceNav(); renderPane();
}

// ---------------------------------------------------------------------
//  Direct manipulation on the stage
// ---------------------------------------------------------------------
const pointers = new Map();
let drag = null, pinch = null;

canvas.addEventListener('pointerdown', e => {
  if (!current) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const src = source();
  if (stageMode === 'anchor' && src.face.pts) { pickLandmark(e, src); return; }
  if (pointers.size === 1) {
    drag = {
      x: e.clientX, y: e.clientY,
      ox: current.offset.x, oy: current.offset.y,
      hx: current.hit.cx, hy: current.hit.cy,
      sx: firstSx(src)
    };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = {
      d: dist(a, b), scale: current.scale, hitR: current.hit.r,
      angle: Math.atan2(b.y - a.y, b.x - a.x), rot: current.rotation.z
    };
    drag = null;
  }
});

function firstSx(src) {
  if (!src.face.pts) return 1;
  const list = instancesOf(current, src.face.pts, src.face.faceM);
  return list.length ? list[0].sx : 1;
}

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !current) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const src = source();
  if (!src.face.faceM) return;

  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const ratio = dist(a, b) / pinch.d;
    if (stageMode === 'hit') current.hit.r = clamp(pinch.hitR * ratio, .02, 8);
    else {
      current.scale = clamp(pinch.scale * ratio, .01, 30);
      // Two-finger twist rotates the part.
      current.rotation.z = pinch.rot + (Math.atan2(b.y - a.y, b.x - a.x) - pinch.angle);
    }
    markDirty(); refreshPlaceRows();
  } else if (drag) {
    const k = toCanvas(canvas, 0, 0).k;
    const m = dragToFaceUnits(src.face.faceM, (e.clientX - drag.x) / k, (e.clientY - drag.y) / k, drag.sx);
    if (stageMode === 'hit') { current.hit.cx = drag.hx + m.dx * drag.sx; current.hit.cy = drag.hy + m.dy; }
    else { current.offset.x = drag.ox + m.dx; current.offset.y = drag.oy + m.dy; }
    markDirty(); refreshPlaceRows();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) drag = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// Laptop: scroll to resize.
canvas.addEventListener('wheel', e => {
  if (!current) return;
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.05 : 1 / 1.05;
  if (stageMode === 'hit') current.hit.r = clamp(current.hit.r * k, .02, 8);
  else current.scale = clamp(current.scale * k, .01, 30);
  markDirty(); refreshPlaceRows();
}, { passive: false });

function pickLandmark(e, src) {
  const p = toCanvas(canvas, e.clientX, e.clientY);
  let best = -1, bd = 1e9;
  src.face.pts.forEach((q, i) => { const d = dist(p, q); if (d < bd) { bd = d; best = i; } });
  if (best < 0 || bd > src.face.faceM.size * .25) { toast('Tap closer to a dot.', 'bad'); return; }
  current.anchor = { landmarks: [best], mode: current.anchor.mode === 'pair' ? 'single' : current.anchor.mode };
  markDirty(); renderPane();
  toast('Anchor set to landmark ' + best);
}

// ---------------------------------------------------------------------
//  Dirty tracking
// ---------------------------------------------------------------------
const snap = r => JSON.stringify(normalizeRecord(r));
const isDirty = () => !!current && snap(current) !== savedJson;
function markDirty() { updateTopbar(); }

function updateTopbar() {
  $('partName').textContent = current ? current.name : 'No part selected';
  const b = $('partBadge');
  if (!current) { b.hidden = true; }
  else {
    b.hidden = false;
    if (isDirty()) { b.className = 'badge dirty'; b.textContent = 'Unsaved'; }
    else if (current.published) { b.className = 'badge pub'; b.textContent = 'Published'; }
    else { b.className = 'badge draft'; b.textContent = 'Draft'; }
  }
  const who = $('who');
  who.innerHTML = '';
  if (Store.isLocal()) {
    who.append(el('span', { class: 'tiny muted', text: 'Saved on this device' }));
  } else if (user) {
    who.append(el('button', { class: 'ghost tiny', text: 'Sign out', onclick: async () => { await Store.signOut(); user = null; admin = false; updateTopbar(); renderPane(); } }));
  } else {
    who.append(el('button', { class: 'primary tiny', text: 'Sign in', onclick: signInFlow }));
  }
}

// ---------------------------------------------------------------------
//  Tabs
// ---------------------------------------------------------------------
const TABS = [
  { key: 'library', label: 'Library' },
  { key: 'place', label: 'Place' },
  { key: 'react', label: 'Reactions' },
  { key: 'faces', label: 'Test faces' },
  { key: 'save', label: 'Save' }
];
let tab = 'library';

function renderTabs() {
  const t = $('tabs');
  t.innerHTML = '';
  for (const x of TABS) {
    t.append(el('button', {
      role: 'tab', 'aria-selected': String(x.key === tab), text: x.label,
      onclick: () => { tab = x.key; renderTabs(); renderPane(); }
    }));
  }
}

function renderPane() {
  const p = $('panes');
  p.innerHTML = '';
  p.append(({ library: paneLibrary, place: panePlace, react: paneReact, faces: paneFaces, save: paneSave })[tab]());
  updateTopbar();
  refreshStageNeeds();
}

function refreshStageNeeds() {
  $('dotsBtn').className = showDots ? 'on' : 'ghost';
}

// ---------------------------------------------------------------------
//  Pane: Library
// ---------------------------------------------------------------------
let search = '';

function thumbFor(rec) {
  const part = rec.type === 'builtin' ? (parts[rec.slot] || []).find(p => p.id === rec.id) : null;
  if (rec.type === 'builtin' && !part) return thumbPlaceholder('?', 44);
  if (is3DRecord(rec, part)) { if (rec.type === 'glb') loadGLTF(rec.assetUrl); return thumb3D(layer, rec, part, rec.defaultColor, 44); }
  if ((rec.type === 'png' || rec.type === 'svg')) {
    const e = getImage(rec.assetUrl);
    if (!e || !e.ready) return thumbPlaceholder('…', 44);
  }
  return thumb2D(rec, part, rec.defaultColor, 44);
}

function paneLibrary() {
  const pane = el('div', { class: 'pane' });

  pane.append(el('div', { class: 'row' },
    el('button', { class: 'primary grow', text: '＋ Upload new asset', onclick: uploadFlow }),
    el('button', { class: 'ghost', text: '↻', 'aria-label': 'Reload library', onclick: () => reload(true) })
  ));

  const box = el('input', { type: 'text', value: search, placeholder: 'Search parts…' });
  box.oninput = () => { search = box.value; listWrap.innerHTML = ''; listWrap.append(buildList()); };
  pane.append(el('div', { class: 'search' }, box));

  const listWrap = el('div', {});
  pane.append(listWrap);
  listWrap.append(buildList());

  const st = Store.localStats();
  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Backup' }),
    el('p', { class: 'tiny muted', text: Store.isLocal()
      ? `${st.total} part(s) saved on this device — ${st.published} published, ${st.drafts} draft(s). Clearing your browser data would lose them, so save a backup now and then.`
      : `${st.total} part(s) still held on this device from before Supabase was set up.` }),
    el('div', { class: 'row tight' },
      el('button', { class: 'ghost', text: '⭳ Save a backup file', onclick: exportFlow }),
      (() => {
        const inp = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
        inp.onchange = () => { if (inp.files[0]) importFlow(inp.files[0]); inp.value = ''; };
        return el('span', {}, el('button', { class: 'ghost', text: '⭱ Restore a backup', onclick: () => inp.click() }), inp);
      })()
    ),
    Store.isLocal()
      ? el('p', { class: 'tiny muted', text: 'When Supabase is set up later, a "Move to Supabase" button appears here and sends all of this up — no re-calibrating.' })
      : el('button', { class: 'primary', text: '⤴ Move this device’s parts to Supabase', onclick: migrateFlow, disabled: !(user && admin) || st.total === 0 })
  ));

  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Security check' }),
    el('p', { class: 'tiny muted', text: Store.isLocal()
      ? 'Nothing is shared while parts are saved on this device. Run this again once Supabase is set up.'
      : 'Checks what a stranger with only the public key can do. Everything except the first line should say "no".' }),
    el('button', { class: 'ghost', text: 'Run the check', onclick: runSecurityCheck }),
    el('div', { id: 'secOut' })
  ));

  function buildList() {
    const wrap = el('div', {});
    const q = search.trim().toLowerCase();
    let shown = 0;
    for (const key of SLOT_KEYS) {
      const list = Object.values(records)
        .filter(r => r.slot === key && (!q || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!list.length) continue;
      shown += list.length;
      const g = el('div', { class: 'slotGroup' }, el('h4', { text: SLOTS.find(s => s.key === key).label + ' · ' + list.length }));
      const items = el('div', { class: 'items' });
      for (const rec of list) {
        items.append(el('button', {
          class: 'item' + (current && current.id === rec.id ? ' on' : ''),
          onclick: () => selectRecord(rec.id)
        },
          thumbFor(rec),
          el('div', { class: 'meta' },
            el('div', { class: 'nm', text: rec.name }),
            el('div', { class: 'tiny muted', text: rec.type === 'builtin' ? 'Built-in art' : rec.type.toUpperCase() + ' upload' })
          ),
          el('span', { class: 'badge ' + (rec.published ? 'pub' : 'draft'), text: rec.published ? 'Published' : 'Draft' })
        ));
      }
      g.append(items);
      wrap.append(g);
    }
    if (!shown) wrap.append(el('p', { class: 'muted small', text: q ? 'Nothing matches that.' : 'No parts yet.' }));
    return wrap;
  }

  return pane;
}

async function exportFlow() {
  try {
    const dump = await Store.exportAll();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', {
      href: url,
      download: 'mascot-calibration-' + new Date().toISOString().slice(0, 10) + '.json'
    });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Backup saved to your downloads.', 'good');
  } catch (e) { toast('Could not make a backup: ' + e.message, 'bad'); }
}

async function importFlow(file) {
  try {
    const payload = JSON.parse(await file.text());
    const n = Object.keys(payload.records || {}).length;
    const r = await ask({
      title: 'Restore ' + n + ' part(s)?',
      body: 'From ' + (payload.exportedAt ? new Date(payload.exportedAt).toLocaleString() : 'an unknown date') + '.',
      okText: 'Restore',
      fields: [{ key: 'how', label: 'What to do with what is here now', value: 'merge', options: [
        { value: 'merge', label: 'Keep both — the backup wins where they clash' },
        { value: 'replace', label: 'Replace everything on this device' }
      ] }]
    });
    if (!r) return;
    const count = await Store.importAll(payload, { replace: r.how === 'replace' });
    await reload(false);
    toast('Restored ' + count + ' part(s).', 'good');
  } catch (e) { toast('Could not restore: ' + e.message, 'bad'); }
}

async function migrateFlow() {
  const st = Store.localStats();
  const ok = await ask({
    title: 'Move ' + st.total + ' part(s) to Supabase?',
    body: 'Uploads the artwork and the calibrations so everyone sees them. What is on this device is left alone, so nothing is lost if it goes wrong.',
    okText: 'Move them up'
  });
  if (!ok) return;
  toast('Moving…');
  try {
    const res = await Store.pushLocalToSupabase((done, total) => toast(`Moving ${done} of ${total}…`));
    await reload(false);
    if (res.failed.length) {
      toast(res.total - res.failed.length + ' moved, ' + res.failed.length + ' failed: ' + res.failed.map(f => f.id).join(', '), 'bad');
    } else {
      toast('All ' + res.total + ' moved up ✓', 'good');
    }
  } catch (e) { toast('Could not move: ' + e.message, 'bad'); }
}

async function runSecurityCheck() {
  const out = $('secOut');
  if (!out) return;
  out.innerHTML = '';
  out.append(el('p', { class: 'tiny muted', text: 'Checking…' }));
  try {
    const res = await Store.securityCheck();
    out.innerHTML = '';
    for (const r of res) {
      out.append(el('div', { class: 'ver' },
        el('span', { style: 'font-size:16px', text: r.pass ? '✅' : '❌' }),
        el('div', { class: 'vmeta' },
          el('div', { text: r.name }),
          el('div', { class: 'tiny muted', text: r.detail }))
      ));
    }
    const bad = res.filter(r => !r.pass).length;
    out.append(el('p', {
      class: 'tiny', style: 'color:' + (bad ? 'var(--danger)' : 'var(--ok)'),
      text: bad ? bad + ' problem(s) — re-run Step 2 of SETUP.md.' : 'All good: the public key can read published parts and nothing else.'
    }));
  } catch (e) {
    out.innerHTML = '';
    out.append(el('p', { class: 'tiny', style: 'color:var(--danger)', text: 'Could not run the check: ' + e.message }));
  }
}

function selectRecord(id) {
  const rec = records[id];
  if (!rec) return;
  current = normalizeRecord(JSON.parse(JSON.stringify(rec)));
  savedJson = snap(rec);
  if (current.type === 'glb') loadGLTF(current.assetUrl);
  if (current.type === 'png' || current.type === 'svg') getImage(current.assetUrl);
  tab = 'place'; renderTabs(); renderPane();
}

// ---------------------------------------------------------------------
//  Pane: Place
// ---------------------------------------------------------------------
let placeRows = [];
function refreshPlaceRows() { for (const r of placeRows) r.refresh && r.refresh(); }

function panePlace() {
  placeRows = [];
  const pane = el('div', { class: 'pane' });
  if (!current) {
    pane.append(el('p', { class: 'muted', text: 'Pick a part in the Library tab to start calibrating it.' }));
    return pane;
  }

  // What dragging does
  const modeRow = el('div', { class: 'row tight' });
  for (const [key, label] of [['move', 'Move / size'], ['hit', 'Tap area'], ['anchor', 'Pick anchor']]) {
    modeRow.append(el('button', {
      class: stageMode === key ? 'on' : 'ghost', text: label,
      onclick: () => {
        stageMode = key;
        if (key === 'anchor') showDots = true;
        renderPane();
      }
    }));
  }
  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Drag on the picture to' }), modeRow,
    el('p', {
      class: 'tiny muted', text: stageMode === 'hit'
        ? 'Drag to move the tap circle, pinch or scroll to resize it.'
        : stageMode === 'anchor'
          ? 'Tap a green dot to attach the part there. Its number is shown.'
          : 'Drag to move, pinch or scroll to resize, twist with two fingers to rotate.'
    })
  ));

  const off = el('div', { class: 'group' }, el('h3', { text: 'Offset (face units)' }));
  for (const ax of ['x', 'y']) {
    const r = numRow(ax.toUpperCase(), () => current.offset[ax], v => current.offset[ax] = v,
      { min: -1.5, max: 1.5, hardMin: -10, hardMax: 10 });
    placeRows.push(r); off.append(r);
  }
  // Depth needs a lot more room than side-to-side: pushing a hat or a crown
  // back far enough to sit AROUND the head is several face widths.
  const rz = numRow('Z (depth)', () => current.offset.z, v => current.offset.z = v,
    { min: -4, max: 4, nudge: .02, hardMin: -20, hardMax: 20 });
  placeRows.push(rz); off.append(rz);
  off.append(el('p', { class: 'tiny muted', text:
    'Z moves a part towards or away from the camera, so it only affects 3D parts. '
    + 'More negative pushes it back behind your face — that is what makes a crown or a hat sit around your head instead of through it. '
    + 'The hidden head shape then covers whatever goes behind it.' }));
  pane.append(off);

  const sc = el('div', { class: 'group' }, el('h3', { text: 'Size and turn' }));
  const sr = numRow('Scale', () => current.scale, v => current.scale = v,
    { min: .05, max: 4, step: .01, nudge: .01, digits: 2, hardMin: .01, hardMax: 30 });
  placeRows.push(sr); sc.append(sr);
  for (const ax of ['x', 'y', 'z']) {
    const r = numRow('Rotate ' + ax.toUpperCase(), () => current.rotation[ax], v => current.rotation[ax] = v,
      { min: -Math.PI, max: Math.PI, step: .01, nudge: .02, digits: 2, hardMin: -12, hardMax: 12 });
    placeRows.push(r); sc.append(r);
  }
  pane.append(sc);

  const pv = el('div', { class: 'group' }, el('h3', { text: 'Pivot (flat art only)' }));
  for (const ax of ['x', 'y']) {
    const r = numRow('Pivot ' + ax.toUpperCase(), () => current.pivot[ax], v => current.pivot[ax] = v,
      { min: -1, max: 1, hardMin: -5, hardMax: 5 });
    placeRows.push(r); pv.append(r);
  }
  pane.append(pv);

  const hit = el('div', { class: 'group' }, el('h3', { text: 'Tap area' }));
  for (const [k, lbl, o] of [
    ['cx', 'Centre X', { min: -1, max: 1, hardMin: -5, hardMax: 5 }],
    ['cy', 'Centre Y', { min: -1, max: 1, hardMin: -5, hardMax: 5 }],
    ['r', 'Radius', { min: .02, max: 1.5, hardMin: .02, hardMax: 8 }]]) {
    const r = numRow(lbl, () => current.hit[k], v => current.hit[k] = v, o);
    placeRows.push(r); hit.append(r);
  }
  pane.append(hit);

  // Attachment
  const anch = el('div', { class: 'group' }, el('h3', { text: 'Attachment' }));
  const modeSel = el('select', {},
    ...[['single', 'One copy'], ['pair', 'One per landmark'], ['side', 'One each side of the face']]
      .map(([v, l]) => el('option', { value: v, text: l, selected: v === current.anchor.mode })));
  modeSel.onchange = () => {
    current.anchor.mode = modeSel.value;
    if (modeSel.value === 'side' && current.anchor.landmarks.length < 2) current.anchor = { ...SIDE_ANCHOR };
    if (modeSel.value === 'pair' && current.anchor.landmarks.length < 2) current.anchor.landmarks = [...(SLOT_ANCHORS[current.slot].landmarks.length > 1 ? SLOT_ANCHORS[current.slot].landmarks : [205, 425])];
    markDirty(); renderPane();
  };
  const lmBox = el('input', { type: 'text', value: current.anchor.landmarks.join(', ') });
  lmBox.onchange = () => {
    const nums = lmBox.value.split(/[,\s]+/).map(n => parseInt(n, 10)).filter(n => n >= 0 && n < 478);
    if (!nums.length) { toast('Needs at least one landmark number.', 'bad'); lmBox.value = current.anchor.landmarks.join(', '); return; }
    current.anchor.landmarks = nums; markDirty();
  };
  anch.append(
    el('div', {}, el('label', { class: 'small muted', text: 'How many copies' }), modeSel),
    el('div', {}, el('label', { class: 'small muted', text: 'Landmark numbers (several = their midpoint)' }), lmBox),
    el('div', { class: 'row tight' },
      el('button', { class: 'ghost', text: 'Default for this slot', onclick: () => { current.anchor = { ...SLOT_ANCHORS[current.slot] }; markDirty(); renderPane(); } }),
      el('button', { class: 'ghost', text: 'Sides of face', onclick: () => { current.anchor = { ...SIDE_ANCHOR }; markDirty(); renderPane(); } })
    )
  );
  pane.append(anch);

  const tog = el('div', { class: 'group' }, el('h3', { text: 'Behaviour' }),
    el('div', { class: 'row tight' },
      toggle('Mirror pair', () => current.mirror, v => current.mirror = v),
      toggle('Follow head turn', () => current.followHeadTurn, v => current.followHeadTurn = v),
      toggle('Colorable', () => current.colorable, v => current.colorable = v)
    ),
    el('p', { class: 'tiny muted', text: 'Mirror pair draws one piece of art twice, flipped. Follow head turn makes a 3D part rotate fully with the head.' })
  );
  pane.append(tog);

  // Colour preview
  const sw = el('div', { class: 'row tight' });
  for (const c of COLORS) {
    sw.append(el('button', {
      style: `background:${c};width:28px;height:28px;padding:0;border-radius:50%;border:2px solid ${(current.previewColor || current.defaultColor) === c ? '#fff' : 'rgba(255,255,255,.3)'}`,
      'aria-label': 'Preview colour ' + c,
      onclick: () => { current.previewColor = c; renderPane(); }
    }));
  }
  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Default colour' }),
    el('div', { class: 'row tight' },
      el('input', { type: 'color', value: current.defaultColor, onchange: e => { current.defaultColor = e.target.value; current.previewColor = null; markDirty(); renderPane(); }, style: 'width:54px;height:36px;padding:2px' }),
      el('span', { class: 'small muted', text: current.defaultColor })
    ),
    el('p', { class: 'tiny muted', text: 'Try other colours without changing the default:' }), sw
  ));

  return pane;
}

// ---------------------------------------------------------------------
//  Pane: Reactions
// ---------------------------------------------------------------------
let meterEls = null;

function updateMeters(src) {
  if (!meterEls) return;
  const f = infoFor(src);
  const vals = { mouthGap: f.gap, brow: f.brow, blink: f.blink, swing: f.swing, bounce: f.bounce };
  for (const [k, m] of Object.entries(meterEls)) {
    const v = vals[k] || 0;
    const pct = k === 'swing' || k === 'bounce' ? (v + 1) / 2 * 100 : Math.min(1, v / (k === 'mouthGap' ? .5 : 1)) * 100;
    m.fill.style.width = clamp(pct, 0, 100) + '%';
    m.val.textContent = v.toFixed(2);
  }
}

function paneReact() {
  meterEls = {};
  const pane = el('div', { class: 'pane' });
  if (!current) { pane.append(el('p', { class: 'muted', text: 'Pick a part first.' })); return pane; }

  // Live meters
  const mg = el('div', { class: 'group' }, el('h3', { text: 'What the face is doing now' }));
  for (const i of REACTION_INPUTS) {
    const fill = el('div', { class: 'fill' }), val = el('span', { class: 'val', text: '0.00' });
    meterEls[i.key] = { fill, val };
    mg.append(el('div', { class: 'meter' }, el('span', { text: i.label }), el('div', { class: 'bar' }, fill), val));
  }
  mg.append(el('p', { class: 'tiny muted', text: 'On a frozen or saved face the head is not moving, so turn on the sliders below to try a reaction out.' }));
  pane.append(mg);

  // Manual drivers
  const sg = el('div', { class: 'group' }, el('h3', { text: 'Pretend the face is doing this' }),
    el('div', { class: 'row tight' }, toggle('Use these sliders', () => sim.on, v => { sim.on = v; renderPane(); })));
  if (sim.on) {
    for (const [k, lbl, min, max] of [['mouthGap', 'Mouth open', 0, .5], ['brow', 'Eyebrows', 0, 1], ['blink', 'Blink', 0, 1], ['swing', 'Head swing', -1, 1], ['bounce', 'Head bounce', -.6, .6]]) {
      sg.append(numRow(lbl, () => sim[k], v => sim[k] = v, { min, max, step: .01, nudge: .02, digits: 2 }));
    }
  }
  pane.append(sg);

  // Rules
  const rg = el('div', { class: 'group' }, el('h3', { text: 'Rules' }));
  if (current.type === 'builtin') {
    rg.append(el('p', { class: 'tiny muted', text: 'This is a built-in part. Its reactions are written into its artwork, so rules here are not used — but its position, size and tap area are all still yours to change.' }));
  }
  current.reactions.forEach((rx, i) => rg.append(reactionRow(rx, i)));
  rg.append(el('button', {
    class: 'ghost', text: '＋ Add rule',
    onclick: () => { current.reactions.push({ input: 'mouthGap', property: 'scale', amount: 1, min: 0, max: 1 }); markDirty(); renderPane(); }
  }));
  pane.append(rg);
  return pane;
}

function reactionRow(rx, i) {
  const inSel = el('select', {}, ...REACTION_INPUTS.map(x => el('option', { value: x.key, text: x.label, selected: x.key === rx.input })));
  const prSel = el('select', {}, ...REACTION_PROPS.map(x => el('option', { value: x.key, text: x.label, selected: x.key === rx.property })));
  inSel.onchange = () => { rx.input = inSel.value; markDirty(); };
  prSel.onchange = () => { rx.property = prSel.value; markDirty(); renderPane(); };
  const unit = (REACTION_PROPS.find(p => p.key === rx.property) || {}).unit || '';
  return el('div', { class: 'rx' },
    el('div', { class: 'line' }, inSel, el('span', { class: 'tiny muted', text: '→' }), prSel),
    rx.property === 'visible' ? null : numRow('Amount', () => rx.amount, v => rx.amount = v, { min: -4, max: 4, step: .01, nudge: .05, digits: 2 }),
    numRow('From', () => rx.min, v => rx.min = v, { min: -1, max: 1, step: .01, nudge: .01, digits: 2 }),
    numRow('To', () => rx.max, v => rx.max = v, { min: -1, max: 1, step: .01, nudge: .01, digits: 2 }),
    el('div', { class: 'row' },
      el('span', { class: 'tiny muted grow', text: unit ? 'Amount is in ' + unit : 'Shown only while the reading is between From and To.' }),
      el('button', { class: 'danger', text: 'Remove', onclick: () => { current.reactions.splice(i, 1); markDirty(); renderPane(); } })
    )
  );
}

// ---------------------------------------------------------------------
//  Pane: Test faces
// ---------------------------------------------------------------------
function paneFaces() {
  const pane = el('div', { class: 'pane' });

  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Showing' }),
    el('div', { class: 'row tight' },
      el('button', { class: faceIndex === -1 && !frozen ? 'on' : 'ghost', text: 'Live camera', onclick: () => { faceIndex = -1; frozen = null; $('freezeBtn').textContent = 'Freeze'; updateFaceNav(); renderPane(); } }),
      el('button', { class: frozen && faceIndex === -1 ? 'on' : 'ghost', text: frozen ? 'Unfreeze' : 'Freeze frame', onclick: () => { freeze(); renderPane(); } })
    ),
    el('div', { class: 'row tight' },
      el('button', { class: 'primary', text: '＋ Save this face', onclick: () => addFaceFromCanvas() }),
      (() => {
        const inp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
        inp.onchange = () => { if (inp.files[0]) addFaceFromFile(inp.files[0]); inp.value = ''; };
        const b = el('button', { class: 'ghost', text: 'Upload a photo', onclick: () => inp.click() });
        return el('span', {}, b, inp);
      })()
    )
  ));

  const g = el('div', { class: 'group' }, el('h3', { text: 'Saved faces · ' + faces.length }));
  if (!faces.length) g.append(el('p', { class: 'tiny muted', text: 'Save a few faces at different angles, then flip through them with the arrows on the picture to check one part fits them all.' }));
  faces.forEach((f, i) => {
    g.append(el('div', { class: 'ver' },
      el('span', { class: 'vmeta', text: f.name + (f.faceState ? '' : ' (no face)') }),
      el('button', { class: faceIndex === i ? 'on' : 'ghost', text: 'Show', onclick: () => { faceIndex = i; frozen = null; updateFaceNav(); renderPane(); } }),
      el('button', { class: 'ghost', text: 'Rename', onclick: async () => {
        const r = await ask({ title: 'Rename face', okText: 'Rename', fields: [{ key: 'name', label: 'Name', value: f.name }] });
        if (r && r.name.trim()) { f.name = r.name.trim().slice(0, 30); saveFaces(); updateFaceNav(); renderPane(); }
      } }),
      el('button', { class: 'danger', text: 'Delete', onclick: async () => {
        const ok = await ask({ title: 'Delete this test face?', body: f.name, okText: 'Delete', okClass: 'danger' });
        if (!ok) return;
        faces.splice(i, 1);
        if (faceIndex >= faces.length) faceIndex = -1;
        saveFaces(); updateFaceNav(); renderPane();
      } })
    ));
  });
  pane.append(g);

  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Side-by-side check' }),
    el('button', { class: 'ghost', text: gridOpen ? 'Hide grid' : 'Show this part on every face', onclick: () => { gridOpen = !gridOpen; renderPane(); if (gridOpen) setTimeout(drawGrid, 50); } }),
    gridOpen ? el('div', { id: 'gridWrap' }) : null
  ));
  if (gridOpen) setTimeout(drawGrid, 50);
  return pane;
}

// Render the current part onto every saved face at once.
function drawGrid() {
  const wrap = $('gridWrap');
  if (!wrap || !current) return;
  wrap.innerHTML = '';
  if (!faces.length) { wrap.append(el('p', { class: 'tiny muted', text: 'Save some test faces first.' })); return; }
  for (const f of faces) {
    if (!f.faceState || !f.faceState.pts) continue;
    const c = el('canvas', {});
    const w = 260, k = w / f.still.w;
    c.width = w; c.height = Math.round(f.still.h * k);
    const g = c.getContext('2d');
    g.drawImage(f.img, 0, 0, c.width, c.height);
    const st = stateFromStill(f.still, c.width, c.height);
    const view = buildView({ kind: 'test', face: st, w: c.width, h: c.height });
    view.canvasWidth = c.width; view.canvasHeight = c.height;
    const info = faceInfo(st);
    if (sim.on) Object.assign(info, { gap: sim.mouthGap, brow: sim.brow, blink: sim.blink, swing: sim.swing, bounce: sim.bounce });
    drawMascot(g, view, info);
    if (layer && render3D(layer, view, info, false)) g.drawImage(layer.renderer.domElement, 0, 0, c.width, c.height);
    wrap.append(el('figure', {}, c, el('figcaption', { text: f.name })));
  }
}

// ---------------------------------------------------------------------
//  Pane: Save
// ---------------------------------------------------------------------
function paneSave() {
  const pane = el('div', { class: 'pane' });
  if (!current) { pane.append(el('p', { class: 'muted', text: 'Pick a part first.' })); return pane; }

  if (Store.isLocal()) {
    pane.append(el('div', { class: 'group' },
      el('h3', { text: 'Saved on this device' }),
      el('p', { class: 'small muted', text: 'Parts are kept in this browser and show up in the app on this device. Nobody else sees them yet. Back them up from the Library tab, and move them to Supabase when you are ready to share.' })));
  } else if (!user) {
    pane.append(el('div', { class: 'group' },
      el('h3', { text: 'Sign in to save' }),
      el('button', { class: 'primary', text: 'Sign in', onclick: signInFlow })));
  } else if (!admin) {
    pane.append(el('div', { class: 'group' },
      el('h3', { text: 'Signed in, but not an admin' }),
      el('p', { class: 'small', text: 'Your account is not on the admin list, so saving will be refused. Run Step 4 of SETUP.md with this email: ' + (user.email || '') })));
  }

  const canWrite = Store.isLocal() || (user && admin);

  const nameBox = el('input', { type: 'text', value: current.name });
  nameBox.onchange = () => { current.name = nameBox.value.trim().slice(0, 40) || current.name; markDirty(); };
  const slotSel = el('select', {}, ...SLOTS.map(s => el('option', { value: s.key, text: s.label, selected: s.key === current.slot })));
  slotSel.onchange = () => {
    current.slot = slotSel.value;
    if (current.type !== 'builtin') current.anchor = { ...SLOT_ANCHORS[current.slot] };
    markDirty(); renderPane();
  };
  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Details' }),
    el('div', {}, el('label', { class: 'small muted', text: 'Name' }), nameBox),
    el('div', {}, el('label', { class: 'small muted', text: 'Tab it appears in' }), slotSel),
    el('p', { class: 'tiny muted', text: 'id: ' + current.id + ' · type: ' + current.type })
  ));

  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'Save' }),
    el('div', { class: 'row tight' },
      el('button', { class: 'ghost grow', text: 'Save draft', onclick: () => doSave(false), disabled: !canWrite }),
      el('button', { class: 'primary grow', text: current.published ? 'Save & keep published' : 'Publish', onclick: () => doSave(true), disabled: !canWrite })
    ),
    current.published
      ? el('button', { class: 'ghost', text: 'Unpublish (hide from the app)', onclick: () => doSave(false, true), disabled: !canWrite })
      : null,
    el('button', { class: 'ghost', text: 'Revert to last published', onclick: doRevert, disabled: !canWrite }),
    el('p', { class: 'tiny muted', text: 'A draft is only visible here. Publish makes it appear in the app.' })
  ));

  pane.append(el('div', { class: 'group' },
    el('h3', { text: 'This part' }),
    el('div', { class: 'row tight' },
      el('button', { class: 'ghost', text: 'Copy settings from…', onclick: copyFromFlow }),
      el('button', { class: 'ghost', text: 'Duplicate', onclick: duplicateFlow, disabled: !canWrite }),
      el('button', { class: 'ghost', text: 'Reset to defaults', onclick: resetFlow })
    ),
    current.type === 'builtin'
      ? el('p', { class: 'tiny muted', text: 'Built-in parts cannot be deleted — reset them instead.' })
      : el('button', { class: 'danger', text: 'Delete this part', onclick: deleteFlow, disabled: !canWrite })
  ));

  const vg = el('div', { class: 'group' }, el('h3', { text: 'History' }),
    el('button', { class: 'ghost', text: 'Load history', onclick: () => loadHistory(vg), disabled: !canWrite }));
  pane.append(vg);
  return pane;
}

async function doSave(publish, unpublish = false) {
  try {
    const rec = normalizeRecord(current);
    delete rec.previewColor;
    const saved = await Store.saveRecord(rec, { publish: unpublish ? false : publish });
    records[saved.id] = saved;
    current = normalizeRecord(JSON.parse(JSON.stringify(saved)));
    savedJson = snap(saved);
    await refreshAppCache();
    toast(unpublish ? 'Unpublished.' : publish ? 'Published ✓' : 'Draft saved ✓', 'good');
    renderPane();
  } catch (e) {
    toast('Could not save: ' + (e.message || e), 'bad');
  }
}

async function doRevert() {
  try {
    const prev = await Store.lastPublished(current.id);
    if (!prev) { toast('No published version to go back to.', 'bad'); return; }
    const ok = await ask({ title: 'Revert to last published?', body: 'Your unsaved changes will be lost.', okText: 'Revert' });
    if (!ok) return;
    current = normalizeRecord(prev);
    markDirty(); renderPane();
    toast('Reverted. Save to keep it.', 'good');
  } catch (e) { toast('Could not revert: ' + e.message, 'bad'); }
}

async function loadHistory(container) {
  try {
    const list = await Store.listVersions(current.id);
    container.querySelectorAll('.ver, .histNote').forEach(n => n.remove());
    if (!list.length) { container.append(el('p', { class: 'tiny muted histNote', text: 'No saved versions yet.' })); return; }
    for (const v of list) {
      container.append(el('div', { class: 'ver' },
        el('div', { class: 'vmeta' },
          el('div', { text: 'v' + v.version + (v.published ? ' · published' : ' · draft') }),
          el('div', { class: 'tiny muted', text: new Date(v.created_at).toLocaleString() })),
        el('button', {
          class: 'ghost', text: 'Restore',
          onclick: async () => {
            const ok = await ask({ title: 'Restore version ' + v.version + '?', body: 'It becomes your working copy. Nothing changes in the app until you save.', okText: 'Restore' });
            if (!ok) return;
            current = normalizeRecord({ ...v.record, id: current.id, published: current.published, version: current.version });
            markDirty(); renderPane(); toast('Restored v' + v.version + '. Save to keep it.', 'good');
          }
        })
      ));
    }
  } catch (e) { toast('Could not load history: ' + e.message, 'bad'); }
}

async function copyFromFlow() {
  const opts = Object.values(records).filter(r => r.id !== current.id)
    .sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name))
    .map(r => ({ value: r.id, label: `${r.name} (${r.slot})` }));
  if (!opts.length) { toast('Nothing to copy from.', 'bad'); return; }
  const r = await ask({
    title: 'Copy settings from…',
    body: 'Takes position, size, rotation, attachment, tap area and reactions. Keeps this part’s own name and artwork.',
    okText: 'Copy', fields: [{ key: 'id', label: 'Part', options: opts, value: opts[0].value }]
  });
  if (!r) return;
  const from = records[r.id];
  Object.assign(current, {
    offset: { ...from.offset }, rotation: { ...from.rotation }, scale: from.scale,
    pivot: { ...from.pivot }, anchor: { landmarks: [...from.anchor.landmarks], mode: from.anchor.mode },
    mirror: from.mirror, followHeadTurn: from.followHeadTurn,
    hit: { ...from.hit }, reactions: JSON.parse(JSON.stringify(from.reactions))
  });
  markDirty(); renderPane();
  toast('Copied from ' + from.name);
}

async function duplicateFlow() {
  const r = await ask({ title: 'Duplicate this part', okText: 'Duplicate', fields: [{ key: 'name', label: 'Name for the copy', value: current.name + ' copy' }] });
  if (!r || !r.name.trim()) return;
  const copy = normalizeRecord({ ...JSON.parse(JSON.stringify(current)), id: slugId(r.name), name: r.name.trim(), published: false, version: 0, type: current.type === 'builtin' ? 'builtin' : current.type });
  if (copy.type === 'builtin') { toast('A built-in part can only be re-calibrated, not duplicated.', 'bad'); return; }
  try {
    const saved = await Store.saveRecord(copy, { publish: false, label: 'duplicate of ' + current.id });
    records[saved.id] = saved;
    selectRecord(saved.id);
    toast('Duplicated as a draft.', 'good');
  } catch (e) { toast('Could not duplicate: ' + e.message, 'bad'); }
}

async function resetFlow() {
  const ok = await ask({ title: 'Reset to defaults?', body: 'Puts this part back to how it started. Nothing changes in the app until you save.', okText: 'Reset', okClass: 'danger' });
  if (!ok) return;
  const part = (parts[current.slot] || []).find(p => p.id === current.id);
  if (current.type === 'builtin' && part) {
    const base = builtinRecords(parts)[current.id];
    current = normalizeRecord({ ...base, published: current.published, version: current.version });
  } else {
    current = normalizeRecord({
      ...newRecord(current.slot, current.name, current.type, current.assetUrl),
      id: current.id, published: current.published, version: current.version
    });
  }
  markDirty(); renderPane();
}

async function deleteFlow() {
  const r = await ask({
    title: 'Delete "' + current.name + '"?',
    body: 'This removes it from the app for everyone. Type DELETE to confirm.',
    okText: 'Delete', okClass: 'danger',
    fields: [{ key: 'word', label: 'Type DELETE', placeholder: 'DELETE' }]
  });
  if (!r || r.word.trim().toUpperCase() !== 'DELETE') { if (r) toast('Not deleted.', 'bad'); return; }
  try {
    await Store.deleteRecord(current.id);
    await Store.deleteAssetAt(current.storedUrl || current.assetUrl);
    delete records[current.id];
    current = null; savedJson = '';
    await refreshAppCache();
    tab = 'library'; renderTabs(); renderPane();
    toast('Deleted.', 'good');
  } catch (e) { toast('Could not delete: ' + e.message, 'bad'); }
}

// ---------------------------------------------------------------------
//  Upload
// ---------------------------------------------------------------------
function uploadFlow() {
  if (!Store.isLocal() && (!user || !admin)) { toast('Sign in as the admin first.', 'bad'); return; }
  const inp = el('input', { type: 'file', accept: '.png,.svg,.glb,.gltf,image/png,image/svg+xml,model/gltf-binary,model/gltf+json', style: 'display:none' });
  inp.onchange = async () => {
    const file = inp.files[0];
    inp.remove();
    if (file) await handleUpload(file);
  };
  document.body.append(inp);
  inp.click();
}

// A look at the file before it goes anywhere. Flat art is shown on a
// chequerboard so a missing transparent background is obvious.
async function filePreview(file, kind) {
  const box = el('div', {
    style: 'border:1px solid var(--line);border-radius:10px;padding:8px;display:grid;place-items:center;min-height:120px;'
      + 'background-color:#1a1f28;background-image:linear-gradient(45deg,#232936 25%,transparent 25%,transparent 75%,#232936 75%),'
      + 'linear-gradient(45deg,#232936 25%,transparent 25%,transparent 75%,#232936 75%);'
      + 'background-size:16px 16px;background-position:0 0,8px 8px;'
  });
  if (kind === 'glb') {
    box.append(el('p', { class: 'tiny muted', style: 'text-align:center',
      text: '3D model — you will see it on your face as soon as it uploads.' }));
    return box;
  }
  try {
    let url;
    if (kind === 'svg') {
      url = URL.createObjectURL(new Blob([Store.sanitizeSvg(await file.text())], { type: 'image/svg+xml' }));
    } else {
      url = URL.createObjectURL(file);
    }
    const img = el('img', { src: url, style: 'max-width:100%;max-height:180px;display:block' });
    img.onload = () => {
      URL.revokeObjectURL(url);
      box.append(el('p', { class: 'tiny muted', text: img.naturalWidth + ' × ' + img.naturalHeight + ' px' }));
    };
    img.onerror = () => box.append(el('p', { class: 'tiny', style: 'color:var(--danger)', text: 'Could not read that image.' }));
    box.append(img);
  } catch (e) {
    box.append(el('p', { class: 'tiny', style: 'color:var(--danger)', text: e.message }));
  }
  return box;
}

async function handleUpload(file) {
  const kind = Store.assetKind(file);
  if (!kind) { toast('Use a PNG, SVG, GLB or GLTF file.', 'bad'); return; }
  const limit = Store.SIZE_WARN[kind];
  const mb = (file.size / 1024 / 1024).toFixed(2);
  if (file.size > limit) {
    const ok = await ask({
      title: 'That file is large',
      body: `${file.name} is ${mb} MB. ${kind === 'glb' ? 'GLB files should be under 2 MB' : 'Images should be under 1 MB'} so the app stays quick on a phone. Upload it anyway?`,
      okText: 'Upload anyway'
    });
    if (!ok) return;
  }

  const r = await ask({
    title: 'Add "' + file.name + '"',
    body: `${kind.toUpperCase()} · ${mb} MB`,
    okText: 'Upload',
    extra: await filePreview(file, kind),
    fields: [
      { key: 'name', label: 'Name shown to users', value: file.name.replace(/\.[^.]+$/, '').slice(0, 30) },
      { key: 'slot', label: 'Which tab it belongs in', options: SLOTS.map(s => ({ value: s.key, label: s.label })), value: 'head' },
      { key: 'mode', label: 'How it attaches', options: [
        { value: 'single', label: 'One copy, on the middle' },
        { value: 'mirror', label: 'Two copies, mirrored' },
        { value: 'side', label: 'One on each side of the face' }
      ], value: 'single' }
    ]
  });
  if (!r || !r.name.trim()) return;

  toast('Uploading…');
  try {
    const rec = newRecord(r.slot, r.name.trim(), kind, null);
    const up = await Store.uploadAsset(file, rec.id);
    rec.assetUrl = up.url;
    if (up.stored) rec.storedUrl = up.stored;   // local art: keep the durable reference
    rec.type = up.kind;
    if (r.mode === 'mirror') rec.mirror = true;
    if (r.mode === 'side') rec.anchor = { ...SIDE_ANCHOR };
    rec.colorable = up.kind === 'glb';     // only GLBs have a Colorable material
    const saved = await Store.saveRecord(rec, { publish: false, label: 'upload' });
    records[saved.id] = saved;
    if (saved.type === 'glb') await loadGLTF(saved.assetUrl); else getImage(saved.assetUrl);
    clearThumbCache();
    selectRecord(saved.id);
    toast('Uploaded as a draft — calibrate it, then Publish.', 'good');
  } catch (e) {
    toast('Upload failed: ' + (e.message || e), 'bad');
  }
}

// ---------------------------------------------------------------------
//  Auth
// ---------------------------------------------------------------------
async function signInFlow() {
  if (Store.isLocal()) { toast('No sign-in needed — parts are saved on this device.'); return; }
  const r = await ask({
    title: 'Sign in', okText: 'Sign in',
    fields: [
      { key: 'email', label: 'Email', type: 'email', value: localStorage.getItem('mascot-admin-email') || '' },
      { key: 'password', label: 'Password', type: 'password' }
    ]
  });
  if (!r) return;
  try {
    user = await Store.signIn(r.email.trim(), r.password);
    localStorage.setItem('mascot-admin-email', r.email.trim());
    admin = await Store.isAdmin();
    toast(admin ? 'Signed in ✓' : 'Signed in, but not on the admin list.', admin ? 'good' : 'bad');
    await reload(true);
  } catch (e) {
    toast('Sign in failed: ' + (e.message || e), 'bad');
  }
}

// ---------------------------------------------------------------------
//  Loading
// ---------------------------------------------------------------------
async function reload(announce) {
  const base = builtinRecords(parts);
  if (Store.isLocal() || user) {
    try {
      records = mergeRecords(base, await Store.listAll());
      if (announce) toast('Library loaded.', 'good');
    } catch (e) {
      records = base;
      if (announce) toast('Could not load the library: ' + e.message, 'bad');
    }
  } else {
    // Signed out of Supabase: show the built-ins plus whatever is published.
    try {
      const got = await fetchPublished();
      records = mergeRecords(base, got.records);
    } catch (_) { records = base; }
  }
  if (current && records[current.id] && !isDirty()) selectRecord(current.id);
  renderPane();
}

// Keep the app's offline cache in step so a publish shows up straight away.
async function refreshAppCache() {
  if (Store.isLocal()) return;        // the app reads the same local store directly
  try {
    const got = await fetchPublished();
    if (got.source === 'network') primeCache(got.records);
  } catch (_) {}
}

// ---------------------------------------------------------------------
//  Buttons and startup
// ---------------------------------------------------------------------
$('camBtn').onclick = openCamera;
$('freezeBtn').onclick = () => { freeze(); renderPane(); };
$('dotsBtn').onclick = () => { showDots = !showDots; refreshStageNeeds(); };
$('facePrev').onclick = () => stepFace(-1);
$('faceNext').onclick = () => stepFace(1);

async function boot() {
  loadFaces(); updateFaceNav();
  renderTabs();

  try { user = await Store.currentUser(); } catch (_) {}
  if (user) admin = await Store.isAdmin();
  await reload(false);

  loadTracker().catch(() => {});
  try {
    layer = await createLayer();
    parts = makeParts(layer.parts3D);
    await reload(false);
    clearThumbCache();
  } catch (e) {
    console.warn('3D parts unavailable:', e);
  }
  renderPane();
  requestAnimationFrame(loop);

  // Start the camera straight away on a laptop; phones need the tap.
  if (!/iPhone|iPad|Android/i.test(navigator.userAgent)) openCamera();
}

boot().catch(e => {
  console.error('admin boot failed', e);
  if (window.__fatal) window.__fatal('The admin page could not start', e && (e.stack || e.message) || String(e));
});

window.addEventListener('beforeunload', e => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// Hooks for the test harness.
window.__admin = {
  get records() { return records; },
  get current() { return current; },
  set current(v) { current = normalizeRecord(v); },
  get faces() { return faces; },
  get layer() { return layer; },
  selectRecord, buildView, source, infoFor,
  setMode: m => { stageMode = m; },
  get ready() { const s = source(); return !!(s.face && s.face.pts); }
};
