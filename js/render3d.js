// =====================================================================
//  3D RENDERER — three.js layer for the models that turn with the head.
//
//  Two kinds of 3D part:
//    • built-in models, assembled from primitives in build(color)
//    • uploaded GLB / GLTF, loaded with GLTFLoader
//
//  Units: 1 = face width, +y is up, +z points out of the face. Everything
//  is drawn with an orthographic camera in canvas-pixel space, then copied
//  onto the 2D canvas, so the two layers line up exactly.
// =====================================================================
import { forEachInstance, resolveTransform } from './placement.js';
import { buildParts3D } from './parts-builtin.js';

// Shape of the invisible head used to hide parts that go behind it.
// Half-extents: width and depth in face widths, height as a multiple of the
// chin→hairline distance (the skull continues above the hairline, so this is
// more than half of it). Narrow enough that ears mounted at the sides still
// show; tall enough to cover the top of the head.
export const HEAD = { width: .45, depth: .46, height: .74, back: .10 };

export let T = null;            // three.js, once loaded
let GLTFLoader = null, loader = null;

const gltfCache = new Map();    // url → { scene, failed } or a Promise

export async function init3D() {
  if (T) return T;
  T = await import('three');
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  loader = new GLTFLoader();
  return T;
}

export function makeRenderer(w, h, RoomEnvironment) {
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(w, h, false); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new T.Scene();
  // A soft "studio" around the parts gives them realistic shine and reflections.
  scene.environment = new T.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  scene.add(new T.HemisphereLight(0xffffff, 0x445566, .5));
  const sun = new T.DirectionalLight(0xffffff, 1.4); sun.position.set(.4, 1, 1.2); scene.add(sun);
  return { renderer, scene };
}

// Build the whole 3D layer: main pass + a small one for tray pictures.
export async function createLayer() {
  await init3D();
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const main = makeRenderer(16, 16, RoomEnvironment);
  main.camera = new T.OrthographicCamera(0, 16, 0, -16, -5000, 5000);   // 1 unit = 1 camera pixel
  // An invisible head shape: hides 3D parts when they swing behind the head.
  main.occluder = new T.Mesh(new T.SphereGeometry(1, 32, 24), new T.MeshBasicMaterial({ colorWrite: false }));
  main.occluder.renderOrder = -1;
  main.scene.add(main.occluder);
  main.objs = new Map();
  main.thumb = makeRenderer(120, 120, RoomEnvironment);
  main.thumb.camera = new T.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  main.parts3D = buildParts3D(T);
  return main;
}

// Which way the head is facing, worked out from the 3D face points.
export function headRotation(pts, mirror) {
  const P = i => new T.Vector3(pts[i].x, -pts[i].y, -(pts[i].z || 0));
  const X = P(263).sub(P(33)); if (mirror) X.negate(); X.normalize();   // left → right across the eyes
  const Y = P(10).sub(P(152)); Y.addScaledVector(X, -X.dot(Y)).normalize();   // chin → forehead
  const Z = new T.Vector3().crossVectors(X, Y);                          // out of the face
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, Z));
}

export function dispose3D(obj) {
  obj.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m.dispose());
  });
}

// ---------------------------------------------------------------------
//  Uploaded GLB / GLTF
// ---------------------------------------------------------------------
export function loadGLTF(url) {
  if (!url) return Promise.resolve({ scene: null, failed: true });
  if (!loader) return init3D().then(() => loadGLTF(url));   // three.js not up yet
  if (gltfCache.has(url)) return gltfCache.get(url);
  const p = new Promise(res => {
    loader.load(url,
      g => res({ scene: g.scene, failed: false }),
      undefined,
      e => { console.warn('GLB failed to load:', url, e); res({ scene: null, failed: true }); });
  }).then(r => { gltfCache.set(url, r); return r; });
  gltfCache.set(url, p);
  return p;
}
export function gltfReady(url) {
  const e = gltfCache.get(url);
  return e && !(e instanceof Promise) && e.scene ? e : null;
}

// A material named "Colorable" takes the colour the user picked.
function tintColorable(root, color) {
  root.traverse(n => {
    if (!n.material) return;
    for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
      if (m && /^colorable$/i.test(m.name || '') && m.color) m.color.set(color);
    }
  });
}

function buildModel(layer, rec, part, color) {
  if (rec.type === 'builtin') return part && part.build ? part.build(color) : null;
  if (rec.type !== 'glb') return null;
  const got = gltfReady(rec.assetUrl);
  if (!got) { loadGLTF(rec.assetUrl); return null; }
  const clone = got.scene.clone(true);
  // Clone materials so one model's colour does not bleed into another's.
  clone.traverse(n => {
    if (n.material) n.material = Array.isArray(n.material) ? n.material.map(m => m.clone()) : n.material.clone();
  });
  if (rec.colorable) tintColorable(clone, color);
  return clone;
}

