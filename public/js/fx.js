import * as THREE from 'three';
import { energyMaterial, ringMaterial, ribbonMaterial, blastMaterial, distortRingMaterial, distortHazeMaterial } from './shaders.js';
import { ELEMENTS, paletteFor } from './elements.js';
import { rand, clamp, TAU, mulberry32 } from './util.js';

// Particle render styles
export const ST = { GLOW: 0, FLAME: 1, SMOKE: 2, CRISP: 3 };

// ------------------------------------------------------------ procedural sprite atlas (4x2 cells)
function makeAtlas() {
  const C = 128, cv = document.createElement('canvas'); cv.width = C * 4; cv.height = C * 2;
  const g = cv.getContext('2d');
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * C, Math.floor(i / 4) * C); fn(g); g.restore(); };
  const radial = (stops, r = 64) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, r); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  // 0 soft round (also the erosion mask for flames/smoke)
  cell(0, () => { g.fillStyle = radial([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.85)'], [0.7, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, C, C); });
  // 1 four-point star
  cell(1, () => {
    g.fillStyle = radial([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,255,255,0.7)'], [0.35, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, C, C);
    g.fillStyle = '#fff';
    for (const r of [0, Math.PI / 2]) { g.save(); g.translate(64, 64); g.rotate(r); g.beginPath(); g.moveTo(0, -62); g.quadraticCurveTo(5, 0, 0, 62); g.quadraticCurveTo(-5, 0, 0, -62); g.fill(); g.restore(); }
  });
  // 2 lumpy cloud mask
  cell(2, () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 9; i++) { const a = rng() * TAU, d = rng() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 22 + rng() * 18; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, C, C); }
  });
  // 3 flame tongue
  cell(3, () => {
    const gr = g.createRadialGradient(64, 86, 0, 64, 74, 60); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0.1)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(64, 2); g.bezierCurveTo(98, 42, 116, 92, 64, 124); g.bezierCurveTo(12, 92, 30, 42, 64, 2); g.fill();
  });
  // 4 shard
  cell(4, () => {
    const gr = g.createLinearGradient(40, 0, 88, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.6)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(64, 4); g.lineTo(86, 60); g.lineTo(64, 124); g.lineTo(42, 60); g.closePath(); g.fill();
  });
  // 5 leaf / petal
  cell(5, () => {
    g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.moveTo(64, 8); g.quadraticCurveTo(118, 64, 64, 120); g.quadraticCurveTo(10, 64, 64, 8); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 16); g.lineTo(64, 112); g.stroke();
  });
  // 6 wind streak (crescent)
  cell(6, () => { g.strokeStyle = 'rgba(255,255,255,1)'; g.lineCap = 'round'; g.lineWidth = 10; g.beginPath(); g.arc(64, 90, 52, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.lineWidth = 4; g.beginPath(); g.arc(64, 100, 40, Math.PI * 1.2, Math.PI * 1.7); g.stroke(); });
  // 7 rune glyph
  cell(7, () => {
    g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(64, 14); g.lineTo(64, 114); g.moveTo(64, 40); g.lineTo(100, 20); g.moveTo(64, 64); g.lineTo(28, 44); g.moveTo(64, 88); g.lineTo(96, 104); g.stroke();
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeNoiseTex() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S);
  const rng = mulberry32(11), grid = [];
  const oct = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]];
  for (const [n] of oct) { const a = []; for (let i = 0; i < n * n; i++) a.push(rng()); grid.push(a); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    oct.forEach(([n, w], k) => {
      const fx = (x / S) * n, fy = (y / S) * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i, j) => grid[k][((j % n) * n + (i % n))];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      v += w * (at(x0, y0) * (1 - sx) * (1 - sy) + at(x0 + 1, y0) * sx * (1 - sy) + at(x0, y0 + 1) * (1 - sx) * sy + at(x0 + 1, y0 + 1) * sx * sy);
    });
    const o = (y * S + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.min(255, v * 255); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------ particle pool
class ParticlePool {
  constructor(max, atlas, noise, blending) {
    this.max = max; this.n = 0; this.additive = blending === THREE.AdditiveBlending;
    const F = (k) => new Float32Array(max * k);
    this.pos = F(3); this.col = F(4); this.size = F(1); this.frame = F(1); this.rot = F(1); this.life01 = F(1); this.style = F(1); this.seed = F(1);
    this.vel = F(3); this.life = F(1); this.maxLife = F(1); this.s0 = F(1); this.s1 = F(1); this.c0 = F(3); this.c1 = F(3); this.a0 = F(1);
    this.drag = F(1); this.grav = F(1); this.spin = F(1); this.turb = F(1);
    const geo = new THREE.BufferGeometry();
    const at = (arr, k, name) => { const a = new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
    this.attrs = [at(this.pos, 3, 'position'), at(this.col, 4, 'aColor'), at(this.size, 1, 'aSize'), at(this.frame, 1, 'aFrame'), at(this.rot, 1, 'aRot'), at(this.life01, 1, 'aLife'), at(this.style, 1, 'aStyle'), at(this.seed, 1, 'aSeed')];
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uScale: { value: 500 }, uAtlas: { value: atlas }, uNoise: { value: noise } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aSize, aFrame, aRot, aLife, aStyle, aSeed; attribute vec4 aColor;
        uniform float uScale; varying vec4 vColor; varying float vFrame, vRot, vLife, vStyle, vSeed;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=min(aSize*uScale/max(-mv.z,0.1),1100.0); gl_Position=projectionMatrix*mv;
          vColor=aColor; vFrame=aFrame; vRot=aRot; vLife=aLife; vStyle=aStyle; vSeed=aSeed; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas, uNoise; varying vec4 vColor; varying float vFrame, vRot, vLife, vStyle, vSeed;
        void main(){
          vec2 p=gl_PointCoord-0.5; float c=cos(vRot), s=sin(vRot); vec2 q=mat2(c,-s,s,c)*p*1.18; p=q+0.5;
          if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) discard;
          float fx=mod(vFrame,4.0), fy=floor(vFrame/4.0);
          vec4 t=texture2D(uAtlas, vec2((fx+p.x)/4.0, 1.0-(fy+p.y)/2.0));
          float m=t.a; vec3 col; float a;
          if(vStyle<0.5){ a=m*vColor.a; col=vColor.rgb*t.rgb; }
          else if(vStyle<1.5){ // stylized flame: eroding noise, white-hot core, hard edge
            float n=texture2D(uNoise, p*0.55+vec2(vSeed, vSeed*1.7-vLife*0.7)).r;
            float mm=m*(0.45+0.9*n); float th=0.12+vLife*0.8;
            a=smoothstep(th,th+0.05,mm)*vColor.a;
            float heat=smoothstep(th+0.12,th+0.5,mm);
            col=mix(vColor.rgb, vec3(1.0,0.96,0.82)*1.8, heat*(1.0-vLife*0.6));
          } else if(vStyle<2.5){ // toon smoke: two-tone lit puff with an ink rim, eroding
            float n=texture2D(uNoise, p*0.5+vec2(vSeed, vSeed*0.6)).r;
            float mm=m*(0.5+0.75*n); float th=0.18+vLife*0.72;
            float body=smoothstep(th,th+0.025,mm);
            vec2 d=(p-0.5)*2.0; vec3 nrm=normalize(vec3(d, sqrt(max(0.0,1.0-dot(d,d)))));
            float l=dot(nrm, normalize(vec3(-0.35,0.75,0.55)))+(n-0.5)*0.7;
            col=mix(vColor.rgb*0.58, vColor.rgb*1.08, smoothstep(0.12,0.2,l));
            col*=1.0-(1.0-smoothstep(th,th+0.1,mm))*0.45;
            a=body*vColor.a;
          } else { a=smoothstep(0.3,0.55,m)*vColor.a; col=vColor.rgb*t.rgb; }
          if(a<0.01) discard;
          gl_FragColor=vec4(col, a);
        }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = this.additive ? 10 : 5;
  }
  emit(o) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.s0[i] = o.size || 1; this.s1[i] = o.size1 ?? this.s0[i];
    const c = o.color, c1 = o.color1 || c;
    this.c0[i3] = c.r; this.c0[i3 + 1] = c.g; this.c0[i3 + 2] = c.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.a0[i] = o.alpha ?? 1; this.drag[i] = o.drag ?? 1; this.grav[i] = o.grav ?? 0; this.turb[i] = o.turb ?? 0;
    this.frame[i] = o.frame ?? 0; this.rot[i] = o.rot ?? Math.random() * TAU; this.spin[i] = o.spin ?? 0;
    this.style[i] = o.style ?? 0; this.seed[i] = Math.random();
    this.size[i] = 0; this.col[i * 4 + 3] = 0; this.life01[i] = 0;
  }
  swap(i, j) {
    const i3 = i * 3, j3 = j * 3;
    for (let k = 0; k < 3; k++) { this.pos[i3 + k] = this.pos[j3 + k]; this.vel[i3 + k] = this.vel[j3 + k]; this.c0[i3 + k] = this.c0[j3 + k]; this.c1[i3 + k] = this.c1[j3 + k]; }
    for (const a of [this.life, this.maxLife, this.s0, this.s1, this.a0, this.drag, this.grav, this.turb, this.frame, this.rot, this.spin, this.style, this.seed]) a[i] = a[j];
  }
  update(dt, attractors) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.n--; if (i !== this.n) this.swap(i, this.n); continue; }
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      let vx = this.vel[i3] * dr, vy = this.vel[i3 + 1] * dr - this.grav[i] * dt, vz = this.vel[i3 + 2] * dr;
      const tb = this.turb[i];
      if (tb) { vx += (Math.random() - 0.5) * tb * dt * 10; vy += (Math.random() - 0.5) * tb * dt * 10; vz += (Math.random() - 0.5) * tb * dt * 10; }
      for (const a of attractors) {
        const dx = a.x - this.pos[i3], dy = a.y - this.pos[i3 + 1], dz = a.z - this.pos[i3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < a.r2 && d2 > 0.01) { const f = (a.k * dt) / Math.sqrt(d2); vx += dx * f - dz * f * a.swirl; vy += dy * f; vz += dz * f + dx * f * a.swirl; }
      }
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.pos[i3] += vx * dt; this.pos[i3 + 1] += vy * dt; this.pos[i3 + 2] += vz * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.life01[i] = t;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
      const i4 = i * 4;
      this.col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      // eroding styles dissolve by themselves; glow styles fade
      this.col[i4 + 3] = this.a0[i] * Math.min(1, t * 14) * (this.style[i] === 1 || this.style[i] === 2 ? 1 : Math.pow(1 - t, 0.9));
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
  }
}

