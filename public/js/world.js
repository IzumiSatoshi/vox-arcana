import * as THREE from 'three';
import { NOISE, TIME, addOutline, addRim } from './shaders.js';
import { fbm, smooth, rand, mulberry32, TAU, clamp } from './util.js';
import { MagicCircle } from './magicCircle.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { stoneBlock, boulder, CLOUD, CLOUD_GLSL } from './style.js';

// Procedural weathered stone (hand-painted look): per-block tint (vertex colour), warm/cool hue drift, worn bright bevels
// (screen-space curvature), cracks, block joints, rain streaks under ledges and two-tone painterly moss on top faces.
export function stoneMaterial(color, { moss = 1, joint = 0, rough = 0.9, grime = 1, tiles = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMoss = { value: moss }; sh.uniforms.uJoint = { value: joint }; sh.uniforms.uGrime = { value: grime }; sh.uniforms.uTiles = { value: tiles };
    // pattern space: world space for the baked statics (identity transform); bobbing islands and rising spell walls keep
    // their paint because vertical motion is left out
    // aGround: terrain height under each vertex (added when statics are baked); the height above it drives base grime
    sh.vertexShader = 'attribute float aGround; varying vec3 vWP; varying vec3 vWN; varying float vGH;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP=mat3(modelMatrix)*transformed+vec3(modelMatrix[3].x,0.0,modelMatrix[3].z); vWN=normalize(mat3(modelMatrix)*objectNormal); vGH=vWP.y-aGround;');
    sh.fragmentShader = 'varying vec3 vWP; varying vec3 vWN; varying float vGH; uniform float uMoss, uJoint, uGrime, uTiles; float sBump;\n' + NOISE + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P=vWP, WN=normalize(vWN);
        float n1=snoise(P*0.32), n2=snoise(P*1.6+3.1), n3=snoise(P*5.5+7.0);
        vec3 base=diffuseColor.rgb*mix(vec3(0.92,0.96,1.05),vec3(1.07,1.0,0.88),smoothstep(-0.5,0.5,n1));
        base*=0.92+n2*0.07+n3*0.045;
        sBump=n2*0.8+n3*0.12;
        // worn bevels catch the light: curvature from how fast the normal turns across the pixel
        float curv=clamp(length(fwidth(WN))/max(length(fwidth(P)),1e-4)*0.22,0.0,1.0);
        base=mix(base,base*1.22+vec3(0.035,0.03,0.02),smoothstep(0.2,0.8,curv)*0.75);
        float crack=smoothstep(0.055,0.0,abs(n2+n3*0.18))*smoothstep(-0.1,0.5,n1);
        float jy=uJoint>0.0? smoothstep(0.05,0.0,0.5-abs(fract(P.y/uJoint)-0.5)) : 0.0;
        float streak=smoothstep(0.35,0.95,snoise(vec3(P.x*2.4,P.y*0.22,P.z*2.4)))*(1.0-abs(WN.y));
        base*=1.0-streak*0.2;
        base*=1.0-max(jy*0.45,crack*0.5);
        // polar paving (dais top): staggered rings of flagstones, each with its own tint, worn bright edges and dark joints
        float tj=1.0;
        if(uTiles>0.0 && WN.y>0.7){
          float r=length(P.xz), ring=floor(r/uTiles), segs=max(1.0,floor(6.2832*(ring+0.5)*uTiles/2.1));
          float fa=(atan(P.z,P.x)+ring*1.3)/6.2832*segs, seg=floor(fa);
          float jr=(0.5-abs(fract(r/uTiles)-0.5))*uTiles, ja=(0.5-abs(fract(fa)-0.5))/segs*6.2832*r;
          tj=ring<0.5? 1.0 : min(jr,ja);
          float th=fract(sin(dot(vec2(ring,seg),vec2(12.9898,78.233)))*43758.5453);
          base*=(0.9+th*0.16)*mix(vec3(1.0),vec3(1.05,1.0,0.93),step(0.6,th));
          base=mix(base,base*1.14,smoothstep(0.04,0.1,tj)*(1.0-smoothstep(0.1,0.18,tj)));
          base*=mix(0.5,1.0,smoothstep(0.025,0.055,tj+n3*0.012));
        }
        float mossM=smoothstep(0.38,0.72,WN.y+n1*0.35+n3*0.12)*uMoss;
        mossM=max(mossM,smoothstep(0.7,0.95,n1*0.5+0.5+n2*0.2)*0.3*uMoss*(1.0-WN.y*0.5)); // a few creeping patches on the sides
        mossM=smoothstep(0.35,0.55,mossM); // painterly hard-ish edge
        vec3 mossC=mix(vec3(0.21,0.35,0.12),vec3(0.47,0.60,0.20),smoothstep(0.15,0.95,WN.y*0.8+n1*0.3))*(0.95+n3*0.05); // lit from above, low-frequency only (no camo)
        mossM=max(mossM,(1.0-smoothstep(0.02,0.07,tj))*smoothstep(0.0,0.4,n1+n2*0.3)); // grass in the paving joints
        base=mix(base,mossC,mossM);
        // grounded: damp, darker, greener base where stone meets the meadow; painted lighter toward the top
        float gh=vGH+n2*0.3;
        base=mix(base,base*vec3(0.6,0.67,0.52),(1.0-smoothstep(0.0,1.3,gh))*0.6*uGrime);
        base*=mix(1.0,mix(0.9,1.07,smoothstep(0.0,6.0,gh)),uGrime);
        diffuseColor.rgb=base;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor=clamp(roughnessFactor+0.08*sBump,0.5,1.0);')
      // chiselled relief: bump from the colour noise's own screen derivatives (no extra noise evaluations)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 dpx=dFdx(-vViewPosition), dpy=dFdy(-vViewPosition); float bx=dFdx(sBump), by=dFdy(sBump);
          vec3 r1=cross(dpy,normal), r2=cross(normal,dpx); float det=dot(dpx,r1);
          normal=normalize(abs(det)*normal-sign(det)*(bx*r1+by*r2)*0.008); }`);
  };
  m.customProgramCacheKey = () => 'stone3'; // moss/joint/grime/tiles are uniforms: every stone shares one program
  m.userData.ground = grime > 0;
  return m;
}
// per-block tint so a wall is never one flat colour
function tintGeo(g, rng, amt = 0.1) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  const k = 1 - amt / 2 + rng() * amt, warm = (rng() - 0.5) * amt * 0.6;
  for (let i = 0; i < n; i++) { c[i * 3] = k + warm; c[i * 3 + 1] = k; c[i * 3 + 2] = k - warm; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// Merge every static mesh under `group` into one mesh per material (huge draw-call saving)
function bake(scene, group, heightAt, outline = 0.025) {
  group.updateMatrixWorld(true);
  const buckets = new Map(), uses = new Map();
  group.traverse((m) => { if (m.isMesh) uses.set(m.geometry, (uses.get(m.geometry) || 0) + 1); });
  group.traverse((m) => {
    if (!m.isMesh) return;
    // the statics are thrown away after baking, so a geometry used once is transformed in place (cloning thousands of
    // bricks dominated load time); only shared geometry is copied
    const g = uses.get(m.geometry) > 1 ? m.geometry.clone() : m.geometry;
    // stay indexed: the shared-vertex form is 3-6x fewer vertices through the colour, outline, shadow and AO passes
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(m.matrixWorld);
    if (!buckets.has(m.material)) buckets.set(m.material, { list: [], outline: !m.userData.noOutline });
    buckets.get(m.material).list.push(g);
  });
  const out = [];
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.list, false);
    if (mat.userData.ground) { // terrain height under every vertex, for the stone shader's base grime
      const p = merged.attributes.position, gnd = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) gnd[i] = heightAt(p.getX(i), p.getZ(i));
      merged.setAttribute('aGround', new THREE.BufferAttribute(gnd, 1));
    }
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
    const ch = 1 + fbm(x * 2 + seed, y * 1.3 + z * 2, 3) * 0.05; // weathered, slightly irregular drums
    p.setXYZ(i, x * ch, y, z * ch);
  }
  g.translate(0, h / 2, 0); g.computeVertexNormals();
  return g;
}

const _fw = new THREE.Vector3(), _fc = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _cf = new THREE.Vector3();
export const ARENA_R = 112;
const TERRACE_R = 80, TERRACE_H = 7;
// cliff-sided tablelands between the dirt paths: polar angle a, distance r, radius R, height h, and the ramp's heading
// (0 = descending toward the arena centre, radians of turn off that)
export const MESAS = [
  { a: 0.79, r: 52, R: 11, h: 4.5, ramp: 0.5 },
  { a: 2.3, r: 48, R: 8.5, h: 3.4, ramp: -0.6 },
  { a: 3.95, r: 54, R: 12, h: 6, ramp: 0.35 },
  { a: 5.45, r: 47, R: 9, h: 3.8, ramp: -0.45 },
  { a: 1.15, r: 42, R: 6, h: 3.2, ramp: -0.8 },
  { a: 4.42, r: 42, R: 6.5, h: 3.4, ramp: 0.8 },
].map((m) => {
  const x = Math.cos(m.a) * m.r, z = Math.sin(m.a) * m.r, t = Math.atan2(-z, -x) + m.ramp;
  return { ...m, x, z, dx: Math.cos(t), dz: Math.sin(t) };
});
export const SEA_Y = -3;
export const SUN_DIR = new THREE.Vector3(-0.55, 0.52, -0.65).normalize();
// the shadow camera's right/up axes (as lookAt builds them), for snapping the shadow box to its texel grid
const SUN_X = new THREE.Vector3(0, 1, 0).cross(SUN_DIR).normalize(), SUN_Y = SUN_DIR.clone().cross(SUN_X);
const FOG = 0xb4cde6;

let toonGrad = null;
export function toonGradient() {
  if (toonGrad) return toonGrad;
  // soft cel ramp matching style.js: cool core shadow, a narrow soft terminator, then a lit plateau with a gentle highlight
  const N = 64, d = new Uint8Array(N * 4), sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < N; i++) { const x = i / (N - 1), v = 0.42 + 0.44 * sm(0.3, 0.42, x) + 0.14 * sm(0.75, 0.95, x); d.fill(Math.round(v * 255), i * 4, i * 4 + 3); d[i * 4 + 3] = 255; }
  toonGrad = new THREE.DataTexture(d, N, 1, THREE.RGBAFormat); toonGrad.minFilter = toonGrad.magFilter = THREE.LinearFilter; toonGrad.needsUpdate = true;
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
  // pointed, veined leaves (drawn back to front, darker underneath) so crown silhouettes read as foliage, not blobs
  for (let i = 0; i < 64; i++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * 44, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    const s = 0.62 + (i / 64) * 0.3 + rng() * 0.08, L = 12 + rng() * 5, W = 5 + rng() * 2;
    g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2 + (rng() - 0.5) * 1.2);
    g.fillStyle = `rgb(${255 * s},${255 * s},${255 * s})`;
    g.beginPath(); g.moveTo(0, -L); g.quadraticCurveTo(W * 1.3, -L * 0.2, 0, L); g.quadraticCurveTo(-W * 1.3, -L * 0.2, 0, -L); g.fill();
    g.strokeStyle = `rgba(${170 * s},${170 * s},${170 * s},0.8)`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -L * 0.8); g.lineTo(0, L * 0.85); g.stroke();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(cv);
  return leafTex;
}
function canopyMaterial(color, sunView) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null }, uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } }]), uCloudT: { value: CLOUD } },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute vec2 aCorner; attribute float aRand; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying float vR; varying float vH; varying vec3 vCol; varying vec3 vVP;
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
        vVP=mvPosition.xyz;
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${CLOUD_GLSL}
      uniform sampler2D uTex; uniform vec3 uColor; uniform vec3 uSunView;
      varying vec2 vUv; varying vec3 vN; varying float vR; varying float vH; varying vec3 vCol; varying vec3 vVP;
      void main(){
        vec4 t=texture2D(uTex,vUv); if(t.a<0.5) discard;
        vec3 uColor2=uColor*vCol;
        vec3 N=normalize(vN);
        float ndl=dot(N,normalize(uSunView));
        float shade=(smoothstep(-0.15,0.05,ndl)*0.55+smoothstep(0.35,0.55,ndl)*0.25)*cloudShade(vVP)+0.28;
        vec3 c=uColor2*(0.85+vR*0.3)*t.r*shade;
        c*=0.7+0.3*smoothstep(-0.8,0.6,vH);
        c+=uColor2*vec3(0.25,0.3,0.05)*smoothstep(0.6,1.0,-ndl*0.5+0.5)*0.3;
        // back-lit crowns: light through the leaves at the silhouette when looking toward the sun
        float bl=pow(clamp(dot(normalize(-vVP),normalize(uSunView)),0.0,1.0),5.0)*(1.0-abs(N.z)*0.6);
        c+=uColor2*vec3(0.85,1.0,0.35)*bl*0.55*t.r;
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

// Tapered limb along a curve (TubeGeometry has one radius; shrink each ring toward the curve from r0 to r1).
function taperTube(curve, r0, r1, segs = 10, radial = 7) {
  const tube = new THREE.TubeGeometry(curve, segs, r0, radial, false), P = tube.attributes.position, pt = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) { curve.getPointAt(i / segs, pt); const k = 1 + (r1 / r0 - 1) * (i / segs); for (let j = 0; j <= radial; j++) { const idx = i * (radial + 1) + j; v.fromBufferAttribute(P, idx).sub(pt).multiplyScalar(k).add(pt); P.setXYZ(idx, v.x, v.y, v.z); } }
  tube.computeVertexNormals();
  return tube;
}
// Stylised trunk: root-flared lathe with buttress lobes, a lazy S-sway and gnarled bulges. Base at y 0.
function treeTrunk(h, seed) {
  const prof = [[0.78, 0], [0.52, 0.22], [0.42, 0.6], [0.36, h * 0.35], [0.3, h * 0.7], [0.24, h]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12, 0, TAU), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), an = Math.atan2(z, x), yy = y / h;
    const lobe = 1 + Math.pow(Math.max(0, Math.cos(an * 4 + seed)), 2) * Math.max(0, 1 - y / 0.9) * 0.6 + fbm(an * 1.5 + seed, y * 0.8, 2) * 0.12;
    P.setXYZ(i, x * lobe + Math.sin(yy * 2.5 + seed) * 0.35 * yy, y, z * lobe + Math.cos(yy * 1.7 + seed) * 0.15 * yy);
  }
  g.computeVertexNormals();
  return g;
}

// Hexagonal crystal spire: a prism with a faceted point, base at y 0 (flat facets: the gem shader lights per facet)
function crystalSpire(r, h, tip = 0.35) {
  const g = new THREE.CylinderGeometry(r * 0.82, r, h * (1 - tip), 6, 1).translate(0, h * (1 - tip) / 2, 0);
  const cap = new THREE.ConeGeometry(r * 0.82, h * tip, 6, 1).translate(0, h * (1 - tip) + h * tip / 2, 0);
  const m = mergeGeometries([g.toNonIndexed(), cap.toNonIndexed()]); m.computeVertexNormals();
  return m;
}
// Stylised gem: opaque (reads in daylight), cel-banded facets from deep to bright, a glowing fresnel rim, a luminous
// core gradient up the spire and a slow shimmer band sliding through it. Emissive enough to bloom at the edges only.
function gemMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uCol: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vY;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); vP=position; vY=position.y;
        gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vY;
      void main(){
        vec3 L=normalize(vec3(0.3,0.8,0.5));
        float d=dot(normalize(vN),L)*0.5+0.5;
        float band=floor(d*3.0)/3.0;                                   // three cel bands per facet
        vec3 deep=uCol*0.35, mid=uCol*0.85, hi=mix(uCol,vec3(1.0),0.55);
        vec3 c=mix(deep,mid,smoothstep(0.0,0.4,band)); c=mix(c,hi,smoothstep(0.55,0.7,band));
        float fres=pow(1.0-max(dot(normalize(vN),normalize(vV)),0.0),2.5);
        c+=uCol*fres*1.4;                                               // glowing rim
        c+=uCol*smoothstep(0.0,1.0,vY*0.3)*0.25;                        // luminous toward the tip
        float sh=smoothstep(0.92,1.0,sin(vY*2.0-uTime*1.6+vP.x*1.5)*0.5+0.5);
        c+=mix(uCol,vec3(1.0),0.6)*sh*0.9;                              // shimmer band
        gl_FragColor=vec4(c,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Floating rock: sculpted boulder stretched into a tapering carrot with strata and a grassy cap.
function islandGeo(seed) {
  const r2 = mulberry32(seed), g = boulder(r2, { detail: 4, squash: 1, rough: 0.35 }), p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0.05) { const t = -y; y = -t * 2.4 - t * t * 0.8; const k = Math.max(0.12, 1 - t * 0.75); x *= k; z *= k; }
    else y = 0.05 + y * 0.18;
    p.setXYZ(i, x, y, z);
    const grassy = y > 0.02 ? 1 : 0, strata = 0.5 + 0.5 * Math.sin(y * 9 + fbm(x * 2, z * 2, 2) * 2);
    col.push(...(grassy ? [0.36, 0.55, 0.22] : [0.5 + strata * 0.12, 0.45 + strata * 0.1, 0.38 + strata * 0.08]));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}

// Wind-swept meadow foliage (grass blades, flowers). Each instance picks up the same world-space warm/cool drift as the
// terrain under it so the blades melt into the ground instead of a uniform lime carpet; gusts roll brighter waves across.
// up to four bodies (player, bots) that part the grass around them, then up to four blast gusts that flatten it in an
// expanding ring and let it spring back; shared by every meadow material (w = radius, PUSHK = strength)
const PUSH = { value: [...Array(8)].map(() => new THREE.Vector4(0, -999, 0, 0)) }, PUSHK = { value: new Array(8).fill(1) };
function meadowMaterial(flower = false, ground = null) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME; sh.uniforms.uPush = PUSH; sh.uniforms.uPushK = PUSHK;
    if (ground) { sh.uniforms.uGround = { value: ground.tex }; sh.defines = { ...sh.defines, GROUND_WRAP: 1, ...(flower ? { GROUND_FLOWER: 1 } : {}), G_N: ground.n.toFixed(1), G_HALF: (ground.size / 2).toFixed(2), G_STEP: (ground.size / (ground.n - 1)).toFixed(5) }; }
    sh.vertexShader = 'uniform float uTime; uniform vec4 uPush[8]; uniform float uPushK[8]; varying float vTip; varying vec3 vMeadow;\n#ifdef GROUND_WRAP\nuniform sampler2D uGround;\n#endif\n' + (flower ? 'attribute float aHead;\n' : '') + NOISE + sh.vertexShader
      .replace('#include <color_vertex>', flower ? `vColor = color;
        #ifdef USE_INSTANCING_COLOR
          vec3 petal = instanceColor.rgb;
          #ifdef GROUND_FLOWER
            { // a field blooms in one colour (white, buttercup, pink or lilac), each flower a shade off it
              vec4 wq=modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
              float fa=texture2D(uGround,((wq.xz+G_HALF)/G_STEP+0.5)/G_N).a;
              vec3 fc=fa<0.3? vec3(1.0,0.98,0.94) : fa<0.5? vec3(1.0,0.84,0.32) : fa<0.72? vec3(1.0,0.62,0.78) : vec3(0.78,0.66,1.0);
              petal=fc*(0.85+0.3*instanceColor.r);
            }
          #endif
          vColor.rgb *= mix(vec3(1.0), petal * 0.8, aHead); // sunlit petals stay under the bloom threshold (else a cluster blooms into a glowing square)
        #endif` : '#include <color_vertex>')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp=modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
        #ifdef GROUND_WRAP
          // camera-following tile: stand on the terrain (height from the baked grid) where the ground mask allows grass
          vec4 gs=texture2D(uGround,((wp.xz+G_HALF)/G_STEP+0.5)/G_N);
          wp.y=gs.r;
          #ifdef GROUND_FLOWER
            float fr=fract(sin(float(gl_InstanceID)*12.9898)*43758.5453); // thinned by the field density
            float gk=step(fr,gs.b)*(1.0-smoothstep(12.0,18.5,distance(wp.xz,cameraPosition.xz)));
          #else
            float gk=gs.g*(1.0-smoothstep(12.0,18.5,distance(wp.xz,cameraPosition.xz)));
          #endif
        #endif
        float hh=${flower ? 'position.y*1.9' : 'position.y'}; vTip=hh;
        float fade=1.0-smoothstep(${flower ? '22.0,34.0' : '42.0,68.0'},distance(wp.xyz,cameraPosition)); // tiny flower heads shimmer when sub-pixel
        float gust=sin(uTime*0.9+wp.x*0.08-wp.z*0.05)*0.5+0.5;
        float wv=sin(uTime*1.8+wp.x*0.3+wp.z*0.22)*0.3+sin(uTime*3.3+wp.x*0.9+wp.z*0.4)*0.1+gust*0.5;
        // bend in WORLD space (one coherent wind; bodies part the blades), then bring it into the instance's local frame
        vec3 bend=vec3(0.83,-0.12,0.55)*wv*0.36;
        for(int i=0;i<8;i++){
          vec2 dp=wp.xz-uPush[i].xz; float dl=length(dp);
          float f=(1.0-smoothstep(0.25,uPush[i].w,dl))*step(abs(wp.y-uPush[i].y),i<4?1.6:4.0)*uPushK[i];
          bend+=vec3(dp.x/max(dl,1e-3)*f*1.25,-f*0.45,dp.y/max(dl,1e-3)*f*1.25);
        }
        mat3 IM=mat3(instanceMatrix); float sy=length(IM[1]);
        vec3 lb=transpose(IM)*bend/vec3(dot(IM[0],IM[0]),dot(IM[1],IM[1]),dot(IM[2],IM[2]));
        transformed+=lb*hh*hh*sy;
        #ifdef GROUND_WRAP
          transformed*=gk;
          transformed+=transpose(IM)*vec3(0.0,gs.r-(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).y,0.0)/vec3(dot(IM[0],IM[0]),dot(IM[1],IM[1]),dot(IM[2],IM[2]));
        #endif
        transformed*=fade;
        float nA=snoise(vec3(wp.xz*0.035,0.0)), nC=snoise(vec3(wp.xz*0.012,7.0));
        vMeadow=mix(vec3(1.0),vec3(1.1,1.05,0.72),smoothstep(0.15,0.7,nA)*0.55)*mix(vec3(1.0),vec3(0.78,0.92,1.02),smoothstep(0.1,0.7,nC)*0.5)*(0.9+nA*0.1);
        vMeadow*=1.0+smoothstep(0.75,1.0,gust)*hh*0.18;`);
    sh.fragmentShader = 'varying float vTip; varying vec3 vMeadow;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n ${flower ? '' : 'diffuseColor.rgb *= vMeadow;'}`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
      .replace('#include <emissivemap_fragment>', flower ? '#include <emissivemap_fragment>' : `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.16,0.18,0.06) * smoothstep(0.45,1.0,vTip);
        #if NUM_DIR_LIGHTS > 0
          // sun shining through the blades when you look toward it: warm yellow-green glow on the tips
          float trans = pow(saturate(dot(normalize(-vViewPosition), directionalLights[0].direction)), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0,1.1,0.35) * trans * smoothstep(0.2,1.0,vTip) * 0.7;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'meadow' + flower + !!ground;
  return mat;
}

// Procedural cumulus card (see buildDistant). Plane space p: x 0..2, y 0..1 (base near y 0.1).
function cloudMaterial(seed, tall, haze) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uSeed: { value: seed }, uTall: { value: tall }, uHaze: { value: haze }, uL: { value: new THREE.Vector3(0, 1, 0) }, uHor: { value: new THREE.Color(0.58, 0.76, 0.93) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: NOISE + /* glsl */ `
      uniform float uTime, uSeed, uTall, uHaze; uniform vec3 uL, uHor; varying vec2 vUv;
      float h1(float n){ return fract(sin(n*12.9898+uSeed*78.233)*43758.5453); }
      float env(vec2 p){ // union of domes, tallest mid-cloud; flat base
        float e=-1.0;
        for(int i=0;i<5;i++){
          float fi=float(i), u=(fi+0.5)/5.0, dome=sin(3.14159*u);
          float r=min(0.42,(0.26+h1(fi)*0.14)*(0.55+dome*0.65)*uTall);
          vec2 c=vec2(0.5+1.0*u+(h1(fi+7.0)-0.5)*0.15, min(0.1+r*(0.25+0.6*dome*uTall), 0.9-r));
          vec2 d=(p-c)/vec2(r*1.1,r);
          e=max(e,1.0-dot(d,d));
        }
        return e*smoothstep(0.04,0.2,p.y);
      }
      float shape(vec2 p){ return env(p)+snoise(vec3(p*vec2(2.2,2.6)+uSeed*3.1,uTime*0.004))*0.2+snoise(vec3(p*4.5+uSeed*2.3,uTime*0.006))*0.055; } // domes + lumps
      void main(){
        vec2 p=vec2(vUv.x*2.0,vUv.y);
        float S=shape(p);
        float d=S+0.02+fbm3(vec3(p*vec2(4.4,5.2)+uSeed*1.7,uTime*0.006))*0.2+snoise(vec3(p*11.0,uSeed+uTime*0.01))*0.05;
        float soft=mix(0.32,0.03,smoothstep(0.1,0.42,p.y)); // wispy base, crisp top
        float a=smoothstep(0.0,soft,d)*smoothstep(0.0,0.06,vUv.x)*smoothstep(1.0,0.94,vUv.x)*smoothstep(1.0,0.92,vUv.y);
        if(a<0.004) discard;
        const float E=0.012;
        vec2 g=vec2(shape(p+vec2(E,0.0))-S, shape(p+vec2(0.0,E))-S)/E;
        vec3 N=normalize(vec3(-g*0.8,1.0));
        vec3 L=normalize(uL);
        float ndl=dot(N,L), lit=smoothstep(-0.08,0.28,ndl);
        vec3 litC=vec3(1.04,1.01,0.96), shC=vec3(0.54,0.61,0.82), bellyC=vec3(0.45,0.52,0.74);
        vec3 col=mix(shC,litC,lit);
        col=mix(col,bellyC,(1.0-smoothstep(0.1,0.4,p.y))*0.55*(1.0-lit*0.4));
        float back=max(-L.z,0.0), edge=1.0-smoothstep(0.0,0.14,d);
        float toSun=smoothstep(-0.2,0.6,dot(normalize(-g+1e-5),normalize(L.xy+1e-5)));
        col*=mix(1.0,0.84,back*(1.0-edge));
        col+=vec3(1.0,0.94,0.82)*edge*toSun*(0.12+back*1.1);
        col=mix(col,uHor,uHaze*(0.35+0.65*(1.0-smoothstep(0.1,0.5,p.y))));
        gl_FragColor=vec4(col,a);
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
}

export class World {
  constructor(scene, quality = 1) {
    this.scene = scene; this.quality = quality;
    this.obstacles = []; this.anim = []; this.canopyMats = []; this.boxes = []; this.gusts = [];
    this.statics = new THREE.Group(); // merged after construction
    this.sunView = new THREE.Vector3();
    this.buildSky(); this.buildLights(); this.buildTerrain(); this.buildWater();
    this.buildRuins(); this.buildLandmarks(); this.buildBanners(); this.buildCliffs(); this.buildTrees(); this.buildRocks(); this.buildCrystals(); this.buildDistant();
    this.buildGrass(); this.buildFerns(); this.buildBirds(); this.buildButterflies();
    bake(this.scene, this.statics, (x, z) => this.gridH(x, z));
    this.statics.clear();
  }

  // ------------------------------------------------ height field
  // Layout (outward from the centre): the rune dais, the ruin rings, a meadow broken by cliff-sided mesas (each with one
  // ramp), then a ring terrace whose cliff faces the arena, climbed by ramps where the four dirt paths meet it, and a
  // hilly rim that falls away to the sea. Cliffs are real: stepBody blocks walking up them and they stop spells.
  // a blast flattens the meadow around it (see PUSH): up to four at once, the oldest replaced
  gust(pos, radius) {
    this.gusts ||= [];
    const g = { x: pos.x, y: this.heightAt(pos.x, pos.z), z: pos.z, r: Math.max(2, radius * 2.2), t: 0, dur: 0.9 + radius * 0.08 };
    const free = this.gusts.findIndex((q) => !q || q.t >= q.dur);
    if (free >= 0 && free < 4) this.gusts[free] = g; else if (this.gusts.length < 4) this.gusts.push(g); else { this.gusts.shift(); this.gusts.push(g); }
  }
  heightAt(x, z) {
    const r = Math.hypot(x, z);
    let h = fbm(x * 0.018, z * 0.018, 4) * 2.4 + fbm(x * 0.07, z * 0.07, 2) * 0.3;
    h *= smooth(8, 40, r) * 0.85 + 0.15;
    // ring terrace
    const ringR = TERRACE_R + fbm(x * 0.02 + 11, z * 0.02, 3) * 7;
    const cliff = smooth(ringR - 1.3, ringR + 1.3, r), ramp = clamp((r - ringR + 15) / 17);
    const gate = smooth(7, 4, Math.min(Math.abs(x), Math.abs(z)) + fbm(x * 0.1, z * 0.1, 2) * 1.5);
    h += TERRACE_H * (1 + fbm(x * 0.012 + 3, z * 0.012, 2) * 0.7) * (cliff + (ramp - cliff) * gate);
    h += smooth(ringR + 8, ringR + 40, r) * (2 + fbm(x * 0.03 + 7, z * 0.03, 3) * 7);
    h -= smooth(ARENA_R + 26, ARENA_R + 58, r) * 28;
    // mesas
    for (const m of MESAS) {
      const dx = x - m.x, dz = z - m.z; if (Math.abs(dx) > m.R + 24 || Math.abs(dz) > m.R + 24) continue;
      const d = Math.hypot(dx, dz) + fbm(x * 0.09 + m.x, z * 0.09, 2) * 2.2;
      let k = 1 - smooth(m.R - 1.1, m.R + 1.1, d);
      const along = dx * m.dx + dz * m.dz, perp = Math.abs(dx * m.dz - dz * m.dx);
      if (along > 0 && perp < 5.5) k += (clamp(1 - (along - m.R + 3) / 15) - k) * smooth(5.5, 3.2, perp); // the ramp replaces the cliff across its corridor
      h += m.h * k;
    }
    if (r < 11) h = h * smooth(9, 11, r) + 0.35 * (1 - smooth(9, 11, r)); // dais
    return h;
  }
  // inside a ramp corridor (terrace gates and mesa ramps): keep props off these
  onRamp(x, z) {
    const r = Math.hypot(x, z);
    if (Math.min(Math.abs(x), Math.abs(z)) < 8 && r > TERRACE_R - 22) return true;
    if (r > 86 && r < 110) for (const a of [0.79, 2.36, 3.93, 5.5]) if (Math.hypot(x - Math.cos(a) * 98, z - Math.sin(a) * 98) < 10) return true; // landmarks
    for (const m of MESAS) {
      const dx = x - m.x, dz = z - m.z, along = dx * m.dx + dz * m.dz;
      if (along > m.R - 5 && along < m.R + 15 && Math.abs(dx * m.dz - dz * m.dx) < 6.5) return true;
    }
    return false;
  }
  // bilinear height from the terrain grid (build-time placement: cheaper than heightAt and matches the rendered mesh)
  gridH(x, z) {
    const g = this.hGrid; if (!g) return this.heightAt(x, z);
    const { n, size, pos } = g, st = size / (n - 1), fx = (x + size / 2) / st, fz = (z + size / 2) / st;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz))), u = fx - i, v = fz - j;
    const a = pos[(j * n + i) * 3 + 1], b = pos[(j * n + i + 1) * 3 + 1], c = pos[((j + 1) * n + i) * 3 + 1], d = pos[((j + 1) * n + i + 1) * 3 + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  gridUp(x, z) { const e = 0.6; return 2 * e / Math.hypot(this.gridH(x - e, z) - this.gridH(x + e, z), 2 * e, this.gridH(x, z - e) - this.gridH(x, z + e)); } // normal.y
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
    this.skyU = { uTime: TIME, uSun: { value: SUN_DIR }, uDom: { value: 0 }, uDomCol: { value: new THREE.Color(1, 1, 1) }, uCloudT: { value: CLOUD } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; varying vec3 vWorld; void main(){ vDir=position; vWorld=(modelMatrix*vec4(position,1.0)).xyz; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww; }`,
      fragmentShader: NOISE + /* glsl */ `
        uniform vec3 uSun,uDomCol; uniform float uTime,uDom; varying vec3 vDir; varying vec3 vWorld;
        ${CLOUD_GLSL}
        void main(){
          vec3 d=normalize(vDir); float y=d.y;
          vec3 zen=vec3(0.05,0.22,0.68), hor=vec3(0.58,0.76,0.93), gold=vec3(1.0,0.8,0.55);
          float s=max(dot(d,uSun),0.0);
          vec3 col=mix(hor,zen,pow(clamp(y,0.0,1.0),0.5));
          col=mix(col,gold,pow(s,6.0)*0.4*(1.0-clamp(y*1.5,0.0,1.0)));
          // crisp sun disc with a tight corona; the bloom pass supplies the wide glow (a huge disc blooms into a white blob)
          col+=vec3(1.0,0.95,0.82)*(smoothstep(0.99985,0.99992,s)*6.0+pow(s,900.0)*0.9+pow(s,120.0)*0.16+pow(s,10.0)*0.04);
          if(y<0.0) col=mix(hor,vec3(0.55,0.68,0.78),clamp(-y*4.0,0.0,1.0));
          // high wind-combed cirrus: long thin streaks with crisp edges (soft fbm blobs read as grey smudges)
          vec2 uv=d.xz/(max(y,0.02)+0.1);
          if(y>0.05){
            vec2 su=vec2(uv.x*0.8+uv.y*0.6,-uv.x*0.6+uv.y*0.8)*vec2(0.45,1.2)+vec2(uTime*0.004,0.0);
            float c=fbm3(vec3(su,uTime*0.004))+snoise(vec3(su*vec2(1.0,3.0)*2.0,1.0))*0.12;
            float cov=smoothstep(0.26,0.4,c)*smoothstep(0.05,0.3,y)*smoothstep(-0.3,0.2,snoise(vec3(uv*0.3,4.0)));
            vec3 cc=mix(vec3(0.84,0.9,1.0),vec3(1.0,0.99,0.96),smoothstep(0.3,0.55,c))+gold*pow(s,4.0)*0.4;
            col=mix(col,cc,cov*0.6);
          }
          // domain: an ultimate spell stains the heavens with its element
          // fair-weather cumulus deck at 190 m: the same density field that casts the drifting shade on the ground
          vec3 rd=normalize(vWorld-cameraPosition);
          if(rd.y>0.03){
            float tc=(190.0-cameraPosition.y)/rd.y; vec3 Q=cameraPosition+rd*tc;
            float n=cloudField(Q)+(csNoise(Q.xz*0.06+uCloudT.x*0.03)-0.5)*0.06+(csNoise(Q.xz*0.16)-0.5)*0.035; // billowy rims
            float cov=smoothstep(0.525,0.565,n)*(1.0-smoothstep(500.0,1500.0,tc))*uCloudT.y; // crisp toon edge (thresholds match the ground shade)
            float nS=cloudField(Q+vec3(uSun.x,0.0,uSun.z)*30.0);                            // density a step toward the sun
            float lit=smoothstep(-0.015,0.03,n-nS);                                          // thinning toward the sun: a lit flank
            float thick=smoothstep(0.54,0.74,n), sd=max(dot(rd,uSun),0.0);
            vec3 cc=mix(vec3(0.74,0.80,0.92),vec3(1.0,0.99,0.96),lit*0.85+(1.0-thick)*0.25); // two-tone cel: shaded belly / lit flank
            cc+=vec3(1.0,0.88,0.66)*pow(sd,6.0)*0.45*lit;                                    // warm glow on the sun side
            cc=mix(cc,hor,smoothstep(300.0,1800.0,tc)*0.6);                              // distance haze
            col=mix(col,cc,cov*0.95);
          }
          if(uDom>0.001){ // only pay for the swirl while a domain is up
            float swirl=fbm3(vec3(uv*0.5,uTime*0.15));
            vec3 dom=mix(uDomCol*0.12,uDomCol*0.9,smoothstep(-0.2,0.6,swirl))+uDomCol*pow(1.0-abs(y),6.0)*0.6;
            col=mix(col,dom,uDom*0.85);
          }
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), mat);
    // drawn after every opaque object (still before the transparent clouds): at depth 1.0 it only shades the pixels that
    // stay empty, instead of running its noise over the whole screen and being painted over
    sky.renderOrder = 1000; sky.frustumCulled = false;
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(FOG, 110, 760);
    this.scene.background = new THREE.Color(FOG);
  }
  buildLights() {
    const hemi = new THREE.HemisphereLight(0xc8daf2, 0x8d9a6c, 1.08);
    const sun = new THREE.DirectionalLight(0xffeccc, 3.4);
    sun.position.copy(SUN_DIR).multiplyScalar(120); sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    // a tight shadow box that follows the camera (see update) keeps shadows crisp instead of smearing 2k texels over the arena
    const S = this.shadowS = this.quality > 0 ? 46 : 60; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 300 });
    const sm = this.quality > 1 ? 4096 : this.quality > 0 ? 3072 : 1024; sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2;
    this.scene.add(hemi, sun, sun.target);
    this.sun = sun; this.hemi = hemi;
  }

  // ------------------------------------------------ terrain (vertex colours + painterly world-space variation)
  buildTerrain() {
    const size = 460, seg = this.quality > 0 ? 400 : 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    const cGrassA = new THREE.Color(0x4c8a34), cGrassB = new THREE.Color(0x8fb34c), cGrassC = new THREE.Color(0x356a30);
    const cRock = new THREE.Color(0x8a8478), cSand = new THREE.Color(0xdcc89a), cDirt = new THREE.Color(0x8e6c46), c = new THREE.Color();
    const hs = new Float32Array(pos.count), row = seg + 1, st = size / seg;
    for (let i = 0; i < pos.count; i++) hs[i] = this.heightAt(pos.getX(i), pos.getZ(i));
    const HS = (ii, jj) => hs[Math.min(row - 1, Math.max(0, jj)) * row + Math.min(row - 1, Math.max(0, ii))];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = hs[i], ci = i % row, cj = (i - ci) / row;
      pos.setY(i, Math.hypot(x, z) < 10.95 ? h - 0.6 : h); // the dais covers the centre: keep terrain well below it
      const gx = (HS(ci - 1, cj) - HS(ci + 1, cj)) / (2 * st), gz = (HS(ci, cj - 1) - HS(ci, cj + 1)) / (2 * st);
      const slope = 1 - 1 / Math.hypot(gx, 1, gz), v = fbm(x * 0.08, z * 0.08, 3);
      c.copy(cGrassA).lerp(cGrassB, clamp(v * 0.8 + 0.5)).lerp(cGrassC, clamp(fbm(x * 0.02 + 3, z * 0.02, 2) + 0.2));
      const r = Math.hypot(x, z);
      if (r < 11) c.lerp(cDirt, 0.3);
      c.lerp(cRock, smooth(0.16, 0.36, slope));
      c.lerp(cSand, Math.max(smooth(-1.2, -3.2, h), smooth(1.2, -1.0, h) * smooth(122, 140, r))); // sandy beach round the coast
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.hGrid = { n: seg + 1, size, pos: pos.array };
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWNrm;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWPos=(modelMatrix*vec4(transformed,1.0)).xyz; vWNrm=normalize(mat3(modelMatrix)*objectNormal);');
      sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWNrm;\n' + NOISE + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float nA=snoise(vec3(vWPos.xz*0.035,0.0)), nC=snoise(vec3(vWPos.xz*0.012,7.0));
        float nB=snoise(vec3(vWPos.xz*0.6,3.0)), nD=snoise(vec3(vWPos.xz*2.5,5.0));
        diffuseColor.rgb*=0.84+nA*0.12+nB*0.08+nD*0.04;
        // painted grass strokes near the camera: two crossing sets of short, combed dabs (bright tips / dark roots),
        // so the ground between blades reads as dense turf instead of flat paint. Fades out before it can alias.
        float camD=length(vWPos-cameraPosition), sfade=1.0-smoothstep(14.0,34.0,camD);
        if(sfade>0.0){
          vec2 q=vWPos.xz; float wa=nA*1.5;
          vec2 d1=vec2(cos(wa),sin(wa)), d2=vec2(-d1.y,d1.x);
          float s1=snoise(vec3(dot(q,d1)*1.6,dot(q,d2)*5.5,1.0)), s2=snoise(vec3(dot(q,d2)*1.4+7.0,dot(q,d1)*6.0,2.0));
          float st=max(s1,s2*0.9);
          diffuseColor.rgb*=1.0+(smoothstep(0.35,0.75,st)*0.16-smoothstep(-0.2,-0.7,st)*0.12)*sfade;
          diffuseColor.rgb+=vec3(0.03,0.04,0.0)*smoothstep(0.55,0.85,st)*sfade;
        }
        // painterly meadow: sunlit yellow-green drifts and cool blue-green hollows
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.1,1.05,0.72),smoothstep(0.15,0.7,nA)*0.55);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.78,0.92,1.02),smoothstep(0.1,0.7,nC)*0.5);
        // four worn dirt paths radiating from the dais: crisp edges, a packed lighter centre, pebbles, trampled grass border
        float pr=length(vWPos.xz), pd=abs(sin(atan(vWPos.z,vWPos.x)*2.0))*pr*0.5;
        float hw=(0.075+snoise(vec3(vWPos.xz*0.1,9.0))*0.025)*pr*0.5;
        float reach=smoothstep(10.5,12.0,pr)*(1.0-smoothstep(92.0,102.0,pr+nA*4.0));
        float path=(1.0-smoothstep(hw-0.1,hw+0.02,pd+nD*0.07))*reach;
        vec3 dirt=mix(vec3(0.28,0.18,0.09),vec3(0.4,0.29,0.16),smoothstep(hw,0.0,pd)*0.7+nB*0.2);
        dirt=mix(dirt,vec3(0.5,0.45,0.36),step(0.62,snoise(vec3(vWPos.xz*3.2,2.0)))*0.8);
        diffuseColor.rgb*=1.0-(1.0-smoothstep(hw,hw+0.45,pd))*(1.0-path)*reach*0.22;
        diffuseColor.rgb=mix(diffuseColor.rgb,dirt,path);
        // cliff faces: layered sandstone strata (warm bands, dark creases, pale ledges) with a grassy lip at the top
        float steep=(1.0-smoothstep(0.55,0.8,normalize(vWNrm).y+nD*0.06))*smoothstep(-1.2,0.6,vWPos.y); // not on the beach
        if(steep>0.001){
          float sy=vWPos.y*0.85+snoise(vec3(vWPos.xz*0.08,1.0))*0.7+nB*0.12;
          float band=fract(sy), bi=floor(sy);
          float th=fract(sin(bi*91.7)*4375.85);
          vec3 rock=mix(vec3(0.62,0.50,0.37),vec3(0.78,0.67,0.51),th)*(0.92+nD*0.08);
          rock=mix(rock,rock*0.55,smoothstep(0.8,0.95,band));           // crease under each ledge
          rock=mix(rock,rock*1.12+vec3(0.03),smoothstep(0.1,0.0,band)); // sunlit ledge lip
          // vertical joints split each stratum into blocks (a fresh pattern per band), each block its own tone
          float along=dot(vWPos.xz,vec2(0.71,0.71))*0.55+bi*1.7;
          float jn=snoise(vec3(along,bi*3.1,0.0));
          rock*=1.0-smoothstep(0.07,0.0,abs(jn))*0.45*smoothstep(0.02,0.12,band)*(1.0-smoothstep(0.84,0.9,band));
          rock*=0.94+0.1*fract(sin(floor(jn*3.0)+bi*7.3)*437.5);
          diffuseColor.rgb=mix(diffuseColor.rgb,rock,steep);
        }`);
    };
    // Preserve the original vertices/normals, including shared border normals.
    // Only split the index buffer so terrain behind the camera can be culled.
    this.terrain = new THREE.Group();
    const cells = 40, point = new THREE.Vector3();
    for (let row = 0; row < seg; row += cells) for (let col = 0; col < seg; col += cells) {
      const indices = [], bounds = new THREE.Box3();
      const rowEnd = Math.min(seg, row + cells), colEnd = Math.min(seg, col + cells);
      for (let y = row; y < rowEnd; y++) {
        for (let k = (y * seg + col) * 6; k < (y * seg + colEnd) * 6; k++) indices.push(geo.index.array[k]);
      }
      for (let y = row; y <= rowEnd; y++) for (let x = col; x <= colEnd; x++) {
        bounds.expandByPoint(point.fromBufferAttribute(pos, y * (seg + 1) + x));
      }
      const tile = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(geo.attributes)) tile.setAttribute(name, attr);
      tile.setIndex(indices); tile.boundingBox = bounds;
      tile.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(tile, mat); mesh.receiveShadow = true;
      mesh.updateMatrix(); mesh.matrixAutoUpdate = false; this.terrain.add(mesh);
    }
    this.scene.add(this.terrain);
    // central dais with glowing rune circle
    const stone = stoneMaterial(0xc4b9a2, { moss: 0.2, grime: 0, tiles: 1.7 });
    const dais = new THREE.Mesh(tintGeo(new THREE.CylinderGeometry(10, 10.8, 1.2, 96), mulberry32(1), 0), stone);
    dais.position.y = -0.25; dais.receiveShadow = true; this.scene.add(dais);
    const daisA = stoneMaterial(0xc2b8a2, { moss: 0.15, grime: 0 }), daisB = stoneMaterial(0xaea48e, { moss: 0.15, grime: 0 });
    for (let i = 0; i < 24; i++) { // flagstone rim
      const a = (i / 24) * TAU, b = new THREE.Mesh(tintGeo(stoneBlock(2.55, 0.35, 1.1, mulberry32(i + 3), { chip: 0.06, seg: 2 }), mulberry32(i)), i % 2 ? daisA : daisB);
      b.position.set(Math.cos(a) * 10.2, 0.2, Math.sin(a) * 10.2); b.rotation.y = -a + Math.PI / 2 + (Math.random() - 0.5) * 0.04; this.statics.add(b);
    }
    const mc = new MagicCircle({ seed: 7, tier: 9, color: 0x3fb8ff, radius: 8.5, intensity: 0.45 });
    mc.group.rotation.x = -Math.PI / 2; mc.group.position.y = 0.37; mc.spin = 0.05; this.scene.add(mc.group);
    // additive light vanishes on sunlit paving: an azure inlay (normal-blended) under the glow keeps the sigil legible
    for (const m of [mc.outer, mc.inner]) {
      const inlay = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ map: m.material.map, color: 0x3a7cc0, transparent: true, depthWrite: false, opacity: 0.42, side: THREE.DoubleSide }));
      inlay.position.z = -0.0006; inlay.renderOrder = -1; m.add(inlay); // local units: the circle is scaled 17x
    }
    this.anim.push((dt) => { mc.update(dt); mc.target = 0.45 + Math.sin(TIME.value * 0.8) * 0.15; });
  }

  // ------------------------------------------------ water
  buildWater() {
    // depth below the sea surface, baked from the height field: drives toon depth bands, shallow caustics and shore foam
    const DN = 256, DS = 480, dd = new Uint8Array(DN * DN);
    for (let j = 0; j < DN; j++) for (let i = 0; i < DN; i++) {
      const x = ((i + 0.5) / DN - 0.5) * DS, z = ((j + 0.5) / DN - 0.5) * DS;
      dd[j * DN + i] = Math.round(clamp((SEA_Y - this.heightAt(x, z)) / 12) * 255);
    }
    const depthTex = new THREE.DataTexture(dd, DN, DN, THREE.RedFormat, THREE.UnsignedByteType);
    depthTex.minFilter = depthTex.magFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: TIME, uSun: { value: SUN_DIR }, uFog: { value: new THREE.Color(FOG) }, uDepth: { value: depthTex }, uCloudT: { value: CLOUD } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: NOISE + /* glsl */ `
        uniform float uTime; uniform vec3 uSun,uFog; uniform sampler2D uDepth; varying vec3 vW;
        ${CLOUD_GLSL}
        void main(){
          vec3 toC=cameraPosition-vW; float d=length(toC); vec3 V=toC/d;
          vec2 duv=vW.xz/${DS.toFixed(1)}+0.5;
          float inside=step(abs(duv.x-0.5),0.495)*step(abs(duv.y-0.5),0.495);
          float depth=mix(12.0,texture2D(uDepth,duv).r*12.0,inside);
          // gentle rolling normals; fade the ripples with distance so the far sea stays clean instead of aliasing to grey
          vec2 p=vW.xz*0.06; float fadeN=1.0-smoothstep(25.0,320.0,d);
          float n1=snoise(vec3(p*1.6,uTime*0.18)), n2=snoise(vec3(p*1.6+11.0,uTime*0.18));
          float n3=0.0, n4=0.0;
          if(fadeN>0.0){ n3=snoise(vec3(p*5.0+3.0,uTime*0.4)); n4=snoise(vec3(p*5.0+17.0,uTime*0.4)); }
          vec3 N=normalize(vec3((n1*0.6+n3*0.25*fadeN)*0.22*(0.3+0.7*fadeN),1.0,(n2*0.6+n4*0.25*fadeN)*0.22*(0.3+0.7*fadeN)));
          float dn=depth+n1*0.35;
          // painted depth bands: sandy turquoise shallows -> lagoon teal -> ocean blue, with soft but visible steps
          vec3 cSh=vec3(0.36,0.86,0.80), cMid=vec3(0.06,0.62,0.74), cDeep=vec3(0.03,0.30,0.58), cAbyss=vec3(0.02,0.18,0.44);
          vec3 col=mix(cSh,cMid,smoothstep(1.3,1.9,dn));
          col=mix(col,cDeep,smoothstep(5.0,6.2,dn));
          col=mix(col,cAbyss,smoothstep(9.0,11.5,dn));
          // caustic web in the shallows
          if(depth<3.2 && fadeN>0.0){
            vec2 cp=vW.xz*0.45;
            float ca=1.0-abs(snoise(vec3(cp,uTime*0.35))); float cb=1.0-abs(snoise(vec3(cp*1.3+5.0,uTime*0.3)));
            float caus=smoothstep(0.86,0.96,ca*0.6+cb*0.45)*(1.0-smoothstep(0.4,3.2,depth))*fadeN;
            col+=vec3(0.55,0.95,0.9)*caus*0.35;
          }
          // sky reflection: toon fresnel (a soft band toward the horizon, not a noisy white sheen)
          vec3 Nf=normalize(vec3(N.x*0.3,1.0,N.z*0.3)); // flattened: the reflection follows swells, not every ripple
          float fres=pow(1.0-max(dot(Nf,V),0.0),5.0);
          vec3 sky=mix(vec3(0.55,0.76,0.95),vec3(0.80,0.90,1.0),smoothstep(0.5,0.95,fres));
          col=mix(col,sky,smoothstep(0.2,0.85,fres)*0.75);
          // soft white-cap streaks far out where the swell crests catch the sky
          col=mix(col,vec3(0.86,0.94,1.0),smoothstep(0.55,0.75,n1*0.7+n3*0.3)*smoothstep(0.35,0.8,fres)*0.25);
          // sun: a warm glitter path and crisp star-like glints
          vec3 R=reflect(-V,N); float sd=max(dot(R,uSun),0.0);
          float path=pow(sd,40.0);
          float glint=sd>0.93? step(0.72,snoise(vec3(vW.xz*0.9,uTime*1.4)))*smoothstep(0.93,0.99,sd) : 0.0;
          float csh=cloudShade((viewMatrix*vec4(vW,1.0)).xyz); // drifting cloud shade dulls the sea and kills the glints
          col*=0.82+0.18*csh;
          col+=vec3(1.0,0.93,0.78)*(path*0.35+glint*2.2*(0.35+0.65*fadeN))*smoothstep(0.6,1.0,csh);
          // shore: a solid lip of foam where the sea touches land, plus thin wave lines rolling in on the depth contours
          if(depth<1.7 && inside>0.0){
            float fn=snoise(vec3(vW.xz*0.18,uTime*0.25))*0.5+snoise(vec3(vW.xz*0.7,uTime*0.5))*0.25;
            float lip=1.0-smoothstep(0.12,0.22,depth+fn*0.12);
            float wph=fract(depth*0.75-uTime*0.22+fn*0.35);
            float line=smoothstep(0.08,0.0,abs(wph-0.5)-0.03)*(1.0-smoothstep(0.4,1.6,depth))*step(0.0,fn+0.25);
            col=mix(col,vec3(0.96,0.99,1.0),max(lip,line*0.85));
          }
          // aerial perspective matching the global fog tint
          col=mix(col,uFog,smoothstep(150.0,900.0,d)*0.9);
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1), mat);
    water.rotation.x = -Math.PI / 2; water.position.y = SEA_Y;
    water.renderOrder = 999; // after the island's opaque geometry: early depth rejection skips the sea hidden under land
    this.scene.add(water);
  }

  // ------------------------------------------------ ruins
  buildRuins() {
    const stone = stoneMaterial(0xe0d6c2, { moss: 0.8, joint: 1.6 }), block = stoneMaterial(0xc4b89e, { moss: 0.9 }), dark = stoneMaterial(0xa89c84, { moss: 1 });
    const gold = toon(0xd9b25a, { emissive: 0x3a2a00 });
    const rng = mulberry32(42), G = this.statics;
    const put = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) => { const m = new THREE.Mesh(tintGeo(geo, rng), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); G.add(m); return m; };
    const blk = (w, h, d, chip = 0.05) => stoneBlock(w, h, d, rng, { chip, seg: Math.max(w, h, d) > 1.6 ? 3 : Math.max(w, h, d) > 1.0 ? 2 : 1 });
    const rubble = (cx, cz, n, spread) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (rng() - 0.5) * spread, z = cz + (rng() - 0.5) * spread, s = 0.25 + rng() * 0.55;
        put(blk(s * (1 + rng()), s * 0.7, s, 0.14), rng() < 0.5 ? block : dark, x, this.heightAt(x, z) + s * 0.2, z, rng() * TAU, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5);
      }
    };
    const column = (x, z, h, broken) => {
      const y = this.heightAt(x, z) - 0.25, ry = rng() * TAU;
      put(blk(2.3, 0.45, 2.3, 0.08), dark, x, y + 0.22, z, ry);
      put(new THREE.CylinderGeometry(1.08, 1.12, 0.28, 32), block, x, y + 0.58, z, ry);
      put(new THREE.TorusGeometry(0.95, 0.1, 8, 36), block, x, y + 0.74, z, ry, Math.PI / 2);
      put(flutedColumn(h, broken, rng), stone, x, y + 0.72, z, ry);
      if (!broken) {
        put(new THREE.TorusGeometry(0.84, 0.08, 8, 32), gold, x, y + 0.72 + h - 0.05, z, 0, Math.PI / 2);
        put(new THREE.CylinderGeometry(1.1, 0.84, 0.38, 32), block, x, y + 0.72 + h + 0.18, z, ry);
        put(blk(2.3, 0.38, 2.3, 0.08), dark, x, y + 0.72 + h + 0.55, z, ry);
      } else {
        const L = 1.2 + rng() * 1.6, a = rng() * TAU;
        const drum = put(flutedColumn(L, false, rng), stone, x + Math.cos(a) * 2.2, this.heightAt(x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2) + 0.8, z + Math.sin(a) * 2.2, a, Math.PI / 2);
        drum.geometry.translate(0, -L / 2, 0);
        rubble(x, z, 6, 5);
      }
      this.obstacles.push({ x, z, r: 1.05, y0: y, h: h + 1.4 });
    };
    // hilltop shrines on the two broad mesas: a broken colonnade round a stone altar (a vantage point with cover)
    for (const m of [MESAS[0], MESAS[2]]) {
      const n = 6, rr = m.R * 0.55;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + 0.3, dx = Math.cos(a), dz = Math.sin(a);
        if (dx * m.dx + dz * m.dz > 0.75) continue; // leave the head of the ramp open
        column(m.x + dx * rr, m.z + dz * rr, 2.6 + rng() * 2.6, k % 2 === 0);
      }
      const y = this.heightAt(m.x, m.z);
      put(blk(2.6, 0.5, 1.8, 0.08), dark, m.x, y + 0.2, m.z, Math.atan2(m.dx, m.dz));
      put(blk(2.0, 0.7, 1.2, 0.06), block, m.x, y + 0.75, m.z, Math.atan2(m.dx, m.dz));
      this.obstacles.push({ x: m.x, z: m.z, r: 1.2, y0: y, h: 1.2 });
    }
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
        put(blk(1.9, 0.5, 1.9, 0.08), dark, px, y + 0.25, pz, yaw);
        for (let k = 0; k < 4; k++) put(blk(1.45 - (k % 2) * 0.08, 1.58, 1.45 - (k % 2) * 0.08, 0.06), stone, px + (rng() - 0.5) * 0.06, y + 0.5 + 0.8 + k * 1.6, pz + (rng() - 0.5) * 0.06, yaw + (rng() - 0.5) * 0.06);
        put(blk(1.75, 0.35, 1.75, 0.08), dark, px, y + 7.0, pz, yaw);
        this.obstacles.push({ x: px, z: pz, r: 0.95, y0: y, h: 7.2 });
      }
      for (let k = -1; k <= 1; k++) {
        const bx = cx + tx * k * 2.6, bz = cz + tz * k * 2.6;
        put(blk(k ? 3.2 : 2.0, k ? 1.1 : 1.45, 1.7, 0.06), k ? block : dark, bx, y + 7.75 + (k ? 0 : 0.12), bz, yaw);
      }
      rubble(cx, cz, 5, 7);
      const gem = new THREE.Mesh(mergeGeometries([crystalSpire(0.32, 0.9, 0.55), crystalSpire(0.32, 0.9, 0.55).rotateX(Math.PI)]), this.archGem ||= gemMaterial(0x7fe6ff)); // double-pointed keystone gem
      gem.position.set(cx, y + 9.1, cz); this.scene.add(gem);
      this.anim.push((dt) => { gem.rotation.y += dt; gem.position.y = y + 9.1 + Math.sin(TIME.value * 2 + i) * 0.15; });
    }
    // crumbling brick walls for cover: a few near the dais, more (taller, longer, often L-shaped) out in the meadow
    const spots = [];
    for (let i = 0, tries = 0; i < 8 && tries < 200; tries++) { // never across the dirt paths (spawn points and sight lines)
      const a = rng() * TAU, r = 14 + rng() * 14, x = Math.cos(a) * r, z = Math.sin(a) * r, yaw = a + Math.PI / 2 + rng() * 0.5, L = 3.5 + rng() * 2.5, rows = 3 + Math.floor(rng() * 2);
      if (Math.min(Math.abs(x), Math.abs(z)) < L / 2 + 2.5) continue;
      spots.push([x, z, yaw, L, rows]); i++;
    }
    for (let i = 0, tries = 0; i < 22 && tries < 400; tries++) {
      const a = rng() * TAU, r = 38 + rng() * 62, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.min(Math.abs(x), Math.abs(z)) < 6 || this.gridUp(x, z) < 0.9 || this.onRamp(x, z)) continue; // off the paths and ramps
      const yaw = rng() * TAU, L = 4 + rng() * 4, rows = 3 + Math.floor(rng() * 3), cs = Math.cos(yaw), sn = Math.sin(yaw);
      if (Math.abs(this.heightAt(x + cs * L / 2, z - sn * L / 2) - this.heightAt(x - cs * L / 2, z + sn * L / 2)) > 0.8) continue; // flat ground only
      spots.push([x, z, yaw, L, rows]); i++;
      if (rng() < 0.45) { const L2 = 2.5 + rng() * 2.5, y2 = yaw + Math.PI / 2, ex = x + cs * L / 2, ez = z - sn * L / 2; spots.push([ex + Math.cos(y2) * L2 / 2 + cs * 0.4, ez - Math.sin(y2) * L2 / 2 - sn * 0.4, y2, L2, rows - 1]); }
    }
    for (const [x, z, yaw, L, rows] of spots) {
      const cs = Math.cos(yaw), sn = Math.sin(yaw), y0 = this.heightAt(x, z) - 0.1;
      for (let row = 0; row < rows; row++) {
        let u = -L / 2 + (row % 2) * 0.4;
        while (u < L / 2) {
          const w = 0.7 + rng() * 0.6;
          if (!(row === rows - 1 && rng() < 0.35) && !(row > 0 && Math.abs(u) > L / 2 - 0.8 && rng() < 0.5)) {
            put(blk(Math.min(w, L / 2 - u) - 0.04, 0.46, 0.85 + rng() * 0.08, 0.1), rng() < 0.4 ? block : dark, x + cs * (u + w / 2), y0 + 0.23 + row * 0.47, z - sn * (u + w / 2), yaw + (rng() - 0.5) * 0.05);
          }
          u += w;
        }
      }
      rubble(x, z, 4, 4);
      const nk = Math.max(2, Math.round(L / 1.6));
      for (let k = 0; k < nk; k++) { const u = (k / (nk - 1) - 0.5) * (L - 1.2); this.obstacles.push({ x: x + cs * u, z: z - sn * u, r: 0.8, y0: y0, h: rows * 0.47 + 0.1 }); }
    }
  }
  // Rock faces on every cliff: stratified slabs set into the slope wherever the height field is steep, facing outward and
  // sized to the drop, so terrace and mesa edges read as layered sandstone bluffs rather than grassy smears.
  buildCliffs() {
    const rng = mulberry32(31), geos = [0, 1, 2, 3, 4, 5].map(() => stoneBlock(1, 1, 1, rng, { chip: 0.16, seg: 2, round: 0.12 }));
    const mat = stoneMaterial(0xc9b08c, { moss: 0.75, joint: 0.5, grime: 0.6 }), mat2 = stoneMaterial(0xb09c80, { moss: 0.85, joint: 0.65, grime: 0.6 });
    const S = 2.3, R = ARENA_R + 20;
    const slab = (x, z, y, w, h, d, yaw) => {
      const m = new THREE.Mesh(tintGeo(geos[Math.floor(rng() * geos.length)].clone(), rng, 0.16), rng() < 0.5 ? mat : mat2);
      m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set((rng() - 0.5) * 0.1, yaw, (rng() - 0.5) * 0.14);
      this.statics.add(m);
    };
    for (let gx = -R; gx <= R; gx += S) for (let gz = -R; gz <= R; gz += S) {
      const x = gx + (rng() - 0.5) * S * 0.7, z = gz + (rng() - 0.5) * S * 0.7;
      if (this.gridUp(x, z) > 0.62) continue; const n = this.normalAt(x, z);
      const gxz = Math.hypot(n.x, n.z), ox = n.x / gxz, oz = n.z / gxz; // outward (downhill) direction
      const top = this.heightAt(x - ox * 2.4, z - oz * 2.4), bot = this.heightAt(x + ox * 2.4, z + oz * 2.4), H = top - bot;
      if (H < 1.6) continue;
      const yaw = Math.atan2(ox, oz) + (rng() - 0.5) * 0.5;
      // a stepped bluff: a broad foot slab, often a narrower, set-back cap slab above it
      if (rng() < 0.22) continue; // gaps let the painted strata of the bluff show between slabs
      const fh = 0.4 + rng() * 0.45;
      slab(x + ox * 0.1, z + oz * 0.1, bot + H * fh * 0.5, 2.2 + rng() * 1.6, H * fh, 1.8 + rng() * 0.6, yaw);
      if (rng() < 0.65) slab(x - ox * 0.25, z - oz * 0.25, bot + H * 0.72, 1.8 + rng() * 1.0, H * (0.42 + rng() * 0.1), 1.6 + rng() * 0.5, yaw + (rng() - 0.5) * 0.4);
    }
  }
  // Landmark: a colossal sakura on the terrace (visible from anywhere on the map). A twisted, root-flared lathe trunk,
  // tapering tube limbs, and a crown of big blossom clusters built from the same leaf-card canopy as every other tree.
  worldTree(bark, cards, proxies, rng) {
    const a = 0.79, R = 99, x = Math.cos(a) * R, z = Math.sin(a) * R, y = this.heightAt(x, z) - 0.4;
    const prof = [[6, 0], [4.2, 0.8], [3.2, 2.2], [2.6, 5], [2.2, 10], [1.9, 16], [1.5, 22], [1.1, 27], [0.5, 30]];
    const trunk = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), 28, 0, TAU), P = trunk.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const vx = P.getX(i), vy = P.getY(i), vz = P.getZ(i), an = Math.atan2(vz, vx), rr = Math.hypot(vx, vz);
      const root = Math.pow(Math.max(0, Math.cos(an * 5)), 3) * Math.max(0, 1 - vy / 4.5) * 2.4; // five buttress roots
      const k = (rr + root + fbm(an * 2, vy * 0.4, 2) * 0.35) / Math.max(rr, 1e-3), tw = vy * 0.07;
      const nx = vx * k, nz = vz * k;
      P.setXYZ(i, nx * Math.cos(tw) - nz * Math.sin(tw) + Math.sin(vy * 0.18) * 1.2, vy, nx * Math.sin(tw) + nz * Math.cos(tw));
    }
    trunk.computeVertexNormals();
    const tm = new THREE.Mesh(trunk, bark); tm.position.set(x, y, z); this.statics.add(tm);
    const blobs = [], tip = new THREE.Vector3(x + Math.sin(30 * 0.18) * 1.2, y + 29.5, z);
    blobs.push({ c: tip.clone().add(new THREE.Vector3(0, 3.5, 0)), r: 9 });
    for (let b = 0; b < 7; b++) {
      const ba = (b / 7) * TAU + rng() * 0.5, h0 = 15 + rng() * 11, len = 11 + rng() * 7;
      const base = new THREE.Vector3(x + Math.sin(h0 * 0.18) * 1.2, y + h0, z);
      const end = base.clone().add(new THREE.Vector3(Math.cos(ba) * len, 4 + rng() * 5, Math.sin(ba) * len));
      const mid = base.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 2.2, 0));
      const curve = new THREE.CatmullRomCurve3([base, mid, end]);
      const tube = new THREE.TubeGeometry(curve, 16, 1.3, 10, false), TP = tube.attributes.position, pt = new THREE.Vector3(), v = new THREE.Vector3();
      for (let i = 0; i <= 16; i++) { curve.getPointAt(i / 16, pt); const k = 1 - 0.7 * (i / 16); for (let j = 0; j <= 10; j++) { const idx = i * 11 + j; v.fromBufferAttribute(TP, idx).sub(pt).multiplyScalar(k).add(pt); TP.setXYZ(idx, v.x, v.y, v.z); } }
      tube.computeVertexNormals();
      this.statics.add(new THREE.Mesh(tube, bark));
      blobs.push({ c: end.clone().add(new THREE.Vector3(0, 2, 0)), r: 6.2 + rng() * 2.2 });
      blobs.push({ c: mid.clone().lerp(end, 0.4).add(new THREE.Vector3(0, 4, 0)), r: 5 + rng() * 1.8 });
    }
    cards.push({ blobs, color: new THREE.Color(0xffa3c6), per: 7 });
    for (const b of blobs) { const g = new THREE.IcosahedronGeometry(b.r * 0.85, 1); g.translate(b.c.x, b.c.y, b.c.z); proxies.push(g); }
    this.obstacles.push({ x, z, r: 3.6, y0: y, h: 30 });
    for (let k = 0; k < 6; k++) this.sakura.push(blobs[1 + k * 2].c.clone());
  }
  // Ruined watchtowers on the terrace diagonals: polygonal rings of chamfered blocks, arrow slits, a broken crown.
  buildLandmarks() {
    const rng = mulberry32(77), stone = stoneMaterial(0xd4c9b2, { moss: 0.9, joint: 0 }), dark = stoneMaterial(0xb0a58e, { moss: 1 });
    for (const a of [2.36, 3.93, 5.5]) {
      const R = 97, x = Math.cos(a) * R, z = Math.sin(a) * R, y0 = this.heightAt(x, z) - 0.5, TR = 3.1, sides = 11, layers = 11 + Math.floor(rng() * 4);
      const brokenA = rng() * TAU;
      for (let L = 0; L < layers; L++) {
        const off = (L % 2) * 0.5;
        for (let k = 0; k < sides; k++) {
          const an = ((k + off) / sides) * TAU, top = layers - 1 - Math.floor(Math.max(0, Math.cos(an - brokenA)) * 5 * rng());
          if (L > top) continue;
          if ((L === 5 || L === 6 || L === 9) && k % 4 === 1) continue; // arrow slits
          const bw = (TAU * TR) / sides + 0.05, g = stoneBlock(bw, 0.9, 1.0, rng, { chip: 0.07, seg: 2 });
          const m = new THREE.Mesh(tintGeo(g, rng), L < 2 ? dark : stone);
          m.position.set(x + Math.cos(an) * TR, y0 + 0.45 + L * 0.92, z + Math.sin(an) * TR); m.rotation.y = -an + Math.PI / 2 + (rng() - 0.5) * 0.03;
          this.statics.add(m);
        }
      }
      // floor slab ring (base plinth) and scattered fallen blocks
      for (let k = 0; k < 14; k++) { const an = (k / 14) * TAU, g = stoneBlock(1.7, 0.5, 1.2, rng, { chip: 0.1, seg: 1 }); const m = new THREE.Mesh(tintGeo(g, rng), dark); m.position.set(x + Math.cos(an) * (TR + 0.8), y0 + 0.2, z + Math.sin(an) * (TR + 0.8)); m.rotation.y = -an + Math.PI / 2; this.statics.add(m); }
      for (let k = 0; k < 7; k++) { const an = brokenA + (rng() - 0.5) * 1.4, d = TR + 2 + rng() * 5, bx = x + Math.cos(an) * d, bz = z + Math.sin(an) * d, s2 = 0.5 + rng() * 0.5; const m = new THREE.Mesh(tintGeo(stoneBlock(s2 * 1.8, s2, s2 * 1.1, rng, { chip: 0.12, seg: 1 }), rng), stone); m.position.set(bx, this.heightAt(bx, bz) + s2 * 0.3, bz); m.rotation.set((rng() - 0.5) * 0.6, rng() * TAU, (rng() - 0.5) * 0.6); this.statics.add(m); }
      this.obstacles.push({ x, z, r: TR + 0.6, y0, h: layers * 0.92 });
    }
  }
  // Heraldic banners on poles: at the head of each terrace ramp and beside the arches. The cloth hangs from a crossbar and
  // ripples in the same world wind as the grass (vertex shader), cel-lit like everything else.
  buildBanners() {
    const S = 128, cv = document.createElement('canvas'); cv.width = S; cv.height = S * 2; const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S * 2);                          // tinted by the material colour
    g.fillStyle = '#e8c068'; g.fillRect(0, 0, S, 10); g.fillRect(0, 0, 8, S * 2); g.fillRect(S - 8, 0, 8, S * 2); // gold trim
    g.beginPath(); g.moveTo(0, S * 2 - 34); g.lineTo(S / 2, S * 2); g.lineTo(S, S * 2 - 34); g.lineTo(S, S * 2); g.lineTo(0, S * 2); g.fillStyle = 'rgba(0,0,0,0)'; g.globalCompositeOperation = 'destination-out'; g.fill(); g.globalCompositeOperation = 'source-over';
    g.strokeStyle = '#e8c068'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, S * 2 - 40); g.lineTo(S / 2, S * 2 - 6); g.lineTo(S, S * 2 - 40); g.stroke();
    g.fillStyle = '#e8c068'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, r = i % 2 ? 14 : 34; g.lineTo(S / 2 + Math.cos(a) * r, S * 0.85 + Math.sin(a) * r); } g.fill(); // star emblem
    g.lineWidth = 4; g.beginPath(); g.arc(S / 2, S * 0.85, 44, 0, TAU); g.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const cloth = (color) => {
      const m = new THREE.MeshLambertMaterial({ color, map: tex, side: THREE.DoubleSide, alphaTest: 0.5 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = TIME;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 bw=modelMatrix*vec4(0.0,0.0,0.0,1.0); float hang=clamp(-position.y/2.6,0.0,1.0); // 0 at the bar, 1 at the tail
          float wv=sin(uTime*2.6-position.y*2.2+position.x*1.5+bw.x*0.2)*0.5+sin(uTime*4.1-position.y*3.7+bw.z*0.3)*0.22;
          transformed.z+=wv*hang*0.35+hang*hang*0.25; transformed.x+=sin(uTime*1.3+bw.x)*hang*0.08;`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          { float hang=clamp(-position.y/2.6,0.0,1.0); objectNormal=normalize(objectNormal+vec3(0.0,0.0,0.0)+vec3(cos(uTime*2.6-position.y*2.2)*hang*0.6,0.0,0.0)); }`);
      };
      m.customProgramCacheKey = () => 'banner';
      return m;
    };
    const mats = [cloth(0x2b4a9a), cloth(0x9a2b3c), cloth(0x2f7a4a)];
    const pole = stoneMaterial(0x6a4c34, { moss: 0.2, grime: 0 }), gold = toon(0xd9b25a, { emissive: 0x3a2a00 });
    const clothGeo = new THREE.PlaneGeometry(1.3, 2.6, 6, 12); clothGeo.translate(0, -1.3, 0);
    const spots = [];
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const sd of [-1, 1]) { // flanking each terrace ramp head
      const r = TERRACE_R + 4, x = Math.cos(a) * r - Math.sin(a) * 6.5 * sd, z = Math.sin(a) * r + Math.cos(a) * 6.5 * sd;
      spots.push([x, z, a + Math.PI / 2]);
    }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4 + 0.2, r = 25; spots.push([Math.cos(a) * r, Math.sin(a) * r, a]); } // by the arches
    spots.forEach(([x, z, yaw], i) => {
      const y = this.heightAt(x, z) - 0.2, H = 6.2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, H, 8), pole); p.position.set(x, y + H / 2, z); this.statics.add(p);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), pole); bar.rotation.set(0, yaw, Math.PI / 2); bar.position.set(x, y + H - 0.35, z); this.statics.add(bar);
      const fin = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), gold); fin.position.set(x, y + H + 0.1, z); fin.scale.y = 1.8; this.statics.add(fin);
      const c = new THREE.Mesh(clothGeo, mats[i % 3]); c.position.set(x, y + H - 0.38, z); c.rotation.y = yaw; c.castShadow = true; c.receiveShadow = true; c.userData.noAO = true;
      this.scene.add(c);
      this.obstacles.push({ x, z, r: 0.2, y0: y, h: H });
    });
  }
  // Low leafy shrubs: soft cover to duck behind (they hide you, they don't stop spells)
  bushBlobs(rng) {
    const out = [];
    for (let i = 0, tries = 0; i < 70 && tries < 900; tries++) {
      const a = rng() * TAU, r = 16 + rng() * 96, x = Math.cos(a) * r, z = Math.sin(a) * r, y = this.heightAt(x, z);
      if (y < -1 || this.gridUp(x, z) < 0.85 || Math.min(Math.abs(x), Math.abs(z)) < 5 || this.onRamp(x, z)) continue;
      const blobs = [], n = 2 + Math.floor(rng() * 3), s = 0.8 + rng() * 0.6;
      for (let k = 0; k < n; k++) { const bx = x + (rng() - 0.5) * 2.6 * s, bz = z + (rng() - 0.5) * 2.6 * s, br = (0.9 + rng() * 0.5) * s; blobs.push({ c: new THREE.Vector3(bx, this.heightAt(bx, bz) + br * 0.55, bz), r: br }); }
      const bloom = rng() < 0.35 ? new THREE.Color([0xffb3d1, 0xfff4ee, 0xffe07a, 0xd9b8ff][Math.floor(rng() * 4)]) : null; // flowering shrub
      out.push({ blobs, color: new THREE.Color([0x3f8434, 0x4f9a38, 0x5a9e3a, 0x3a7a3c][Math.floor(rng() * 4)]), bloom }); i++;
    }
    return out;
  }
  buildTrees() {
    const rng = mulberry32(9);
    const bark = stoneMaterial(0x5e4030, { moss: 0.6 });
    const palettes = [0x4f9a34, 0x69b23e, 0x3f8a3c, 0x7cba48, 0xffa8c8, 0xff94bc];
    this.sakura = [];
    const cards = [], proxies = [];
    this.worldTree(bark, cards, proxies, rng);
    for (let i = 0; i < 72; i++) {
      const a = rng() * TAU, r = 40 + rng() * 72, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      if (y < -1 || this.gridUp(x, z) < 0.8 || (Math.min(Math.abs(x), Math.abs(z)) < 7 && r < 104) || this.onRamp(x, z)) continue;
      const sc = 0.9 + rng() * 0.5, h = (4.5 + rng() * 4);
      const trunk = new THREE.Mesh(treeTrunk(h, i), bark); trunk.position.set(x, y - 0.3, z); trunk.scale.setScalar(sc); this.statics.add(trunk);
      const sway = (yy) => new THREE.Vector3(x + Math.sin(yy * 2.5 + i) * 0.35 * yy * sc, y - 0.3 + yy * h * sc, z + Math.cos(yy * 1.7 + i) * 0.15 * yy * sc);
      const pink = rng() < 0.3, color = new THREE.Color(pink ? palettes[4 + (i % 2)] : palettes[i % 4]);
      const blobs = [];
      const nb = 4 + Math.floor(rng() * 3);
      for (let k = 0; k < nb; k++) blobs.push({ c: new THREE.Vector3((rng() - 0.5) * 3.2, h + (rng() - 0.2) * 2.2, (rng() - 0.5) * 3.2), r: 1.6 + rng() * 1.2 });
      blobs.push({ c: new THREE.Vector3(0, h + 1.2, 0), r: 2.4 });
      for (const b of blobs) { b.c.multiplyScalar(sc).add(new THREE.Vector3(x, y - 0.2, z)); b.r *= sc; }
      // limbs from the upper trunk out into each side cluster (they show through gaps and under the crown)
      for (let k = 0; k < blobs.length - 1; k++) {
        const from = sway(0.55 + rng() * 0.25), to = blobs[k].c.clone().lerp(from, 0.3), mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.5 * sc, 0));
        this.statics.add(new THREE.Mesh(taperTube(new THREE.CatmullRomCurve3([from, mid, to]), 0.15 * sc, 0.045 * sc, 6, 6), bark));
      }
      cards.push({ blobs, color });
      for (const b of blobs) { const g = new THREE.IcosahedronGeometry(b.r * 0.85, 1); g.translate(b.c.x, b.c.y, b.c.z); proxies.push(g); }
      this.obstacles.push({ x, z, r: 0.65, y0: y, h: h * sc });
      if (pink) this.sakura.push(new THREE.Vector3(x, y + h * sc + 1, z));
    }
    // backdrop groves on the rim hills beyond the playable edge (no collision needed out there)
    for (let i = 0; i < 60; i++) {
      const a = rng() * TAU, r = ARENA_R + 2 + rng() * 26, x = Math.cos(a) * r, z = Math.sin(a) * r, y = this.heightAt(x, z);
      if (y < 0 || this.onRamp(x, z)) continue;
      const sc = 1 + rng() * 0.6, h = 5 + rng() * 4, pink = rng() < 0.25;
      const trunk = new THREE.Mesh(treeTrunk(h, i + 50), bark); trunk.position.set(x, y - 0.3, z); trunk.scale.setScalar(sc); this.statics.add(trunk);
      const blobs = [];
      for (let k = 0; k < 4; k++) blobs.push({ c: new THREE.Vector3((rng() - 0.5) * 3.4, h + (rng() - 0.2) * 2.4, (rng() - 0.5) * 3.4).multiplyScalar(sc).add(new THREE.Vector3(x, y - 0.2, z)), r: (1.8 + rng() * 1.2) * sc });
      cards.push({ blobs, color: new THREE.Color(pink ? palettes[4 + (i % 2)] : palettes[i % 4]), per: 0.8 });
      for (const b of blobs) { const g = new THREE.IcosahedronGeometry(b.r * 0.85, 1); g.translate(b.c.x, b.c.y, b.c.z); proxies.push(g); }
    }
    for (const b of this.bushBlobs(rng)) {
      cards.push(b);
      for (const bb of b.blobs) { const g = new THREE.IcosahedronGeometry(bb.r * 0.8, 1); g.translate(bb.c.x, bb.c.y, bb.c.z); proxies.push(g); }
    }
    // Per-tree bounds include the camera-facing card expansion, enabling safe culling.
    const geos = cards.map(({ blobs, color, per, bloom }) => {
      const g = canopyGeometry(rng, blobs, Math.round((this.quality > 0 ? 70 : 35) * (per || 1)));
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let k = 0; k < n; k += 4) { // per card (4 verts): flowering shrubs dot a share of their cards with blossom
        const cc = bloom && rng() < 0.28 ? bloom : color;
        for (let v = k; v < k + 4; v++) { col[v * 3] = cc.r; col[v * 3 + 1] = cc.g; col[v * 3 + 2] = cc.b; }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
    });
    const mat = canopyMaterial(0xffffff); mat.uniforms.uTex.value = leafTexture(); mat.uniforms.uSunView = { value: this.sunView }; mat.uniforms.uTime = TIME;
    mat.vertexColors = true;
    for (const geo of geos) {
      const canopy = new THREE.Mesh(geo, mat); canopy.userData.noAO = true;
      canopy.updateMatrix(); canopy.matrixAutoUpdate = false; this.scene.add(canopy);
    }
    const shadow = new THREE.Mesh(mergeGeometries(proxies.map((g) => (g.index ? g.toNonIndexed() : g)), false), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    shadow.castShadow = true; this.scene.add(shadow);
    // the card canopy can't render into the AO normal/depth pass (cards expand in its own vertex shader), so without a
    // stand-in the AO of trunks and hills BEHIND a crown is stamped onto its leaves and the tree reads as see-through
    const aoProxy = new THREE.Mesh(shadow.geometry, new THREE.MeshBasicMaterial());
    aoProxy.visible = false; aoProxy.userData.aoOnly = true; this.scene.add(aoProxy);
  }
  buildRocks() {
    const rng = mulberry32(5);
    const geos = [0, 1, 2, 3].map(() => boulder(rng, { detail: 4 }));
    const mat = stoneMaterial(0xa39d90, { moss: 1.2, grime: 0.45 });
    for (let i = 0; i < 60; i++) {
      const a = rng() * TAU, r = 18 + rng() * 95, x = Math.cos(a) * r, z = Math.sin(a) * r, y = this.heightAt(x, z);
      if (y < -1.5 || this.onRamp(x, z)) continue;
      const s = 0.6 + rng() * 2.2;
      const m = new THREE.Mesh(tintGeo(geos[i % 4].clone(), rng, 0.16), mat);
      m.position.set(x, y + s * 0.1, z); m.scale.set(s * (1 + rng() * 0.5), s, s); m.rotation.y = rng() * TAU;
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
      // a cluster of spires growing out of the island's grassy cap, plus three small shards orbiting it
      const gm = gemMaterial(c), core = new THREE.Group(); core.position.y = -0.9; g.add(core);
      const cr = mulberry32(i * 13 + 5);
      core.add(new THREE.Mesh(crystalSpire(0.75, 4.6), gm));
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(crystalSpire(0.3 + cr() * 0.25, 1.6 + cr() * 1.8), gm), a2 = (k / 5) * TAU + cr();
        sp.position.set(Math.cos(a2) * 0.6, 0, Math.sin(a2) * 0.6); sp.rotation.set(Math.sin(a2) * 0.5, cr() * TAU, -Math.cos(a2) * 0.5); core.add(sp);
      }
      for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(crystalSpire(0.2, 0.9, 0.5), gm); s.geometry.translate(0, -0.45, 0); s.userData.k = k; g.add(s); }
      const rock = new THREE.Mesh(islandGeo(i * 7 + 3), this.islandMat ||= Object.assign(stoneMaterial(0xe6dccb, { moss: 1.1, joint: 0.8, grime: 0 }), { emissive: new THREE.Color(0x2a3550), emissiveIntensity: 0.45 })); rock.scale.setScalar(2.4); rock.position.y = -2.6; g.add(rock);
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
    // mountains coloured in the shader by height + slope,
    // with aerial perspective (distance haze that thins with altitude, so peaks stay crisp against the sky)
    const mMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, fog: false });
    mMat.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = { value: new THREE.Color(0x8fb4dc) }; // aerial perspective leans to horizon blue, not white sh.uniforms.uSun = { value: SUN_DIR };
      sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP=(modelMatrix*vec4(transformed,1.0)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
      sh.fragmentShader = 'varying vec3 vWP; varying vec3 vWN; uniform vec3 uHaze, uSun;\n' + NOISE + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 N=normalize(vWN); float h=vWP.y; float n=snoise(vWP*0.01), n2=snoise(vWP*vec3(0.03,0.012,0.03));
          float slope=1.0-N.y;
          vec3 grass=mix(vec3(0.2,0.36,0.17),vec3(0.38,0.52,0.24),smoothstep(-0.5,0.5,n));
          grass=mix(grass,vec3(0.13,0.27,0.16),smoothstep(0.1,0.5,n2)*smoothstep(90.0,30.0,h)); // dark forest patches
          vec3 rock=mix(vec3(0.44,0.44,0.45),vec3(0.58,0.57,0.55),smoothstep(-0.5,0.5,n2));
          vec3 snow=vec3(0.95,0.97,1.0);
          vec3 c=mix(grass,rock,smoothstep(0.25,0.5,slope+n*0.15)*smoothstep(10.0,60.0,h)+smoothstep(80.0,140.0,h+n*40.0));
          c=mix(c,snow,smoothstep(0.45,0.25,slope+n2*0.12)*smoothstep(120.0,170.0,h+n*50.0)+smoothstep(210.0,250.0,h+n*30.0));
          diffuseColor.rgb=c;`)
        .replace('#include <opaque_fragment>', `
          float d=length(vWP-cameraPosition);
          float haze=smoothstep(60.0,1500.0,d)*(1.0-smoothstep(0.0,380.0,vWP.y)*0.35);
          outgoingLight=mix(outgoingLight,uHaze,clamp(haze*0.95,0.0,0.72));
          #include <opaque_fragment>`);
    };
    // continuous mountain ranges: a polar heightfield ring (near range + a hazier far range) with ridged, domain-warped noise
    const ridged = (x, z, oct = 6) => {
      const wx = x + fbm(x * 0.7, z * 0.7, 3) * 1.4, wz = z + fbm(x * 0.7 + 5, z * 0.7 + 9, 3) * 1.4;
      let h = 0, amp = 1, f = 1, prev = 1;
      for (let o = 0; o < oct; o++) { let n = 1 - Math.abs(fbm(wx * f + o * 3.7, wz * f - o * 1.9, 1) * 2); n = n * n; h += n * amp * prev; prev = n; amp *= 0.5; f *= 2.05; }
      return h;
    };
    const range = (r0, r1, peak, seed, nr, na, oct = 6, rug = 1.3) => {
      const pos = [], idx = [];
      for (let a = 0; a <= na; a++) for (let k = 0; k <= nr; k++) {
        const t = k / nr, r = r0 + (r1 - r0) * t, an = (a / na) * TAU, x = Math.cos(an) * r, z = Math.sin(an) * r;
        const env = Math.sin(Math.PI * Math.pow(t, 0.8)) ** 0.7; // rises from the valley, falls behind the crest
        const roll = 0.5 + fbm(x / 420 + seed, z / 420, 3); // broad swells so the skyline undulates instead of zigzagging
        const h = env * peak * (0.15 + roll * 0.45 + Math.pow(ridged(x / 260 + seed, z / 260 - seed, oct), rug) * 0.55 * (0.4 + roll)) - 30;
        pos.push(x, h, z);
      }
      for (let a = 0; a < na; a++) for (let k = 0; k < nr; k++) { const i0 = a * (nr + 1) + k, i1 = i0 + nr + 1; idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      // relax the shading normals over the grid: the silhouette keeps its jagged ridges, but the cel terminator follows
      // broad sculpted masses instead of snapping across every 7 m triangle (which read as low-poly facets)
      const n = g.attributes.normal.array, row = nr + 1;
      for (let it = 0; it < 4; it++) {
        const src = n.slice();
        for (let a = 0; a <= na; a++) for (let k = 1; k < nr; k++) {
          const i = a * row + k, l = (a > 0 ? a - 1 : na - 1) * row + k, r = (a < na ? a + 1 : 1) * row + k;
          for (let c = 0; c < 3; c++) n[i * 3 + c] = src[i * 3 + c] * 0.4 + (src[l * 3 + c] + src[r * 3 + c] + src[(i - 1) * 3 + c] + src[(i + 1) * 3 + c]) * 0.15;
        }
      }
      g.attributes.normal.needsUpdate = true; g.normalizeNormals();
      return g;
    };
    // no AO on the ranges: at 400-1500 m the depth buffer is too coarse and GTAO smears black jags along every ridgeline
    for (const g of [range(360, 900, 120, 3.1, 110, 800, 5, 2.0), range(950, 1550, 380, 11.7, 70, 640, 5, 1.2)]) { // green foothills, snowy far peaks
      const m = new THREE.Mesh(g, mMat); m.userData.noAO = true; this.scene.add(m);
    }
    // floating islands: carrot-shaped sculpted rock with strata, a grassy cap and little trees
    const iMat = Object.assign(stoneMaterial(0xe6dccb, { moss: 1.1, joint: 3, grime: 0 }), { emissive: new THREE.Color(0x2a3550), emissiveIntensity: 0.45 }); // sky bounce so undersides aren't black
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.9 }), pinkMat = new THREE.MeshStandardMaterial({ color: 0xf2a6c4, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const a = rng() * TAU, r = 230 + rng() * 110, y = 45 + rng() * 60, s = 8 + rng() * 14;
      const g = new THREE.Group();
      const rock = new THREE.Mesh(islandGeo(i + 11), iMat); rock.scale.setScalar(s); g.add(rock);
      for (let k = 0; k < 3; k++) {
        const t = new THREE.Mesh(boulder(rng, { detail: 2, squash: 0.9, rough: 0.25 }), rng() < 0.4 ? pinkMat : leafMat);
        const ta = rng() * TAU, td = rng() * s * 0.5; t.position.set(Math.cos(ta) * td, s * 0.25 + s * 0.12, Math.sin(ta) * td); t.scale.setScalar(s * (0.18 + rng() * 0.12)); g.add(t);
      }
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r); this.scene.add(g);
      this.anim.push(() => { g.position.y = y + Math.sin(TIME.value * 0.3 + i) * 2; });
      if (i < 2) this.waterfall(g.position.clone(), s, a + Math.PI * 0.85); // two islands spill into the sea
    }
    // Cumulus: camera-facing cards shaded procedurally. A few domes form the mass, noise erodes the silhouette (crisp
    // cauliflower tops, wispy bases), and a soft cel split is lit from the true sun direction per cloud, with a silver
    // lining when back-lit and horizon haze toward the base. See cloudMaterial().
    this.clouds = [];
    for (let i = 0; i < 22; i++) {
      const high = i >= 16, mat = cloudMaterial(rng() * 50, high ? 0.6 + rng() * 0.3 : 1.0 + rng() * 0.6, high ? 0.12 : 0.22 + rng() * 0.15);
      const m = new THREE.Mesh(this.cloudGeo ||= new THREE.PlaneGeometry(1, 1), mat);
      const a = (i / 16) * TAU + rng() * 0.3, r = high ? 1300 : 1640 + rng() * 100, elev = high ? 0.36 + rng() * 0.22 : 0.1 + rng() * 0.12;
      const s = high ? 480 + rng() * 240 : 650 + rng() * 550;
      m.scale.set(s, s * 0.5, 1); m.frustumCulled = false; m.renderOrder = -5;
      const y = Math.tan(elev) * r + s * 0.18, spd = (0.002 + rng() * 0.003) * (high ? 2 : 1);
      this.scene.add(m); this.clouds.push(m);
      this.anim.push(() => { const an = a + TIME.value * spd * 0.1; m.position.set(Math.cos(an) * r, y, Math.sin(an) * r); });
    }
  }

  // ------------------------------------------------ ferns: arching fronds clustered at tree roots, wall feet and rocks
  buildFerns() {
    const S = 64, cv = document.createElement('canvas'); cv.width = S; cv.height = S * 4; const g = cv.getContext('2d');
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(S / 2, S * 4); g.lineTo(S / 2, 6); g.stroke();                       // rachis
    for (let y = 12; y < S * 4 - 8; y += 11) {                                                  // pinnae, longest mid-frond
      const t = y / (S * 4), L = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (S / 2 - 3);
      for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(S / 2, y + 6); g.quadraticCurveTo(S / 2 + sd * L * 0.6, y - 2, S / 2 + sd * L, y + 2); g.quadraticCurveTo(S / 2 + sd * L * 0.5, y + 5, S / 2, y + 10); g.fill(); }
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    // one clump: 7 fronds radiating out and arching down (bent planes, 6 segments each)
    const pos = [], uv = [], nrm = [], idx = [];
    for (let f = 0; f < 7; f++) {
      const a = (f / 7) * TAU + (f % 2) * 0.3, ca = Math.cos(a), sa = Math.sin(a), L = 0.9 + (f % 3) * 0.2, W = 0.16;
      const v0 = pos.length / 3;
      for (let k = 0; k <= 6; k++) {
        const t = k / 6, r = t * L, y = Math.sin(t * Math.PI * 0.75) * L * 0.75 - t * t * 0.12;
        for (const sd of [-1, 1]) { pos.push(ca * r - sa * W * sd, y, sa * r + ca * W * sd); uv.push(sd < 0 ? 0 : 1, t); nrm.push(0, 1, 0); }
      }
      for (let k = 0; k < 6; k++) { const q = v0 + k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setIndex(idx);
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x3f7a2e }); // deeper than the meadow so clumps read
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = TIME;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 fw=modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0); float tip=length(position.xz);
        transformed.y+=sin(uTime*1.7+fw.x*0.4+fw.z*0.3+tip*2.0)*0.05*tip; transformed.x+=sin(uTime*1.3+fw.z*0.5)*0.04*tip;`)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(0.1,0.14,0.02) * vMapUv.y;');
    };
    mat.customProgramCacheKey = () => 'fern';
    const rng = mulberry32(17), list = [];
    const spots = [...this.obstacles.filter((o) => o.r < 1.3).map((o) => [o.x, o.z, o.r + 0.5])];
    for (let i = 0; i < 140; i++) { const a = rng() * TAU, r = 14 + rng() * 100; spots.push([Math.cos(a) * r, Math.sin(a) * r, 1.5]); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    for (const [ox, oz, rr] of spots) {
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const a = rng() * TAU, x = ox + Math.cos(a) * (rr + rng() * 0.8), z = oz + Math.sin(a) * (rr + rng() * 0.8);
        if (this.gridUp(x, z) < 0.85 || this.gridH(x, z) < -1 || Math.hypot(x, z) < 11.5 || this.onRamp(x, z)) continue;
        if (Math.abs(Math.sin(Math.atan2(z, x) * 2)) < 0.1 && Math.hypot(x, z) < 100) continue; // off the paths
        const s2 = 1.0 + rng() * 0.8; p.set(x, this.gridH(x, z) - 0.05, z); e.set((rng() - 0.5) * 0.2, rng() * TAU, (rng() - 0.5) * 0.2); q.setFromEuler(e); sc.set(s2, s2, s2);
        list.push([m4.compose(p, q, sc).clone(), c.setHSL(0.24 + rng() * 0.07, 0.45 + rng() * 0.15, 0.4 + rng() * 0.12).clone()]);
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([mm, cc], i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, cc); });
    mesh.computeBoundingSphere(); mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noAO = true;
    this.scene.add(mesh);
  }

  // ------------------------------------------------ seagulls: a few loose flocks wheeling over the island
  buildBirds() {
    // body + two wing panels (each wing: inner and outer segment so the tip lags the flap)
    const pos = [], idx = [], wing = [];
    const quad = (a, b, c, d, w) => { const v = pos.length / 3; pos.push(...a, ...b, ...c, ...d); wing.push(...w); idx.push(v, v + 1, v + 2, v, v + 2, v + 3); };
    for (const s of [-1, 1]) {
      quad([0, 0, -0.25], [0, 0, 0.2], [0.55 * s, 0.02, 0.12], [0.5 * s, 0.02, -0.18], [0, 0, 1 * s, 1 * s]);
      quad([0.5 * s, 0.02, -0.18], [0.55 * s, 0.02, 0.12], [1.15 * s, 0.0, 0.2], [1.2 * s, 0.0, 0.08], [1 * s, 1 * s, 2 * s, 2 * s]);
    }
    const v0 = pos.length / 3; pos.push(0, 0.03, -0.45, 0.09, 0, 0.1, -0.09, 0, 0.1, 0, 0, 0.55); wing.push(0, 0, 0, 0); idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2); // body
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: TIME, ...THREE.UniformsLib.fog },
      vertexShader: `attribute float aWing; uniform float uTime; varying float vW; varying float vShade;
        #include <fog_pars_vertex>
        void main(){
          vec3 p=position; float ph=float(gl_InstanceID)*1.7;
          float flap=sin(uTime*7.0+ph)*(0.55+0.45*step(0.0,sin(uTime*0.6+ph))); // glide spells between bursts of flapping
          float w=abs(aWing), sg=sign(aWing);
          p.y+=flap*0.35*w - (w>1.5? 0.12:0.0);
          vW=w; vShade=0.75+0.25*flap;
          vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(p,1.0);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vW; varying float vShade;
        #include <fog_pars_fragment>
        void main(){
          vec3 c=mix(vec3(0.96,0.97,1.0),vec3(0.28,0.3,0.36),smoothstep(1.6,2.0,vW))*vShade;
          gl_FragColor=vec4(c,1.0);
          #include <fog_fragment>
        }`,
      side: THREE.DoubleSide, fog: true,
    });
    const N = 12, birds = new THREE.InstancedMesh(g, mat, N); birds.frustumCulled = false; birds.userData.noAO = true;
    this.scene.add(birds);
    const flocks = [0, 1, 2].map((k) => ({ c: new THREE.Vector3(Math.cos(k * 2.1) * 50, 44 + k * 10, Math.sin(k * 2.1) * 50), r: 30 + k * 14, sp: (0.18 + k * 0.05) * (k % 2 ? -1 : 1), ph: k * 2 }));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(1.4, 1.4, 1.4);
    this.anim.push(() => {
      const t = TIME.value;
      for (let i = 0; i < N; i++) {
        const f = flocks[i % 3], j = Math.floor(i / 3), a = t * f.sp + f.ph + j * 0.16 * Math.sign(f.sp);
        const rr = f.r + Math.sin(j * 2.3) * 4, y = f.c.y + Math.sin(t * 0.4 + j) * 2 + j * 0.6;
        P.set(f.c.x + Math.cos(a) * rr, y, f.c.z + Math.sin(a) * rr);
        const heading = Math.atan2(Math.sin(a) * Math.sign(f.sp), -Math.cos(a) * Math.sign(f.sp)); // local -Z along the circling velocity
        e.set(Math.cos(t * 0.4 + j) * 0.1, heading, 0.35 * Math.sign(f.sp)); q.setFromEuler(e);
        birds.setMatrixAt(i, m.compose(P, q, S));
      }
      birds.instanceMatrix.needsUpdate = true;
    });
  }

  // ------------------------------------------------ butterflies: a handful drifting over the meadow around the camera
  buildButterflies() {
    const pos = [], wing = [], uv = [], idx = [];
    for (const s of [-1, 1]) for (const [y0, y1, w] of [[0.02, 0.2, 0.2], [-0.16, 0.0, 0.14]]) { // fore and hind wing
      const v = pos.length / 3; pos.push(0, 0, y0, 0, 0, y1, w * s, 0, y1 + 0.03, w * s * 1.1, 0, y0); wing.push(0, 0, s, s); uv.push(0, 0, 0, 1, 1, 1, 1, 0); idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: TIME },
      vertexShader: `attribute float aWing; uniform float uTime; varying vec2 vUv; varying vec3 vCol;
        void main(){
          float id=float(gl_InstanceID); vec3 p=position;
          float a=sin(uTime*18.0+id*2.1)*0.9+0.3; // wing beat
          p.y+=abs(p.x)*sin(a)*2.2; p.x*=cos(a);
          vUv=uv; vCol=instanceColor;
          gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.0);
        }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vCol;
        void main(){
          float e=smoothstep(0.75,1.0,vUv.x+vUv.y*0.3); // dark wing edge
          vec3 c=mix(vCol,vec3(0.08,0.06,0.1),e*0.85);
          c=mix(c,vec3(1.0),smoothstep(0.35,0.3,distance(vUv,vec2(0.6,0.55)))*0.5); // eye spot
          gl_FragColor=vec4(c,1.0);
        }`,
      side: THREE.DoubleSide,
    });
    const N = 14, bf = new THREE.InstancedMesh(g, mat, N); bf.frustumCulled = false; bf.userData.noAO = true;
    const cols = [0xffd23a, 0xff8a3a, 0x7ad0ff, 0xffffff, 0xff8fd0, 0xb48cff];
    for (let i = 0; i < N; i++) bf.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    this.scene.add(bf);
    const B = [...Array(N)].map((_, i) => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, ph: i * 1.3 }));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), S = new THREE.Vector3(1, 1, 1);
    this.butterflies = (dt, cam) => {
      const t = TIME.value;
      B.forEach((b, i) => {
        // (re)spawn within 6-22 m of the camera, over grass, when lost or out of range
        if (b.t <= 0 || b.p.distanceToSquared(cam.position) > 26 * 26) {
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * TAU, d = 6 + Math.random() * 16, x = cam.position.x + Math.cos(a) * d, z = cam.position.z + Math.sin(a) * d;
            if (Math.hypot(x, z) > 11 && this.gridUp(x, z) > 0.85) { b.p.set(x, this.heightAt(x, z) + 0.5 + Math.random(), z); break; }
          }
          b.t = 8 + Math.random() * 10; b.v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        }
        b.t -= dt;
        // fluttering wander: a slow heading change plus a bobbing hop
        b.v.x += Math.sin(t * 0.7 + b.ph) * dt * 1.4; b.v.z += Math.cos(t * 0.9 + b.ph * 1.7) * dt * 1.4; b.v.setLength(1.1);
        b.p.addScaledVector(b.v, dt);
        const gy = this.heightAt(b.p.x, b.p.z); b.p.y += ((gy + 0.7 + Math.sin(t * 1.3 + b.ph) * 0.4) - b.p.y) * Math.min(1, dt * 2);
        e.set(Math.sin(t * 9 + b.ph) * 0.25, Math.atan2(b.v.x, b.v.z), 0); q.setFromEuler(e);
        bf.setMatrixAt(i, m.compose(new THREE.Vector3(b.p.x, b.p.y + Math.abs(Math.sin(t * 9 + b.ph)) * 0.12, b.p.z), q, S));
      });
      bf.instanceMatrix.needsUpdate = true;
    };
  }

  // Sky waterfall: a flattened open column from the island's rim to the sea, toon-banded falling water (white foam
  // streaks sliding down pale cyan), fading into a mist plume and a foam ring where it hits the water.
  waterfall(top, s, dirA) {
    const ox = Math.cos(dirA), oz = Math.sin(dirA), x = top.x + ox * s * 0.7, z = top.z + oz * s * 0.7, y0 = top.y + s * 0.02, H = y0 - SEA_Y + 2;
    const mat = this.fallMat ||= new THREE.ShaderMaterial({
      uniforms: { uTime: TIME, ...THREE.UniformsLib.fog },
      vertexShader: `varying vec2 vUv; varying float vH;
        #include <fog_pars_vertex>
        void main(){ vUv=uv; vec4 mvPosition=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        #include <fog_pars_fragment>
        float h(float n){ return fract(sin(n*91.7)*4375.85); }
        void main(){
          float x=vUv.x*24.0, col=floor(x), fx=fract(x);
          float sp=0.6+h(col)*0.8, ph=h(col+7.0);
          float streak=fract(vUv.y*3.0*(0.8+h(col+3.0)*0.6)+uTime*sp*0.9+ph);
          float foam=smoothstep(0.55,0.6,streak)*smoothstep(0.1,0.35,fx)*smoothstep(0.9,0.65,fx);
          vec3 c=mix(vec3(0.55,0.82,0.95),vec3(0.8,0.93,1.0),smoothstep(0.2,1.0,vUv.y));
          c=mix(c,vec3(1.0),foam*0.85);
          c=mix(c,vec3(0.95,0.98,1.0),1.0-smoothstep(0.0,0.18,vUv.y)); // mist whitening near the bottom
          gl_FragColor=vec4(c,1.0);
          #include <fog_fragment>
        }`,
      fog: true, side: THREE.DoubleSide,
    });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.16, s * 0.24, H, 20, 1, true), mat);
    col.scale.set(1, 1, 0.4); col.rotation.y = -dirA; col.position.set(x, SEA_Y - 1 + H / 2, z); col.userData.noAO = true; this.scene.add(col);
    // mist plume at the foot (soft sprites) and a foam ring on the sea
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(240,248,255,0.35)'); gr.addColorStop(1, 'rgba(240,248,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const mtex = this.mistTex ||= new THREE.CanvasTexture(cv);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mtex, transparent: true, depthWrite: false, fog: true, opacity: 0.8 }));
      const sz = s * (1.4 + k * 0.35); sp.scale.set(sz, sz * 0.7, 1);
      const base = new THREE.Vector3(x + (Math.random() - 0.5) * s * 0.6, SEA_Y + s * 0.2 + k * s * 0.18, z + (Math.random() - 0.5) * s * 0.6);
      sp.position.copy(base); this.scene.add(sp);
      this.anim.push(() => { const t = TIME.value; sp.position.y = base.y + Math.sin(t * 0.6 + k) * s * 0.06; sp.material.opacity = 0.55 + Math.sin(t * 0.9 + k * 1.7) * 0.2; });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(s * 0.3, s * 0.9, 32), new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.55, depthWrite: false, fog: true }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, SEA_Y + 0.05, z); this.scene.add(ring);
  }

  // ------------------------------------------------ instanced wind-swept grass
  // ------------------------------------------------ grass: curved clumped blades in culled chunks, fading with distance
  buildGrass() {
    const total = this.quality > 0 ? 200000 : 60000; // mid-field only: the camera-following lawn carries the near field
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
    const mat = meadowMaterial();
    const CH = 18, chunks = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    this.grassChunks = [];
    // placed in time slices after the first frame (the lawn already carries the near field), so loading isn't blocked
    let placed = 0, guard = 0;
    const slice = () => {
    const stop = placed + 25000;
    while (placed < total && placed < stop && guard++ < total) {
      const r = Math.sqrt(121 + Math.random() * (128 * 128 - 121)), a = Math.random() * TAU, cx = Math.cos(a) * r, cz = Math.sin(a) * r; // uniform per area
      if (r < 11.2) continue;
      if (Math.abs(Math.sin(Math.atan2(cz, cx) * 2)) < 0.06 && r < 100) continue;
      const patch = fbm(cx * 0.05, cz * 0.05, 2);
      if (patch < -0.38 || this.gridH(cx, cz) < -1.2 || this.gridUp(cx, cz) < 0.82) continue;
      const nClump = 5 + Math.floor(Math.random() * 9), hue = 0.23 + Math.random() * 0.05 + patch * 0.04, tall = 0.3 + Math.max(0, patch) * 0.6 + Math.random() * 0.2;
      for (let k = 0; k < nClump && placed < total; k++) {
        const ang = Math.random() * TAU, d = Math.random() * 0.35, x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
        p.set(x, this.gridH(x, z) - 0.04, z);
        e.set((Math.random() - 0.5) * 0.4 + Math.sin(ang) * d * 0.8, Math.random() * TAU, (Math.random() - 0.5) * 0.4 - Math.cos(ang) * d * 0.8); q.setFromEuler(e);
        const h = tall * (0.6 + Math.random() * 0.6);
        sc.set(0.8 + Math.random() * 0.6, h, 0.8 + Math.random() * 0.4);
        m.compose(p, q, sc);
        c.setHSL(hue + (Math.random() - 0.5) * 0.03, 0.42 + Math.random() * 0.12, 0.36 + Math.random() * 0.12);
        if (Math.random() < 0.012) c.setHSL([0.0, 0.12, 0.6, 0.8, 0.95][Math.floor(Math.random() * 5)], 0.8, 0.72);
        const key = Math.floor(x / CH) + ',' + Math.floor(z / CH);
        let ch = chunks.get(key); if (!ch) chunks.set(key, ch = { m: [], c: [] });
        for (let k2 = 0; k2 < 16; k2++) ch.m.push(m.elements[k2]);
        ch.c.push(c.r, c.g, c.b);
        placed++;
      }
    }
    if (placed < total && guard < total) { setTimeout(slice, 0); return; }
    for (const ch of chunks.values()) {
      const count = ch.c.length / 3, mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.array.set(ch.m); mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ch.c), 3);
      mesh.computeBoundingSphere(); mesh.receiveShadow = true; mesh.userData.noAO = true; // blades add nothing to AO but cost a full extra pass
      this.scene.add(mesh); this.grassChunks.push(mesh);
    }
    };
    setTimeout(slice, 0);
    this.buildFlowers();
    this.buildLawn(geo, this.quality > 0 ? 1500 : 800);
  }
  // Lush lawn around the camera: 5x5 tiles of dense blades that hop along a 10 m grid with the camera. Each blade finds
  // its height and whether grass may grow there (not on the dais, paths, cliffs or beach) in a texture baked from the
  // terrain grid, so the extra density costs no CPU and no memory beyond one tile's worth of instances.
  buildLawn(bladeGeo, N = 1500) {
    const { n, size, pos } = this.hGrid, step = size / (n - 1), data = new Uint16Array(n * n * 4), H = (i, j) => pos[(Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))) * 3 + 1];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -size / 2 + i * step, z = -size / 2 + j * step, h = H(i, j), r = Math.hypot(x, z);
      const sl = Math.hypot(H(i + 1, j) - H(i - 1, j), H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const pd = Math.abs(Math.sin(Math.atan2(z, x) * 2)) * r * 0.5, onPath = r > 10.5 && r < 100 && pd < 0.075 * r * 0.5 + 0.35;
      let m = smooth(10.8, 12, r) * (1 - smooth(0.3, 0.45, sl)) * smooth(-1.6, -0.9, h) * (onPath ? 0 : 1) * smooth(-0.55, -0.25, fbm(x * 0.05, z * 0.05, 2));
      const o = (j * n + i) * 4;
      const field = m * (0.08 + 0.92 * smooth(0.12, 0.38, fbm(x * 0.028 + 40, z * 0.028, 3))) * (1 - smooth(10, 16, 100 - r) * 0); // meadows in bloom
      data[o] = THREE.DataUtils.toHalfFloat(h); data[o + 1] = THREE.DataUtils.toHalfFloat(m);
      data[o + 2] = THREE.DataUtils.toHalfFloat(field); data[o + 3] = THREE.DataUtils.toHalfFloat(clamp(fbm(x * 0.018 + 90, z * 0.018, 2) * 1.6 + 0.5));
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const T = 10, mat = meadowMaterial(false, { tex, n, size });
    const proto = new THREE.InstancedMesh(bladeGeo, mat, N), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    for (let k = 0; k < N; k++) {
      p.set(Math.random() * T, 0, Math.random() * T); e.set((Math.random() - 0.5) * 0.5, Math.random() * TAU, (Math.random() - 0.5) * 0.5); q.setFromEuler(e);
      const h = 0.35 + Math.random() * 0.4; sc.set(0.8 + Math.random() * 0.5, h, 0.8 + Math.random() * 0.4);
      proto.setMatrixAt(k, m4.compose(p, q, sc));
      c.setHSL(0.24 + Math.random() * 0.05, 0.42 + Math.random() * 0.12, 0.34 + Math.random() * 0.12); proto.setColorAt(k, c);
    }
    this.lawn = [];
    for (let k = 0; k < 25; k++) {
      const t = new THREE.InstancedMesh(bladeGeo, mat, N); t.instanceMatrix = proto.instanceMatrix; t.instanceColor = proto.instanceColor;
      t.receiveShadow = true; t.userData.noAO = true; t.frustumCulled = true;
      t.geometry = bladeGeo; t.boundingSphere = new THREE.Sphere(new THREE.Vector3(T / 2, 0, T / 2), T * 0.75 + 12);
      this.scene.add(t); this.lawn.push(t);
    }
    this.lawnT = T;
    if (this.flowerGeo) {
      const FN = Math.round(N * 0.22), fmat = meadowMaterial(true, { tex, n, size }), fp = new THREE.InstancedMesh(this.flowerGeo, fmat, FN);
      for (let k = 0; k < FN; k++) {
        p.set(Math.random() * T, 0, Math.random() * T); e.set((Math.random() - 0.5) * 0.3, Math.random() * TAU, (Math.random() - 0.5) * 0.3); q.setFromEuler(e);
        const s2 = 0.75 + Math.random() * 0.5; sc.set(s2, s2 * (0.75 + Math.random() * 0.4), s2);
        fp.setMatrixAt(k, m4.compose(p, q, sc)); fp.setColorAt(k, c.setRGB(Math.random(), 1, 1));
      }
      for (let k = 0; k < 25; k++) {
        const t = new THREE.InstancedMesh(this.flowerGeo, fmat, FN); t.instanceMatrix = fp.instanceMatrix; t.instanceColor = fp.instanceColor;
        t.receiveShadow = true; t.userData.noAO = true; t.boundingSphere = new THREE.Sphere(new THREE.Vector3(T / 2, 0, T / 2), T * 0.75 + 12);
        this.scene.add(t); this.lawn.push(t);
      }
    }
  }
  // single-colour clusters of small five-petal flowers on thin stems (the stem ignores the instance colour: aHead = 0)
  buildFlowers() {
    const pos = [], col = [], head = [], idx = [];
    const quad = (x0, y0, x1, y1, c) => { const v = pos.length / 3; pos.push(-x0, y0, 0, x0, y0, 0, x1, y1, 0, -x1, y1, 0); for (let k = 0; k < 4; k++) { col.push(...c); head.push(0); } idx.push(v, v + 1, v + 2, v, v + 2, v + 3); };
    quad(0.01, 0, 0.006, 0.36, [0.2, 0.38, 0.1]);
    const c0 = pos.length / 3, P = 20; pos.push(0, 0.37, 0); col.push(1, 0.92, 0.6); head.push(1);
    for (let i = 0; i < P; i++) {
      const a = (i / P) * TAU, r = 0.12 * (0.45 + 0.55 * Math.abs(Math.cos(a * 2.5)));
      pos.push(Math.cos(a) * r, 0.37 + Math.sin(a) * r * 0.55, Math.sin(a) * r); col.push(1, 1, 1); head.push(1); // tilted head: never flips edge-on
      idx.push(c0, c0 + 1 + ((i + 1) % P), c0 + 1 + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aHead', new THREE.Float32BufferAttribute(head, 1));
    geo.setIndex(idx);
    const hues = [[0.0, 0, 0.94], [0.14, 0.6, 0.74], [0.94, 0.5, 0.8], [0.78, 0.35, 0.8]]; // white, buttercup, pink, lilac (pale blue read as glowing UI chips)
    const list = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    const target = this.quality > 0 ? 7500 : 2000;
    for (let tries = 0; list.length < target && tries < 8000; tries++) {
      const r = 13 + Math.random() * 110, a = Math.random() * TAU, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (fbm(cx * 0.05, cz * 0.05, 2) < 0.05 || Math.abs(Math.sin(a * 2)) < 0.09 || this.heightAt(cx, cz) < -1 || this.gridUp(cx, cz) < 0.85) continue;
      const [hu, sa, li] = hues[Math.floor(Math.random() * hues.length)], n = 10 + Math.floor(Math.random() * 16);
      for (let k = 0; k < n; k++) {
        const d = Math.sqrt(Math.random()) * 1.6, b = Math.random() * TAU, x = cx + Math.cos(b) * d, z = cz + Math.sin(b) * d;
        if ((Math.abs(Math.sin(Math.atan2(z, x) * 2)) < 0.11 && Math.hypot(x, z) < 100) || this.gridUp(x, z) < 0.8) continue; // off the dirt paths and cliffs
        p.set(x, this.heightAt(x, z) - 0.03, z); e.set((Math.random() - 0.5) * 0.35, Math.random() * TAU, (Math.random() - 0.5) * 0.35); q.setFromEuler(e);
        const s = 0.7 + Math.random() * 0.6; sc.set(s, s * (0.7 + Math.random() * 0.5), s);
        list.push([m.compose(p, q, sc).clone(), c.setHSL(hu + (Math.random() - 0.5) * 0.03, sa, li + (Math.random() - 0.5) * 0.08).clone()]);
      }
    }
    this.flowerGeo = geo;
    const mesh = new THREE.InstancedMesh(geo, meadowMaterial(true), list.length);
    list.forEach(([mm, cc], i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, cc); });
    mesh.computeBoundingSphere(); mesh.receiveShadow = true; mesh.userData.noAO = true;
    this.scene.add(mesh);
  }

  update(dt, fx, camera, bodies) {
    for (const f of this.anim) f(dt);
    CLOUD.x = TIME.value;
    if (camera) {
      this.sunView.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
      this.butterflies?.(Math.min(dt, 0.05), camera);
      // blades are invisible past ~70 m (they shrink to nothing in the vertex shader): skip whole chunks out there
      if (bodies) { let k = 0; for (const c of bodies) { if (k > 3) break; if (c.alive === false || !c.pos) continue; PUSH.value[k++].set(c.pos.x, c.pos.y, c.pos.z, 1.3); } for (; k < 4; k++) PUSH.value[k].set(0, -999, 0, 0); }
      // blast gusts: the flattened disc races outward and the blades spring back as it fades
      for (let k = 0; k < 4; k++) {
        const gst = this.gusts[k], v = PUSH.value[4 + k];
        if (!gst || gst.t >= gst.dur) { v.set(0, -999, 0, 0); PUSHK.value[4 + k] = 0; continue; }
        gst.t += Math.min(dt, 0.05); const e = gst.t / gst.dur;
        v.set(gst.x, gst.y, gst.z, gst.r * (0.35 + Math.sqrt(e) * 0.9)); PUSHK.value[4 + k] = (1 - e) * (1 - e) * 1.6;
      }
      if (this.lawn) {
        const T = this.lawnT, cx = Math.floor(camera.position.x / T), cz = Math.floor(camera.position.z / T);
        this.lawn.forEach((t, k) => { const kk = k % 25; t.position.set((cx + (kk % 5) - 2) * T, 0, (cz + Math.floor(kk / 5) - 2) * T); t.boundingSphere.center.set(T / 2, camera.position.y, T / 2); t.updateMatrixWorld(); });
      }
      for (const g of this.grassChunks) g.visible = g.boundingSphere.center.distanceToSquared(camera.position) < (78 + g.boundingSphere.radius) ** 2;
      for (const c of this.clouds) {
        c.lookAt(camera.position);
        _cr.set(1, 0, 0).applyQuaternion(c.quaternion); _cu.set(0, 1, 0).applyQuaternion(c.quaternion); _cf.set(0, 0, 1).applyQuaternion(c.quaternion);
        c.material.uniforms.uL.value.set(SUN_DIR.dot(_cr), SUN_DIR.dot(_cu), SUN_DIR.dot(_cf));
      }
      // centre the shadow box a little ahead of the camera, snapped to shadow texels so edges don't shimmer. The snap must be on
      // the light's own axes: rounding world x/z moves the box by sub-texel steps in light space (the sun is oblique), so
      // shadow edges crawl and flicker the cool shadow tint on the ground as the camera moves.
      const f = camera.getWorldDirection(_fw).setY(0).normalize(), c = _fc.copy(camera.position).addScaledVector(f, this.shadowS * 0.45);
      const texel = (this.shadowS * 2) / this.sun.shadow.mapSize.x;
      c.y = 0;
      const u = Math.round(c.dot(SUN_X) / texel) * texel, v = Math.round(c.dot(SUN_Y) / texel) * texel, d = c.dot(SUN_DIR);
      c.copy(SUN_X).multiplyScalar(u).addScaledVector(SUN_Y, v).addScaledVector(SUN_DIR, d);
      this.sun.target.position.copy(c); this.sun.position.copy(c).addScaledVector(SUN_DIR, 150);
    }
    if (fx) {
      // loose leaves riding the breeze past the camera (same wind as the grass)
      if (camera && Math.random() < dt * 2.5) {
        const side = rand(-14, 14), back = rand(8, 18), x = camera.position.x - 0.83 * back - 0.55 * side, z = camera.position.z - 0.55 * back + 0.83 * side;
        const c = new THREE.Color().setHSL(0.2 + Math.random() * 0.12, 0.6, 0.35 + Math.random() * 0.2);
        fx.smoke.emit({ x, y: this.heightAt(x, z) + rand(2, 6), z, vx: 0.83 * rand(1.5, 3), vy: rand(-0.5, -0.1), vz: 0.55 * rand(1.5, 3), life: 8, size: rand(0.12, 0.18), color: c, alpha: 1, drag: 0.05, grav: 0.08, frame: 5, spin: rand(-4, 4), turb: 0.9, style: 3 });
      }
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
