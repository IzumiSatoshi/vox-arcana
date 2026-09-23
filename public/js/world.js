import * as THREE from 'three';
import { NOISE, TIME, addOutline, addRim } from './shaders.js';
import { fbm, smooth, rand, mulberry32, TAU, clamp } from './util.js';
import { MagicCircle } from './magicCircle.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural weathered stone: world-space colour noise, cracks, block joints, moss on top faces, bumpy normals.
export function stoneMaterial(color, { moss = 1, joint = 0, rough = 0.92 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMoss = { value: moss }; sh.uniforms.uJoint = { value: joint };
    sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP=(modelMatrix*vec4(transformed,1.0)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = 'varying vec3 vWP; varying vec3 vWN; uniform float uMoss, uJoint;\n' + NOISE + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n1=snoise(vWP*0.45), n2=snoise(vWP*2.1+3.1);
        float crack=smoothstep(0.07,0.0,abs(n2))*smoothstep(-0.2,0.4,n1);
        float jy=uJoint>0.0? smoothstep(0.06,0.0,0.5-abs(fract(vWP.y/uJoint)-0.5)) : 0.0;
        vec3 base=diffuseColor.rgb*(0.97+n1*0.12+n2*0.06);
        base*=mix(vec3(1.0),vec3(1.06,1.0,0.9),smoothstep(-0.3,0.6,snoise(vWP*0.12)));
        base*=1.0-max(jy*0.5,crack*0.4);
        float moss=smoothstep(0.5,0.85,vWN.y+n1*0.3)*uMoss;
        moss=max(moss, smoothstep(0.7,1.0,n1*0.5+0.5+snoise(vWP*0.9)*0.3)*0.3*uMoss*step(0.0,-vWN.y+0.7));
        base=mix(base,vec3(0.26,0.4,0.14)*(0.85+n2*0.25),clamp(moss,0.0,1.0));
        diffuseColor.rgb=base;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal=normalize(normal+vec3(snoise(vWP*3.0),snoise(vWP*3.0+5.0),snoise(vWP*3.0+9.0))*0.16);`);
  };
  m.customProgramCacheKey = () => 'stone' + moss + '_' + joint;
  return m;
}
// Merge every static mesh under `group` into one mesh per material (huge draw-call saving)
function bake(scene, group, outline = 0.025) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((m) => {
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(m.matrixWorld);
    if (!buckets.has(m.material)) buckets.set(m.material, { list: [], outline: !m.userData.noOutline });
    buckets.get(m.material).list.push(g);
  });
  const out = [];
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.list, false);
    const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = mesh.receiveShadow = true;
    if (outline && b.outline) addOutline(mesh, outline);
    scene.add(mesh); out.push(mesh);
  }
  return out;
}
function flutedColumn(h, broken, rng) {
  const g = new THREE.CylinderGeometry(0.8, 0.92, h, 40, Math.max(3, Math.round(h * 1.5)));
  const p = g.attributes.position, seed = rng() * 10;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.3) {
      const a = Math.atan2(z, x), k = 1 - 0.035 * (y / h + 0.5) - 0.055 * Math.pow(0.5 + 0.5 * Math.cos(a * 18), 3) + (rng() - 0.5) * 0.012;
      x *= k; z *= k;
    }
    if (broken && y > h / 2 - 0.01) y -= 0.15 + Math.abs(Math.sin(Math.atan2(z, x) * 2.3 + seed)) * 0.7 + rng() * 0.2;
    p.setXYZ(i, x, y, z);
  }
  g.translate(0, h / 2, 0); g.computeVertexNormals();
  return g;
}

export const ARENA_R = 68;
export const SEA_Y = -3;
export const SUN_DIR = new THREE.Vector3(-0.55, 0.52, -0.65).normalize();
const FOG = 0xb4cde6;

let toonGrad = null;
export function toonGradient() {
  if (toonGrad) return toonGrad;
  const d = new Uint8Array([90, 90, 90, 255, 165, 165, 165, 255, 225, 225, 225, 255, 255, 255, 255, 255]);
  toonGrad = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat); toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter; toonGrad.needsUpdate = true;
  return toonGrad;
}
export const toon = (color, extra = {}) => addRim(new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra }), 0xfff0d6, 0.35, 3.5);
const outlineAll = (obj, t = 0.025) => obj.traverse((m) => { if (m.isMesh && !m.userData.noOutline && m.material?.type === 'MeshToonMaterial') addOutline(m, t); });

// ------------------------------------------------ fluffy stylized tree canopy (camera-facing leaf cards)
let leafTex = null;
function leafTexture() {
  if (leafTex) return leafTex;
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const rng = mulberry32(8);
  for (let i = 0; i < 70; i++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * 46, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    const s = 0.75 + rng() * 0.25;
    g.fillStyle = `rgb(${255 * s},${255 * s},${255 * s})`;
    g.save(); g.translate(x, y); g.rotate(rng() * TAU); g.beginPath(); g.ellipse(0, 0, 13, 6, 0, 0, TAU); g.fill(); g.restore();
  }
  leafTex = new THREE.CanvasTexture(cv);
  return leafTex;
}
function canopyMaterial(color, sunView) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null }, uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec2 aCorner; attribute float aRand; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying float vR; varying float vH; varying vec3 vCol;
      void main(){
        vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
        float sw=sin(uTime*1.3+position.x*0.6+position.z*0.4+aRand*6.0)*0.06;
        float c=cos(aRand*6.28+sw), s=sin(aRand*6.28+sw);
        vec2 k=mat2(c,-s,s,c)*aCorner;
        float size=0.9+aRand*0.5;
        mvPosition.xy+=k*size;
        vN=normalize(normalMatrix*normal); vUv=aCorner*0.5+0.5; vR=aRand; vH=normal.y;
        #ifdef USE_COLOR
        vCol=color;
        #else
        vCol=vec3(1.0);
        #endif
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D uTex; uniform vec3 uColor; uniform vec3 uSunView;
      varying vec2 vUv; varying vec3 vN; varying float vR; varying float vH; varying vec3 vCol;
      void main(){
        vec4 t=texture2D(uTex,vUv); if(t.a<0.5) discard;
        vec3 uColor2=uColor*vCol;
        vec3 N=normalize(vN);
        float ndl=dot(N,normalize(uSunView));
        float shade=smoothstep(-0.15,0.05,ndl)*0.55+smoothstep(0.35,0.55,ndl)*0.25+0.28;
        vec3 c=uColor2*(0.85+vR*0.3)*t.r*shade;
        c*=0.7+0.3*smoothstep(-0.8,0.6,vH);
        c+=uColor2*vec3(0.25,0.3,0.05)*smoothstep(0.6,1.0,-ndl*0.5+0.5)*0.3;
        gl_FragColor=vec4(c,1.0);
        #include <fog_fragment>
      }`,
    fog: true,
  });
}
function canopyGeometry(rng, blobs, cardsPer) {
  const pos = [], nrm = [], corner = [], rnd = [], idx = [];
  let v = 0;
  for (const b of blobs) {
    for (let i = 0; i < cardsPer; i++) {
      const u = rng() * 2 - 1, a = rng() * TAU, s = Math.sqrt(1 - u * u);
      const n = new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
      const r = b.r * (0.55 + rng() * 0.45);
      const p = n.clone().multiplyScalar(r).add(b.c);
      const nn = p.clone().sub(b.c).normalize().multiplyScalar(0.7).add(new THREE.Vector3(0, 0.3, 0)).normalize();
      const rr = rng();
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(p.x, p.y, p.z); nrm.push(nn.x, nn.y, nn.z); corner.push(cx, cy); rnd.push(rr); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 1));
  g.setIndex(idx); g.computeBoundingSphere(); g.boundingSphere.radius += 2;
  return g;
}