// ------------------------------------------------------------ spark streaks
class SparkPool {
  constructor(max) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.ml = new Float32Array(max);
    this.c = new Float32Array(max * 3); this.grav = new Float32Array(max); this.len = new Float32Array(max);
    this.vpos = new Float32Array(max * 6); this.vcol = new Float32Array(max * 8);
    const geo = new THREE.BufferGeometry();
    this.aP = new THREE.BufferAttribute(this.vpos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.BufferAttribute(this.vcol, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aP); geo.setAttribute('aColor', this.aC);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 aColor; varying vec4 vC; void main(){ vC=aColor; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying vec4 vC; void main(){ gl_FragColor=vec4(vC.rgb*vC.a*3.5, vC.a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(geo, mat); this.lines.frustumCulled = false; this.lines.renderOrder = 11;
  }
  emit(x, y, z, vx, vy, vz, life, color, grav = 9, len = 0.04) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z; this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.life[i] = this.ml[i] = life; this.c[i3] = color.r; this.c[i3 + 1] = color.g; this.c[i3 + 2] = color.b; this.grav[i] = grav; this.len[i] = len;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.n--;
        if (i !== this.n) {
          const a = i * 3, b = this.n * 3;
          for (let k = 0; k < 3; k++) { this.p[a + k] = this.p[b + k]; this.v[a + k] = this.v[b + k]; this.c[a + k] = this.c[b + k]; }
          this.life[i] = this.life[this.n]; this.ml[i] = this.ml[this.n]; this.grav[i] = this.grav[this.n]; this.len[i] = this.len[this.n];
        }
        continue;
      }
      const i3 = i * 3;
      this.v[i3] *= 1 - 1.5 * dt; this.v[i3 + 2] *= 1 - 1.5 * dt; this.v[i3 + 1] = this.v[i3 + 1] * (1 - 1.5 * dt) - this.grav[i] * dt;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      const L = this.len[i], o = i * 6, q = i * 8, a = this.life[i] / this.ml[i];
      this.vpos[o] = this.p[i3]; this.vpos[o + 1] = this.p[i3 + 1]; this.vpos[o + 2] = this.p[i3 + 2];
      this.vpos[o + 3] = this.p[i3] - this.v[i3] * L; this.vpos[o + 4] = this.p[i3 + 1] - this.v[i3 + 1] * L; this.vpos[o + 5] = this.p[i3 + 2] - this.v[i3 + 2] * L;
      for (let k = 0; k < 2; k++) { this.vcol[q + k * 4] = this.c[i3]; this.vcol[q + k * 4 + 1] = this.c[i3 + 1]; this.vcol[q + k * 4 + 2] = this.c[i3 + 2]; }
      this.vcol[q + 3] = a; this.vcol[q + 7] = 0;
      i++;
    }
    this.lines.geometry.setDrawRange(0, this.n * 2);
    for (const at of [this.aP, this.aC]) { at.clearUpdateRanges(); at.addUpdateRange(0, this.n * 2 * at.itemSize); at.needsUpdate = true; }
  }
}

