// =====================================================================
//  FACE TRACKING — MediaPipe Face Landmarker, face measurements,
//  expressions and the floppy-part spring physics.
//
//  Everything here works on a plain "face state" object so the main app
//  (one live face) and the admin page (a live face plus saved test faces)
//  can each keep their own, without one disturbing the other.
// =====================================================================
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

export const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });

// ---------------------------------------------------------------------
//  The tracker itself (one per page, loaded once)
// ---------------------------------------------------------------------
let landmarker = null, trackerPromise = null;

export function loadTracker() {
  if (!trackerPromise) trackerPromise = createTracker().catch(e => { trackerPromise = null; throw e; });
  return trackerPromise;
}
export const getLandmarker = () => landmarker;

async function createTracker() {
  const files = await FilesetResolver.forVisionTasks(TASKS_VISION + '/wasm');
  const opts = delegate => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO', numFaces: 1,
    outputFaceBlendshapes: true      // expression readings: eyebrows up, blinks, etc.
  });
  // The GPU path is much faster on a phone and is what we want everywhere real.
  // Some software/headless GL stacks accept it and then quietly find no faces,
  // so ?tracker=cpu forces the slower CPU path for testing or a broken device.
  const forced = new URLSearchParams(location.search).get('tracker');
  if (forced === 'cpu') return (landmarker = await FaceLandmarker.createFromOptions(files, opts('CPU')));
  try { landmarker = await FaceLandmarker.createFromOptions(files, opts('GPU')); }
  catch (e) { landmarker = await FaceLandmarker.createFromOptions(files, opts('CPU')); }
  return landmarker;
}

// Timestamps handed to detectForVideo must always move forward, even when we
// run a still photo through the video-mode tracker.
let stamp = 0;
export const nextStamp = () => (stamp = Math.max(stamp + 1, performance.now()));

// ---------------------------------------------------------------------
//  Face state
// ---------------------------------------------------------------------
export function newFaceState() {
  return {
    pts: null,          // smoothed face points, in canvas pixels
    faceM: null,        // latest measurements
    expr: { brow: 0, blink: 0 },
    phys: { sw: 0, sv: 0, by: 0, bv: 0, px: null, py: 0, pa: 0 },
    smooth: 0.65        // 1 = no smoothing
  };
}

export function measure(p) {
  const a = p[33], b = p[263];
  const [l, r] = a.x < b.x ? [a, b] : [b, a];
  return {
    size: dist(p[234], p[454]),
    angle: Math.atan2(r.y - l.y, r.x - l.x),
    mouthOpen: dist(p[13], p[14]) / dist(p[10], p[152])
  };
}

// Normalised landmarks (0–1 from MediaPipe) → canvas pixels, mirrored if asked.
// z is depth on the same scale as x; smaller = closer to the camera.
export function toPixels(face, w, h, mirror) {
  return face.map(q => ({ x: (mirror ? 1 - q.x : q.x) * w, y: q.y * h, z: q.z * w }));
}

export function readExpressions(st, bs) {
  if (!bs) return;
  const get = n => (bs.categories.find(c => c.categoryName === n) || { score: 0 }).score;
  const browRaw = Math.max(get('browInnerUp'), (get('browOuterUpLeft') + get('browOuterUpRight')) / 2);
  st.expr.brow += (clamp((browRaw - .12) / .45, 0, 1) - st.expr.brow) * .4;
  const blinkRaw = (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2;
  st.expr.blink += (clamp((blinkRaw - .3) / .4, 0, 1) - st.expr.blink) * .6;
}

// Floppy physics: ears lag behind when the head moves, then spring back.
export function stepPhysics(st) {
  const ph = st.phys, a = st.pts[10], s = st.faceM.size;
  if (ph.px !== null) {
    const vx = (a.x - ph.px) / s, vy = (a.y - ph.py) / s, da = st.faceM.angle - ph.pa;
    ph.sv += -ph.sw * .12 - ph.sv * .14 - vx * 3 - da * 1.2;
    ph.sw = clamp(ph.sw + ph.sv, -1.1, 1.1);
    ph.bv += -ph.by * .15 - ph.bv * .15 - vy * 3;
    ph.by = clamp(ph.by + ph.bv, -.6, .6);
  }
  ph.px = a.x; ph.py = a.y; ph.pa = st.faceM.angle;
}

// Take one set of fresh landmarks into the state (smoothing, measuring, physics).
export function ingest(st, face, w, h, mirror, blendshapes) {
  const fresh = toPixels(face, w, h, mirror);
  const k = st.smooth;
  st.pts = st.pts && st.pts.length === fresh.length
    ? fresh.map((q, i) => ({
        x: st.pts[i].x + (q.x - st.pts[i].x) * k,
        y: st.pts[i].y + (q.y - st.pts[i].y) * k,
        z: st.pts[i].z + (q.z - st.pts[i].z) * k
      }))
    : fresh;
  st.faceM = measure(st.pts);
  readExpressions(st, blendshapes);
  stepPhysics(st);
  return st;
}

export function resetFace(st) {
  st.pts = null; st.faceM = null; st.phys.px = null;
}

// Live face info handed to every part each frame. Thumbnails and frozen
// frames pass pretend values in `over`.
export function faceInfo(st, over) {
  const s = st.faceM.size;
  const f = {
    gap: dist(st.pts[13], st.pts[14]) / s,
    w: dist(st.pts[61], st.pts[291]) / s,
    t: performance.now() / 1000,
    brow: st.expr.brow, blink: st.expr.blink,
    swing: st.phys.sw, bounce: st.phys.by,
    sx: 1
  };
  return over ? Object.assign(f, over) : f;
}

// A face read once from a still image: landmarks are kept as they were
// detected, so a saved test face always places parts identically.
export async function detectStill(source, w, h, mirror) {
  const lm = await loadTracker();
  let res = null;
  // The video-mode tracker needs a couple of frames to settle on a still.
  for (let i = 0; i < 3; i++) res = lm.detectForVideo(source, nextStamp());
  const face = res && res.faceLandmarks && res.faceLandmarks[0];
  if (!face) return null;
  return {
    landmarks: face.map(q => ({ x: q.x, y: q.y, z: q.z })),   // normalised, reusable
    blendshapes: res.faceBlendshapes && res.faceBlendshapes[0]
      ? res.faceBlendshapes[0].categories.map(c => ({ categoryName: c.categoryName, score: c.score }))
      : null,
    mirror: !!mirror, w, h
  };
}

// Rebuild a face state from a stored still (no smoothing, no physics).
export function stateFromStill(still, w, h) {
  const st = newFaceState();
  st.smooth = 1;
  st.pts = toPixels(still.landmarks, w, h, still.mirror);
  st.faceM = measure(st.pts);
  if (still.blendshapes) {
    // Apply in full rather than easing towards the reading.
    const get = n => (still.blendshapes.find(c => c.categoryName === n) || { score: 0 }).score;
    const browRaw = Math.max(get('browInnerUp'), (get('browOuterUpLeft') + get('browOuterUpRight')) / 2);
    st.expr.brow = clamp((browRaw - .12) / .45, 0, 1);
    st.expr.blink = clamp(((get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2 - .3) / .4, 0, 1);
  }
  return st;
}