// ---------------------------------------------------------------------
//  The main pass. Returns false when there is nothing 3D to copy across.
// ---------------------------------------------------------------------
export function render3D(layer, view, f, mirror) {
  const { renderer, scene, camera } = layer;
  const w = view.canvasWidth, h = view.canvasHeight;
  if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
    renderer.setSize(w, h, false); camera.right = w; camera.bottom = -h; camera.updateProjectionMatrix();
  }
  const q = headRotation(view.pts, mirror), S = view.faceM.size, used = new Set();

  forEachInstance(view, ins => {
    const { rec, part, state } = ins;
    const is3D = rec.type === 'glb' || (rec.type === 'builtin' && part && part.three);
    if (!is3D) return;
    const key = ins.slotKey + ':' + ins.inst;
    const color = state.color || rec.defaultColor;
    const sig = rec.id + '|' + color + '|' + (rec.assetUrl || '');
    let o = layer.objs.get(key);
    if (!o || o.sig !== sig) {
      if (o) { scene.remove(o.outer); dispose3D(o.outer); }
      const model = buildModel(layer, rec, part, color);
      if (!model) return;                       // still loading, try again next frame
      const outer = new T.Group(), inner = new T.Group();
      inner.add(model); outer.add(inner); scene.add(outer);
      o = { sig, outer, inner, model };
      layer.objs.set(key, o);
    }
    used.add(key);

    const tr = resolveTransform(rec, state, f);
    o.outer.visible = tr.visible;
    if (!tr.visible) return;

    o.outer.position.set(ins.anchor.x, -ins.anchor.y, -(ins.anchor.z || 0));   // stuck to the face point
    if (rec.followHeadTurn) {
      o.outer.quaternion.copy(q);                                             // turned with the head
    } else {
      o.outer.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), -view.faceM.angle);
    }
    o.outer.scale.set(S * ins.sx, S, S);                                      // sized to the face (mirrored on the left)
    o.inner.position.set(tr.x, -tr.y, tr.z);                                  // record offset + the user's drag
    o.inner.rotation.set(tr.rot.x, tr.rot.y, tr.rot.z);
    o.inner.scale.set(tr.sx, tr.sy, tr.sx);
    f.sx = ins.sx;
    if (o.model.userData && o.model.userData.update) o.model.userData.update(f);
    if (tr.opacity < 1) {
      o.model.traverse(n => {
        if (!n.material) return;
        for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
          if (m) { m.transparent = true; m.opacity = tr.opacity; }
        }
      });
    }
  });

  for (const [key, o] of layer.objs) if (!used.has(key)) { scene.remove(o.outer); dispose3D(o.outer); layer.objs.delete(key); }
  if (!used.size) return false;

  // The invisible head shape, fitted to the whole skull rather than just the
  // face. It used to be a small sphere centred at ear level, whose top barely
  // reached the forehead — so a crown or a hat brim that should pass BEHIND
  // the head was never hidden, and drew straight across it.
  //
  // The tracker gives no point for the crown of the skull (landmark 10 is the
  // hairline), so the head is built from the chin up: its height comes from
  // chin → hairline, extended to allow for the skull above.
  const P = i => new T.Vector3(view.pts[i].x, -view.pts[i].y, -(view.pts[i].z || 0));
  const chin = P(152), brow = P(10);
  const up = brow.clone().sub(chin);
  const faceH = up.length() || S;
  up.normalize();
  const halfH = faceH * HEAD.height;              // chin → top of the skull, halved
  const center = chin.clone().addScaledVector(up, halfH)
    .add(new T.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(S * HEAD.back));
  layer.occluder.position.copy(center);
  layer.occluder.quaternion.copy(q);
  layer.occluder.scale.set(S * HEAD.width, halfH, S * HEAD.depth);

  renderer.render(scene, camera);
  return true;
}

// ---------------------------------------------------------------------
//  Tray pictures for 3D parts: a little 3/4-view render.
// ---------------------------------------------------------------------
const thumbCache = new Map();
export function clearThumbCache() { thumbCache.clear(); }

export function thumb3D(layer, rec, part, color, px = 60) {
  const d = Math.min(3, window.devicePixelRatio || 1), size = Math.round(px * d);
  const out = document.createElement('canvas'); out.width = out.height = size;
  const g2 = out.getContext('2d');
  if (!layer) {
    g2.fillStyle = 'rgba(255,255,255,.55)'; g2.font = `700 ${13 * d}px system-ui, sans-serif`;
    g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('3D…', size / 2, size / 2);
    return out;
  }
  const key = rec.id + '|' + color + '|' + size;
  if (!thumbCache.has(key)) {
    const model = buildModel(layer, rec, part, color);
    if (!model) {                                     // GLB still downloading
      g2.fillStyle = 'rgba(255,255,255,.55)'; g2.font = `700 ${13 * d}px system-ui, sans-serif`;
      g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('3D…', size / 2, size / 2);
      return out;
    }
    const { renderer, scene, camera } = layer.thumb;
    const holder = new T.Group();
    const f = { gap: .12, w: .38, t: 0, brow: .6, blink: 0, swing: 0, bounce: 0, sx: 1 };
    const add = (sx, x) => {
      const wrap = new T.Group(), m = sx === 1 && x === 0 ? model : buildModel(layer, rec, part, color);
      if (!m) return;
      wrap.position.x = x; wrap.scale.x = sx; wrap.add(m);
      if (m.userData && m.userData.update) m.userData.update(f);
      holder.add(wrap);
    };
    if (rec.anchor.mode === 'side' || rec.mirror) { add(1, .5); add(-1, -.5); } else add(1, 0);
    holder.rotation.set(.15, -.5, 0);
    scene.add(holder); holder.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(holder), c = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
    const half = Math.max(sz.x, sz.y, .05) * .58;
    camera.left = c.x - half; camera.right = c.x + half; camera.top = c.y + half; camera.bottom = c.y - half;
    camera.updateProjectionMatrix();
    renderer.setSize(size, size, false);
    renderer.render(scene, camera);
    const img = document.createElement('canvas'); img.width = img.height = size;
    img.getContext('2d').drawImage(renderer.domElement, 0, 0);
    thumbCache.set(key, img);
    scene.remove(holder); dispose3D(holder);
  }
  g2.drawImage(thumbCache.get(key), 0, 0);
  return out;
}

export const is3DRecord = (rec, part) => rec.type === 'glb' || (rec.type === 'builtin' && part && part.three);
