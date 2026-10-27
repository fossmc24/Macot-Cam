// =====================================================================
//  MASCOT CAM — the app itself.
//
//  All the placement maths, the part library and the renderers live in the
//  shared modules, which admin.html uses too. This file is the glue: the
//  camera, the draw loop and the builder sheet.
// =====================================================================
import {
  loadTracker, getLandmarker, newFaceState, ingest, resetFace, faceInfo, dist, nextStamp
} from './face.js';
import {
  SLOTS, TAB_ORDER, DRAW_ORDER, blankSlot, hitTest, toCanvas, dragToFaceUnits, findPart
} from './placement.js';
import { drawMascot, drawDots, drawSelection, roarIfMouthOpen, thumb2D, preloadImages } from './render2d.js';
import { createLayer, render3D, thumb3D, is3DRecord, clearThumbCache } from './render3d.js';
import { makeParts, loadRecords, recordsForSlot } from './library.js';

const $ = id => document.getElementById(id);
const video = $('cam'), canvas = $('out'), ctx = canvas.getContext('2d');
const start = $('start'), bar = $('bar'), tag = $('tag'), err = $('err'), sheet = $('sheet');

let stream = null, facing = 'user', running = false, lastVideoTime = -1;
let showDots = false, editing = false;
let layer = null;                      // the 3D layer, once three.js is up
let parts = makeParts(null);           // built-in art
let records = {};                      // calibration records, keyed by id

const face = newFaceState();

const COLORS = ['#7a4a24', '#f08a1c', '#c8102e', '#0b3d91', '#00843d', '#ffb81c', '#6a2c91', '#1b1b1b', '#ffffff'];

// ---------------------------------------------------------------------
//  Presets
// ---------------------------------------------------------------------
const slotWith = (slot, id, color) => ({
  part: id, dx: 0, dy: 0, scale: 1,
  color: color || (records[id] ? records[id].defaultColor : null)
});
const PRESETS = [
  { name: 'Bear',  icon: '🐻', build: () => ({ ears: slotWith('ears', 'bearEars'), nose: slotWith('nose', 'bearNose'), cheeks: slotWith('cheeks', 'blush') }) },
  { name: 'Puppy', icon: '🐶', build: () => ({ ears: slotWith('ears', 'dogEars'), nose: slotWith('nose', 'bearNose'), mouth: slotWith('mouth', 'tongue') }) },
  { name: 'Bunny', icon: '🐰', build: () => ({ ears: slotWith('ears', 'bunnyEars'), nose: slotWith('nose', 'tigerNose'), mouth: slotWith('mouth', 'buck'), facial: slotWith('facial', 'whiskers') }) },
  { name: 'Tiger', icon: '🐯', build: () => ({ ears: slotWith('ears', 'tigerEars'), nose: slotWith('nose', 'tigerNose'), facial: slotWith('facial', 'whiskers'), mouth: slotWith('mouth', 'teeth') }) },
  { name: 'Fan',   icon: '📣', build: () => ({ head: slotWith('head', 'cap'), eyes: slotWith('eyes', 'eyeBlack'), cheeks: slotWith('cheeks', 'stripes') }) },
  { name: 'Monster', icon: '👹', build: () => ({ head: slotWith('head', 'horns'), mouth: slotWith('mouth', 'fire'), eyes: slotWith('eyes', 'mask') }) },
  { name: 'Bird',  icon: '🐦', build: () => ({ head: slotWith('head', 'crown'), mouth: slotWith('mouth', 'beak'), cheeks: slotWith('cheeks', 'blush') }) },
  { name: 'Goofy', icon: '🤪', build: () => ({ mouth: slotWith('mouth', 'tongue'), nose: slotWith('nose', 'clownNose'), eyes: slotWith('eyes', 'glasses') }) },
  { name: '3D Bear', icon: '🧸', build: () => ({ ears: slotWith('ears', 'bearEars3d'), nose: slotWith('nose', 'bearNose3d'), mouth: slotWith('mouth', 'tongue3d') }) },
  { name: '3D Star', icon: '⭐', build: () => ({ head: slotWith('head', 'crown3d'), eyes: slotWith('eyes', 'shades3d'), mouth: slotWith('mouth', 'bubble3d') }) },
  { name: '3D Piggy', icon: '🐷', build: () => ({ ears: slotWith('ears', 'mouseEars3d', '#f4a3b5'), nose: slotWith('nose', 'pigSnout3d'), cheeks: slotWith('cheeks', 'blush') }) },
  { name: 'Panda', icon: '🐼', build: () => ({ head: slotWith('head', 'pandaHead3d') }) },
  { name: 'Blank', icon: '⬜', build: () => ({}) }
];
function presetState(i) {
  const built = PRESETS[i].build();
  const st = {};
  for (const s of SLOTS) st[s.key] = built[s.key] || blankSlot();
  return st;
}

