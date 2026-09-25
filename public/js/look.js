// Visual genome of a spell.
// Every visual is driven by a small set of continuous, abstract axes (0..1), never by "which preset to play":
//   temperature · sharpness · density (hardness / matter) · weight · dispersion · luminosity · height · width
// Each axis has one consistent meaning across shape, colour, fluctuation, initial velocity and time evolution:
//   temperature : colour along a blackbody ramp (deep red → orange → yellow → white → blue), buoyancy (hot rises),
//                 flicker speed, fast bright birth + quick decay; cold sinks, lingers, crystallises
//   sharpness   : soft round puffs → flame tongues → shards/stars; low-frequency wobble → fine high-frequency detail;
//                 particles stretch along their velocity
//   density     : ethereal glow → opaque matter: opacity, dark crust over glowing veins, smoke, rock cores, embers
//   weight      : gravity on particles, slow launch speed, low squat volumes, debris that falls and bounces
//   dispersion  : spread cone, turbulence, how far particles wander from the body, ragged silhouettes
//   luminosity  : intensity, white-hot cores, bloom, light radius
//   height/width: proportions of every volume
// "Substance" words (magma, raging flame, plasma…) only bias these axes, so incantations blend continuously.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

export const SUBSTANCES = ['native', 'magma', 'flame', 'plasma', 'smoke', 'crystal', 'liquid', 'mist', 'spectral', 'radiant', 'corrupted'];

// Where each substance pulls the axes (unlisted axes keep the incantation's own values).
const BIAS = {
  magma: { temperature: 0.62, density: 0.9, weight: 0.85, sharpness: 0.2, luminosity: 0.35, dispersion: 0.25 },
  flame: { temperature: 0.8, density: 0.15, weight: 0.05, sharpness: 0.5, luminosity: 0.75, dispersion: 0.55 },
  plasma: { temperature: 0.97, density: 0.05, weight: 0.0, sharpness: 0.8, luminosity: 0.95, dispersion: 0.35 },
  smoke: { temperature: 0.55, density: 0.7, weight: 0.3, sharpness: 0.05, luminosity: 0.18, dispersion: 0.7 },
  crystal: { density: 0.95, sharpness: 0.95, weight: 0.6, luminosity: 0.6, dispersion: 0.2 },
  liquid: { density: 0.6, sharpness: 0.1, weight: 0.7, dispersion: 0.35 },
  mist: { density: 0.04, sharpness: 0.0, weight: 0.05, luminosity: 0.4, dispersion: 0.8 },
  spectral: { density: 0.02, sharpness: 0.25, weight: 0.0, luminosity: 0.55, dispersion: 0.6 },
  radiant: { luminosity: 1.0, sharpness: 0.7, density: 0.1, weight: 0.0 },
  corrupted: { luminosity: 0.15, density: 0.6, dispersion: 0.6 },
};
// Element defaults for axes the chant never mentions.
const DENSITY = { fire: 0.3, ice: 0.75, water: 0.55, lightning: 0.1, wind: 0.08, earth: 0.85, darkness: 0.5, light: 0.15, nature: 0.55, poison: 0.45, arcane: 0.3 };
const LUM = { fire: 0.65, ice: 0.55, water: 0.45, lightning: 0.85, wind: 0.4, earth: 0.35, darkness: 0.3, light: 0.95, nature: 0.45, poison: 0.45, arcane: 0.7 };
// Each element's own lean on the axes (weaker than a substance), so a plain ice spell is still sharp crystal.
const EL_BIAS = { ice: { sharpness: 0.85 }, lightning: { sharpness: 0.8, dispersion: 0.55 }, earth: { weight: 0.75 }, wind: { weight: 0.0, dispersion: 0.6 }, water: { sharpness: 0.1 }, poison: { dispersion: 0.55 } };
// each element's neutral temperature (what the local parser assumes when nothing is said)
const T0 = { fire: 0.8, ice: 0.08, water: 0.35, lightning: 0.6, wind: 0.4, earth: 0.5, darkness: 0.3, light: 0.65, nature: 0.5, poison: 0.45, arcane: 0.5 };
const THERMAL = { fire: 1, light: 0.3, earth: 0.25 }; // how much temperature recolours the element

