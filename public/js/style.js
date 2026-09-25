// Global art direction applied to three.js itself. Imported before any material compiles.
//  · Soft cel terminator: every Standard/Lambert material's direct light goes through one ramp, so terrain, ruins,
//    characters and props share the same toon light/shadow boundary while keeping PBR ambient + specular.
//  · Rim light on every lit material.
//  · Helpers for weathered, chamfered stone geometry (no more raw boxes).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm } from './util.js';

const CEL = /* glsl */ `
#define CEL_SHADE
// soft two-band ramp: a narrow, slightly warm terminator; a sliver of the raw N·L keeps form readable in the light
float celNL(float x){ return smoothstep(0.0, 0.16, x) * 0.86 + x * 0.14; }
vec3 celDirect = vec3(0.0); // how much direct light (after cast shadows) this pixel received; drives the shadow hue below
`;
const IRR = 'vec3 irradiance = dotNL * directLight.color;';
for (const k of ['lights_physical_pars_fragment', 'lights_lambert_pars_fragment']) {
  const src = THREE.ShaderChunk[k];
  if (!src.includes(IRR)) { console.warn('style.js: cel patch skipped for', k); continue; }
  THREE.ShaderChunk[k] = CEL + src.replace(IRR, 'vec3 irradiance = celNL(dotNL) * directLight.color; celDirect += irradiance;');
}

// Drifting cumulus shadows: slow soft-edged pools of shade roll across the whole landscape (terrain, ruins, grass,
// characters), projected along the sun so tall things are shaded where the cloud really is. Only the sun is dimmed.
// CLOUD is a plain {x,y} object: UniformsUtils.clone keeps it by reference, so one write per frame reaches every material.
export const CLOUD = { x: 0, y: 1 }; // x: time, y: strength
const CS_SUN = new THREE.Vector3(-0.55, 0.52, -0.65).normalize(); // keep in sync with world.js SUN_DIR
for (const k of ['physical', 'standard', 'lambert', 'toon', 'phong']) if (THREE.ShaderLib[k]) THREE.ShaderLib[k].uniforms.uCloudT = { value: CLOUD };
export const CLOUD_GLSL = /* glsl */ `
uniform vec2 uCloudT;
float csHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float csNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(csHash(i), csHash(i+vec2(1.0,0.0)), f.x), mix(csHash(i+vec2(0.0,1.0)), csHash(i+vec2(1.0,1.0)), f.x), f.y); }
// cloud density at a world point, projected along the sun: the sky's cloud deck samples it at its altitude and every
// lit surface samples it at its own position, so each pool of shade lies exactly under the cloud that casts it
float cloudField(vec3 wp){
  vec2 p = (wp.xz - vec2(${CS_SUN.x.toFixed(4)}, ${CS_SUN.z.toFixed(4)}) / ${CS_SUN.y.toFixed(4)} * wp.y) * 0.015 + uCloudT.x * vec2(0.012, 0.005);
  return csNoise(p) * 0.62 + csNoise(p * 2.7 + 7.3) * 0.28 + csNoise(p * 7.1 + 3.1) * 0.1;
}
float cloudShade(vec3 vpos){
  return 1.0 - smoothstep(0.525, 0.6, cloudField(cameraPosition + transpose(mat3(viewMatrix)) * vpos)) * 0.55 * uCloudT.y;
}
`;
{
  const k = 'lights_fragment_begin', src = THREE.ShaderChunk[k], hook = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (src.includes(hook)) THREE.ShaderChunk[k] = src.replace(hook, hook + '\n\t\tdirectLight.color *= cloudShade( geometryPosition );');
  else console.warn('style.js: cloud shadow patch skipped');
  THREE.ShaderChunk.lights_pars_begin = CLOUD_GLSL + THREE.ShaderChunk.lights_pars_begin; // every lit fragment shader
}