// ---------------------------------------------------------------------
//  The user's mascot, remembered on this phone
// ---------------------------------------------------------------------
let mascot = {};
for (const s of SLOTS) mascot[s.key] = blankSlot();

const slotOf = id => (records[id] ? records[id].slot : null);

// Drop any part we no longer have, the way the old migration code did.
function adoptSaved(saved) {
  if (!saved) return;
  // Older saves kept whiskers/mustache/beard under "mouth" — move them to "facial".
  if (saved.mouth && saved.mouth.part && slotOf(saved.mouth.part) === 'facial') { saved.facial = saved.mouth; saved.mouth = null; }
  // Older saves kept ears under "head" — move them to "ears".
  if (saved.head && saved.head.part && slotOf(saved.head.part) === 'ears') { saved.ears = saved.head; saved.head = null; }
  for (const s of SLOTS) {
    const got = saved[s.key];
    mascot[s.key] = (got && (!got.part || slotOf(got.part) === s.key)) ? got : blankSlot();
  }
  // Floppy/elephant ears moved to new attachment points — clear old tweaks once.
  if (!(saved.v >= 2) && mascot.ears.part && records[mascot.ears.part]
      && records[mascot.ears.part].anchor.mode === 'side') {
    Object.assign(mascot.ears, { dx: 0, dy: 0, scale: 1 });
  }
}
const save = () => { try { localStorage.setItem('mascot-v1', JSON.stringify({ ...mascot, v: 2 })); } catch (_) {} };

// ---------------------------------------------------------------------
//  Camera
// ---------------------------------------------------------------------
function showError(msg) { err.textContent = msg; err.hidden = false; }