// ------------------------------------------------------------ camera-facing ribbon
const _t = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
export class Ribbon {
  constructor(max, material) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(max * 6);
    const tArr = new Float32Array(max * 2), sArr = new Float32Array(max * 2), idx = [];
    for (let i = 0; i < max; i++) { sArr[i * 2] = 1; sArr[i * 2 + 1] = -1; }
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.aPos = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.aT = new THREE.BufferAttribute(tArr, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('aT', this.aT); geo.setAttribute('aSide', new THREE.BufferAttribute(sArr, 1));
    geo.setIndex(idx); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(geo, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 12;
  }
  set(pts, width, camPos, tFn) {
    const n = Math.min(pts.length, this.max);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], p = pts[i];
      _t.subVectors(b, a); _c.subVectors(camPos, p);
      _s.crossVectors(_t, _c).normalize();
      const t = tFn ? tFn(i, n) : i / Math.max(1, n - 1);
      const w = typeof width === 'function' ? width(t, i) : width;
      const o = i * 6;
      this.posArr[o] = p.x + _s.x * w; this.posArr[o + 1] = p.y + _s.y * w; this.posArr[o + 2] = p.z + _s.z * w;
      this.posArr[o + 3] = p.x - _s.x * w; this.posArr[o + 4] = p.y - _s.y * w; this.posArr[o + 5] = p.z - _s.z * w;
      this.aT.array[i * 2] = this.aT.array[i * 2 + 1] = t;
    }
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.aPos.needsUpdate = true; this.aT.needsUpdate = true;
  }
}