// Stylized rim: a fresnel edge light that is strongest when the sun is behind the object, tinted by albedo,
// so back-lit silhouettes separate from the background instead of going flat.
THREE.ShaderChunk.lights_fragment_end = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
  float rimF = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 4.0);
  float back = 0.3 + 0.7 * saturate(-dot(geometryViewDir, directionalLights[0].direction));
  reflectedLight.directDiffuse += directionalLights[0].color * rimF * back * (0.05 + 0.3 * material.diffuseColor);
}
#endif
` + THREE.ShaderChunk.lights_fragment_end + /* glsl */ `
// Coloured shadows: the shaded side keeps (and slightly boosts) the albedo's hue and leans cool, instead of the
// ambient term turning every surface a darker grey. Green grass shades to teal-green, sandstone to warm violet-grey.
#if defined(CEL_SHADE) && NUM_DIR_LIGHTS > 0
{
  const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
  float lit = saturate(dot(celDirect, LUM) / max(dot(directionalLights[0].color, LUM), 1e-4));
  vec3 dc = material.diffuseColor;
  vec3 chroma = min(dc / max(dot(dc, LUM), 1e-3), vec3(2.5));
  vec3 tint = mix(vec3(1.0), chroma, 0.4) * vec3(0.96, 0.99, 1.06) * 1.25;
  reflectedLight.indirectDiffuse *= mix(vec3(1.0), tint, 1.0 - lit);
}
#endif
`;

// Atmosphere for every fogged material: distance fog + a low valley mist that thins with altitude, both tinted warm
// toward the sun and cool away from it (aerial perspective), so depth reads as air instead of a flat grey wash.
const FOG_SUN = new THREE.Vector3(-0.55, 0.52, -0.65).normalize(); // keep in sync with world.js SUN_DIR
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogWorld;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = -mvPosition.z; vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  float fogMist = (1.0 - exp(-vFogDepth * 0.0065)) * exp(-max(vFogWorld.y + 1.0, 0.0) * 0.085);
  fogFactor = max(fogFactor, fogMist * 0.5);
  float fogSun = dot(normalize(vFogWorld - cameraPosition), vec3(${FOG_SUN.x.toFixed(4)}, ${FOG_SUN.y.toFixed(4)}, ${FOG_SUN.z.toFixed(4)}));
  vec3 fogC = fogColor * mix(vec3(0.96, 0.99, 1.04), vec3(1.22, 1.05, 0.84), pow(fogSun * 0.5 + 0.5, 4.0));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);
#endif`;

// Chamfered block with chipped, uneven faces. Deterministic from rng. Hundreds of bricks share a few sizes, so
// geometry is cached per (size rounded to 10 cm, chip style, one of 3 chip patterns) and scaled to the exact size.
const _blockCache = new Map();
export function stoneBlock(w, h, d, rng, opts = {}) {
  const q = (v) => Math.max(0.1, Math.round(v * 10) / 10), W = q(w), H = q(h), D = q(d), variant = Math.floor(rng() * 3);
  const key = `${W}|${H}|${D}|${opts.round ?? ''}|${opts.chip ?? ''}|${opts.seg ?? ''}|${variant}`;
  let g = _blockCache.get(key);
  if (!g) { g = makeStoneBlock(W, H, D, variant * 13.7 + 1, opts); if (_blockCache.size < 1500) _blockCache.set(key, g); }
  const out = g.clone(); out.scale(w / W, h / H, d / D);
  return out;
}
function makeStoneBlock(w, h, d, seed, { round = 0.09, chip = 0.05, seg = 3 } = {}) {
  const m = Math.min(w, h, d);
  let g = new RoundedBoxGeometry(w, h, d, seg, Math.min(m * 0.3, round + m * 0.06));
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, s = seed;
  const hw = w / 2, hh = h / 2, hd = d / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // chips concentrate on edges and corners (where more than one axis is near its extent)
    const edge = Math.max(0, Math.abs(x) / hw + Math.abs(y) / hh + Math.abs(z) / hd - 1.9);
    const k = fbm(x * 1.7 + s, y * 1.7 + z * 1.3, 3) * chip * m * (0.5 + edge * 2.2) - edge * chip * m * 0.6;
    p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// Organic boulder / cliff chunk: displaced icosphere with smooth normals and flattened base.
export function boulder(rng, { detail = 3, squash = 0.72, rough = 0.4 } = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail), v = new THREE.Vector3(), s = rng() * 40;
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const m = mergeVertices(g), p = m.attributes.position;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.6 + s, v.y * 1.6 + v.z * 1.1, 4);
    // terraced strata give a hand-sculpted look
    const strata = Math.round((v.y + n * 0.3) * 4) / 4 * 0.06;
    v.multiplyScalar(0.82 + n * rough + strata);
    v.y = v.y * squash; if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  m.computeVertexNormals();
  return m;
}