async function openCamera() {
  err.hidden = true;
  if (!window.isSecureContext) return showError('This page must be opened with https:// for the camera to work.');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showError('This browser does not support the camera. Try Safari or Chrome.');
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    });
  } catch (e) {
    start.hidden = false;
    if (e.name === 'NotAllowedError') showHelp(e);
    else if (e.name === 'NotFoundError') showError('No camera was found on this device.');
    else showError('Could not start the camera: ' + e.message);
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  start.hidden = true; canvas.hidden = false; tag.hidden = false;
  setEditing(editing);
  running = true;
  requestAnimationFrame(loop);
  if (!getLandmarker()) {
    setTag('Loading face tracker…', false);
    try { await loadTracker(); } catch (e) { setTag('Face tracker failed to load: ' + e.message, false); }
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

function setTag(text, ok) {
  if (tag.textContent !== text) tag.textContent = text;
  tag.classList.toggle('ok', !!ok);
}

// ---------------------------------------------------------------------
//  Draw loop
// ---------------------------------------------------------------------
const view = () => ({
  pts: face.pts, faceM: face.faceM, mascot, records, parts,
  canvasWidth: canvas.width, canvasHeight: canvas.height
});

function loop() {
  if (!running) return;
  const w = video.videoWidth, h = video.videoHeight;
  if (w && h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const mirror = facing === 'user';

    ctx.save();
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    const lm = getLandmarker();
    if (lm && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = lm.detectForVideo(video, nextStamp());
      const got = res.faceLandmarks && res.faceLandmarks[0];
      if (got) {
        ingest(face, got, w, h, mirror, res.faceBlendshapes && res.faceBlendshapes[0]);
        setTag(editing ? 'Face found ✓ — tap a part to edit' : 'Face found ✓', true);
      } else {
        resetFace(face);
        setTag(editing ? 'Look at the camera to edit' : 'Looking for a face…', false);
      }
    }

    if (face.pts && face.faceM) {
      const v = view();
      if (showDots) drawDots(ctx, face.pts, canvas.width);
      const fi = faceInfo(face);
      drawMascot(ctx, v, fi);
      if (layer && render3D(layer, v, fi, mirror)) ctx.drawImage(layer.renderer.domElement, 0, 0);
      roarIfMouthOpen(ctx, face.pts, face.faceM);
      if (editing && selected) drawSelection(ctx, v, selected.slot, canvas.width);
    }
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------
//  Editing on the face — tap to select, drag to move, pinch to resize
// ---------------------------------------------------------------------
let selected = null;   // { slot, inst }
const pointers = new Map();
let drag = null, pinch = null;

const overSheet = y => !sheet.hidden && y > sheet.getBoundingClientRect().top;

canvas.addEventListener('pointerdown', e => {
  if (!editing) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    const hit = hitTest(view(), canvas, e.clientX, e.clientY);
    if (hit) {
      selected = { slot: hit.slot, inst: hit.inst };
      const st = mascot[hit.slot];
      drag = { x: e.clientX, y: e.clientY, dx: st.dx, dy: st.dy, sx: hit.sx };
      showTab(hit.slot, false);
    } else {
      selected = null; drag = null;
    }
    updateSelbar();
  } else if (pointers.size === 2 && selected) {
    const [a, b] = [...pointers.values()];
    pinch = { d: dist(a, b), scale: mascot[selected.slot].scale };
    drag = null;
  }
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2 && selected) {
    const [a, b] = [...pointers.values()];
    mascot[selected.slot].scale = Math.min(3, Math.max(.35, pinch.scale * dist(a, b) / pinch.d));
  } else if (drag && selected && face.faceM) {
    const k = toCanvas(canvas, 0, 0).k;
    const m = dragToFaceUnits(face.faceM, (e.clientX - drag.x) / k, (e.clientY - drag.y) / k, drag.sx);
    const st = mascot[selected.slot];
    st.dx = drag.dx + m.dx;
    st.dy = drag.dy + m.dy;
    sheet.classList.toggle('drop-remove', overSheet(e.clientY));
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (drag && selected && overSheet(e.clientY)) removeSelected();
  sheet.classList.remove('drop-remove');
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) { drag = null; save(); }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// ---------------------------------------------------------------------
//  Builder sheet — tabs, part tray, colour + size controls
// ---------------------------------------------------------------------
let currentTab = 'head';

function renderTabs() {
  $('tabs').innerHTML = '';
  for (const key of TAB_ORDER) {
    const b = document.createElement('button');
    b.textContent = key === 'presets' ? 'Start from' : SLOTS.find(s => s.key === key).label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === currentTab));
    b.onclick = () => showTab(key, true);
    $('tabs').appendChild(b);
  }
}

function showTab(key, selectIt) {
  currentTab = key;
  if (selectIt && key !== 'presets') selected = mascot[key].part ? { slot: key, inst: 0 } : null;
  renderTabs(); renderTray(); updateSelbar();
}

function thumbFor(slotKey, rec, part) {
  const st = mascot[slotKey];
  const col = st.part === rec.id && st.color ? st.color : rec.defaultColor;
  return is3DRecord(rec, part) ? thumb3D(layer, rec, part, col) : thumb2D(rec, part, col);
}

function renderTray() {
  const tray = $('tray');
  tray.innerHTML = '';
  if (currentTab === 'presets') {
    PRESETS.forEach((pr, i) => {
      const t = document.createElement('button');
      t.className = 'tile';
      t.innerHTML = `<span class="word">${pr.icon}</span>${pr.name}`;
      t.onclick = () => { mascot = presetState(i); selected = null; save(); showTab('presets', false); };
      tray.appendChild(t);
    });
    return;
  }
  const slotKey = currentTab;
  const none = document.createElement('button');
  none.className = 'tile' + (mascot[slotKey].part ? '' : ' on');
  none.innerHTML = '<span class="word">∅</span>None';
  none.onclick = () => { mascot[slotKey] = blankSlot(); selected = null; save(); renderTray(); updateSelbar(); };
  tray.appendChild(none);

  for (const { rec, part } of recordsForSlot(records, parts, slotKey)) {
    const t = document.createElement('div');
    t.className = 'tile' + (mascot[slotKey].part === rec.id ? ' on' : '');
    t.tabIndex = 0;
    t.setAttribute('role', 'button');
    if (is3DRecord(rec, part)) {
      const b = document.createElement('span'); b.className = 'badge3d'; b.textContent = '3D'; t.appendChild(b);
    }
    t.appendChild(thumbFor(slotKey, rec, part));
    t.appendChild(document.createTextNode(rec.name));
    makeDraggable(t, slotKey, rec, part);
    t.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); equip(slotKey, rec.id); } };
    tray.appendChild(t);
  }
}