export function boltPoints(a, b, jag = 0.25, depth = 5) {
  let pts = [a.clone(), b.clone()];
  let off = a.distanceTo(b) * jag;
  for (let d = 0; d < depth; d++) {
    const np = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().lerp(pts[i + 1], 0.5);
      m.x += rand(-off, off); m.y += rand(-off, off); m.z += rand(-off, off);
      np.push(m, pts[i + 1]);
    }
    pts = np; off *= 0.5;
  }
  return pts;
}

// ------------------------------------------------------------ pooled dynamic point lights
class LightPool {
  constructor(scene, n = 8) {
    this.lights = [];
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffffff, 0, 20, 2); scene.add(l); this.lights.push(l); }
    this.req = [];
  }
  // spell code speaks in "artistic" intensities; scale + cap so stacked impacts never white out the frame
  request(pos, color, intensity, range) { this.req.push({ pos, color, intensity: Math.min(220, intensity * 0.22), range }); }
  flush() {
    this.req.sort((a, b) => b.intensity - a.intensity);
    this.lights.forEach((l, i) => {
      const r = this.req[i];
      if (r) { l.position.copy(r.pos); l.color.copy(r.color); l.intensity = r.intensity; l.distance = r.range; }
      else l.intensity = 0;
    });
    this.req.length = 0;
  }
}

const SMOKE_COL = { poison: 0x6a8a1a, fire: 0x3b3330, ice: 0xe4f6ff, water: 0xd8ecff, lightning: 0x4a3a66, wind: 0xe6fff6, earth: 0x8a7458, darkness: 0x16061f, light: 0xfff6dc, nature: 0x6a7a4a, arcane: 0x5a2a4a };
const LIGHT_SMOKE = { ice: 1, water: 1, wind: 1, light: 1 };

