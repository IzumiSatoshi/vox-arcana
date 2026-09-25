import * as THREE from 'three';
import { paintLayer, CIRCLE_SIZE } from './circlePaint.js';

const cache = new Map();

// Painting a layer is cheap to record but rasterising its blurred rune text costs ~10 ms, and it used to land on the
// cast frame (6-8 layers for a high-tier cast). A worker paints on an OffscreenCanvas and hands back a bitmap, already
// flipped the way WebGL's UNPACK_FLIP_Y would. Until it arrives the texture samples black, which the additive circle
// shows as nothing while its fade-in has barely started. Without worker support it paints here as before.
let worker = null;
const pending = new Map();
try {
  worker = new Worker(new URL('./circleWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: { key, bitmap } }) => {
    const tex = pending.get(key); pending.delete(key);
    if (tex && bitmap) { tex.image = bitmap; tex.needsUpdate = true; }
  };
  worker.onerror = () => { worker = null; for (const [k, t] of pending) paintHere(k, t); pending.clear(); };
} catch { worker = null; }
function paintHere(key, tex) {
  const [seed, tier, layer] = key.split(':');
  const cv = document.createElement('canvas'); cv.width = cv.height = CIRCLE_SIZE;
  paintLayer(cv, +seed, +tier, layer);
  tex.image = cv; tex.flipY = true; tex.needsUpdate = true;
}

function drawLayer(seed, tier, layer) {
  const key = seed + ':' + tier + ':' + layer;
  if (cache.has(key)) return cache.get(key);
  const tex = new THREE.Texture(); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.flipY = false;
  if (worker) { pending.set(key, tex); worker.postMessage({ key, seed, tier, layer }); } else paintHere(key, tex);
  cache.set(key, tex);
  // every incantation has its own seed: keep the recent ones, free the GPU copies of the rest (a texture still on
  // screen just re-uploads from its image)
  if (cache.size > 48) { const [k, old] = cache.entries().next().value; cache.delete(k); old.dispose(); }
  return tex;
}

const planeGeo = new THREE.PlaneGeometry(1, 1);
export class MagicCircle {
  constructor({ seed = 1, tier = 3, color = 0xffffff, radius = 1, intensity = 2.2 } = {}) {
    this.group = new THREE.Group();
    const mk = (layer) => {
      const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: drawLayer(seed, tier, layer), color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0, fog: false }));
      m.scale.setScalar(radius * 2); this.group.add(m); return m;
    };
    this.outer = mk('outer'); this.inner = mk('inner');
    this.inner.position.z = 0.01;
    this.spin = 0.4 + tier * 0.12; this.opacity = 0; this.target = 1; this.radius = radius;
  }
  setColor(c, intensity = 2.2) { for (const m of [this.outer, this.inner]) m.material.color.set(c).multiplyScalar(intensity); }
  update(dt) {
    this.outer.rotation.z += this.spin * dt; this.inner.rotation.z -= this.spin * 1.6 * dt;
    this.opacity += (this.target - this.opacity) * Math.min(1, dt * 8);
    this.outer.material.opacity = this.inner.material.opacity = this.opacity;
  }
  dispose() { this.group.parent?.remove(this.group); this.outer.material.dispose(); this.inner.material.dispose(); }
}