// Put a part on the face, replacing whatever was in that spot.
function equip(slotKey, id) {
  const prev = mascot[slotKey];
  const rec = records[id];
  mascot[slotKey] = { part: id, dx: 0, dy: 0, scale: prev.part ? prev.scale : 1, color: rec.defaultColor };
  selected = { slot: slotKey, inst: 0 };
  save(); renderTray(); updateSelbar();
}

// Tap a tile to add it; or drag it up onto the face.
function makeDraggable(tile, slotKey, rec, part) {
  let startP = null, ghost = null;
  tile.addEventListener('pointerdown', e => {
    startP = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { tile.setPointerCapture(e.pointerId); } catch (_) {}   // keep following the finger past the tile
  });
  tile.addEventListener('pointermove', e => {
    if (!startP || e.pointerId !== startP.id) return;
    const dx = e.clientX - startP.x, dy = e.clientY - startP.y;
    if (!ghost && -dy > 10 && Math.abs(dy) > Math.abs(dx)) {
      ghost = thumbFor(slotKey, rec, part);
      ghost.className = 'ghostpart';
      document.body.appendChild(ghost);
    }
    if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
  });
  const finish = e => {
    if (!startP || e.pointerId !== startP.id) return;
    const moved = Math.hypot(e.clientX - startP.x, e.clientY - startP.y);
    if (ghost) {
      ghost.remove(); ghost = null;
      if (e.type === 'pointerup' && !overSheet(e.clientY)) equip(slotKey, rec.id);
    } else if (e.type === 'pointerup' && moved < 8) {
      equip(slotKey, rec.id);
    }
    startP = null;
  };
  tile.addEventListener('pointerup', finish);
  tile.addEventListener('pointercancel', finish);
}

function updateSelbar() {
  const st = selected ? mascot[selected.slot] : null;
  const rec = st && st.part ? records[st.part] : null;
  $('selName').textContent = rec
    ? rec.name + (rec.tip ? ' · ' + rec.tip : '')
    : (currentTab === 'presets' ? 'Pick a mascot to start from' : 'Tap a part on your face to change it');
  for (const id of ['swatches', 'smaller', 'bigger', 'removeBtn']) $(id).hidden = !rec;
  if (!rec) return;
  const sw = $('swatches');
  sw.hidden = !rec.colorable;
  sw.innerHTML = '';
  if (!rec.colorable) return;
  for (const col of COLORS) {
    const b = document.createElement('button');
    b.className = 'sw' + ((st.color || rec.defaultColor) === col ? ' on' : '');
    b.style.background = col;
    b.setAttribute('aria-label', 'Color ' + col);
    b.onclick = () => { st.color = col; save(); renderTray(); updateSelbar(); };
    sw.appendChild(b);
  }
}

function removeSelected() {
  if (!selected) return;
  mascot[selected.slot] = blankSlot();
  selected = null;
  save(); renderTray(); updateSelbar();
}

$('smaller').onclick = () => { if (selected) { const st = mascot[selected.slot]; st.scale = Math.max(.35, st.scale * .9); save(); } };
$('bigger').onclick  = () => { if (selected) { const st = mascot[selected.slot]; st.scale = Math.min(3, st.scale * 1.1); save(); } };
$('removeBtn').onclick = removeSelected;

// While editing, shrink the camera view to the space above the panel.
function fitCanvas() {
  canvas.style.height = editing ? `calc(100% - ${sheet.offsetHeight - 18}px)` : '100%';
}
new ResizeObserver(fitCanvas).observe(sheet);

function setEditing(on) {
  editing = on;
  sheet.hidden = !on; $('doneBtn').hidden = !on; bar.hidden = on;
  if (!on) selected = null;
  if (on) showTab(currentTab, true);
  fitCanvas();
}
$('editBtn').onclick = () => setEditing(true);
$('doneBtn').onclick = () => setEditing(false);