const C = (h) => new THREE.Color(h);
// Blackbody-ish ramp: 0.45 deep ember red … 0.9 white … 1 blue-white
const RAMP = [[0.4, C(0x5a0a02)], [0.55, C(0xc2200a)], [0.7, C(0xff5a12)], [0.82, C(0xffa22a)], [0.9, C(0xfff0c8)], [1.0, C(0x6ab4ff)]];
export function blackbody(t) {
  t = clamp(t, RAMP[0][0], 1);
  for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) { const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i]; return ca.clone().lerp(cb, (t - a) / (b - a)); }
  return RAMP[RAMP.length - 1][1].clone();
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// Stable per-incantation hue jitter so no two chants are pixel-identical.
function jitter(seed) { const x = Math.sin((seed || 1) * 12.9898) * 43758.5453; return x - Math.floor(x) - 0.5; }

export function lookOf(spec, pal) {
  const el = spec.element, e2 = spec.element2;
  let sub = spec.substance && spec.substance !== 'native' ? spec.substance : null;
  if (!sub) { // implied by fusions
    if (el === 'fire' && e2 === 'earth') sub = 'magma';
    else if (el === 'fire' && e2 === 'darkness') sub = 'corrupted';
    else if (el === 'fire' && e2 === 'light') sub = 'radiant';
    else if ((el === 'water' || el === 'ice') && e2 === 'wind') sub = 'mist';
  }
  const B = (sub && BIAS[sub]) || {};
  // an explicit axis from the chant beats the substance; otherwise the substance pulls the element default
  const EB = EL_BIAS[el] || {};
  const axis = (k, specV, def) => {
    let v = specV ?? def;
    if (EB[k] !== undefined) v = lerp(v, EB[k], 0.5);
    return B[k] === undefined ? clamp(v) : clamp(lerp(v, B[k], specV == null ? 0.85 : 0.6));
  };
  const g = {
    temperature: axis('temperature', spec.temperature, 0.5),
    sharpness: axis('sharpness', spec.sharpness, 0.4),
    density: axis('density', spec.density, DENSITY[el] ?? 0.4),
    weight: axis('weight', spec.weight, 0.35),
    dispersion: axis('dispersion', spec.chaos, 0.3),
    luminosity: axis('luminosity', spec.luminosity, LUM[el] ?? 0.6),
    height: clamp(spec.height ?? 0.5), width: clamp(spec.width ?? 0.5),
  };
  const { temperature: T, sharpness: S, density: D, weight: W, dispersion: X, luminosity: L } = g;

  // ---- colour
  const P = pal, th = THERMAL[el] ?? 0.1;
  if (sub === 'corrupted') { P.color.lerp(C(0x9a1aff), 0.45); P.core.lerp(C(0xff5ae0), 0.5); P.dark.set(0x07000c); }
  if (sub === 'spectral') { P.color.lerp(C(0x7fe8d8), 0.5).offsetHSL(0, -0.15, 0.05); P.core.set(0xeafffb); }
  if (sub === 'radiant') { P.color.lerp(C(0xffd766), 0.55); P.core.set(0xfffbe8); }
  if (sub === 'mist') { P.color.lerp(C(0xdfeaf6), 0.4); P.core.lerp(C(0xffffff), 0.6); }
  if (th > 0 && sub !== 'corrupted' && sub !== 'spectral') { // temperature recolours thermal elements along the ramp
    P.color.lerp(blackbody(T), th * 0.85);
    P.core.lerp(blackbody(Math.min(1, T + 0.12)).lerp(C(0xffffff), 0.35), th * 0.8);
  }
  // every element also answers temperature relative to its own neutral point: colder → icy blue-white, hotter → gold/orange
  const dT = T - (T0[el] ?? 0.5);
  if (el !== 'fire') {
    const k = Math.min(1, Math.abs(dT) * 2.2) * (1 - th * 0.6);
    if (dT < 0) { P.color.lerp(C(0x8fd4ff), k * 0.8); P.core.lerp(C(0xf2fbff), k * 0.6); }
    else { P.color.lerp(C(0xffa040), k * 0.75); P.core.lerp(C(0xfff0c0), k * 0.6); }
  }
  const j = jitter(spec.seed);
  P.color.offsetHSL(j * 0.04, 0, 0);
  P.color.multiplyScalar(0.6 + L * 0.55); // dim spells burn deep and saturated
  P.core.lerp(C(0xffffff), smooth(0.7, 1, L) * 0.6); // bright ones bleach to white
  // matter colour: soot for hot dense stuff, the element's own dark tone for cold ones
  P.smoke = C(0x3e3634).lerp(P.dark.clone().lerp(C(0x9aa4b0), 1 - T), 0.5 - T * 0.35).lerp(P.color.clone().lerp(C(0xffffff), 0.6), smooth(0.6, 1, L) * (1 - D) * 0.8);
  if (sub === 'mist' || el === 'wind' || el === 'ice' || el === 'water') P.smoke.lerp(C(0xe8f0f8), 0.7);
  // every element's smoke carries its own matter (toxic haze, dust, pollen, violet aether…) instead of neutral grey
  const SMK = { poison: [0x7f9a2a, 0.65], nature: [0x8fae5a, 0.55], earth: [0xa08a6a, 0.5], arcane: [0x6a4ea8, 0.5], darkness: [0x2a1838, 0.55], light: [0xf2e2b0, 0.6], lightning: [0x4a5070, 0.45] }[el];
  if (SMK && sub !== 'smoke') P.smoke.lerp(C(SMK[0]), SMK[1] * (1 - smooth(0.55, 0.9, T) * 0.6));
  P.accent = P.core.clone();

  // ---- particles: every number is a function of the axes
  const hot = smooth(0.55, 0.85, T);
  const part = {
    rise: (T - 0.45) * 9 * (1 - D * 0.75) - W * 2.5, // buoyancy
    grav: W * D * 16 - hot * (1 - D) * 2,
    drag: 0.6 + (1 - D) * 1.2 + S * 0.4,
    turb: X * 3 + (1 - D) * 0.8 + hot * 0.6,
    size: 0.65 + (1 - S) * 0.55 + (1 - D) * 0.35,
    life: 0.45 + D * 0.8 + (1 - T) * 0.35 + (1 - S) * 0.2,
    alpha: 0.35 + D * 0.55 + L * 0.1,
    spread: 0.5 + X * 1.2,
    // sprite: soft → tongue → shard/star
    frame: S > 0.7 ? (L > 0.8 && D < 0.4 ? 1 : 4) : hot > 0.3 && S > 0.25 ? 3 : D > 0.6 && L < 0.45 ? 2 : 0,
    style: S > 0.7 ? 'crisp' : hot > 0.3 && D < 0.75 ? 'flame' : D > 0.55 && L < 0.45 ? 'smoke' : 'glow',
    smoke: D * (1 - L * 0.8) * 1.6 + X * 0.3,
    embers: D * hot * 1.2 + (sub === 'crystal' ? 0.4 : 0),
    emberGrav: 4 + W * 12,
    spark: hot * (0.4 + S * 1.4) + L * 0.5,
    sparkGrav: W * 16,
    count: 0.55 + D * 0.7 + X * 0.3,
  };
  // ---- surfaces
  const shell = {
    amp: (1 - S) * 0.3 + X * 0.3 + (1 - D) * 0.12, freq: 1.2 + S * 2.6 + X, flow: 0.8 + T * 5 * (1 - D * 0.6) + X * 2,
    opacity: 0.2 + D * 0.35 + L * 0.1, bands: L > 0.88 ? 1 : 0, rim: 1.5 + S * 2,
  };
  const crust = smooth(0.55, 0.85, D) * (1 - smooth(0.6, 0.95, L)); // dark matter skin over glowing veins
  const core = S > 0.75 && D > 0.65 ? 'crystal' : D > 0.72 ? 'rock' : D < 0.15 && L < 0.65 ? 'wisp' : L > 0.85 && T > 0.85 ? 'plasma' : 'energy';
  const sy = Math.pow(2, (g.height - 0.5) * 2.4);
  return {
    g, substance: sub || 'native', part, shell, crust, core,
    // proportions: exponential so 0 and 1 read as clearly different silhouettes; mild volume conservation
    sy, sx: Math.pow(2, (g.width - 0.5) * 2.2) * Math.pow(sy, -0.18),
    intensity: 0.5 + L * 0.8, lightMul: 0.35 + L * 0.9,
    // time evolution: hot/light things bloom fast and fade fast; heavy/dense things swell slowly and linger
    growT: 0.12 + W * 0.35 + D * 0.2 - hot * 0.08, lingerMul: 0.7 + D * 0.6 + W * 0.3 - hot * 0.2,
    pal: P,
  };
}