export class World {
  constructor(scene, quality = 1) {
    this.scene = scene; this.quality = quality;
    this.obstacles = []; this.anim = []; this.canopyMats = []; this.boxes = [];
    this.statics = new THREE.Group(); // merged after construction
    this.sunView = new THREE.Vector3();
    this.buildSky(); this.buildLights(); this.buildTerrain(); this.buildWater();
    this.buildRuins(); this.buildTrees(); this.buildRocks(); this.buildCrystals(); this.buildDistant();
    this.buildGrass();
    bake(this.scene, this.statics);
    this.statics.clear();
  }

  // ------------------------------------------------ height field
  heightAt(x, z) {
    const r = Math.hypot(x, z);
    let h = fbm(x * 0.018, z * 0.018, 4) * 2.4 + fbm(x * 0.07, z * 0.07, 2) * 0.3;
    h *= smooth(8, 40, r) * 0.85 + 0.15;
    h += smooth(46, 76, r) * (3.5 + fbm(x * 0.03 + 7, z * 0.03, 3) * 7);
    h -= smooth(86, 112, r) * 20;
    if (r < 11) h = h * smooth(9, 11, r) + 0.35 * (1 - smooth(9, 11, r)); // dais
    return h;
  }
  normalAt(x, z) {
    const e = 0.5;
    return new THREE.Vector3(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }
  // ---- conjured solids (yaw-rotated boxes): platforms, stairs, pillars, ramparts
  addBox(b) { b.cos = Math.cos(b.yaw || 0); b.sin = Math.sin(b.yaw || 0); this.boxes.push(b); return b; }
  removeBox(b) { const i = this.boxes.indexOf(b); if (i >= 0) this.boxes.splice(i, 1); }
  local(b, x, z) { const dx = x - b.x, dz = z - b.z; return [dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos]; }
  inBox(b, p, pad = 0) { const [lx, lz] = this.local(b, p.x, p.z); return Math.abs(lx) < b.hx + pad && Math.abs(lz) < b.hz + pad && p.y > b.y - b.hy && p.y < b.y + b.hy; }
  // highest walkable surface under (x,z) that is not above `feetY` + step height
  groundAt(x, z, feetY = Infinity) {
    let h = this.heightAt(x, z);
    for (const b of this.boxes) {
      const [lx, lz] = this.local(b, x, z);
      if (Math.abs(lx) < b.hx + 0.45 && Math.abs(lz) < b.hz + 0.45) { const top = b.y + b.hy; if (top <= feetY + 0.62 && top > h) h = top; }
    }
    return h;
  }
  solid(p) {
    if (p.y < this.heightAt(p.x, p.z)) return true;
    for (const b of this.boxes) if (this.inBox(b, p)) return true;
    for (const o of this.obstacles) {
      const dx = p.x - o.x, dz = p.z - o.z;
      if (dx * dx + dz * dz < o.r * o.r && p.y > o.y0 - 0.5 && p.y < o.y0 + o.h) return true;
    }
    return false;
  }
  raycast(origin, dir, maxDist = 90, step = 0.5) {
    const p = origin.clone(), d = dir.clone().normalize();
    for (let t = 0; t < maxDist; t += step) {
      p.copy(origin).addScaledVector(d, t);
      if (this.solid(p)) {
        let a = t - step, b = t;
        for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (this.solid(origin.clone().addScaledVector(d, m))) b = m; else a = m; }
        return { point: origin.clone().addScaledVector(d, a), dist: a, hit: true };
      }
    }
    return { point: origin.clone().addScaledVector(d, maxDist), dist: maxDist, hit: false };
  }
  collideBody(pos, radius = 0.45) {
    for (const o of this.obstacles) {
      if (pos.y > o.y0 + o.h || pos.y + 1.8 < o.y0) continue;
      const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx, dz), min = o.r + radius;
      if (d < min && d > 0.0001) { pos.x = o.x + (dx / d) * min; pos.z = o.z + (dz / d) * min; }
    }
    for (const b of this.boxes) { // push out sideways when the body overlaps a box it is not standing on
      if (pos.y >= b.y + b.hy - 0.6 || pos.y + 1.8 <= b.y - b.hy) continue; // low ledges are stepped onto, not blocked
      const [lx, lz] = this.local(b, pos.x, pos.z), ex = b.hx + radius - Math.abs(lx), ez = b.hz + radius - Math.abs(lz);
      if (ex > 0 && ez > 0) {
        let nx = lx, nz = lz;
        if (ex < ez) nx = Math.sign(lx || 1) * (b.hx + radius); else nz = Math.sign(lz || 1) * (b.hz + radius);
        pos.x = b.x + nx * b.cos + nz * b.sin; pos.z = b.z - nx * b.sin + nz * b.cos;
      }
    }
    const r = Math.hypot(pos.x, pos.z);
    if (r > ARENA_R) { pos.x *= ARENA_R / r; pos.z *= ARENA_R / r; }
  }

  // ------------------------------------------------ sky
  buildSky() {
    this.skyU = { uTime: TIME, uSun: { value: SUN_DIR }, uDom: { value: 0 }, uDomCol: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww; }`,
      fragmentShader: NOISE + /* glsl */ `
        uniform vec3 uSun,uDomCol; uniform float uTime,uDom; varying vec3 vDir;
        void main(){
          vec3 d=normalize(vDir); float y=d.y;
          vec3 zen=vec3(0.07,0.27,0.74), hor=vec3(0.64,0.79,0.94), gold=vec3(1.0,0.8,0.55);
          float s=max(dot(d,uSun),0.0);
          vec3 col=mix(hor,zen,pow(clamp(y,0.0,1.0),0.5));
          col=mix(col,gold,pow(s,6.0)*0.4*(1.0-clamp(y*1.5,0.0,1.0)));
          col+=vec3(1.0,0.92,0.75)*(pow(s,1500.0)*18.0+pow(s,90.0)*0.25+pow(s,10.0)*0.05);
          if(y<0.0) col=mix(hor,vec3(0.55,0.68,0.78),clamp(-y*4.0,0.0,1.0));
          // high painterly cirrus + puffy layer
          vec2 uv=d.xz/(max(y,0.02)+0.1);
          float c=fbm3(vec3(uv*0.7+vec2(uTime*0.005,uTime*0.002),uTime*0.006));
          float cov=smoothstep(0.18,0.42,c)*smoothstep(0.0,0.2,y);
          float lightC=c+snoise(vec3(uv*1.4+uSun.xz*0.3,uTime*0.01))*0.12-0.06;
          vec3 cc=mix(vec3(0.66,0.72,0.84),vec3(1.0,0.98,0.94),smoothstep(0.0,0.35,c-lightC+0.2))+gold*pow(s,4.0)*0.5;
          col=mix(col,cc,cov*0.9);
          // domain: an ultimate spell stains the heavens with its element
          float swirl=fbm3(vec3(uv*0.5,uTime*0.15));
          vec3 dom=mix(uDomCol*0.12,uDomCol*0.9,smoothstep(-0.2,0.6,swirl))+uDomCol*pow(1.0-abs(y),6.0)*0.6;
          col=mix(col,dom,uDom*0.85);
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), mat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(FOG, 110, 760);
    this.scene.background = new THREE.Color(FOG);
  }
  buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5d6a3a, 1.15);
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
    sun.position.copy(SUN_DIR).multiplyScalar(120); sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const S = 78; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 300 });
    sun.shadow.mapSize.set(this.quality > 0 ? 2048 : 1024, this.quality > 0 ? 2048 : 1024);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    this.scene.add(hemi, sun, sun.target);
    this.sun = sun; this.hemi = hemi;
  }

  // ------------------------------------------------ terrain (vertex colours + painterly world-space variation)
  buildTerrain() {
    const size = 280, seg = this.quality > 0 ? 280 : 150;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    const cGrassA = new THREE.Color(0x5a9a30), cGrassB = new THREE.Color(0xa3cc48), cGrassC = new THREE.Color(0x3a7a32);
    const cRock = new THREE.Color(0x8a8478), cSand = new THREE.Color(0xdcc89a), cDirt = new THREE.Color(0x8e6c46), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = this.heightAt(x, z);
      pos.setY(i, Math.hypot(x, z) < 10.95 ? h - 0.6 : h); // the dais covers the centre: keep terrain well below it
      const n = this.normalAt(x, z), slope = 1 - n.y, v = fbm(x * 0.08, z * 0.08, 3);
      c.copy(cGrassA).lerp(cGrassB, clamp(v * 0.8 + 0.5)).lerp(cGrassC, clamp(fbm(x * 0.02 + 3, z * 0.02, 2) + 0.2));
      const r = Math.hypot(x, z);
      if (r < 11) c.lerp(cDirt, 0.3);
      const pathW = 0.07 + fbm(x * 0.1, z * 0.1, 2) * 0.03;
      if (Math.abs(Math.sin(Math.atan2(z, x) * 2)) < pathW && r > 11 && r < 44) c.lerp(cDirt, 0.65);
      c.lerp(cRock, smooth(0.16, 0.36, slope));
      c.lerp(cSand, smooth(-1.2, -3.2, h));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWPos=(modelMatrix*vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWPos;\n' + NOISE + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float nA=snoise(vec3(vWPos.xz*0.045,0.0));
        float nB=snoise(vec3(vWPos.xz*0.6,3.0));
        diffuseColor.rgb*=0.86+nA*0.1+nB*0.1;
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.08,1.04,0.82),smoothstep(0.2,0.7,nA)*0.6);`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
    // central dais with glowing rune circle
    const stone = stoneMaterial(0xb8ae98, { moss: 0.35 });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.8, 1.2, 64), stone);
    dais.position.y = -0.25; dais.receiveShadow = true; this.scene.add(dais);
    const daisA = stoneMaterial(0xc2b8a2, { moss: 0.5 }), daisB = stoneMaterial(0xaea48e, { moss: 0.5 });
    for (let i = 0; i < 24; i++) { // flagstone rim
      const a = (i / 24) * TAU, b = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.35, 1.1), i % 2 ? daisA : daisB);
      b.position.set(Math.cos(a) * 10.2, 0.2, Math.sin(a) * 10.2); b.rotation.y = -a + Math.PI / 2 + (Math.random() - 0.5) * 0.04; this.statics.add(b);
    }
    const mc = new MagicCircle({ seed: 7, tier: 9, color: 0x3fb8ff, radius: 8.5, intensity: 0.45 });
    mc.group.rotation.x = -Math.PI / 2; mc.group.position.y = 0.37; mc.spin = 0.05; this.scene.add(mc.group);
    this.anim.push((dt) => { mc.update(dt); mc.target = 0.45 + Math.sin(TIME.value * 0.8) * 0.15; });
  }

  // ------------------------------------------------ water
  buildWater() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: TIME, uSun: { value: SUN_DIR }, uFog: { value: new THREE.Color(FOG) } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: NOISE + /* glsl */ `
        uniform float uTime; uniform vec3 uSun,uFog; varying vec3 vW;
        void main(){
          vec2 p=vW.xz*0.06;
          float nx=snoise(vec3(p*2.0,uTime*0.25))*0.6+snoise(vec3(p*7.0+3.0,uTime*0.5))*0.3;
          float nz=snoise(vec3(p*2.0+11.0,uTime*0.25))*0.6+snoise(vec3(p*7.0+17.0,uTime*0.5))*0.3;
          vec3 N=normalize(vec3(nx*0.35,1.0,nz*0.35));
          vec3 V=normalize(cameraPosition-vW);
          float fres=pow(1.0-max(dot(N,V),0.0),4.0);
          vec3 deep=vec3(0.02,0.18,0.34), shallow=vec3(0.08,0.62,0.66), sky=vec3(0.7,0.82,0.94);
          float r=length(vW.xz);
          vec3 col=mix(shallow,deep,smoothstep(95.0,150.0,r));
          col=mix(col,sky,fres*0.8);
          vec3 R=reflect(-V,N); float sp=pow(max(dot(R,uSun),0.0),300.0)*6.0+pow(max(dot(R,uSun),0.0),30.0)*0.3;
          col+=vec3(1.0,0.92,0.75)*sp;
          float foam=smoothstep(4.0,0.0,abs(r-100.0+snoise(vec3(vW.xz*0.05,uTime*0.3))*4.0))*(0.5+0.5*snoise(vec3(vW.xz*0.4,uTime)));
          col=mix(col,vec3(0.95),step(0.45,clamp(foam,0.0,1.0))*0.8);
          float d=length(cameraPosition-vW);
          col=mix(col,uFog,smoothstep(150.0,900.0,d));
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1), mat);
    water.rotation.x = -Math.PI / 2; water.position.y = SEA_Y;
    this.scene.add(water);
  }

  // ------------------------------------------------ ruins
  buildRuins() {
    const stone = stoneMaterial(0xe0d6c2, { moss: 0.8, joint: 1.6 }), block = stoneMaterial(0xc4b89e, { moss: 0.9 }), dark = stoneMaterial(0xa89c84, { moss: 1 });
    const gold = toon(0xd9b25a, { emissive: 0x3a2a00 });
    const rng = mulberry32(42), G = this.statics;
    const put = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); G.add(m); return m; };
    const rubble = (cx, cz, n, spread) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (rng() - 0.5) * spread, z = cz + (rng() - 0.5) * spread, s = 0.25 + rng() * 0.55;
        put(new THREE.BoxGeometry(s * (1 + rng()), s * 0.7, s), rng() < 0.5 ? block : dark, x, this.heightAt(x, z) + s * 0.25, z, rng() * TAU, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5);
      }
    };
    const column = (x, z, h, broken) => {
      const y = this.heightAt(x, z) - 0.25, ry = rng() * TAU;
      put(new THREE.BoxGeometry(2.3, 0.45, 2.3), dark, x, y + 0.22, z, ry);
      put(new THREE.CylinderGeometry(1.08, 1.12, 0.28, 32), block, x, y + 0.58, z, ry);
      put(new THREE.TorusGeometry(0.95, 0.1, 8, 36), block, x, y + 0.74, z, ry, Math.PI / 2);
      put(flutedColumn(h, broken, rng), stone, x, y + 0.72, z, ry);
      if (!broken) {
        put(new THREE.TorusGeometry(0.84, 0.08, 8, 32), gold, x, y + 0.72 + h - 0.05, z, 0, Math.PI / 2);
        put(new THREE.CylinderGeometry(1.1, 0.84, 0.38, 32), block, x, y + 0.72 + h + 0.18, z, ry);
        put(new THREE.BoxGeometry(2.3, 0.38, 2.3), dark, x, y + 0.72 + h + 0.55, z, ry);
      } else {
        const L = 1.2 + rng() * 1.6, a = rng() * TAU;
        const drum = put(flutedColumn(L, false, rng), stone, x + Math.cos(a) * 2.2, this.heightAt(x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2) + 0.8, z + Math.sin(a) * 2.2, a, Math.PI / 2);
        drum.geometry.translate(0, -L / 2, 0);
        rubble(x, z, 6, 5);
      }
      this.obstacles.push({ x, z, r: 1.05, y0: y, h: h + 1.4 });
    };
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + 0.12, r = 32 + (i % 2) * 4;
      if (rng() < 0.15) continue;
      column(Math.cos(a) * r, Math.sin(a) * r, 5 + rng() * 5, rng() < 0.35);
    }
    // block-built arches with keystones
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4, r = 22;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, tx = -Math.sin(a), tz = Math.cos(a), yaw = -a + Math.PI / 2;
      const y = Math.min(this.heightAt(cx + tx * 3, cz + tz * 3), this.heightAt(cx - tx * 3, cz - tz * 3)) - 0.1;
      for (const sd of [-1, 1]) {
        const px = cx + tx * 3.3 * sd, pz = cz + tz * 3.3 * sd;
        put(new THREE.BoxGeometry(1.9, 0.5, 1.9), dark, px, y + 0.25, pz, yaw);
        for (let k = 0; k < 4; k++) put(new THREE.BoxGeometry(1.45 - (k % 2) * 0.08, 1.58, 1.45 - (k % 2) * 0.08), stone, px + (rng() - 0.5) * 0.06, y + 0.5 + 0.8 + k * 1.6, pz + (rng() - 0.5) * 0.06, yaw + (rng() - 0.5) * 0.06);
        put(new THREE.BoxGeometry(1.75, 0.35, 1.75), dark, px, y + 7.0, pz, yaw);
        this.obstacles.push({ x: px, z: pz, r: 0.95, y0: y, h: 7.2 });
      }
      for (let k = -1; k <= 1; k++) {
        const bx = cx + tx * k * 2.6, bz = cz + tz * k * 2.6;
        put(new THREE.BoxGeometry(k ? 3.2 : 2.0, k ? 1.1 : 1.45, 1.7), k ? block : dark, bx, y + 7.75 + (k ? 0 : 0.12), bz, yaw);
      }
      rubble(cx, cz, 5, 7);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe6ff).multiplyScalar(3) }));
      gem.position.set(cx, y + 9.1, cz); this.scene.add(gem);
      this.anim.push((dt) => { gem.rotation.y += dt; gem.position.y = y + 9.1 + Math.sin(TIME.value * 2 + i) * 0.15; });
    }
    // crumbling brick walls for cover
    for (let i = 0; i < 8; i++) {
      const a = rng() * TAU, r = 14 + rng() * 14, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const yaw = a + Math.PI / 2 + rng() * 0.5, cs = Math.cos(yaw), sn = Math.sin(yaw);
      const L = 3.5 + rng() * 2.5, rows = 3 + Math.floor(rng() * 2), y0 = this.heightAt(x, z) - 0.1;
      for (let row = 0; row < rows; row++) {
        let u = -L / 2 + (row % 2) * 0.4;
        while (u < L / 2) {
          const w = 0.7 + rng() * 0.6;
          if (!(row === rows - 1 && rng() < 0.35) && !(row > 0 && Math.abs(u) > L / 2 - 0.8 && rng() < 0.5)) {
            put(new THREE.BoxGeometry(Math.min(w, L / 2 - u) - 0.04, 0.46, 0.85 + rng() * 0.08), rng() < 0.4 ? block : dark, x + cs * (u + w / 2), y0 + 0.23 + row * 0.47, z - sn * (u + w / 2), yaw + (rng() - 0.5) * 0.05);
          }
          u += w;
        }
      }
      rubble(x, z, 4, 4);
      for (const k of [-1, 0, 1]) this.obstacles.push({ x: x + cs * k * L * 0.33, z: z - sn * k * L * 0.33, r: 0.8, y0: y0, h: rows * 0.47 + 0.1 });
    }
  }
  buildTrees() {
    const rng = mulberry32(9);
    const bark = stoneMaterial(0x5e4030, { moss: 0.6 });
    const palettes = [0x4f9a34, 0x69b23e, 0x3f8a3c, 0x7cba48, 0xffa8c8, 0xff94bc];
    this.sakura = [];
    const cards = [], proxies = [];
    for (let i = 0; i < 36; i++) {
      const a = rng() * TAU, r = 44 + rng() * 42, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      if (y < -1) continue;
      const sc = 0.9 + rng() * 0.5, h = (4.5 + rng() * 4);
      const trunkGeo = new THREE.CylinderGeometry(0.22, 0.55, h, 10, 5);
      const tp = trunkGeo.attributes.position;
      for (let k = 0; k < tp.count; k++) { const yy = tp.getY(k) / h + 0.5; tp.setX(k, tp.getX(k) + Math.sin(yy * 2.5 + i) * 0.35 * yy); }
      trunkGeo.computeVertexNormals();
      const trunk = new THREE.Mesh(trunkGeo, bark); trunk.position.set(x, y - 0.2 + (h / 2) * sc, z); trunk.scale.setScalar(sc); this.statics.add(trunk);
      for (let b = 0; b < 3; b++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 2.2, 5), bark);
        const ba = rng() * TAU; br.position.set(x + Math.cos(ba) * 0.6 * sc, y - 0.2 + h * sc * (0.6 + b * 0.12), z + Math.sin(ba) * 0.6 * sc); br.rotation.set(Math.sin(ba) * 0.9, 0, -Math.cos(ba) * 0.9); br.scale.setScalar(sc); this.statics.add(br);
      }
      const pink = rng() < 0.3, color = new THREE.Color(pink ? palettes[4 + (i % 2)] : palettes[i % 4]);
      const blobs = [];
      const nb = 4 + Math.floor(rng() * 3);
      for (let k = 0; k < nb; k++) blobs.push({ c: new THREE.Vector3((rng() - 0.5) * 3.2, h + (rng() - 0.2) * 2.2, (rng() - 0.5) * 3.2), r: 1.6 + rng() * 1.2 });
      blobs.push({ c: new THREE.Vector3(0, h + 1.2, 0), r: 2.4 });
      for (const b of blobs) { b.c.multiplyScalar(sc).add(new THREE.Vector3(x, y - 0.2, z)); b.r *= sc; }
      cards.push({ blobs, color });
      for (const b of blobs) { const g = new THREE.IcosahedronGeometry(b.r * 0.85, 1); g.translate(b.c.x, b.c.y, b.c.z); proxies.push(g); }
      this.obstacles.push({ x, z, r: 0.65, y0: y, h: h * sc });
      if (pink) this.sakura.push(new THREE.Vector3(x, y + h * sc + 1, z));
    }
    // all canopies in ONE mesh (per-card colour attribute) + one invisible shadow caster
    const geos = cards.map(({ blobs, color }) => {
      const g = canopyGeometry(rng, blobs, this.quality > 0 ? 70 : 35);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { col[k * 3] = color.r; col[k * 3 + 1] = color.g; col[k * 3 + 2] = color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
    });
    const mat = canopyMaterial(0xffffff); mat.uniforms.uTex.value = leafTexture(); mat.uniforms.uSunView = { value: this.sunView }; mat.uniforms.uTime = TIME;
    mat.vertexColors = true;
    const canopy = new THREE.Mesh(mergeGeometries(geos, false), mat); canopy.frustumCulled = false; this.scene.add(canopy);
    const shadow = new THREE.Mesh(mergeGeometries(proxies.map((g) => g.toNonIndexed()), false), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    shadow.castShadow = true; this.scene.add(shadow);
  }
  buildRocks() {
    const rng = mulberry32(5);
    const geo = new THREE.DodecahedronGeometry(1, 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(0.8 + fbm(v.x * 2, v.y * 2 + v.z, 3) * 0.4); p.setXYZ(i, v.x, v.y * 0.72, v.z); }
    geo.computeVertexNormals();
    const mat = stoneMaterial(0x9a958a, { moss: 1.2 });
    for (let i = 0; i < 30; i++) {
      const a = rng() * TAU, r = 18 + rng() * 55, x = Math.cos(a) * r, z = Math.sin(a) * r, y = this.heightAt(x, z);
      if (y < -1.5) continue;
      const s = 0.6 + rng() * 2.2;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y + s * 0.15, z); m.scale.set(s * (1 + rng() * 0.5), s, s); m.rotation.y = rng() * TAU;
      this.statics.add(m);
      if (s > 1.2) this.obstacles.push({ x, z, r: s * 0.9, y0: y - 1, h: s * 1.1 + 1 });
    }
  }
  buildCrystals() {
    const cols = [0x6fe8ff, 0xb68cff, 0x7dffc8, 0xffc36a];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.4, r = 50 + (i % 3) * 8;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, base = this.heightAt(x, z) + 9 + (i % 3) * 3;
      const c = cols[i % cols.length];
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.8, roughness: 0.15, metalness: 0.2, flatShading: true }));
      core.scale.set(1, 2.2, 1); g.add(core);
      for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), core.material); s.userData.k = k; g.add(s); }
      const rock = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4, 7), toon(0x7d776b)); rock.rotation.x = Math.PI; rock.position.y = -4.5; g.add(rock); addOutline(rock, 0.04);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 7), toon(0x6aa33e)); top.position.y = -2.4; g.add(top); addOutline(top, 0.04);
      g.position.set(x, base, z); this.scene.add(g);
      this.anim.push((dt) => {
        const t = TIME.value;
        core.rotation.y += dt * 0.5; g.position.y = base + Math.sin(t * 0.7 + i) * 0.6;
        g.children.forEach((s) => { if (s.userData.k !== undefined) { const an = t * 1.2 + (s.userData.k * TAU) / 3; s.position.set(Math.cos(an) * 2.6, Math.sin(t * 2 + s.userData.k) * 0.6, Math.sin(an) * 2.6); s.rotation.y += dt * 2; } });
      });
    }
  }
  buildDistant() {
    const rng = mulberry32(77);
    // noise-displaced mountains with grass / rock / snow bands
    const mtnGeo = (seed) => {
      const g = new THREE.IcosahedronGeometry(1, 5), p = g.attributes.position, colors = [];
      const v = new THREE.Vector3(), cG = new THREE.Color(0x5b8a52), cR = new THREE.Color(0x7d8fa6), cS = new THREE.Color(0xf4f8ff), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        let y = Math.max(0, v.y);
        const ridge = 1 - Math.abs(fbm(v.x * 2.2 + seed, v.z * 2.2 + y, 4));
        const r = 0.75 + ridge * 0.45;
        v.x *= r; v.z *= r; v.y = y * (0.8 + ridge * 0.5) - 0.02;
        p.setXYZ(i, v.x, v.y, v.z);
        c.copy(cG).lerp(cR, smooth(0.15, 0.4, v.y)).lerp(cS, smooth(0.62, 0.75, v.y + fbm(v.x * 6, v.z * 6, 2) * 0.1));
        colors.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals();
      return g;
    };
    const mMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const geos = [0, 1, 2, 3].map((k) => mtnGeo(k * 13.1));
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + rng() * 0.15, r = 420 + rng() * 260, h = 110 + rng() * 170, w = 110 + rng() * 120;
      const m = new THREE.Mesh(geos[i % 4], mMat); m.position.set(Math.cos(a) * r, -25, Math.sin(a) * r); m.scale.set(w, h, w * (0.8 + rng() * 0.4)); m.rotation.y = rng() * TAU;
      this.scene.add(m);
    }
    // floating islands
    for (let i = 0; i < 5; i++) {
      const a = rng() * TAU, r = 160 + rng() * 140, y = 45 + rng() * 60, s = 8 + rng() * 14;
      const g = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.ConeGeometry(s, s * 1.8, 8), toon(0x857a6a)); rock.rotation.x = Math.PI; rock.position.y = -s * 0.9; g.add(rock);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 0.98, s * 0.25, 8), toon(0x6fb14a)); g.add(top);
      const tr = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.3, 1), toon(rng() < 0.5 ? 0xffb3cf : 0x4f9a3a)); tr.position.set(s * 0.3, s * 0.45, 0); g.add(tr);
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r); this.scene.add(g);
      this.anim.push(() => { g.position.y = y + Math.sin(TIME.value * 0.3 + i) * 2; });
    }
    // painted cumulus clouds (lit tops, cool undersides)
    const cloudTex = (seed) => {
      const W = 512, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
      const r2 = mulberry32(seed), blobs = [];
      for (let i = 0; i < 26; i++) { const x = W * 0.15 + r2() * W * 0.7, base = H * 0.72, rr = 30 + r2() * 70 * (1 - Math.abs(x / W - 0.5)); blobs.push([x, base - rr * (0.3 + r2() * 0.9), rr]); }
      for (const [x, y, r] of blobs) { g.fillStyle = 'rgb(150,168,196)'; g.beginPath(); g.arc(x, y + r * 0.12, r, 0, TAU); g.fill(); }
      for (const [x, y, r] of blobs) { const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.45, r * 0.1, x, y, r); gr.addColorStop(0, 'rgb(255,253,248)'); gr.addColorStop(0.55, 'rgb(240,242,248)'); gr.addColorStop(1, 'rgba(206,216,232,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 0.92, 0, TAU); g.fill(); }
      g.globalCompositeOperation = 'destination-in'; const fade = g.createLinearGradient(0, H * 0.6, 0, H); fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fade; g.fillRect(0, 0, W, H);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const texes = [1, 2, 3, 4].map(cloudTex);
    for (let i = 0; i < 22; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texes[i % 4], transparent: true, depthWrite: false, fog: false }));
      const a = rng() * TAU, r = 380 + rng() * 520; sp.position.set(Math.cos(a) * r, 90 + rng() * 120, Math.sin(a) * r);
      const s = 260 + rng() * 260; sp.scale.set(s, s * 0.5, 1);
      this.scene.add(sp);
      const sp0 = a, spd = 0.002 + rng() * 0.003;
      this.anim.push(() => { const an = sp0 + TIME.value * spd * 0.1; sp.position.x = Math.cos(an) * r; sp.position.z = Math.sin(an) * r; });
    }
  }

  // ------------------------------------------------ instanced wind-swept grass
  // ------------------------------------------------ grass: curved clumped blades in culled chunks, fading with distance
  buildGrass() {
    const total = this.quality > 0 ? 90000 : 26000;
    const SEG = 4, pos = [], col = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const y = i / SEG, w = 0.055 * (1 - Math.pow(y, 1.4)) + 0.004, bend = y * y * 0.32;
      const c = [0.13 + 0.55 * y, 0.26 + 0.62 * y, 0.08 + 0.3 * y];
      if (i < SEG) { pos.push(-w, y, bend, w, y, bend); col.push(...c, ...c); }
      else { pos.push(0, y, bend); col.push(...c); }
    }
    for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    idx.push((SEG - 1) * 2, (SEG - 1) * 2 + 1, SEG * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = TIME;
      sh.vertexShader = 'uniform float uTime; varying float vTip;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp=modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
        float hh=position.y; vTip=hh;
        float fade=1.0-smoothstep(42.0,68.0,distance(wp.xyz,cameraPosition));
        float gust=sin(uTime*0.9+wp.x*0.08-wp.z*0.05)*0.5+0.5;
        float wv=sin(uTime*1.8+wp.x*0.3+wp.z*0.22)*0.3+sin(uTime*3.3+wp.x*0.9+wp.z*0.4)*0.1+gust*0.5;
        transformed.x+=wv*hh*hh*0.35; transformed.z+=wv*hh*hh*0.22; transformed.y-=wv*hh*hh*0.07;
        transformed*=fade;`);
      sh.fragmentShader = 'varying float vTip;\n' + sh.fragmentShader
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(0.28,0.32,0.1) * smoothstep(0.45,1.0,vTip);');
    };
    const CH = 18, chunks = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < total && guard++ < total) {
      const r = Math.pow(Math.random(), 0.62) * 88, a = Math.random() * TAU, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (r < 11.2) continue;
      if (Math.abs(Math.sin(Math.atan2(cz, cx) * 2)) < 0.06 && r < 44) continue;
      const patch = fbm(cx * 0.05, cz * 0.05, 2);
      if (patch < -0.38 || this.heightAt(cx, cz) < -1.2 || this.normalAt(cx, cz).y < 0.82) continue;
      const nClump = 5 + Math.floor(Math.random() * 9), hue = 0.2 + Math.random() * 0.06 + patch * 0.04, tall = 0.3 + Math.max(0, patch) * 0.6 + Math.random() * 0.2;
      for (let k = 0; k < nClump && placed < total; k++) {
        const ang = Math.random() * TAU, d = Math.random() * 0.35, x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
        p.set(x, this.heightAt(x, z) - 0.04, z);
        e.set((Math.random() - 0.5) * 0.4 + Math.sin(ang) * d * 0.8, Math.random() * TAU, (Math.random() - 0.5) * 0.4 - Math.cos(ang) * d * 0.8); q.setFromEuler(e);
        const h = tall * (0.6 + Math.random() * 0.6);
        sc.set(0.8 + Math.random() * 0.6, h, 0.8 + Math.random() * 0.4);
        m.compose(p, q, sc);
        c.setHSL(hue + (Math.random() - 0.5) * 0.03, 0.5 + Math.random() * 0.15, 0.44 + Math.random() * 0.14);
        if (Math.random() < 0.012) c.setHSL([0.0, 0.12, 0.6, 0.8, 0.95][Math.floor(Math.random() * 5)], 0.8, 0.72);
        const key = Math.floor(x / CH) + ',' + Math.floor(z / CH);
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push([m.clone(), c.clone()]);
        placed++;
      }
    }
    for (const list of chunks.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([mm, cc], i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, cc); });
      mesh.computeBoundingSphere(); mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  update(dt, fx, camera) {
    for (const f of this.anim) f(dt);
    if (camera) this.sunView.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
    if (fx) {
      if (this.sakura.length && Math.random() < dt * 14) {
        const s = this.sakura[Math.floor(Math.random() * this.sakura.length)];
        fx.smoke.emit({ x: s.x + rand(-2, 2), y: s.y + rand(-1, 1), z: s.z + rand(-2, 2), vx: rand(0.5, 1.5), vy: rand(-0.6, -0.2), vz: rand(-0.5, 0.5), life: 6, size: 0.2, color: new THREE.Color(0xffc2da), alpha: 1, drag: 0.2, grav: 0.15, frame: 5, spin: rand(-3, 3), turb: 0.6, style: 3 });
      }
      if (Math.random() < dt * 12) {
        const a = Math.random() * TAU, r = Math.random() * 50;
        fx.glow.emit({ x: Math.cos(a) * r, y: this.heightAt(Math.cos(a) * r, Math.sin(a) * r) + rand(0.5, 3), z: Math.sin(a) * r, vx: rand(-0.2, 0.2), vy: rand(0.05, 0.2), vz: rand(-0.2, 0.2), life: 5, size: 0.08, color: new THREE.Color(0xfff2a0), alpha: 0.8, drag: 0.1, turb: 0.3, frame: 0 });
      }
    }
  }
}