// ---------------------------------------------------------------------
//  Camera-blocked help
// ---------------------------------------------------------------------
function whichBrowser() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|Snapchat|Twitter|LinkedInApp|TikTok|musical_ly|GSA\//.test(ua);
  if (isIOS && inApp) return 'ios-inapp';
  if (isIOS && /CriOS/.test(ua)) return 'ios-chrome';
  if (isIOS && /FxiOS/.test(ua)) return 'ios-firefox';
  if (isIOS) return 'ios-safari';
  if (/Android/.test(ua)) return 'android-chrome';
  return 'desktop';
}
const STEPS = {
  'ios-safari': { steps: ['Tap <b>aA</b> (or the page icon) on the left side of the address bar.', 'Tap <b>Website Settings</b>.', 'Tap <b>Camera</b> and choose <b>Allow</b> (or <b>Ask</b>).', 'Tap <b>Done</b>, then tap <b>Try again</b> below.'], note: 'Still blocked? Open the Settings app → Apps → Safari → Camera, and choose Ask or Allow. Then come back and reload this page.' },
  'ios-chrome': { steps: ['Open the iPhone <b>Settings</b> app.', 'Tap <b>Apps</b>, then <b>Chrome</b>.', 'Turn on <b>Camera</b>.', 'Come back here and tap <b>Try again</b>.'], note: 'If Chrome asks again, tap Allow.' },
  'ios-firefox': { steps: ['Open the iPhone <b>Settings</b> app.', 'Tap <b>Apps</b>, then <b>Firefox</b>.', 'Turn on <b>Camera</b>.', 'Come back here and tap <b>Try again</b>.'], note: '' },
  'ios-inapp': { steps: ['This page opened inside another app, which blocks the camera.', 'Tap the <b>⋯</b> or share button in the corner.', 'Choose <b>Open in Safari</b> (or Open in browser).', 'Tap <b>Turn on camera</b> again there.'], note: '' },
  'android-chrome': { steps: ['Tap the <b>icon left of the web address</b>.', 'Tap <b>Permissions</b> (or Site settings).', 'Turn on <b>Camera</b>.', 'Tap <b>Try again</b> below.'], note: '' },
  'desktop': { steps: ['Click the <b>icon left of the web address</b>.', 'Set <b>Camera</b> to <b>Allow</b>.', 'Click <b>Try again</b> below.'], note: '' }
};
async function showHelp(e) {
  const info = STEPS[whichBrowser()];
  let perm = 'unknown';
  try { perm = (await navigator.permissions.query({ name: 'camera' })).state; } catch (_) {}
  $('diag').textContent = 'Details: browser=' + whichBrowser() + ' · address=' + location.protocol + '//' + location.host +
    ' · permission=' + perm + ' · error=' + e.name + ' (' + e.message + ')';
  $('helpSteps').innerHTML = info.steps.map(s => '<li>' + s + '</li>').join('');
  $('helpNote').textContent = info.note; $('helpNote').hidden = !info.note;
  start.hidden = true; $('help').hidden = false;
}

// ---------------------------------------------------------------------
//  Buttons
// ---------------------------------------------------------------------
$('go').onclick = openCamera;
$('retry').onclick = () => {
  $('help').hidden = true; start.hidden = false;
  if (whichBrowser().startsWith('ios')) location.reload(); else openCamera();
};
$('dotsBtn').onclick = e => { showDots = !showDots; e.target.textContent = 'Dots: ' + (showDots ? 'on' : 'off'); };
$('flip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; resetFace(face); openCamera(); };
$('stop').onclick = () => {
  stopCamera(); setEditing(false);
  canvas.hidden = true; bar.hidden = true; tag.hidden = true; start.hidden = false;
};

// ---------------------------------------------------------------------
//  Startup
// ---------------------------------------------------------------------
async function boot() {
  // Calibration records first, so the saved mascot can be checked against them.
  const got = await loadRecords(parts);
  records = got.records;
  const remote = got.remote;      // reused below, so we only fetch once
  preloadImages(Object.values(records));
  mascot = presetState(0);
  try { adoptSaved(JSON.parse(localStorage.getItem('mascot-v1') || 'null')); } catch (_) {}
  if (editing) { renderTabs(); renderTray(); updateSelbar(); }

  loadTracker().catch(() => {});

  // three.js is optional: without it, the flat parts still work.
  try {
    layer = await createLayer();
    parts = makeParts(layer.parts3D);
    records = (await loadRecords(parts, remote)).records;
    clearThumbCache();
    if (editing) renderTray();
  } catch (e) {
    console.warn('3D parts unavailable:', e);
  }
}
boot();

// Let the test harness and the admin page's "check in the app" link see state.
window.__mascot = {
  get records() { return records; },
  get parts() { return parts; },
  get mascot() { return mascot; },
  get face() { return face; },
  get layer() { return layer; },
  set mascot(v) { mascot = v; save(); if (editing) { renderTray(); updateSelbar(); } },
  equip, presetState, openCamera,
  get ready() { return !!(face.pts && face.faceM); }
};