// ------------------------------------------------------------ the FX system
export class FX {
  constructor(scene, camera, world) {
    this.scene = scene; this.camera = camera; this.world = world;
    this.atlas = makeAtlas(); this.noise = makeNoiseTex();
    this.glow = new ParticlePool(26000, this.atlas, this.noise, THREE.AdditiveBlending);
    this.smoke = new ParticlePool(12000, this.atlas, this.noise, THREE.NormalBlending);
    this.sparks = new SparkPool(6000);
    scene.add(this.glow.points, this.smoke.points, this.sparks.lines);
    this.lights = new LightPool(scene, 5);
    this.items = [];
    this.attractors = [];
    this.shake = 0;
    this.quality = 1;
    this.sphereGeo = new THREE.IcosahedronGeometry(1, 4);
    this.blastGeo = new THREE.IcosahedronGeometry(1, 5);
    this.planeGeo = new THREE.PlaneGeometry(2, 2);
    this.decalTex = this.makeDecalTex(); this.crackTex = this.makeCrackTex();
    this.decals = [];
    this.distortScene = new THREE.Scene(); // rendered to an offset buffer by the post pass
  }
  setScale(h, fov) { const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)); this.glow.uniforms.uScale.value = s; this.smoke.uniforms.uScale.value = s; }
  add(item) { this.items.push(item); return item; }
  addShake(amount, pos) {
    let a = amount;
    if (pos) a *= clamp(1.2 - this.camera.position.distanceTo(pos) / 60, 0, 1);
    this.shake = Math.min(1.2, this.shake + a);
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) if (!this.items[i](dt)) this.items.splice(i, 1);
    this.glow.update(dt, this.attractors); this.smoke.update(dt, this.attractors); this.sparks.update(dt);
    this.attractors.length = 0;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]; d.t -= dt;
      d.mesh.material.opacity = clamp(d.t / 4) * d.a;
      if (d.glow) d.glow.material.opacity = clamp((d.t - d.life + 3.5) / 3.5) * 0.9;
      if (d.t <= 0) { this.scene.remove(d.mesh); d.mesh.material.dispose(); if (d.glow) { this.scene.remove(d.glow); d.glow.material.dispose(); } this.decals.splice(i, 1); }
    }
    this.lights.flush();
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }

  // ---- element-flavoured emission
  flame(pos, { color, size = 0.6, life = 0.7, vel = null, rise = 2.5, frame = 3, spread = 0.6 } = {}) {
    const v = vel || new THREE.Vector3();
    this.glow.emit({ x: pos.x + rand(-spread, spread) * size * 0.3, y: pos.y, z: pos.z + rand(-spread, spread) * size * 0.3, vx: v.x + rand(-0.5, 0.5), vy: v.y + rise * rand(0.6, 1.2), vz: v.z + rand(-0.5, 0.5), life: life * rand(0.7, 1.2), size: size * rand(0.8, 1.2), size1: size * 0.55, color: color, color1: color, alpha: 1, drag: 1.2, grav: -1, frame, rot: rand(-0.3, 0.3), spin: rand(-0.6, 0.6), style: ST.FLAME });
  }
  puff(pos, { color, size = 1, size1 = null, life = 1.6, vel = null, alpha = 0.95, rise = 0.8, drag = 1.6 } = {}) {
    const v = vel || new THREE.Vector3(rand(-0.4, 0.4), rise, rand(-0.4, 0.4));
    this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: v.x, vy: v.y, vz: v.z, life: life * rand(0.8, 1.2), size: size * rand(0.8, 1.2), size1: size1 ?? size * 1.9, color, color1: color, alpha, drag, grav: -0.3, frame: Math.random() < 0.5 ? 2 : 0, spin: rand(-0.4, 0.4), style: ST.SMOKE });
  }
  element(el, pos, { count = 10, speed = 3, size = 0.5, palette, life = 0.8, dir = null, spread = 1, scale = 1 } = {}) {
    const E = ELEMENTS[el] || ELEMENTS.arcane, P = E.particle, pal = palette || paletteFor(el);
    count = Math.ceil(count * this.quality);
    for (let i = 0; i < count; i++) {
      const v = dir ? dir.clone().multiplyScalar(speed) : new THREE.Vector3();
      v.x += rand(-1, 1) * speed * spread; v.y += rand(-1, 1) * speed * spread + P.rise; v.z += rand(-1, 1) * speed * spread;
      const p = { x: pos.x + rand(-0.2, 0.2) * scale, y: pos.y + rand(-0.2, 0.2) * scale, z: pos.z + rand(-0.2, 0.2) * scale };
      if (el === 'fire' || (el === 'darkness' && Math.random() < 0.5)) {
        this.flame(p, { color: el === 'fire' ? pal.color : pal.color, size: size * 1.4 * scale, life: life * 0.9, vel: v, rise: P.rise * 0.6 });
        continue;
      }
      const hot = Math.random() < 0.35;
      const crisp = el === 'ice' || el === 'earth' || el === 'nature' || el === 'wind' || el === 'arcane' || el === 'light' || el === 'poison';
      this.glow.emit({
        ...p, vx: v.x, vy: v.y, vz: v.z, life: life * rand(0.6, 1.3), size: size * rand(0.6, 1.4) * scale * (crisp ? 0.8 : 1), size1: size * (crisp ? 0.2 : 1.4) * scale,
        color: hot ? pal.core : pal.color, color1: pal.color, alpha: 0.95, drag: P.drag, grav: P.grav,
        frame: Math.random() < 0.7 ? P.shape : 0, spin: rand(-3, 3), turb: P.jitter ? 4 : P.swirl ? 1 : 0.3, style: crisp ? ST.CRISP : ST.GLOW,
      });
    }
    if (P.smoke > 0 && Math.random() < P.smoke * this.quality * 0.8) {
      this.puff(pos, { color: new THREE.Color(SMOKE_COL[el] ?? 0x333333), size: size * 1.4 * scale, life: rand(0.9, 1.6), alpha: LIGHT_SMOKE[el] ? 0.5 : 0.85 });
    }
    if (P.spark > 0 && Math.random() < P.spark * 0.6 * this.quality) {
      const s = speed * 2 + 4;
      this.sparks.emit(pos.x, pos.y, pos.z, rand(-s, s), rand(-s * 0.5, s), rand(-s, s), rand(0.2, 0.6), pal.core, el === 'lightning' ? 0 : 9, 0.03);
    }
  }
  flash(pos, color, radius, dur = 0.25, intensity = 4) {
    const m = new THREE.Mesh(this.sphereGeo, energyMaterial({ color, core: 0xffffff, intensity, noiseAmp: 0.25, noiseFreq: 1.5, flow: 3 }));
    m.position.copy(pos); m.scale.setScalar(radius * 0.3); this.scene.add(m);
    let t = 0;
    const col = new THREE.Color(color);
    this.add((dt) => {
      t += dt; const k = t / dur;
      m.scale.setScalar(radius * (0.3 + 0.7 * Math.pow(k, 0.4)));
      m.material.uniforms.uOpacity.value = Math.max(0, 1 - k);
      this.lights.request(pos, col, 400 * radius * (1 - k), radius * 6);
      if (k >= 1) { this.scene.remove(m); m.material.dispose(); return false; }
      return true;
    });
  }
  ring(pos, color, radius, dur = 0.5, normal = null, thickness = 0.12) {
    const m = new THREE.Mesh(this.planeGeo, ringMaterial({ color, thickness }));
    m.position.copy(pos);
    if (normal) m.lookAt(pos.clone().add(normal)); else m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(radius); this.scene.add(m);
    let t = 0;
    this.add((dt) => {
      t += dt; const k = t / dur;
      m.material.uniforms.uProg.value = Math.pow(k, 0.5) * 0.95;
      m.material.uniforms.uAlpha.value = 1 - k;
      if (k >= 1) { this.scene.remove(m); m.material.dispose(); return false; }
      return true;
    });
  }
  // screen-space shockwave (refraction) — billboard facing the camera
  shockwave(pos, radius, strength = 1, dur = 0.5) {
    const m = new THREE.Mesh(this.planeGeo, distortRingMaterial());
    m.position.copy(pos); m.scale.setScalar(radius); m.material.uniforms.uStrength.value = strength;
    this.distortScene.add(m);
    let t = 0;
    this.add((dt) => {
      t += dt; const k = t / dur;
      m.quaternion.copy(this.camera.quaternion);
      m.material.uniforms.uProg.value = Math.pow(k, 0.6);
      if (k >= 1) { this.distortScene.remove(m); m.material.dispose(); return false; }
      return true;
    });
  }
  haze(getPos, size, strength = 1, dur = 1) {
    const m = new THREE.Mesh(this.planeGeo, distortHazeMaterial());
    m.scale.setScalar(size); this.distortScene.add(m);
    let t = 0;
    const h = { alive: true, strength };
    this.add((dt) => {
      t += dt;
      const p = typeof getPos === 'function' ? getPos() : getPos;
      if (p) m.position.copy(p);
      m.quaternion.copy(this.camera.quaternion);
      m.material.uniforms.uStrength.value = h.strength * clamp(t / 0.2) * (dur > 0 ? clamp((dur - t) / 0.4) : 1);
      if ((dur > 0 && t >= dur) || !h.alive) { this.distortScene.remove(m); m.material.dispose(); return false; }
      return true;
    });
    return h;
  }
  // stylized mesh explosion (eroding banded fireball + lobes)
  blast(el, pos, radius, mag = 0.5, pal = null) {
    pal = pal || paletteFor(el);
    const hot = new THREE.Color(0xffffff).lerp(pal.core, 0.35);
    const mid = pal.core.clone().lerp(pal.color, 0.35);
    const cool = pal.color.clone();
    const smoke = new THREE.Color(SMOKE_COL[el] ?? 0x333333);
    if (el === 'fire') { cool.lerp(new THREE.Color(0xd8341a), 0.35); }
    const dur = 0.8 + mag * 0.9;
    const lobes = 3 + Math.floor(radius * 0.8);
    const meshes = [];
    for (let i = 0; i < Math.min(8, lobes); i++) {
      const m = new THREE.Mesh(this.blastGeo, blastMaterial({ hot, mid, cool, smoke, emissive: LIGHT_SMOKE[el] ? 1.3 : 2.2 }));
      const off = i === 0 ? new THREE.Vector3() : new THREE.Vector3(rand(-1, 1), rand(-0.2, 0.9), rand(-1, 1)).normalize().multiplyScalar(radius * rand(0.4, 0.75));
      m.userData = { off, s: i === 0 ? 1 : rand(0.45, 0.75), delay: i === 0 ? 0 : rand(0, 0.08), rise: rand(0.6, 1.4) };
      m.position.copy(pos); m.scale.setScalar(0.01); m.frustumCulled = false;
      this.scene.add(m); meshes.push(m);
    }
    let t = 0;
    this.add((dt) => {
      t += dt;
      let alive = false;
      for (const m of meshes) {
        const u = m.userData, k = clamp((t - u.delay) / dur);
        if (k < 1) alive = true;
        const grow = 1 - Math.pow(1 - clamp(k * 2.4), 3);
        m.scale.setScalar(Math.max(0.01, radius * u.s * (0.25 + 0.75 * grow) * (1 + k * 0.25)));
        m.position.copy(pos).addScaledVector(u.off, 0.3 + grow * 0.7);
        m.position.y += k * k * radius * 0.8 * u.rise;
        m.material.uniforms.uProg.value = k;
        m.visible = k < 1;
      }
      this.lights.request(pos, pal.color, 600 * radius * Math.max(0, 1 - t / (dur * 0.5)), radius * 7);
      if (!alive) { meshes.forEach((m) => { this.scene.remove(m); m.material.dispose(); }); return false; }
      return true;
    });
  }
  bolt(a, b, color, { width = 0.15, dur = 0.25, jag = 0.22, branches = 2, flicker = true } = {}) {
    const mk = () => [new Ribbon(40, ribbonMaterial({ color, intensity: 3, wisp: 0 })), new Ribbon(40, ribbonMaterial({ color: 0xffffff, core: 0xffffff, intensity: 3, wisp: 0 }))];
    const main = mk(); main.forEach((r) => this.scene.add(r.mesh));
    const brs = [];
    for (let i = 0; i < branches; i++) { const r = new Ribbon(20, ribbonMaterial({ color, intensity: 2, wisp: 0 })); this.scene.add(r.mesh); brs.push(r); }
    let t = 0, regen = 0, pts;
    const col = new THREE.Color(color);
    const build = () => {
      pts = boltPoints(a, b, jag, 5);
      const cam = this.camera.position;
      main[0].set(pts, width * 3, cam, () => 1); main[1].set(pts, width * 0.6, cam, () => 1);
      brs.forEach((r) => {
        const s = pts[Math.floor(rand(0.2, 0.8) * pts.length)];
        const e = s.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 0.3), rand(-1, 1)).multiplyScalar(a.distanceTo(b) * 0.25));
        r.set(boltPoints(s, e, 0.3, 4), width, cam, (i, n) => 1 - i / n);
      });
    };
    build();
    this.add((dt) => {
      t += dt; regen -= dt;
      if (flicker && regen <= 0) { build(); regen = 0.045; }
      const k = t / dur, al = (1 - k) * (flicker ? rand(0.6, 1) : 1);
      [...main, ...brs].forEach((r) => (r.mesh.material.uniforms.uAlpha.value = al));
      this.lights.request(pts[Math.floor(pts.length / 2)], col, 600 * (1 - k), 25);
      if (k >= 1) { [...main, ...brs].forEach((r) => { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }); return false; }
      return true;
    });
  }
  makeDecalTex() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    for (let i = 0; i < 40; i++) {
      const x = 64 + rand(-30, 30), y = 64 + rand(-30, 30), r = rand(10, 40);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(cv);
  }
  // radial branching cracks for glowing impact scars
  makeCrackTex() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    const rng = mulberry32(5);
    const branch = (x, y, a, len, w, depth) => {
      if (depth > 4 || len < 6) return;
      let cx = x, cy = y;
      g.lineWidth = w; g.beginPath(); g.moveTo(cx, cy);
      const steps = 5;
      for (let i = 0; i < steps; i++) { a += (rng() - 0.5) * 0.7; cx += Math.cos(a) * len / steps; cy += Math.sin(a) * len / steps; g.lineTo(cx, cy); }
      g.stroke();
      branch(cx, cy, a + (rng() - 0.5) * 0.9, len * 0.65, w * 0.65, depth + 1);
      if (rng() < 0.6) branch(cx, cy, a + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6), len * 0.5, w * 0.55, depth + 1);
    };
    for (let i = 0; i < 9; i++) branch(S / 2, S / 2, (i / 9) * TAU + rng() * 0.4, 40 + rng() * 30, 6, 0);
    const t = new THREE.CanvasTexture(cv); return t;
  }
  decal(pos, radius, el, glowColor = null) {
    if (this.decals.length > 28) { const d = this.decals.shift(); this.scene.remove(d.mesh); d.mesh.material.dispose(); if (d.glow) { this.scene.remove(d.glow); d.glow.material.dispose(); } }
    const colorMap = { fire: 0x120804, ice: 0xcff4ff, water: 0x0a2a55, lightning: 0x1a1030, earth: 0x3a2a18, darkness: 0x16001f, light: 0xfff6c8, nature: 0x1e4a10, wind: 0x3a4a3a, arcane: 0x401030, poison: 0x3a5a08 };
    const bright = el === 'ice' || el === 'light';
    const mat = new THREE.MeshBasicMaterial({ map: this.decalTex, color: colorMap[el] ?? 0x111111, transparent: true, depthWrite: false, opacity: bright ? 0.6 : 0.85, polygonOffset: true, polygonOffsetFactor: -4, blending: bright ? THREE.AdditiveBlending : THREE.NormalBlending });
    const m = new THREE.Mesh(this.planeGeo, mat);
    const y = this.world.heightAt(pos.x, pos.z);
    m.position.set(pos.x, y + 0.06, pos.z);
    const n = this.world.normalAt(pos.x, pos.z);
    m.lookAt(m.position.clone().add(n)); m.rotateZ(rand(0, TAU));
    m.scale.setScalar(radius);
    this.scene.add(m);
    let glow = null;
    if (glowColor) {
      glow = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({ map: this.crackTex, color: new THREE.Color(glowColor).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5 }));
      glow.position.copy(m.position).y += 0.01; glow.quaternion.copy(m.quaternion); glow.scale.setScalar(radius * 1.1);
      this.scene.add(glow);
    }
    this.decals.push({ mesh: m, glow, t: 14, life: 14, a: mat.opacity });
  }

  // ---- composite explosion, the workhorse of every impact
  explosion(el, pos, radius, mag = 0.5, pal = null, opts = {}) {
    pal = pal || paletteFor(el);
    const q = this.quality;
    const gy = this.world.heightAt(pos.x, pos.z);
    this.blast(el, pos, radius * 0.75, mag, pal);
    this.flash(pos, pal.core, radius * 0.5, 0.12, 3);
    this.ring(new THREE.Vector3(pos.x, gy + 0.15, pos.z), pal.color, radius * 1.7, 0.35 + mag * 0.4, null, 0.08);
    if (radius > 1.2) this.shockwave(pos, radius * 3.2, 0.6 + mag, 0.45 + mag * 0.2);
    // flame / element bits
    const n = Math.floor((14 + radius * 10) * q);
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize();
      const sp = rand(0.5, 1) * radius * 3.5;
      if (el === 'fire' || el === 'darkness') this.flame(pos, { color: pal.color, size: radius * rand(0.25, 0.5), life: rand(0.35, 0.8), vel: d.multiplyScalar(sp), rise: 1.5 });
      else this.glow.emit({ x: pos.x, y: pos.y, z: pos.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rand(0.4, 0.9) + mag * 0.3, size: radius * rand(0.12, 0.3), size1: radius * 0.05, color: Math.random() < 0.5 ? pal.core : pal.color, color1: pal.color, alpha: 1, drag: 2.5, grav: ELEMENTS[el]?.particle.grav ?? 0, frame: ELEMENTS[el]?.particle.shape ?? 0, spin: rand(-4, 4), style: ST.CRISP });
    }
    for (let i = 0; i < n * 0.9; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0, 1.3), rand(-1, 1)).normalize(), sp = rand(8, 24) * (0.5 + mag);
      this.sparks.emit(pos.x, pos.y, pos.z, d.x * sp, d.y * sp, d.z * sp, rand(0.3, 1.1), pal.core, el === 'lightning' ? 2 : 14, 0.035);
    }
    // lingering toon smoke column
    const sc = new THREE.Color(SMOKE_COL[el] ?? 0x333333);
    for (let i = 0; i < (5 + radius * 3) * q; i++) {
      const d = new THREE.Vector3(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize();
      this.puff(pos.clone().addScaledVector(d, radius * 0.4), { color: sc, size: radius * rand(0.4, 0.7), size1: radius * rand(1.1, 1.6), life: rand(1.6, 2.8) + mag, vel: d.multiplyScalar(rand(1, 3) * radius * 0.4).setY(rand(1, 2.5)), alpha: LIGHT_SMOKE[el] ? 0.6 : 0.95, drag: 2 });
    }
    if (el === 'earth' || el === 'ice' || opts.debris) this.debris(pos, radius, el, pal);
    if (el === 'lightning') for (let i = 0; i < 3 + mag * 4; i++) { const e = pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).multiplyScalar(radius * 1.5)); this.bolt(pos, e, pal.color, { width: 0.08, dur: 0.3, branches: 0 }); }
    if (el === 'nature') for (let i = 0; i < 26 * q; i++) this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-6, 6), vy: rand(2, 8), vz: rand(-6, 6), life: rand(1.5, 3), size: 0.35, color: Math.random() < 0.5 ? pal.color : new THREE.Color(0xff9ac8), alpha: 1, drag: 1.5, grav: 1.5, frame: 5, spin: rand(-6, 6), style: ST.CRISP });
    if (el === 'fire' && radius > 1.5) this.haze(pos.clone().setY(pos.y + radius * 0.6), radius * 3, 1.2, 1.6 + mag);
    if (pos.y - gy < radius * 0.8 && !opts.noDecal) this.decal(pos, radius * 1.3, el, radius > 1.2 && ['fire', 'lightning', 'arcane', 'darkness', 'light', 'earth'].includes(el) ? pal.color : null);
    this.addShake(0.12 + mag * 0.5 * Math.min(1, radius / 4), pos);
  }
  debris(pos, radius, el, pal) {
    const n = Math.floor(6 + radius * 2);
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = el === 'ice'
      ? new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: pal.color, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.9, flatShading: true })
      : new THREE.MeshStandardMaterial({ color: 0x6b5a48, emissive: pal.color, emissiveIntensity: 0.25, roughness: 0.9, flatShading: true });
    const bits = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat); m.position.copy(pos); m.scale.setScalar(rand(0.1, 0.3) * (0.5 + radius * 0.15)); m.castShadow = true;
      this.scene.add(m);
      bits.push({ m, v: new THREE.Vector3(rand(-1, 1), rand(0.6, 1.5), rand(-1, 1)).multiplyScalar(rand(4, 10) * (0.6 + radius * 0.1)), w: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)) });
    }
    let t = 0;
    this.add((dt) => {
      t += dt;
      for (const b of bits) {
        b.v.y -= 22 * dt; b.m.position.addScaledVector(b.v, dt);
        b.m.rotation.x += b.w.x * dt; b.m.rotation.y += b.w.y * dt;
        const gy = this.world.heightAt(b.m.position.x, b.m.position.z);
        if (b.m.position.y < gy) { b.m.position.y = gy; b.v.multiplyScalar(0.4); b.v.y = Math.abs(b.v.y) * 0.5; b.w.multiplyScalar(0.5); }
        else if (Math.random() < 0.15) this.puff(b.m.position, { color: new THREE.Color(SMOKE_COL[el] ?? 0x555555), size: 0.25, life: 0.8, alpha: 0.7 });
        if (t > 2.5) b.m.scale.multiplyScalar(1 - dt * 2);
      }
      if (t > 4) { bits.forEach((b) => this.scene.remove(b.m)); geo.dispose(); mat.dispose(); return false; }
      return true;
    });
  }
}
