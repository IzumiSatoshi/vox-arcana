import * as THREE from 'three';
import { mulberry32, TAU } from './util.js';

const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ✦☽☉♄♃♂♀☿';
const cache = new Map();

// Two layers: 'outer' (rings + rune bands) and 'inner' (star polygon, sigils) so they can counter-rotate.
function drawLayer(seed, tier, layer) {
  const key = seed + ':' + tier + ':' + layer;
  if (cache.has(key)) return cache.get(key);
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), R = S / 2, rng = mulberry32(seed + (layer === 'inner' ? 991 : 0));
  g.translate(R, R);
  g.strokeStyle = g.fillStyle = 'white'; g.shadowColor = 'white'; g.shadowBlur = 8; g.lineCap = 'round';
  const circle = (r, w = 3) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };
  const runeRing = (r, size, count) => {
    g.font = `${size}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU; g.save(); g.rotate(a); g.translate(0, -r); g.fillText(RUNES[Math.floor(rng() * RUNES.length)], 0, 0); g.restore();
    }
  };
  if (layer === 'outer') {
    circle(R - 8, 5); circle(R - 20, 2);
    if (tier >= 2) { runeRing(R - 38, 24, 22 + tier * 2); circle(R - 56, 2); }
    if (tier >= 5) { circle(R - 64, 1.5); for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; g.lineWidth = 2; g.beginPath(); g.moveTo(Math.cos(a) * (R - 64), Math.sin(a) * (R - 64)); g.lineTo(Math.cos(a) * (R - 72), Math.sin(a) * (R - 72)); g.stroke(); } }
    if (tier >= 7) { runeRing(R - 90, 18, 30); circle(R - 104, 2); }
    const dots = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < dots; i++) { const a = (i / dots) * TAU; g.beginPath(); g.arc(Math.cos(a) * (R - 14), Math.sin(a) * (R - 14), 7, 0, TAU); g.fill(); }
  } else {
    const n = 3 + ((seed >>> 3) % 5) + (tier >= 6 ? 2 : 0);
    const k = n >= 5 ? 2 : 1;
    const rr = R * (tier >= 7 ? 0.58 : 0.7);
    g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= n; i++) { const a = ((i * k) / n) * TAU - Math.PI / 2; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    if (n % 2 === 0 || tier >= 4) { g.beginPath(); for (let i = 0; i <= n; i++) { const a = (i / n) * TAU - Math.PI / 2 + Math.PI / n; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    circle(rr, 2.5);
    if (tier >= 3) for (let i = 0; i < n; i++) { const a = (i / n) * TAU - Math.PI / 2; g.save(); g.translate(Math.cos(a) * rr, Math.sin(a) * rr); circle(18 + tier, 2); g.font = '20px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(RUNES[Math.floor(rng() * RUNES.length)], 0, 0); g.restore(); }
    circle(rr * 0.42, 2);
    if (tier >= 4) runeRing(rr * 0.55, 16, 12 + tier);
    if (tier >= 8) for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Math.cos(a) * rr * 0.42, Math.sin(a) * rr * 0.42); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); g.stroke(); }
    g.font = `${60 + tier * 4}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(RUNES[Math.floor(rng() * RUNES.length)], 0, 4);
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  cache.set(key, tex);
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
