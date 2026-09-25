// Procedural spell runtime. A spell spec (element, shape + continuous parameters)
// is turned into geometry, motion, particles, light, sound and damage.
import * as THREE from 'three';
import { energyMaterial, crystalMaterial, flowMaterial, matterFlowMaterial, ribbonMaterial, distortLensMaterial, TIME, NOISE } from './shaders.js';
import { lookOf } from './look.js';
import { kitOf, surfaceMaterial } from './vfxkit.js';
import { stoneMaterial } from './world.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Ribbon, boltPoints } from './fx.js';
import { MagicCircle } from './magicCircle.js';
import { ELEMENTS, paletteFor } from './elements.js';
import { applyHit } from './combat.js';
import { rand, clamp, lerp, mulberry32, TAU, fbm, pick } from './util.js';

// ------------------------------------------------------------ shared geometry
const SPHERE = new THREE.IcosahedronGeometry(1, 4);
const SPHERE_LO = new THREE.IcosahedronGeometry(1, 2);
const OCTA = new THREE.OctahedronGeometry(1, 0);
const SMOOTH = new THREE.SphereGeometry(1, 48, 32);
// comet skin: sphere whose flow axis (uv.y, pole to pole) points backward along -Z, stretched into a tail
const FLECK = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.5, 0, -0.35, -0.3, 0.05, 0.4, -0.25, -0.05, 0.05, -0.55, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]); g.computeVertexNormals(); return g; })(); // leaf/chip: a bent quad
const COMET = (() => { const g = new THREE.SphereGeometry(1, 48, 32); g.rotateX(-Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const z = p.getZ(i); if (z < 0) p.setZ(i, z * 1.9); } g.computeVertexNormals(); return g; })();
const ROCK = (() => {
  const g = new THREE.DodecahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(0.8 + fbm(v.x * 1.7 + 3, v.y * 1.7 + v.z, 3) * 0.4); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
})();
const BEAM_GEO = (() => {
  // unit beam along +Z, pinched at the root so it flares out of the caster's hand
  const g = new THREE.CylinderGeometry(1, 1, 1, 28, 60, true); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i), t = Math.min(1, z / 0.07), f = 0.12 + 0.88 * t * t * (3 - 2 * t); p.setX(i, p.getX(i) * f); p.setY(i, p.getY(i) * f); }
  g.computeVertexNormals(); return g;
})();
const SPIKE_GEOS = [5, 6, 7].map((n) => { const g = new THREE.ConeGeometry(1, 1, n, 1); g.translate(0, 0.5, 0); return g; });
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
let SPELL_ID = 0;

// ------------------------------------------------------------ helpers
class Trail {
  constructor(spell, color, core, width, max = 24, intensity = 2.5) {
    this.ribbon = new Ribbon(max, ribbonMaterial({ color, core, intensity }));
    spell.g.scene.add(this.ribbon.mesh);
    this.spell = spell; this.pts = []; this.max = max; this.width = width; this.dead = false;
  }
  push(p) { this.pts.push(p.clone()); if (this.pts.length > this.max) this.pts.shift(); }
  update() {
    if (this.dead) { this.pts.shift(); if (this.pts.length > 8) this.pts.shift(); }
    if (this.pts.length < 2) { if (this.dead) { this.dispose(); return false; } this.ribbon.mesh.geometry.setDrawRange(0, 0); return true; }
    this.ribbon.set(this.pts, (t) => this.width * Math.pow(t, 0.7), this.spell.g.camera.position);
    return true;
  }
  dispose() { this.spell.g.scene.remove(this.ribbon.mesh); this.ribbon.mesh.geometry.dispose(); this.ribbon.mesh.material.dispose(); }
}

// Projectile body from the look axes: density picks matter (wisp … energy … rock/crystal), sharpness the silhouette detail,
// temperature the flicker/flow, luminosity the intensity. (Mana bolts keep the classic element core.)
function lookCore(L, r, spec) {
  const g = new THREE.Group(), G = L.g, P = L.pal, Sh = L.shell, I = L.intensity;
  const hot = clamp((G.temperature - 0.55) / 0.3);
  if (L.core === 'rock' || L.core === 'crystal') {
    const gem = L.core === 'crystal';
    const cm = crystalMaterial({ color: gem ? P.color.clone().lerp(new THREE.Color(0xffffff), 0.4) : P.smoke.clone().multiplyScalar(0.9), glow: P.color, emissive: 0.6 + hot * 2.2 * (0.4 + G.luminosity), crack: 0.3 + hot * 0.6 });
    const body = new THREE.Group();
    if (gem) { // a cluster of shards radiating from the centre
      for (let i = 0; i < 6; i++) { const sh = new THREE.Mesh(OCTA, cm); sh.scale.set(0.32, 1.1 + Math.random() * 0.5, 0.32); sh.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU); body.add(sh); }
    } else body.add(new THREE.Mesh(ROCK, cm));
    g.add(body); g.userData.spin = body;
    // a comet skin of the matter (frost mist, dust, embers) streaming behind the solid core
    const sk = new THREE.Mesh(COMET, surfaceMaterial({ ...kitOf(spec.element, L), opacity: 0.55 }, { spin: 2, twist: 1.2, bulge: 0.2 }));
    sk.material.uniforms.uTopFade.value = 1; sk.material.uniforms.uFlow.value = 3; sk.scale.setScalar(1.35); sk.renderOrder = 3; g.add(sk); g.userData.comet = true;
    // hot matter wears a thin licking shell; cold matter a faint halo
    const shell = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: P.color, core: P.core, intensity: I * (0.6 + hot), noiseAmp: Sh.amp + hot * 0.2, noiseFreq: Sh.freq, flow: Sh.flow, opacity: 0.15 + hot * 0.3 }));
    shell.scale.setScalar(1.25 + hot * 0.25); g.add(shell);
  } else if (L.core === 'wisp') {
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: P.color, core: P.core, intensity: I * 1.1, noiseAmp: 0.5 + G.dispersion * 0.4, noiseFreq: 1 + i * 0.7, flow: 1.5 + i, opacity: 0.45 - i * 0.1, rimPower: 1.2, additive: i > 0 }));
      w.scale.setScalar(0.8 + i * 0.35); g.add(w);
    }
  } else {
    // a kit shell gives the orb a readable, alpha-blended silhouette of its matter (storm cloud, water, dust, flame…)
    const kit = kitOf(spec.element, L), shellK = { ...kit, opacity: Math.max(kit.opacity, 0.75) };
    const skin = new THREE.Mesh(COMET, surfaceMaterial(shellK, { spin: 2.5, twist: 1.5, bulge: 0.12 + G.dispersion * 0.15 }));
    skin.material.uniforms.uTopFade.value = 1; skin.material.uniforms.uFlow.value = 2.5 + hot * 3; skin.scale.setScalar(1.1); skin.renderOrder = 3; g.add(skin); g.userData.comet = true;
    const inner = new THREE.Mesh(SPHERE, energyMaterial({ color: P.color, core: P.core, intensity: I * (0.85 + spec.mag * 0.4), noiseAmp: Sh.amp * 0.6, noiseFreq: Sh.freq, flow: Sh.flow, bands: Sh.bands, rimPower: Sh.rim }));
    g.add(inner);
    // shell count and raggedness grow with dispersion and heat: a plasma ball is one tight sphere, raging fire is layers of tongues
    const layers = 1 + Math.round(G.dispersion * 1.5 + hot * (1 - G.sharpness));
    for (let i = 0; i < layers; i++) {
      const o = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: P.color, core: i ? P.color : P.core, intensity: I * (0.55 - i * 0.12), noiseAmp: Sh.amp * (1 + i * 0.6), noiseFreq: Sh.freq * (1 - i * 0.2), flow: Sh.flow * (1 + i * 0.3), opacity: Sh.opacity * (1 - i * 0.3) }));
      o.scale.setScalar(1.35 + i * 0.35); g.add(o);
    }
    if (G.sharpness > 0.7) { // sharp energy grows orbiting rings
      for (let i = 0; i < 2; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3 + i * 0.2, 0.04, 6, 40), energyMaterial({ color: P.core, intensity: I * 2, noiseAmp: 0.02 })); ring.userData.ownGeo = true; ring.rotation.set(rand(0, TAU), rand(0, TAU), 0); g.add(ring); if (!i) g.userData.ring = ring; }
    }
    if (L.crust > 0.3) { // dense dark matter swirling over the energy (smoke balls, black flame)
      const dark = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: P.smoke, core: P.color, intensity: 1, noiseAmp: 0.4, noiseFreq: 1.6, flow: 2, opacity: 0.6 * L.crust, additive: false }));
      dark.scale.setScalar(1.2); g.add(dark);
    }
  }
  // radiant spells carry a star glint (spikes from sharpness) that twinkles in flight
  if (G.luminosity > 0.78) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex(), color: P.core.clone().lerp(P.color, 0.3).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.setScalar(3.2 + G.luminosity); g.add(sp); g.userData.glint = sp;
  }
  // proportions: an orb stretches a little with height/width
  g.scale.set(r * Math.sqrt(L.sx), r * Math.sqrt(L.sy), r * Math.sqrt(L.sx));
  g.userData.base = g.scale.clone();
  return g;
}
let _glint = null;
function glintTex() {
  if (_glint) return _glint;
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.4, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, S, S);
  c.fillStyle = '#fff';
  for (const [r, w] of [[0, 3.5], [Math.PI / 2, 3.5], [Math.PI / 4, 1.6], [-Math.PI / 4, 1.6]]) { c.save(); c.translate(64, 64); c.rotate(r); c.beginPath(); c.moveTo(0, -62); c.quadraticCurveTo(w, 0, 0, 62); c.quadraticCurveTo(-w, 0, 0, -62); c.fill(); c.restore(); }
  _glint = new THREE.CanvasTexture(cv); _glint.colorSpace = THREE.SRGBColorSpace;
  return _glint;
}
function coreMesh(el, pal, r, spec, look = null) {
  if (look && !spec.basic) return lookCore(look, r, spec);
  const g = new THREE.Group();
  const chaos = spec.chaos || 0;
  if (el === 'earth') {
    const rock = new THREE.Mesh(ROCK, crystalMaterial({ color: 0x5a4632, glow: pal.color, emissive: 1.4, crack: 0.6 }));
    g.add(rock); g.userData.spin = rock;
    const halo = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: pal.color, core: pal.core, intensity: 1.2, noiseAmp: 0.3, opacity: 0.35 })); halo.scale.setScalar(1.35); g.add(halo);
  } else if (el === 'ice') {
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(OCTA, crystalMaterial({ color: 0x9fdcff, glow: pal.color, emissive: 1.1, crack: 0.3 }));
      c.scale.set(0.45, 1.1, 0.45); c.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU)); g.add(c);
    }
    g.userData.spin = g;
    const halo = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: pal.color, core: 0xffffff, intensity: 1.4, noiseAmp: 0.2, opacity: 0.4 })); halo.scale.setScalar(1.3); g.add(halo);
  } else {
    const inner = new THREE.Mesh(SPHERE, energyMaterial({ color: pal.color, core: pal.core, intensity: 1.7 + spec.mag * 0.7, noiseAmp: 0.18 + chaos * 0.3, noiseFreq: 1.8 + chaos * 3, flow: 2 + spec.speed * 3, bands: el === 'arcane' || el === 'light' ? 1 : 0 }));
    g.add(inner);
    const outer = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: pal.color, core: pal.color, intensity: 1.4, noiseAmp: 0.35 + chaos * 0.4, noiseFreq: 1.2, flow: 3, opacity: 0.45 }));
    outer.scale.setScalar(1.45); g.add(outer);
    if (el === 'darkness') { const black = new THREE.Mesh(SPHERE_LO, new THREE.MeshBasicMaterial({ color: 0x000000 })); black.scale.setScalar(0.72); g.add(black); }
    if (el === 'wind' || el === 'water') { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 6, 32), energyMaterial({ color: pal.color, intensity: 2, noiseAmp: 0.05 })); g.add(ring); g.userData.ring = ring; }
  }
  g.scale.setScalar(r);
  return g;
}

function disposeObj(o) {
  o.traverse((m) => {
    if (m.material) { (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); }
    if (m.geometry && m.userData.ownGeo) m.geometry.dispose();
  });
}

// ------------------------------------------------------------ base spell
class Spell {
  constructor(sys, spec, caster, aim) {
    this.sys = sys; this.g = sys.game; this.spec = spec; this.caster = caster; this.aim = aim;
    this.el = spec.element; this.el2 = spec.element2;
    this.look = lookOf(spec, paletteFor(spec.element, spec.temperature));
    this.pal = this.look.pal;
    this.pal2 = spec.element2 ? paletteFor(spec.element2, spec.temperature) : null;
    this.t = 0; this.objs = []; this.trails = []; this.projectiles = []; this.done = false;
    this.rng = mulberry32((spec.seed || 1) + (++SPELL_ID) * 7919);
    this.id = SPELL_ID;
    this.level = spec.basic ? 0 : spec.level ?? 1;
    // effective magnitude: grades push size/intensity apart non-linearly (minor 0.75× … ultimate 1.9×)
    this.m = spec.mag * [0.75, 1, 1.35, 1.9][this.level];
  }
  add(o) { this.g.scene.add(o); this.objs.push(o); return o; }
  remove(o) { this.g.scene.remove(o); disposeObj(o); const i = this.objs.indexOf(o); if (i >= 0) this.objs.splice(i, 1); }
  trail(color, core, width, max, intensity) { const t = new Trail(this, color, core, width, max, intensity); this.trails.push(t); return t; }
  targets() { return this.g.combatants.filter((c) => c.alive && c !== this.caster); }
  nearestTarget(from, dir = null, cone = 0.6, range = 80) {
    let best = null, bd = Infinity;
    for (const t of this.targets()) {
      const c = t.center(); const d = c.distanceTo(from);
      if (d > range) continue;
      if (dir) { const dot = _v.subVectors(c, from).normalize().dot(dir); if (dot < cone) continue; }
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  hit(target, base, point, extra = {}) {
    const s = this.spec;
    const res = applyHit(this.g, target, { dmg: base * s.dmgMult, el: this.el, el2: this.el2, src: this.caster, point, mag: s.mag, weight: s.weight, dmgMult: s.dmgMult, shape: s.shape, spellId: this.id, basic: s.basic, ...extra });
    if (this.el2 && target.alive) applyHit(this.g, target, { dmg: base * s.dmgMult * 0.3, el: this.el2, src: this.caster, point, mag: s.mag * 0.6, dmgMult: s.dmgMult, shape: s.shape, spellId: this.id, basic: s.basic });
    return res;
  }
  aoe(center, radius, base, { knock = 0, lift = 0, exclude = null, falloff = 0.6, extra = {} } = {}) {
    for (const t of this.targets()) {
      if (t === exclude) continue;
      const d = t.distTo(center);
      if (d > radius) continue;
      const k = 1 - (d / radius) * falloff;
      const dir = t.center().sub(center); dir.y = 0; dir.normalize().multiplyScalar(knock * k); dir.y += lift * k;
      this.hit(t, base * k, t.center(), { knock: dir, ...extra });
    }
  }
  emit(pos, count, size, speed = 2, dir = null, el = this.el, pal = this.pal) {
    this.g.fx.element(el, pos, { count, size, speed, palette: pal, dir, look: el === this.el && !this.spec.basic ? this.look : null });
    if (this.el2 && Math.random() < 0.4) this.g.fx.element(this.el2, pos, { count: Math.ceil(count * 0.5), size: size * 0.8, speed, palette: this.pal2, dir });
  }
  light(pos, intensity, range, color = this.pal.color) { this.g.fx.lights.request(pos, color, intensity, range); }
  explode(pos, radius, dmgBase, opts = {}) {
    this.g.fx.explosion(this.el, pos, radius, this.m, this.pal, { ...opts, look: this.look });
    if (this.el2) this.g.fx.explosion(this.el2, pos, radius * 0.6, this.m * 0.5, this.pal2, { noDecal: true });
    this.g.audio.impact(this.el, this.m * Math.min(1.3, radius / 3), pos, this.spec.basic ? null : this.look);
    if (dmgBase > 0) this.aoe(pos, radius, dmgBase, opts);
  }
  // blocks by walls / wards
  barrierHit(a, b) {
    for (const bar of this.sys.barriers) {
      if (bar.owner === this.caster) continue;
      const t = bar.segment(a, b);
      if (t !== null) return { bar, t };
    }
    return null;
  }
  updateCommon(dt) {
    for (let i = this.trails.length - 1; i >= 0; i--) if (!this.trails[i].update()) this.trails.splice(i, 1);
  }
  finished() { return this.done && this.trails.length === 0; }
  dispose() {
    for (const p of this.projectiles) if (p.haze) p.haze.alive = false;
    if (this.hazeH) this.hazeH.alive = false;
    if (this.lens) this.g.fx.distortScene.remove(this.lens);
    for (const o of this.objs) { this.g.scene.remove(o); disposeObj(o); }
    for (const t of this.trails) t.dispose();
    this.loopSnd?.stop();
  }
  threats() { return []; }
}

// ------------------------------------------------------------ projectile
class Projectile {
  constructor(spell, o) {
    Object.assign(this, { radius: 0.3, grav: 0, homing: 0, life: 4, target: null, wobble: 0 }, o);
    this.spell = spell; this.prev = this.pos.clone(); this.age = 0; this.alive = true; this.speed = this.vel.length();
    this.wseed = Math.random() * 100;
  }
  update(dt) {
    const sp = this.spell, g = sp.g;
    this.age += dt; this.prev.copy(this.pos);
    if (this.homing > 0) {
      if (!this.target || !this.target.alive) this.target = sp.nearestTarget(this.pos, this.vel.clone().normalize(), 0.3, 70);
      if (this.target) {
        const want = this.target.center().sub(this.pos).normalize().multiplyScalar(this.speed);
        this.vel.lerp(want, clamp(this.homing * dt * 2.2)); this.vel.setLength(this.speed);
      }
    }
    this.vel.y -= this.grav * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.wobble) {
      const w = this.wobble;
      this.pos.x += Math.sin(this.age * 13 + this.wseed) * w * dt * 6; this.pos.y += Math.cos(this.age * 11 + this.wseed) * w * dt * 6;
    }
    const bh = sp.barrierHit(this.prev, this.pos);
    if (bh) { this.pos.lerpVectors(this.prev, this.pos, bh.t); bh.bar.damage(this.power || 20, this.pos); this.end(null, 'barrier'); return false; }
    for (const t of sp.targets()) if (t.hits(this.pos, this.radius)) { this.end(t, 'hit'); return false; }
    if (g.world.solid(this.pos)) { this.end(null, 'world'); return false; }
    if (this.age > this.life) { this.end(null, 'expire'); return false; }
    if (this.mesh) {
      this.mesh.position.copy(this.pos);
      if (this.orient) this.mesh.lookAt(_v.copy(this.pos).add(this.vel));
      if (this.mesh.userData.spin) { this.mesh.userData.spin.rotation.x += dt * 3; this.mesh.userData.spin.rotation.y += dt * 2; }
      if (this.mesh.userData.ring) this.mesh.userData.ring.rotation.set(this.age * 5, this.age * 3, 0);
    }
    if (this.trailObj) this.trailObj.push(this.pos);
    this.onFly?.(this, dt);
    return true;
  }
  end(target, why) {
    this.alive = false;
    if (this.trailObj) this.trailObj.dead = true;
    if (this.mesh) this.spell.remove(this.mesh);
    this.onHit?.(this.pos.clone(), target, why);
  }
}

// ------------------------------------------------------------ 1. ORB
class OrbSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.r = (0.16 + s.size * 0.45) * (0.55 + this.m * 0.9) * (s.basic ? 0.6 : 1);
    this.n = s.count > 0.45 && !s.basic ? 1 + Math.round((s.count - 0.45) * 6) : 1;
    this.gather = !s.basic && this.m > 0.85 ? 0.12 : 0; // brief flourish; the real build-up happens while chanting
    this.launched = false;
    this.cores = [];
    const origin = this.sys.castOrigin(this.caster);
    for (let i = 0; i < this.n; i++) {
      const mesh = this.add(coreMesh(this.el, this.pal, this.r, s, this.look));
      mesh.position.copy(origin);
      this.cores.push(mesh);
    }
    if (this.gather) {
      this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.r * (this.caster.isPlayer ? 2 : 3.5), intensity: this.caster.isPlayer ? 1.2 : 2.2 });
      this.add(this.mc.group);
    }
    if (!s.basic) this.loopSnd = this.g.audio.loop(this.el, origin, 0.25 + this.m * 0.3, this.look);
  }
  launch() {
    const s = this.spec, aim = this.caster.getAim();
    const speed = (16 + s.speed * 42) * (1 - s.weight * 0.25) * (s.basic ? 1.3 : 1);
    this.launched = true;
    this.cores.forEach((mesh, i) => {
      const spread = this.n > 1 ? (i - (this.n - 1) / 2) * 0.09 : 0;
      const dir = _w.subVectors(aim.point, mesh.position).normalize();
      dir.applyAxisAngle(_up, spread);
      const pr = new Projectile(this, {
        pos: mesh.position.clone(), vel: dir.clone().multiplyScalar(speed), radius: this.r * 0.9, grav: s.weight * 7,
        homing: s.homing > 0.5 ? s.homing * 1.4 : s.basic ? 0.3 : 0, life: 4.5, mesh, wobble: s.chaos > 0.5 ? (s.chaos - 0.5) * 2 : 0, power: 30 * s.dmgMult,
      });
      pr.trailObj = this.trail(this.pal.color, this.pal.core, this.r * 1.1 * Math.sqrt(this.look.sx), s.basic ? 10 : Math.round(14 + this.look.g.dispersion * 14 + this.look.lingerMul * 4), (1.4 + this.m) * this.look.intensity);
      if (!s.basic && this.look.g.temperature > 0.6) pr.haze = this.g.fx.haze(() => pr.pos, this.r * 5, 1, 0);
      pr.onFly = (p, dt) => {
        this.emit(p.pos, (s.basic ? 1 : 2) + this.m * 4, this.r * 1.2, 1.2 + this.look.g.dispersion);
        if (!s.basic && (this.el === 'lightning' || this.el2 === 'lightning') && Math.random() < 0.5) {
          const e = p.pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(this.r * 2.2));
          this.g.fx.bolt(p.pos.clone(), e, this.pal.core, { look: this.look, width: 0.02 + this.r * 0.04, dur: 0.08, jag: 0.3, branches: 0, flicker: false });
        }
        this.light(p.pos, (60 + this.r * 250) * this.look.lightMul, 8 + this.r * 10);
        if (i === 0) this.loopSnd?.set(p.pos);
      };
      pr.onHit = (pos, target) => {
        if (pr.haze) pr.haze.alive = false;
        const R = s.basic ? 0.9 : 1.1 + this.r * 2.2 + s.size * 1.8 * this.m;
        if (target) this.hit(target, s.basic ? 22 : 62, pos, { knock: dir.clone().multiplyScalar(2 + s.weight * 8), shatter: s.weight > 0.6 });
        this.explode(pos, R, s.basic ? 0 : 24, { exclude: target, knock: 3 + s.weight * 5, lift: 2 });
        if (i === 0) this.loopSnd?.stop(), (this.loopSnd = null);
      };
      this.projectiles.push(pr);
    });
    this.g.audio.whoosh(this.m);
    if (this.mc) this.mc.target = 0;
  }
  update(dt) {
    this.t += dt;
    if (!this.launched) {
      const origin = this.sys.castOrigin(this.caster);
      const aim = this.caster.getAim();
      const lift = this.gather ? Math.min(1, this.t / this.gather) : 0;
      this.cores.forEach((m, i) => {
        const off = this.n > 1 ? (i - (this.n - 1) / 2) * this.r * 2.4 : 0;
        const right = _v.crossVectors(aim.dir, _up).normalize();
        m.position.copy(origin).addScaledVector(aim.dir, this.gather ? (this.caster.isPlayer ? 2.6 + this.r * 2.5 : 1 + this.r) : 0.3).addScaledVector(right, off);
        if (this.gather) m.position.y += this.r * lift;
        m.scale.copy(m.userData.base || _v.setScalar(this.r)).multiplyScalar(this.gather ? 0.3 + 0.7 * lift : 1);
      });
      if (this.gather) {
        const c = this.cores[0].position;
        this.mc.group.position.copy(c).addScaledVector(aim.dir, -this.r * 0.8);
        this.mc.group.lookAt(_v.copy(this.mc.group.position).add(aim.dir));
        this.g.fx.attractors.push({ x: c.x, y: c.y, z: c.z, r2: 400, k: 60, swirl: 0.8 });
        for (let k = 0; k < 6; k++) {
          const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(this.r * 6);
          this.g.fx.glow.emit({ x: c.x + d.x, y: c.y + d.y, z: c.z + d.z, vx: 0, vy: 0, vz: 0, life: 0.4, size: this.r * 0.4, color: this.pal.core, alpha: 1, drag: 0.5, frame: 1 });
        }
        this.light(c, 300 * lift, 20);
      }
      if (this.t >= this.gather) this.launch();
    }
    this.mc?.update(dt);
    this.projectiles = this.projectiles.filter((p) => p.update(dt));
    this.updateCommon(dt);
    if (this.launched && !this.projectiles.length) this.done = true;
    return !this.finished();
  }
  threats() { return this.projectiles; }
}

// ------------------------------------------------------------ 2. BARRAGE
class BarrageSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.total = Math.round(clamp(4 + s.count * 14 * (0.6 + this.m * 0.6), 4, 28));
    this.fired = 0; this.next = 0.02; this.interval = 0.1 - s.speed * 0.055;
    this.portals = [];
    const np = Math.min(9, 3 + Math.floor(this.total / 4));
    for (let i = 0; i < np; i++) {
      const mc = new MagicCircle({ seed: s.seed + i, tier: Math.max(1, s.tierInt - 3), color: this.pal.color, radius: 0.35 + this.m * 0.2 });
      this.add(mc.group); this.portals.push({ mc, x: (i / (np - 1 || 1)) * 2 - 1, y: this.rng() });
    }
    this.shardLen = 0.35 + s.sharpness * 0.6 + s.size * 0.3;
  }
  portalPos(p, out) {
    const aim = this.caster.getAim(), eye = this.caster.eye(new THREE.Vector3());
    const right = _v.crossVectors(aim.dir, _up).normalize();
    return out.copy(eye).addScaledVector(right, p.x * (1.4 + this.m)).addScaledVector(_up, 0.4 + Math.abs(p.x) * -0.2 + p.y * 0.9 + 0.3).addScaledVector(aim.dir, -0.4);
  }
  fire() {
    const s = this.spec, p = this.portals[this.fired % this.portals.length];
    const pos = this.portalPos(p, new THREE.Vector3());
    const aim = this.caster.getAim();
    const spread = 0.012 + s.chaos * 0.05;
    const dir = _w.subVectors(aim.point, pos).normalize();
    dir.x += rand(-spread, spread); dir.y += rand(-spread, spread); dir.z += rand(-spread, spread); dir.normalize();
    const mesh = new THREE.Mesh(OCTA, this.el === 'earth' ? crystalMaterial({ color: 0x6a5238, glow: this.pal.color }) : energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 3, noiseAmp: 0.05 }));
    mesh.scale.set(0.09 + s.size * 0.06, 0.09 + s.size * 0.06, this.shardLen);
    this.add(mesh);
    const speed = 38 + s.speed * 40;
    const pr = new Projectile(this, { pos, vel: dir.multiplyScalar(speed), radius: 0.22, life: 3, mesh, orient: true, homing: s.homing > 0.5 ? 1.2 : 0, grav: s.weight * 3, power: 10 * s.dmgMult });
    pr.trailObj = this.trail(this.pal.color, this.pal.core, 0.08 + s.size * 0.05, 10, 2.5);
    pr.onFly = (pp) => { if (Math.random() < 0.5) this.emit(pp.pos, 1, 0.15, 0.5); };
    pr.onHit = (hp, target) => {
      if (target) this.hit(target, 15, hp, { knock: pr.vel.clone().setLength(1.2) });
      this.g.fx.explosion(this.el, hp, 0.7, 0.15, this.pal, { look: this.look, noDecal: true });
      if (Math.random() < 0.4) this.g.audio.impact(this.el, 0.15, hp, this.look);
    };
    this.projectiles.push(pr);
    if (this.fired % 2 === 0) this.g.audio.cast(this.el, 0.12, pos, this.look);
    this.fired++;
  }
  update(dt) {
    this.t += dt;
    const open = this.fired < this.total;
    for (const p of this.portals) {
      this.portalPos(p, p.mc.group.position);
      p.mc.group.lookAt(_v.copy(p.mc.group.position).add(this.caster.getAim().dir));
      p.mc.target = open ? 1 : 0; p.mc.update(dt);
    }
    this.next -= dt;
    while (open && this.next <= 0 && this.fired < this.total) { this.fire(); this.next += this.interval; }
    this.projectiles = this.projectiles.filter((p) => p.update(dt));
    this.updateCommon(dt);
    if (!open && !this.projectiles.length && this.t > 0.6) this.done = true;
    return !this.finished();
  }
  threats() { return this.projectiles; }
}

// ------------------------------------------------------------ 3. FUNNELS (homing drones)
class FunnelSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.n = Math.round(clamp(2 + s.count * 4 + this.m * 2, 2, 8));
    this.life = 4 + s.duration * 6 + this.m * 2;
    this.drones = [];
    const origin = this.sys.castOrigin(this.caster);
    for (let i = 0; i < this.n; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(OCTA, crystalMaterial({ color: this.pal.dark, glow: this.pal.color, emissive: 2 }));
      body.scale.set(0.16, 0.45, 0.16); body.rotation.x = Math.PI / 2; g.add(body);
      const glow = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 2.5, opacity: 0.6, noiseAmp: 0.3 })); glow.scale.setScalar(0.18); glow.position.z = 0.35; g.add(glow);
      // a wisp of the element's matter wrapped around each familiar, streaming behind as it darts
      const sk = new THREE.Mesh(COMET, surfaceMaterial({ ...(this.kit ||= kitOf(this.el, this.look)), opacity: 0.75 }, { spin: 3, twist: 1.5, bulge: 0.2 }));
      sk.material.uniforms.uTopFade.value = 1; sk.material.uniforms.uFlow.value = 3; sk.scale.set(0.3, 0.3, 0.45); sk.rotation.y = Math.PI; sk.renderOrder = 3; g.add(sk);
      g.scale.setScalar(1.2 + this.m * 0.6);
      g.position.copy(origin); this.add(g);
      const tr = this.trail(this.pal.color, this.pal.core, 0.08, 16, 2);
      this.drones.push({ g, tr, cd: 0.9 + i * 0.13, phase: (i / this.n) * TAU, vel: new THREE.Vector3() });
    }
    this.rate = 1.45 - s.speed * 0.5;
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, t = this.t, ending = t > this.life;
    const target = this.caster.alive ? this.nearestTarget(this.caster.eye(new THREE.Vector3()), null, -1, 90) : null;
    const home = this.caster.center();
    for (const d of this.drones) {
      let want;
      if (t < 0.7 || ending || !target) {
        const a = d.phase + t * 3;
        want = _v.set(home.x + Math.cos(a) * 1.6, home.y + 1.2 + Math.sin(t * 4 + d.phase) * 0.3, home.z + Math.sin(a) * 1.6);
        if (!target && !ending && t >= 0.7) want.copy(this.caster.getAim().point).add(new THREE.Vector3(Math.cos(a) * 4, 3, Math.sin(a) * 4));
      } else {
        const a = d.phase + t * 0.6, tc = target.center();
        want = _v.set(tc.x + Math.cos(a) * 6, tc.y + 2.5 + Math.sin(t * 1.3 + d.phase) * 1.2, tc.z + Math.sin(a) * 6);
      }
      const acc = want.clone().sub(d.g.position).multiplyScalar(6).sub(d.vel.clone().multiplyScalar(2.5));
      d.vel.addScaledVector(acc, dt);
      d.g.position.addScaledVector(d.vel, dt);
      if (target) d.g.lookAt(target.center()); else d.g.lookAt(_v.copy(d.g.position).add(d.vel));
      d.tr.push(d.g.position);
      if (Math.random() < 0.3) this.emit(d.g.position, 1, 0.15, 0.3);
      this.light(d.g.position, 30, 6);
      d.cd -= dt;
      if (target && t > 0.8 && !ending && d.cd <= 0) {
        d.cd = this.rate * rand(0.8, 1.2);
        const from = d.g.position.clone(), to = target.center().add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.3, 0.3), rand(-0.2, 0.2)));
        const bh = this.barrierHit(from, to);
        if (bh) { to.lerpVectors(from, to, bh.t); bh.bar.damage(8 * s.dmgMult, to); }
        this.g.fx.bolt(from, to, this.pal.color, { look: this.look, width: 0.05 + this.m * 0.03, dur: 0.14, jag: this.el === 'lightning' ? 0.18 : 0.02, branches: 0, flicker: false });
        this.g.fx.explosion(this.el, to, 0.5, 0.1, this.pal, { look: this.look, noDecal: true });
        if (!bh) this.hit(target, 6.5, to);
        this.g.audio.cast(this.el, 0.08, from, this.look);
      }
    }
    if (ending && t > this.life + 0.8 && !this.done) {
      for (const d of this.drones) { this.g.fx.explosion(this.el, d.g.position, 0.6, 0.1, this.pal, { look: this.look, noDecal: true }); d.tr.dead = true; this.remove(d.g); }
      this.drones.length = 0; this.done = true;
    }
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ------------------------------------------------------------ 4. BEAM
class BeamSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.charge = 0.08;
    this.life = this.charge + 1.0 + s.duration * 2.4 + this.m * 0.8;
    this.w = (0.3 + s.size * 1.0) * (0.6 + this.m * 0.6) * this.look.sx;
    this.grp = new THREE.Group(); this.add(this.grp);
    // matter torrent (water jet, flame stream, sandblast, blizzard…) wrapped around a glowing core; the core's
    // brightness and the matter's opacity both come from the kit, so a plasma ray is mostly core and a water jet mostly matter
    this.kit = kitOf(this.el, this.look);
    const mt = surfaceMaterial(this.kit, { spin: 2.5 + s.speed * 3, twist: 1.2 + this.look.g.dispersion * 2, bulge: 0.14 + this.look.g.dispersion * 0.15 });
    mt.uniforms.uFlow.value = 3 + s.speed * 5; mt.uniforms.uTopFade.value = 0; mt.uniforms.uStreak.value = 4;
    this.outer = new THREE.Mesh(BEAM_GEO, mt); this.outer.renderOrder = 3;
    this.inner = new THREE.Mesh(BEAM_GEO, flowMaterial({ color: this.pal.core, core: 0xffffff, intensity: 1.2 + this.kit.energy * 2.5, scroll: 12, stripes: 2, softEdge: false, opacity: 0.35 + this.kit.energy * 0.65 }));
    this.halo = new THREE.Mesh(BEAM_GEO, surfaceMaterial(this.kit, { spin: 1.2, twist: 0.8, bulge: 0.25, energyOnly: true }));
    this.halo.material.uniforms.uFlow.value = 2 + s.speed * 3; this.halo.material.uniforms.uTopFade.value = 0;
    this.grp.add(this.halo, this.outer, this.inner); this.halo.visible = this.kit.energy > 0.2;
    this.grp.visible = false;
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.w * 3 + 0.4 });
    this.add(this.mc.group);
    this.endFlare = this.add(new THREE.Mesh(SPHERE, energyMaterial({ color: this.pal.color, core: this.pal.color.clone().lerp(this.pal.core, 0.5), intensity: 1.4, noiseAmp: 0.4, flow: 6 })));
    this.startFlare = this.add(new THREE.Mesh(SPHERE, energyMaterial({ color: this.pal.color, core: 0xffffff, intensity: 3, noiseAmp: 0.3, flow: 6 })));
    this.endFlare.visible = false;
    this.tick = 0;
    this.loopSnd = this.g.audio.loop(this.el, this.sys.castOrigin(this.caster), 0, this.look);
    this.caster.channeling = true;
  }
  update(dt) {
    this.t += dt;
    const s = this.spec;
    const aim = this.caster.getAim();
    const fp = this.caster.isPlayer;
    const origin = this.sys.castOrigin(this.caster).clone();
    const dir = _w.subVectors(aim.point, origin).normalize().clone();
    if (fp) origin.addScaledVector(dir, 0.9); // keep the beam root out of the first-person lens
    const active = this.t > this.charge && this.t < this.life && this.caster.alive;
    const k = clamp((this.t - this.charge) / 0.15) * clamp((this.life - this.t) / 0.25);
    this.mc.group.position.copy(origin).addScaledVector(dir, fp ? 0.6 : 0.3); this.mc.group.lookAt(_v.copy(this.mc.group.position).add(dir));
    if (fp) this.mc.group.scale.setScalar(Math.min(1, 0.45 / this.mc.radius));
    this.mc.target = this.t < this.life ? 1 : 0; this.mc.update(dt);
    this.startFlare.position.copy(origin); this.startFlare.scale.setScalar(this.w * (fp ? 0.09 : 1) * (0.6 + clamp(this.t / this.charge) * 0.8 + Math.sin(this.t * 40) * 0.1));
    this.startFlare.material.uniforms.uOpacity.value = this.t < this.life ? 1 : 0;
    if (this.t < this.charge) {
      this.g.fx.attractors.push({ x: origin.x, y: origin.y, z: origin.z, r2: 64, k: 40, swirl: 1 });
      const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(3);
      this.g.fx.glow.emit({ x: origin.x + d.x, y: origin.y + d.y, z: origin.z + d.z, life: 0.4, size: 0.15, color: this.pal.core, alpha: 1, drag: 0.5, frame: 1 });
    }
    if (active) {
      if (!this.grp.visible) { this.g.audio.cast(this.el, this.m, origin, this.look); this.g.fx.flash(origin, this.pal.color, this.w * (fp ? 1 : 4), 0.2, fp ? 1.5 : 4); }
      this.grp.visible = true;
      let len = 75;
      const rc = this.g.world.raycast(origin, dir, len, 0.6); len = rc.dist;
      let end = origin.clone().addScaledVector(dir, len);
      const bh = this.barrierHit(origin, end);
      if (bh) { len *= bh.t; end = origin.clone().addScaledVector(dir, len); }
      // targets along the ray
      this.tick -= dt;
      const doTick = this.tick <= 0; if (doTick) this.tick = 0.1;
      let hitT = null, hitD = len;
      for (const t of this.targets()) {
        const c = t.center(); const along = _v.subVectors(c, origin).dot(dir);
        if (along < 0 || along > len) continue;
        const perp = _v.subVectors(c, origin).addScaledVector(dir, -along).length();
        if (perp < this.w + 0.55 && along < hitD) { hitD = along; hitT = t; }
      }
      if (hitT && s.sharpness < 0.7) { len = hitD; end = origin.clone().addScaledVector(dir, len); }
      if (doTick) {
        if (hitT) this.hit(hitT, 11, end, { knock: dir.clone().multiplyScalar(1.2) });
        if (bh) bh.bar.damage(10 * s.dmgMult, end);
      }
      const wob = 1 + Math.sin(this.t * 50) * 0.06;
      this.grp.position.copy(origin); this.grp.lookAt(end);
      this.outer.scale.set(this.w * k * wob, this.w * k * wob, len);
      this.inner.scale.set(this.w * 0.35 * k, this.w * 0.35 * k, len);
      this.halo.scale.set(this.w * 1.6 * k, this.w * 1.6 * k, len);
      this.endFlare.visible = true; this.endFlare.position.copy(end); this.endFlare.scale.setScalar(this.w * 2.2 * k * wob);
      this.emit(end, 2 + this.m * 3, this.w * 0.9, 5);
      this.pulseT = (this.pulseT || 0) - dt; // the impact point throbs with shock walls of matter
      if (this.pulseT <= 0 && end.y - this.g.world.heightAt(end.x, end.z) < 1.5) { this.pulseT = 0.3; this.g.fx.shockWall(end, 1 + this.w * 2, this.look, this.el, 0.35, 0.25 + this.w * 0.4); }
      if (this.level >= 2) {
        if (!this.strands) this.strands = [0, 1, 2].slice(0, this.level === 3 ? 3 : 2).map(() => { const r = new Ribbon(48, ribbonMaterial({ color: this.pal.core, core: 0xffffff, intensity: 3, wisp: 0 })); this.add(r.mesh); r.mesh.userData.ownGeo = true; return r; });
        const u = new THREE.Vector3().crossVectors(dir, _up).normalize(), v2 = new THREE.Vector3().crossVectors(u, dir);
        this.strands.forEach((rb, si) => {
          const pts = [];
          for (let i = 0; i < 48; i++) { const f = i / 47, a = f * len * 0.9 - this.t * 14 + (si * TAU) / this.strands.length, rr = this.w * (1.4 + 0.3 * Math.sin(f * 20 + this.t * 6)) * Math.min(1, f * 6); pts.push(origin.clone().addScaledVector(dir, f * len).addScaledVector(u, Math.cos(a) * rr).addScaledVector(v2, Math.sin(a) * rr)); }
          rb.set(pts, this.w * 0.12, this.g.camera.position, () => k);
        });
      }
      if (this.level === 3) { this.ultT = (this.ultT || 0) - dt; if (this.ultT <= 0) { this.ultT = 0.35; runPayload(this, end.clone(), this.w * 2.5, null, 30, 0.4, null, 'erupt'); } }
      if (Math.random() < 0.5) this.g.fx.sparks.emit(end.x, end.y, end.z, rand(-12, 12), rand(0, 14), rand(-12, 12), 0.5, this.pal.core, 12, 0.04);
      for (let i = 0; i < 3; i++) this.emit(origin.clone().addScaledVector(dir, rand(0, len)), 1, this.w * 0.8, 1.5);
      this.light(end, 300 * k, 18); this.light(origin.clone().addScaledVector(dir, len * 0.5), 200 * k, len * 0.6); this.light(origin, (fp ? 40 : 150) * k, 10);
      if (this.caster.isPlayer) this.g.fx.addShake(0.02 * this.m);
      if (Math.random() < dt * 8) this.g.fx.decal(end, this.w * 2, this.el);
      this.payT = (this.payT || 0) - dt;
      if (this.payT <= 0 && ['linger', 'erupt', 'crystallize', 'echo'].includes(s.payload)) { this.payT = s.payload === 'linger' ? 0.7 : 0.45; runPayload(this, end.clone(), this.w * 2.2, null, 25, 0.3); }
      this.loopSnd?.set(end, 0.5 + this.m * 0.4);
    } else if (this.grp.visible) {
      this.grp.visible = false; this.endFlare.visible = false; this.loopSnd?.stop(); this.loopSnd = null;
    }
    if (this.t > this.life + 0.4) { this.done = true; this.caster.channeling = false; }
    this.updateCommon(dt);
    return !this.finished();
  }
  dispose() { super.dispose(); this.caster.channeling = false; }
}

// ------------------------------------------------------------ 5. TORNADO
// A real funnel: a rope-like axis that sways and bends (more with dispersion and height), three nested shells from the
// element surface kit (soft outer haze, main body, additive energy core), a churning debris skirt at the ground, matter
// spiralling up along the bent axis, a rotating cloud cap on tall funnels, speed-line ribbons for airy spells and
// arcing bolts for charged ones. Every amount comes from the look axes, not from the element name.
function funnelGeo(base, curve, flare) {
  const pts = [];
  for (let k = 0; k <= 40; k++) { const y = k / 40; pts.push(new THREE.Vector2(base + (1 - base) * Math.pow(y, curve) + flare * Math.pow(y, 6), y)); }
  return new THREE.LatheGeometry(pts, 64);
}
class TornadoSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, aim = this.caster.getAim(), L = this.look, G = L.g;
    this.dir = new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize();
    this.pos = this.caster.pos.clone().addScaledVector(this.dir, 3.5);
    this.speed = 3.5 + s.speed * 8;
    this.life = 3 + s.duration * 5 + this.m * 1.5;
    this.R = (1.8 + s.size * 3.2) * (0.6 + this.m * 0.6) * L.sx;
    this.H = (6.5 + s.size * 11) * (0.6 + this.m * 0.5) * L.sy;
    this.kit = kitOf(this.el, L);
    // silhouette: squat whirls keep a wide skirt, tall ones pinch into a rope; bend grows with dispersion and slenderness
    const slender = this.H / this.R, squat = clamp(1 - slender / 6);
    this.base = 0.1 + squat * 0.45;
    this.bend = (0.25 + G.dispersion * 0.9) * clamp(slender / 4, 0.3, 2.2);
    const geo = funnelGeo(this.base, 1.4 + (1 - squat) * 0.8, 0.7);
    this.grp = this.add(new THREE.Group());
    const spin = 1.2 + s.speed * 1.6;
    const shells = [
      { k: 1.28, op: 0.4, spin: spin * 0.6, bulge: 0.18, twist: 1.5 },   // outer haze
      { k: 1.0, op: 1.0, spin, bulge: 0.12, twist: 2.4 },                // body
    ];
    // hot matter wears a sheath of dark soot bands around its flame core (contrast is what makes fire read)
    const sheathKit = this.kit.heat > 0.25 ? { ...this.kit, mix: new THREE.Vector4(0, 0.25, 1, 0.1), body: new THREE.Color(0x3a302c).lerp(this.pal.smoke, 0.4), dark: new THREE.Color(0x120e0c), hi: this.pal.color.clone(), energy: 0, opacity: 0.9 } : this.kit;
    this.shells = shells.map((o) => {
      const m = new THREE.Mesh(geo, surfaceMaterial(o.k > 1 ? sheathKit : this.kit, { spin: o.spin, twist: o.twist, bend: this.bend / o.k, bulge: o.bulge + G.dispersion * 0.1, opacity: o.k > 1 && this.kit.heat > 0.25 ? 1 : o.op }));
      // spiralling sheets: sharper spells cut finer bands, dense matter fills the gaps more
      m.material.uniforms.uBands.value = Math.round((o.k > 1 ? 2 : 3) + G.sharpness * 3);
      m.material.uniforms.uGap.value = o.k > 1 ? 1 : 0.35 + (1 - G.density) * 0.25;
      if (o.k > 1 && this.kit.heat > 0.25) m.material.uniforms.uLow.value = 0.72; // soot only where the flame dies out, at the top
      if (o.k === 1) m.material.uniforms.uFlameUp.value = 0.05; // funnel flame burns all the way up
      m.userData.k = o.k; m.renderOrder = 3; this.grp.add(m); return m;
    });
    if (this.kit.energy > 0.15 || this.kit.heat > 0.3) { // glowing core (charged or hot funnels)
      const m = new THREE.Mesh(geo, surfaceMaterial(this.kit, { spin: spin * 1.6, twist: 3.5, bend: this.bend / 0.55, bulge: 0.08, energyOnly: true }));
      m.userData.k = 0.55; m.renderOrder = 2; this.grp.add(m); this.shells.push(m);
    }
    this.shells[0].userData.ownGeo = true;
    // cloud cap: tall funnels hang from a slowly turning shelf of cloud
    this.capKit = { ...this.kit, mix: new THREE.Vector4(0, this.kit.mix.y * 0.3, 1, 0.1), opacity: 0.55 + G.density * 0.35, energy: this.kit.energy * 0.4 };
    if (this.kit.heat > 0.25) Object.assign(this.capKit, { body: sheathKit.body, dark: sheathKit.dark, hi: sheathKit.hi, opacity: 0.9 });
    if (slender > 2.2) {
      const cpts = []; for (let k = 0; k <= 16; k++) { const t = k / 16; cpts.push(new THREE.Vector2(0.7 + t * 2.2, Math.sin(t * Math.PI) * 0.12 - t * 0.05)); }
      this.cap = new THREE.Mesh(new THREE.LatheGeometry(cpts, 48), surfaceMaterial(this.capKit, { spin: 0.4, twist: 0.8, bulge: 0.05 }));
      this.cap.userData.ownGeo = true; this.cap.renderOrder = 4; this.grp.add(this.cap);
    }
    // speed lines for airy, fast spells
    this.lines = [];
    const nLines = Math.round(3 + (1 - G.density) * 6 * (0.5 + s.speed) + (this.el === 'wind' ? 4 : 0));
    for (let i = 0; i < nLines; i++) {
      const rb = new Ribbon(36, ribbonMaterial({ color: this.kit.hi.clone().lerp(this.pal.color, 0.25), core: 0xffffff, intensity: 1.6 + G.luminosity * 1.4, wisp: 0.35 }));
      this.add(rb.mesh); rb.mesh.userData.ownGeo = true;
      this.lines.push({ rb, ph: rand(0, TAU), y0: rand(0, 1), sp: rand(0.25, 0.6), r: rand(1.05, 1.4) });
    }
    this.grp.scale.setScalar(0.01);
    // ground swirl: a spiral of the matter scouring the floor around the base
    const sg = new THREE.RingGeometry(0.15, 1, 64, 6); sg.rotateX(-Math.PI / 2);
    const sm = surfaceMaterial({ ...this.kit, opacity: 0.8 }, { spin: 3, twist: 3, bulge: 0 });
    sm.uniforms.uBands.value = 4; sm.uniforms.uTopFade.value = 1; sm.uniforms.uFlow.value = 1.5; sm.polygonOffset = true; sm.polygonOffsetFactor = -4;
    // RingGeometry uv is planar: remap to (angle, radius) so bands spiral around the centre
    const su = sg.attributes.uv, sp = sg.attributes.position;
    for (let i = 0; i < su.count; i++) { const x = sp.getX(i), z = sp.getZ(i); su.setXY(i, Math.atan2(z, x) / TAU + 0.5, 1 - Math.hypot(x, z)); }
    this.swirl = this.add(new THREE.Mesh(sg, sm)); this.swirl.userData.ownGeo = true; this.swirl.renderOrder = 2;
    this.ringT = 0;
    this.tick = 0;
    this.g.fx.explosion(this.el, this.pos.clone().setY(this.pos.y + 0.5), this.R * 0.7, this.m * 0.5, this.pal, { look: this.look, smokeMul: 0.25 }); // touch-down burst (the funnel is the show, not its smoke)
    this.loopSnd = this.g.audio.loop(this.el === 'wind' ? 'wind' : this.el, this.pos, 0.6 + this.m * 0.4, this.look, { spin: 0.6 + this.spec.speed * 0.4 });
    this.g.audio.cast('wind', this.m, this.pos, this.look);
    // carried debris meshes: amount from density, glowing when hot, shards when sharp
    this.debris = [];
    const nDeb = Math.round(G.density * 14 + (this.el === 'earth' || this.el === 'ice' ? 5 : 0));
    const hot = clamp((G.temperature - 0.55) / 0.3);
    for (let i = 0; i < nDeb; i++) {
      const d = new THREE.Mesh(G.sharpness > 0.65 ? OCTA : ROCK, G.sharpness > 0.65 ? crystalMaterial({ color: this.pal.color.clone().lerp(new THREE.Color(0xffffff), 0.5), glow: this.pal.color }) : crystalMaterial({ color: this.kit.dark, glow: this.pal.color, emissive: 0.2 + hot * 2, crack: 0.2 + hot * 0.5 }));
      d.scale.setScalar(rand(0.12, 0.4) * (0.6 + this.m) * (0.6 + G.density * 0.6)); this.add(d);
      this.debris.push({ d, a: rand(0, TAU), y: rand(0.02, 0.85) * (1 - G.weight * 0.4), s: rand(2, 5) * (1.2 - G.weight * 0.5) });
    }
    // flecks: a swarm of small tumbling chips riding the vortex up and out (leaves for wind/nature, embers when hot,
    // ice shards, sparks of aether…). One instanced mesh; they are what makes the funnel read as spinning.
    const K = this.kit, glowF = clamp(K.heat * 1.2 + K.energy * 0.8), leafy = this.el === 'wind' || this.el === 'nature';
    const nF = Math.round((22 + (1 - G.density) * 16) * (0.6 + this.m * 0.6));
    const fmat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, emissive: glowF > 0.3 ? this.pal.color : 0x000000, emissiveIntensity: glowF * 2.2 });
    this.flecks = new THREE.InstancedMesh(G.sharpness > 0.65 || this.el === 'ice' ? OCTA : FLECK, fmat, nF); this.flecks.frustumCulled = false; this.flecks.userData.noAO = true;
    const pal = leafy ? [0x5f9e34, 0x8cc84a, 0xc8e08a, 0x3f6e28, 0xe6c35a] : this.el === 'ice' ? [0xf2fbff, 0xbfe4ff, 0x9ccdf2] : glowF > 0.3 ? [this.pal.color.getHex(), this.pal.core.getHex(), K.dark.getHex()] : [K.dark.getHex(), K.body.getHex(), K.hi.getHex()];
    this.fl = [];
    for (let i = 0; i < nF; i++) {
      this.flecks.setColorAt(i, new THREE.Color(pick(pal)));
      this.fl.push({ a: rand(0, TAU), y: Math.random(), r: rand(0.85, 1.5), s: rand(2.5, 5), up: rand(0.12, 0.3) * (1.2 - G.weight * 0.8), sz: rand(0.18, 0.4) * (0.7 + this.m * 0.5) * (leafy ? 1.8 : 1), rx: rand(0, TAU), ry: rand(0, TAU), t: rand(4, 10) });
    }
    this.add(this.flecks); this._fo = new THREE.Object3D();
  }
  // world position of the funnel axis at height fraction y (mirrors the vertex shader's rope sway)
  axisAt(y, out) {
    const t = TIME.value, ph = this.shells[1].material.uniforms.uPhase.value, sc = this.grp.scale.x;
    out.set(this.bend * (Math.sin(y * 2.4 + t * 0.9 + ph) * y + Math.sin(y * 5.1 - t * 1.7) * 0.25 * y) * this.R * sc, y * this.H * sc, this.bend * Math.cos(y * 2.1 + t * 0.7 + ph * 1.3) * y * 0.8 * this.R * sc);
    out.applyAxisAngle(_up, this.grp.rotation.y).add(this.pos);
    return out;
  }
  radiusAt(y) { return this.R * this.grp.scale.x * (this.base + (1 - this.base) * Math.pow(y, 1.6)); }
  update(dt) {
    this.t += dt;
    const s = this.spec, G = this.look.g, fx = this.g.fx, alive = this.t < this.life;
    const grow = Math.pow(clamp(this.t / (0.3 + this.look.growT)), 0.7) * clamp((this.life + 0.6 - this.t) / 0.6);
    const tgt = this.nearestTarget(this.pos, null, -1, 40);
    if (tgt && s.homing > 0.4) { const d = tgt.pos.clone().sub(this.pos).setY(0).normalize(); this.dir.lerp(d, dt * s.homing * 1.5).normalize(); }
    this.dir.applyAxisAngle(_up, Math.sin(this.t * 1.7 + s.seed) * s.chaos * dt * 2);
    this.pos.addScaledVector(this.dir, this.speed * dt * (alive ? 1 : 0.3));
    const r = Math.hypot(this.pos.x, this.pos.z); if (r > 80) this.dir.multiplyScalar(-1);
    this.pos.y = this.g.world.heightAt(this.pos.x, this.pos.z);
    this.grp.position.copy(this.pos);
    this.grp.scale.set(Math.max(0.01, grow), Math.max(0.01, Math.pow(grow, 0.6)), Math.max(0.01, grow));
    this.grp.rotation.y -= dt * (1.5 + s.speed * 2);
    for (const m of this.shells) m.scale.set(this.R * m.userData.k, this.H, this.R * m.userData.k);
    if (this.cap) { this.cap.position.copy(this.axisAt(1, _v).sub(this.pos).applyAxisAngle(_up, -this.grp.rotation.y).divide(this.grp.scale)); this.cap.scale.setScalar(this.R); this.cap.rotation.y += dt * 0.5; }
    const sc = this.grp.scale.x, K = this.kit, q = fx.quality;
    this.swirl.position.set(this.pos.x, this.pos.y + 0.08, this.pos.z); this.swirl.scale.setScalar(this.R * (1.2 + this.base) * sc + 0.01); this.swirl.rotation.y -= dt * (3 + s.speed * 3);
    this.swirl.material.uniforms.uFade.value = grow;
    this.ringT -= dt;
    if (this.ringT <= 0 && alive) { this.ringT = 0.35 + G.weight * 0.3; fx.ring(new THREE.Vector3(this.pos.x, this.pos.y + 0.2, this.pos.z), K.hi.clone().lerp(this.pal.color, 0.5), this.R * 3 * sc, 0.6, null, 0.06); }
    // debris skirt: churning ring of dust/spray/smoke hugging the ground
    const skirtR = this.R * (this.base * 1.6 + 0.35) * sc;
    const skHot = K.heat; // hot dust glows with the fire above it
    for (let i = 0; i < (0.4 + G.density * 0.7) * q * grow; i++) {
      const a = rand(0, TAU), rr = skirtR * rand(0.7, 1.4), p = new THREE.Vector3(this.pos.x + Math.cos(a) * rr, this.pos.y + rand(0, 0.6), this.pos.z + Math.sin(a) * rr);
      const tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(-(4 + s.speed * 6)).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(rand(-1, 1.5)));
      tan.y = rand(0.5, 2.5) * (1 - G.weight * 0.5);
      fx.puff(p, { color: K.body.clone().lerp(K.hi, K.mix.x * 0.8).lerp(K.dark, rand(0, 0.5) * (1 - K.mix.x)).lerp(this.pal.color, skHot * rand(0.3, 0.7)), size: skirtR * rand(0.5, 0.8) * (1 - K.mix.x * 0.4), size1: skirtR * rand(1.2, 1.8) * (1 - K.mix.x * 0.4), life: rand(0.8, 1.4) * this.look.lingerMul, vel: tan, alpha: (0.35 + G.density * 0.5) * (1 - K.mix.x * 0.5), drag: 1.2, soft: true });
    }
    // matter spiralling up the bent axis
    for (let i = 0; i < (3 + this.m * 4) * clamp(Math.sqrt(this.R * this.H / 20), 0.6, 2.2); i++) {
      const y = Math.pow(Math.random(), 0.8), a = rand(0, TAU), c = this.axisAt(y, new THREE.Vector3()), rr = this.radiusAt(y) * rand(0.75, 1.15);
      const p = c.add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr));
      const tan = new THREE.Vector3(Math.sin(a), 0.5 + (1 - G.weight) * 0.6, -Math.cos(a)).multiplyScalar(5 + s.speed * 8);
      fx.element(this.el, p, { count: 0.7, speed: tan.length() * 0.4, size: 0.2 * (0.5 + this.m) * Math.sqrt(this.R / 2), palette: this.pal, dir: tan.normalize(), spread: 0.15, look: this.look });
    }
    // cloud cap churn
    if (this.cap && Math.random() < 0.04 * q) {
      const top = this.axisAt(1, new THREE.Vector3()), a = rand(0, TAU), rr = this.R * rand(0.8, 2.6);
      fx.puff(top.add(new THREE.Vector3(Math.cos(a) * rr, rand(-0.3, 0.4), Math.sin(a) * rr)), { color: K.dark.clone().lerp(K.body, 0.4), size: this.R * 1.4, size1: this.R * 2.4, life: 2.4, vel: new THREE.Vector3(-Math.sin(a) * 3, 0.2, Math.cos(a) * 3), alpha: 0.5 + G.density * 0.3, drag: 0.8, rise: 0, soft: true });
    }
    // speed lines: helical arcs racing up the funnel
    const cam = this.g.camera.position;
    for (const Ln of this.lines) {
      Ln.y0 += dt * Ln.sp; if (Ln.y0 > 1.05) { Ln.y0 = -0.1; Ln.ph = rand(0, TAU); }
      const pts = [];
      for (let k = 0; k < 36; k++) { const y = clamp(Ln.y0 - 0.3 + k / 35 * 0.3, 0, 1), a = Ln.ph + this.t * (4 + s.speed * 4) + k * 0.1; const c = this.axisAt(y, new THREE.Vector3()), rr = this.radiusAt(y) * Ln.r; pts.push(c.add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr))); }
      Ln.rb.set(pts, (t) => (0.06 + this.R * 0.035) * Math.sin(Math.PI * Math.min(1, t * 1.15)), cam, (i, n) => (i / (n - 1)) * grow);
    }
    // charged funnels crackle with arcs between points of the axis
    for (let bi = 0; bi < 2; bi++) if (K.energy > 0.5 && Math.random() < K.energy * 0.45) {
      const y0 = rand(0.1, 0.8), a0 = this.axisAt(y0, new THREE.Vector3()), b0 = this.axisAt(Math.min(1, y0 + rand(0.1, 0.3)), new THREE.Vector3()).add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(this.radiusAt(y0)));
      fx.bolt(a0, b0, this.pal.core, { look: this.look, width: 0.06 + this.R * 0.03 * (0.5 + G.density), dur: 0.14, jag: 0.2 + G.sharpness * 0.25, branches: Math.round(G.dispersion * 3), flicker: false });
    }
    for (let i = 0; i < this.fl.length; i++) { // flecks spiral up, flung wider near the top, then re-enter at the base
      const f = this.fl[i], o = this._fo; f.a += dt * f.s * (1.2 + s.speed); f.y += dt * f.up; if (f.y > 1.05) { f.y = 0; f.a = rand(0, TAU); }
      const c = this.axisAt(f.y, _w), rr = this.radiusAt(f.y) * f.r * (1 + f.y * 0.4) + 0.3;
      o.position.set(c.x + Math.cos(f.a) * rr, c.y, c.z + Math.sin(f.a) * rr);
      f.rx += dt * f.t; f.ry += dt * f.t * 0.7; o.rotation.set(f.rx, f.ry, f.a);
      o.scale.setScalar(f.sz * clamp(grow * 1.5) * Math.min(1, (1.05 - f.y) * 6)); o.updateMatrix(); this.flecks.setMatrixAt(i, o.matrix);
    }
    this.flecks.instanceMatrix.needsUpdate = true;
    for (const d of this.debris) { d.a += dt * d.s; const c = this.axisAt(d.y, _w), rr = this.radiusAt(d.y) * 0.9; d.d.position.set(c.x + Math.cos(d.a) * rr, c.y, c.z + Math.sin(d.a) * rr); d.d.rotation.x += dt * 4; d.d.visible = grow > 0.2; }
    const top = this.axisAt(0.6, new THREE.Vector3());
    this.g.fx.attractors.push({ x: this.pos.x, y: this.pos.y + this.H * 0.3, z: this.pos.z, r2: (this.R * 3) ** 2, k: 18, swirl: 2.2 });
    this.light(top, 150 * grow * this.look.lightMul * (0.3 + K.energy), this.H * 1.5);
    this.loopSnd?.set(top);
    // pull + damage
    this.tick -= dt;
    if (alive) for (const t of this.targets()) {
      const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z, d = Math.hypot(dx, dz);
      if (d < this.R * 2.6 && t.pos.y < this.pos.y + this.H) {
        const k = 1 - d / (this.R * 2.6);
        t.vel.x += (dx / (d + 0.01)) * 14 * k * dt * (0.5 + s.weight) - (dz / (d + 0.01)) * 10 * k * dt;
        t.vel.z += (dz / (d + 0.01)) * 14 * k * dt * (0.5 + s.weight) + (dx / (d + 0.01)) * 10 * k * dt;
        if (d < this.R * 1.2) t.vel.y = Math.max(t.vel.y, 4 + s.size * 4);
        if (this.tick <= 0 && d < this.R * 1.5) this.hit(t, 13, t.center());
      }
    }
    if (this.tick <= 0) this.tick = 0.25;
    if (this.t > this.life + 0.6 && !this.done) { this.done = true; this.loopSnd?.stop(); this.loopSnd = null; if (s.payload && !['explode', 'none'].includes(s.payload)) runPayload(this, this.pos.clone().setY(this.pos.y + 1), this.R, null, 40); }
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ------------------------------------------------------------ 6. METEOR
class MeteorSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.center = this.caster.getAim().point.clone();
    const gy = this.g.world.heightAt(this.center.x, this.center.z); if (this.center.y > gy + 1) this.center.y = gy;
    this.n = s.count > 0.5 ? 1 + Math.round((s.count - 0.5) * 7) : 1;
    this.R = (3 + s.size * 6) * (0.5 + this.m * 0.6) * this.look.sx;
    this.rockR = (0.7 + s.size * 2.2) * (0.5 + this.m * 0.6);
    this.delay = 0.7 + (1 - s.speed) * 0.9;
    this.meteors = [];
    const skyDir = new THREE.Vector3(rand(-0.4, 0.4), 1, rand(-0.4, 0.4)).normalize();
    for (let i = 0; i < this.n; i++) {
      const off = i === 0 ? new THREE.Vector3() : new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(this.R * 1.4);
      const tp = this.center.clone().add(off); tp.y = this.g.world.heightAt(tp.x, tp.z);
      const mc = new MagicCircle({ seed: s.seed + i, tier: s.tierInt, color: this.pal.color, radius: this.R * (i ? 0.6 : 1) });
      mc.group.rotation.x = -Math.PI / 2; mc.group.position.copy(tp).y += 0.2; mc.spin = 1.2; this.add(mc.group);
      this.meteors.push({ tp, mc, start: this.delay + i * 0.25 + rand(0, 0.15), from: tp.clone().addScaledVector(skyDir, 60 + this.m * 30), mesh: null, state: 0, r: this.rockR * (i ? 0.6 : 1) });
    }
    // sky circle for high tiers
    if (s.tierInt >= 6) {
      this.skyMc = new MagicCircle({ seed: s.seed + 99, tier: s.tierInt, color: this.pal.color, radius: this.R * 2 });
      this.skyMc.group.rotation.x = Math.PI / 2; this.skyMc.group.position.copy(this.meteors[0].from).lerp(this.center, 0.1); this.add(this.skyMc.group);
    }
  }
  update(dt) {
    this.t += dt;
    const s = this.spec;
    let allDone = true;
    this.skyMc?.update(dt);
    if (this.skyMc && this.t > this.delay + 1.5) this.skyMc.target = 0;
    for (const m of this.meteors) {
      m.mc.update(dt);
      if (m.state < 2) allDone = false;
      if (m.state === 0 && this.t >= m.start) {
        m.state = 1; m.age = 0;
        const g = new THREE.Group();
        const rock = new THREE.Mesh(ROCK, crystalMaterial({ color: this.el === 'ice' ? 0x8fc8ea : 0x3a2c22, glow: this.pal.color, emissive: 2.2, crack: 0.7 }));
        g.add(rock); g.userData.spin = rock;
        const shell = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 2.2, noiseAmp: 0.35, flow: 5, opacity: 0.22 })); // faint: additive light over hot matter washes it to peach in daylight
        shell.scale.setScalar(1.35); g.add(shell);
        // a streaming shroud of the element's matter (flame, frost, dust, aether) whose tail points back up the fall line
        const K = (this.kit ||= kitOf(this.el, this.look));
        const skin = new THREE.Mesh(COMET, surfaceMaterial({ ...K, opacity: 1 }, { spin: 3, twist: 1.5, bulge: 0.3 }));
        const su = skin.material.uniforms; su.uTopFade.value = 1; su.uFlow.value = 5; su.uFlameUp.value = -0.6;
        skin.scale.set(1.45, 1.45, 2.4); skin.renderOrder = 3;
        skin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.tp.clone().sub(m.from).normalize()); g.add(skin);
        g.scale.setScalar(m.r); g.position.copy(m.from); this.add(g); m.mesh = g;
        m.trail = this.trail(this.pal.color, this.pal.color.clone().lerp(this.pal.core, 0.4), m.r * 1.1, 26, 1.3 * this.look.intensity);
        m.snd = this.g.audio.loop(this.el, m.from, 0.8, this.look);
        m.dur = 0.9 + (1 - s.speed) * 0.5;
      }
      if (m.state === 1) {
        m.age += dt;
        const k = Math.min(1, m.age / m.dur), e = k * k;
        m.mesh.position.lerpVectors(m.from, m.tp, e);
        m.mesh.userData.spin.rotation.x += dt * 2; m.mesh.userData.spin.rotation.z += dt * 1.3;
        m.trail.push(m.mesh.position);
        m.snd.set(m.mesh.position);
        const p = m.mesh.position;
        this.emit(p, 5 + this.m * 6, m.r * 1.2, 2);
        // billowing matter trail from the kit: soot for fire, frost mist for ice, spray for water, dust for earth…
        if (!this.kit) this.kit = kitOf(this.el, this.look);
        for (let q = 0; q < 2; q++) this.g.fx.puff(p.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(m.r * 0.6)), { color: this.kit.body.clone().lerp(this.kit.dark, rand(0.2, 0.7)).lerp(this.kit.hi, this.kit.mix.x * 0.6), size: m.r * 1.3, size1: m.r * 3.5, life: 1.6 * this.look.lingerMul, vel: new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1)), alpha: 0.55 + this.look.g.density * 0.35, drag: 1.2, soft: this.look.g.density < 0.6 });
        this.light(p, 500 * m.r, 40);
        m.mc.target = 1;
        // barrier interception
        const bh = this.barrierHit(p.clone().sub(new THREE.Vector3(0, 1, 0)), p);
        if (k >= 1 || bh) {
          m.state = 2; m.trail.dead = true; m.snd.stop(); this.remove(m.mesh); m.mc.target = 0;
          if (bh) bh.bar.damage(200 * s.dmgMult, p);
          const R = this.R * (m.r / this.rockR);
          this.explode(p.clone(), R, 115 * (m.r / this.rockR), { knock: 8 + s.weight * 8, lift: 7, debris: true, extra: { shatter: true } });
          if (s.payload && !['explode', 'none'].includes(s.payload)) runPayload(this, p.clone(), R * 0.7, null, 60 * (m.r / this.rockR));
          if (m === this.meteors[0]) escalateImpact(this, p.clone(), R * 0.8, null);
          this.g.fx.ring(p.clone().setY(p.y + 0.3), this.pal.core, R * 2.5, 0.8);
          this.g.fx.addShake(0.4 + this.m * 0.5, p);
          for (let i = 0; i < 20; i++) this.g.fx.sparks.emit(p.x, p.y + 1, p.z, rand(-15, 15), rand(8, 25), rand(-15, 15), rand(0.8, 1.6), this.pal.core, 20, 0.05);
        }
      }
    }
    this.updateCommon(dt);
    if (allDone && this.t > this.delay + 1.2) { this.meteors.forEach((m) => (m.mc.target = 0)); if (this.t > this.delay + 2.2) this.done = true; }
    return !this.finished();
  }
  threats() { return this.meteors.filter((m) => m.state < 2).map((m) => ({ pos: m.tp, vel: new THREE.Vector3(0, -1, 0), radius: this.R, area: true })); }
}

// ------------------------------------------------------------ 7. NOVA
class NovaSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.R = (4.5 + s.size * 9) * (0.55 + this.m * 0.6) * this.look.sx;
    this.charge = 0.06;
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.R * 0.5 });
    this.mc.group.rotation.x = -Math.PI / 2; this.add(this.mc.group);
    this.sphere = this.add(new THREE.Mesh(SPHERE, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.3, noiseAmp: 0.25, flow: 4, opacity: 0 })));
    this.kit = kitOf(this.el, this.look);
    this.shell = this.add(new THREE.Mesh(SMOOTH, surfaceMaterial(this.kit, { spin: 1.5, twist: 1, bulge: 0.18 + this.look.g.dispersion * 0.2 })));
    this.shell.material.uniforms.uTopFade.value = 0; this.shell.material.uniforms.uFlow.value = -1.5; this.shell.visible = false; this.shell.renderOrder = 3;
    // expanding shockwave wall of matter racing across the ground (dust, spray, flame, frost…); taller for tall novas
    const wp = []; for (let k = 0; k <= 12; k++) { const t = k / 12; wp.push(new THREE.Vector2(1 - Math.pow(t, 1.6) * 0.18, Math.sin(t * Math.PI * 0.5))); }
    this.wallRing = this.add(new THREE.Mesh(new THREE.LatheGeometry(wp, 72), surfaceMaterial({ ...this.kit, opacity: Math.max(this.kit.opacity, 0.85) }, { spin: 0.6, twist: 0.4, bulge: 0.1 })));
    this.wallRing.userData.ownGeo = true; this.wallRing.visible = false; this.wallRing.renderOrder = 3;
    this.wallRing.material.uniforms.uFlow.value = 2; this.wallRing.material.uniforms.uStreak.value = 14;
    this.fired = false;
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, c = this.caster.center();
    this.mc.group.position.copy(this.caster.pos).y += 0.15; this.mc.update(dt);
    if (!this.fired) {
      this.g.fx.attractors.push({ x: c.x, y: c.y, z: c.z, r2: (this.R * 1.2) ** 2, k: 50, swirl: 1.5 });
      for (let i = 0; i < 4; i++) {
        const d = new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(this.R);
        this.g.fx.glow.emit({ x: c.x + d.x, y: c.y + d.y, z: c.z + d.z, life: 0.5, size: 0.3, color: this.pal.core, alpha: 1, drag: 0.3, frame: 1 });
      }
      this.light(c, 200 * (this.t / this.charge), 12);
      if (this.t >= this.charge) {
        this.fired = true; this.ft = 0;
        this.g.audio.impact(this.el, this.m + 0.2, c, this.look);
        this.aoe(c, this.R, 85, { knock: 10 + s.weight * 10, lift: 5, falloff: 0.5 });
        this.g.fx.ring(this.caster.pos.clone().setY(this.caster.pos.y + 0.3), this.pal.color, this.R * 2, 0.6);
        this.g.fx.ring(c, this.pal.core, this.R * 1.6, 0.45, _up.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.4), 0.05);
        this.g.fx.addShake(0.3 + this.m * 0.4, c);
        this.g.fx.shockwave(c, this.R * 2.4, 1.5, 0.6);
        if (this.level >= 2) escalateImpact(this, this.caster.pos.clone().setY(this.caster.pos.y + 0.5), this.R * 0.6, null, true);
        this.g.fx.blast(this.el, c, this.R * 0.35, this.m, this.pal, this.look);
        if (this.look.sy > 1.25) this.g.fx.blast(this.el, c.clone().setY(c.y + this.R * 0.3 * this.look.sy), this.R * 0.25, this.m, this.pal, this.look); // tall: a pillar rises from the burst
        const n = Math.floor(80 + this.R * 20);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU, sp = this.R * rand(3, 4.5);
          this.g.fx.glow.emit({ x: c.x, y: c.y - 0.5, z: c.z, vx: Math.cos(a) * sp, vy: rand(-1, 3), vz: Math.sin(a) * sp, life: rand(0.4, 0.8), size: rand(0.5, 1.2) * (0.5 + this.m), size1: 0.1, color: Math.random() < 0.4 ? this.pal.core : this.pal.color, color1: this.pal.dark, alpha: 1, drag: 2.2, frame: ELEMENTS[this.el].particle.shape, spin: rand(-4, 4) });
        }
        for (let i = 0; i < 20; i++) { const a = rand(0, TAU); this.g.fx.smoke.emit({ x: c.x + Math.cos(a) * 2, y: c.y - 0.6, z: c.z + Math.sin(a) * 2, vx: Math.cos(a) * this.R * 2, vy: 0.5, vz: Math.sin(a) * this.R * 2, life: 1.8, size: 1.5, size1: 4, color: new THREE.Color(0x8a7a60), alpha: 0.3, drag: 2.5, frame: 2 }); }
        if (this.el === 'ice' || this.el === 'earth') this.sys.spikeRing(this, this.caster.pos, this.R * 0.8);
        if (this.el2) this.g.fx.explosion(this.el2, c, this.R * 0.5, this.m, this.pal2, { noDecal: true });
      }
    } else {
      this.ft += dt;
      const k = clamp(this.ft / 0.4);
      this.sphere.position.copy(c); this.sphere.scale.setScalar(this.R * Math.pow(k, 0.5));
      this.sphere.material.uniforms.uOpacity.value = (1 - k) * 0.9 * (0.3 + this.kit.energy * 0.7);
      // matter shell: flattened for wide novas, stretched into a column for tall ones; hot/light ones fade faster
      const ks = clamp(this.ft / (0.55 * this.look.lingerMul)), L = this.look;
      this.shell.visible = ks < 1; this.shell.position.copy(this.caster.pos);
      this.shell.scale.set(this.R * 0.95 * Math.pow(ks, 0.45), this.R * 0.6 * L.sy * Math.pow(ks, 0.45), this.R * 0.95 * Math.pow(ks, 0.45));
      this.shell.material.uniforms.uFade.value = Math.pow(1 - ks, 1.3) * 1.3;
      const kw = clamp(this.ft / (0.8 * this.look.lingerMul)), gy = this.g.world.heightAt(this.caster.pos.x, this.caster.pos.z);
      this.wallRing.visible = kw < 1; this.wallRing.position.set(this.caster.pos.x, gy - 0.1, this.caster.pos.z);
      const rr = this.R * (0.2 + 1.05 * Math.pow(kw, 0.5)), wh = (0.9 + this.R * 0.18) * L.sy * (1 - kw * 0.6);
      this.wallRing.scale.set(rr, wh, rr); this.wallRing.material.uniforms.uFade.value = Math.pow(1 - kw, 1.1);
      this.light(c, 800 * (1 - k), this.R * 3);
      this.mc.target = 0;
      if (this.ft > 0.8) this.done = true;
    }
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ------------------------------------------------------------ 8. SPIKES (ground eruption line)
class SpikeSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, aim = this.caster.getAim();
    this.dir = new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize();
    this.pos = this.caster.pos.clone().addScaledVector(this.dir, 1.8);
    this.len = (12 + s.size * 16) * (0.6 + this.m * 0.5);
    this.step = 1.15 - s.sharpness * 0.4;
    this.interval = 0.05 - s.speed * 0.03;
    this.h = (1.3 + s.size * 2.4) * (0.6 + this.m * 0.6) * this.look.sy;
    this.w = (0.3 + s.size * 0.4) * (0.7 + this.m * 0.4) * (1.3 - s.sharpness * 0.5) * this.look.sx;
    this.travel = 0; this.next = 0; this.spikes = []; this.hitOnce = new Map();
    this.target = s.homing > 0.4 ? this.nearestTarget(this.caster.pos, this.dir, 0.5, 60) : null;
    this.mat = this.makeMat();
    // non-solid matter erupts as geysers / pillars of itself instead of rigid cones
    this.kit = kitOf(this.el, this.look);
    this.geyser = this.kit.mix.w < 0.4 && !['earth', 'ice', 'nature'].includes(this.el) && this.look.substance !== 'crystal';
    if (this.geyser) {
      const gp = [[0.95, 0], [0.55, 0.1], [0.38, 0.38], [0.4, 0.72], [0.62, 0.9], [0.32, 1.0], [0.02, 1.03]].map(([r, y]) => new THREE.Vector2(r, y));
      this.gGeo = new THREE.LatheGeometry(new THREE.SplineCurve(gp).getPoints(24), 32);
      this.gMat = surfaceMaterial({ ...this.kit, opacity: Math.max(0.85, this.kit.opacity) }, { spin: 1.5, twist: 0.8, bulge: 0.15 });
      this.gMat.uniforms.uFlow.value = 3.5; this.gMat.uniforms.uTopFade.value = 1; this.gMat.uniforms.uCrest.value = 0.6;
      if (this.kit.energy > 0.25) this.gGlow = surfaceMaterial(this.kit, { spin: 2, twist: 1, bulge: 0.1, energyOnly: true });
      this.w *= 1.25;
    }
  }
  makeMat() {
    const el = this.el;
    if (el === 'ice') return crystalMaterial({ color: 0x9ad8f8, glow: this.pal.color, emissive: 1.2, crack: 0.25 });
    if (el === 'earth') return crystalMaterial({ color: 0x7a6248, glow: this.pal.color, emissive: 0.8, crack: 0.4, rough: true });
    if (el === 'fire') return crystalMaterial({ color: 0x2a1a14, glow: this.pal.color, emissive: 2.5, crack: 0.9 });
    return crystalMaterial({ color: this.pal.dark, glow: this.pal.color, emissive: 2.0, crack: 0.6 });
  }
  update(dt) {
    this.t += dt;
    const s = this.spec;
    this.next -= dt;
    while (this.travel < this.len && this.next <= 0) {
      this.next += Math.max(0.012, this.interval);
      if (this.target && this.target.alive) { const d = this.target.pos.clone().sub(this.pos).setY(0).normalize(); this.dir.lerp(d, 0.18).normalize(); }
      this.pos.addScaledVector(this.dir, this.step); this.travel += this.step;
      const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
      const cluster = s.size > 0.6 ? 3 : s.size > 0.3 ? 2 : 1;
      for (let c = 0; c < cluster; c++) {
        const p = this.pos.clone().addScaledVector(side, (c - (cluster - 1) / 2) * this.w * 1.8 + rand(-0.3, 0.3) * (0.3 + s.chaos));
        p.y = this.g.world.heightAt(p.x, p.z) - 0.2;
        const geo = this.geyser ? this.gGeo : SPIKE_GEOS[Math.floor(rand(0, 3))];
        const m = new THREE.Mesh(geo, this.geyser ? this.gMat : this.mat);
        if (this.geyser) { m.renderOrder = 3; if (this.gGlow) { const gm = new THREE.Mesh(this.gGeo, this.gGlow); gm.scale.setScalar(0.7); m.add(gm); } }
        const hh = this.h * rand(0.7, 1.2) * (c === Math.floor(cluster / 2) ? 1.15 : 0.8);
        m.position.copy(p); m.rotation.set(rand(-0.3, 0.3) * (0.4 + s.chaos) + this.dir.z * 0.2, rand(0, TAU), rand(-0.3, 0.3) * (0.4 + s.chaos) - this.dir.x * 0.2);
        m.scale.set(this.w, 0.01, this.w); m.castShadow = true;
        this.g.scene.add(m);
        this.spikes.push({ m, h: hh * (this.geyser ? 1.35 : 1), age: 0, p });
        if (this.geyser && this.kit.energy > 0.6 && Math.random() < 0.5) this.g.fx.bolt(p.clone().setY(p.y + hh * 1.6), p.clone(), this.pal.color, { look: this.look, width: 0.06, dur: 0.18, jag: 0.2, branches: 1 });
        this.g.fx.element(this.el, p.clone().setY(p.y + 0.4), { count: 4, speed: 3, size: this.w * 1.2, palette: this.pal, look: this.look });
        this.g.fx.smoke.emit({ x: p.x, y: p.y + 0.3, z: p.z, vx: rand(-2, 2), vy: rand(1, 3), vz: rand(-2, 2), life: 1.2, size: this.w * 2, size1: this.w * 5, color: new THREE.Color(0x8a7a60), alpha: 0.4, drag: 2, frame: 2 });
        for (const t of this.targets()) {
          if (t.distTo(p.clone().setY(p.y + hh * 0.4)) < this.w + 0.6 && !this.hitOnce.has(t)) {
            this.hitOnce.set(t, true);
            this.hit(t, 55, t.center(), { knock: new THREE.Vector3(0, 7 + s.size * 4, 0), shatter: true });
          }
        }
        const bh = this.barrierHit(p.clone().setY(p.y + 0.5), p.clone().setY(p.y + 0.5).addScaledVector(this.dir, this.step));
        if (bh) { bh.bar.damage(30 * s.dmgMult, p); this.travel = this.len; }
      }
      if (Math.floor(this.travel / this.step) % 3 === 0) this.g.audio.impact(this.el, 0.12, this.pos, this.look);
      this.light(this.pos.clone().setY(this.pos.y + 1), 200, 10);
      this.g.fx.addShake(0.03, this.pos);
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const sp = this.spikes[i]; sp.age += dt;
      const up = clamp(sp.age / 0.1), down = clamp((sp.age - 1.4 - s.duration) / 0.5);
      const k = up * (1 - down);
      sp.m.scale.y = Math.max(0.01, sp.h * (up < 1 ? 1.15 * Math.sin(up * Math.PI * 0.6) / Math.sin(Math.PI * 0.6) : 1) * (1 - down));
      if (this.geyser) { // geysers churn: the crown spits matter and the column breathes
        sp.m.scale.x = sp.m.scale.z = this.w * (0.85 + Math.sin(sp.age * 18 + sp.p.x) * 0.08) * (1 - down * 0.6);
        if (Math.random() < 0.25 * k) this.g.fx.element(this.el, sp.p.clone().setY(sp.p.y + sp.m.scale.y), { count: 1.5, speed: 3, size: this.w * 0.6, palette: this.pal, dir: _up, spread: 0.6, look: this.look });
      }
      if (k <= 0 && down >= 1) { this.g.scene.remove(sp.m); this.spikes.splice(i, 1); }
    }
    this.updateCommon(dt);
    if (this.travel >= this.len && !this.spikes.length) this.done = true;
    return !this.finished();
  }
  dispose() { super.dispose(); for (const sp of this.spikes) this.g.scene.remove(sp.m); this.mat.dispose(); this.gGeo?.dispose(); this.gMat?.dispose(); this.gGlow?.dispose(); }
}

// ------------------------------------------------------------ 9. WALL (a wall made of the spell's own matter)
// The kit's solid weight decides what the wall is. Solid matter (stone, ice, magma rock…) raises real masonry: columns of
// rough-cut courses burst out of the ground from the centre outward, crenellated and trimmed with the spell's glow. That is a
// world box, so it stops bodies and every spell on both sides and can be climbed; hits chip it and knock merlons off, and it
// crumbles back into the earth. Anything else (flame, water, wind, storm, light…) rises as a rank of churning tongues of that
// matter: bodies pass through and are hurt, enemy spells are swallowed. Heat and energy add licking flames, soot and arcs.
const BRICK = (() => { const g = new RoundedBoxGeometry(1, 1, 1, 2, 0.1); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; })();
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const backOut = (p) => { const q = p - 1; return 1 + 2.4 * q * q * q + 1.4 * q * q; };
// one tongue of matter: a column that tapers into a licking tip (surface kit uv: x around, y up)
const TONGUE = (() => { const pts = []; for (let k = 0; k <= 40; k++) { const y = k / 40; pts.push(new THREE.Vector2(Math.max(0.05, (1 - 0.25 * y) * (1 - Math.pow(y, 3) * 0.7)), y)); } return new THREE.LatheGeometry(pts, 48); })();
class WallSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, aim = this.caster.getAim(), world = this.g.world, rng = this.rng;
    const f = new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize();
    const dist = Math.min(12, Math.max(4, this.caster.pos.distanceTo(aim.point)));
    this.center = this.caster.pos.clone().addScaledVector(f, dist);
    this.center.y = world.heightAt(this.center.x, this.center.z);
    this.normal = f.clone().negate(); this.sideV = new THREE.Vector3(f.z, 0, -f.x); this.yaw = Math.atan2(f.x, f.z);
    this.W = (6 + s.size * 8) * (0.7 + this.m * 0.4) * this.look.sx;
    this.H = (2.6 + s.size * 2.6) * (0.8 + this.m * 0.3) * this.look.sy;
    this.T = 0.8 + this.m * 0.35 + this.look.g.density * 0.3;
    this.life = 6 + s.duration * 10 + this.m * 3;
    this.hp = this.maxHp = 260 * s.dmgMult;
    this.kit = kitOf(this.el, this.look);
    this.grp = this.add(new THREE.Group()); this.grp.position.copy(this.center); this.grp.rotation.y = this.yaw;
    this.cols = []; this.merlons = []; this.falling = []; this.knocked = 0; this.mats = [];
    this.solid = this.kit.mix.w >= 0.45;
    if (this.solid) this.buildMasonry(); else this.buildMatter();
    this.barrier = { owner: this.caster, segment: (p, q) => this.segment(p, q), damage: (d, p) => this.damage(d, p) };
    this.sys.barriers.push(this.barrier);
    this.rise = 0; this.hitFlash = 0;
    for (const k of [-0.32, 0, 0.32]) this.g.fx.decal(this.center.clone().addScaledVector(this.sideV, this.W * k), this.W * 0.24, this.solid ? (this.el === 'ice' ? 'ice' : 'earth') : this.el, this.pal.color);
    this.g.audio.impact(this.solid ? 'earth' : this.el, 0.6 + this.m * 0.2, this.center, this.look);
    this.g.fx.addShake((this.solid ? 0.25 : 0.12) + this.m * 0.1, this.center);
  }
  buildMasonry() {
    const world = this.g.world, rng = this.rng;
    const mat = (CONSTRUCT_MAT[this.el] || (() => stoneMaterial(new THREE.Color(0xb4ac9c).lerp(this.kit.body, 0.35), { moss: 0.3, joint: 0 })))();
    this.trim = new THREE.MeshStandardMaterial({ color: this.pal.color, emissive: this.pal.color, emissiveIntensity: 1.4 });
    const n = Math.max(3, Math.round(this.W / 2.1)), cw = this.W / n, crenel = this.H > 2.4, T = this.T;
    const block = (geos, w, h, d, x, y, z, ry = 0) => { const b = BRICK.clone(); b.scale(w, h, d); b.rotateY(ry); b.translate(x, y, z); geos.push(b); };
    for (let i = 0; i < n; i++) {
      const x = -this.W / 2 + (i + 0.5) * cw, wp = this.center.clone().addScaledVector(this.sideV, x);
      const base = world.heightAt(wp.x, wp.z) - this.center.y - 0.35, Hm = this.H - base; // every column reaches the same wall-walk
      // a core fills the joints; a broad plinth, courses in running bond (each course split at a different point, every stone
      // a little off true), and an overhanging coping on top
      const geos = [];
      block(geos, cw * 0.97, Hm, T * 0.8, 0, Hm / 2, 0);
      const plinth = 0.65 + rng() * 0.1;
      block(geos, cw - 0.03, plinth, T * 1.2, 0, plinth / 2, 0);
      let y = plinth, row = 0;
      while (y < Hm - 0.5) {
        let h = 0.42 + rng() * 0.3; if (Hm - 0.22 - y - h < 0.3) h = Hm - 0.22 - y;
        const k = cw > 2.6 ? 3 : 2, cuts = [0];
        for (let j = 1; j < k; j++) cuts.push(j / k + ((row + i) % 2 ? 0.17 : -0.17) + (rng() - 0.5) * 0.12);
        cuts.push(1);
        for (let j = 0; j < k; j++) {
          const x0 = -cw / 2 + cuts[j] * cw, x1 = -cw / 2 + cuts[j + 1] * cw;
          block(geos, x1 - x0 - 0.05, h - 0.05, T * (0.94 + rng() * 0.1), (x0 + x1) / 2 + (rng() - 0.5) * 0.03, y + h / 2, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.05);
        }
        y += h; row++;
      }
      block(geos, cw + 0.02, Hm - y, T * 1.16, 0, (y + Hm) / 2, 0);
      const col = new THREE.Mesh(mergeGeometries(geos), mat); geos.forEach((q) => q.dispose());
      col.userData.ownGeo = true; col.castShadow = col.receiveShadow = true;
      const pivot = new THREE.Group(); pivot.position.set(x, base, 0); pivot.add(col); this.grp.add(pivot);
      for (const sz of [-1, 1]) { const e = new THREE.Mesh(UNIT_BOX, this.trim); e.scale.set(cw + 0.03, 0.08, 0.1); e.position.set(0, y + 0.02, sz * (T * 0.58 + 0.01)); pivot.add(e); } // glowing seam along the coping lip
      const c = { pivot, x, base, h: Hm, wp, delay: (Math.abs(x) / (this.W / 2)) * 0.28 + rng() * 0.04, burst: false };
      if (crenel) {
        const mh = 0.6 + this.H * 0.07, mm = new THREE.Mesh(BRICK, mat);
        mm.scale.set(cw * 0.5, mh, T * 0.95); mm.position.set((rng() - 0.5) * 0.1, Hm + mh / 2 - 0.02, 0); mm.castShadow = true; pivot.add(mm);
        this.merlons.push(mm); c.h += mh;
      }
      this.cols.push(c);
    }
    this.mats = [mat, this.trim];
    this.box = world.addBox({ x: this.center.x, y: this.center.y - 0.5, z: this.center.z, hx: this.W / 2, hy: 0.01, hz: this.T / 2, yaw: this.yaw });
  }
  // a rank of overlapping tongues of the matter, each with the tornado's recipe: a body shell, an outer haze (a dark soot
  // sheath over hot matter, only where the flame dies out at the top) and a glowing core when hot or charged
  buildMatter() {
    const K = this.kit, G = this.look.g, world = this.g.world, rng = this.rng, hot = K.heat > 0.25;
    this.T = Math.max(this.T, 1.1);
    const R = 0.7 + this.T * 0.3, n = Math.max(6, Math.ceil(this.W / (R * 0.8))), step = this.W / n;
    const sheathKit = hot ? { ...K, mix: new THREE.Vector4(0, 0.25, 1, 0.1), body: new THREE.Color(0x3a302c).lerp(this.pal.smoke, 0.4), dark: new THREE.Color(0x120e0c), hi: this.pal.color.clone(), energy: 0, opacity: 0.9 } : K;
    const gassy = K.mix.z > 0.6 && K.mix.y < 0.3;
    for (let i = 0; i < n; i++) {
      const x = -this.W / 2 + (i + 0.5) * step + (rng() - 0.5) * step * 0.3, wp = this.center.clone().addScaledVector(this.sideV, x);
      const base = world.heightAt(wp.x, wp.z) - this.center.y - 0.2, zr = (i % 2 ? 1 : -1) * this.T * 0.22; // two staggered ranks
      const c = { x, base, wp, r: R * (0.8 + rng() * 0.4), h: this.H * (i % 2 ? 0.6 + rng() * 0.35 : 0.85 + rng() * 0.45) - base, delay: (Math.abs(x) / (this.W / 2)) * 0.3 + rng() * 0.05, burst: false, shells: [] };
      c.pivot = new THREE.Group(); c.pivot.position.set(x, base, zr); c.pivot.rotation.y = rng() * TAU; this.grp.add(c.pivot);
      const shell = (kit, k, ky, o) => {
        const m = new THREE.Mesh(TONGUE, surfaceMaterial(kit, o)); m.userData.k = k; m.userData.ky = ky; m.renderOrder = 3; c.pivot.add(m); c.shells.push(m); return m.material.uniforms;
      };
      const spin = 0.8 + rng() * 0.8, bend = 0.22 + G.dispersion * 0.25;
      const u = shell(K, 1, 1, { spin, twist: 1.6, bend, bulge: 0.26 + G.dispersion * 0.15 });
      // flame tears its own top into licks (hard cut-out, so it stays saturated); streak bands show it rushing upward
      u.uFlameUp.value = 0.75; u.uFlow.value = K.flow * 1.6 + 1; u.uBands.value = gassy ? 2 + Math.round(G.sharpness * 2) : 2; u.uGap.value = gassy ? 0.35 + (1 - G.density) * 0.25 : 0.12;
      const us = shell(sheathKit, 1.22, 1.06, { spin: spin * 0.6, twist: 1.2, bend: bend * 0.8, bulge: 0.2, opacity: hot ? 1 : 0.4 });
      if (hot) us.uLow.value = 0.7;
      if (K.energy > 0.3) shell(K, 0.55, 0.9, { spin: spin * 1.6, twist: 2.5, bend: bend * 1.4, bulge: 0.08, energyOnly: true });
      this.cols.push(c);
    }
    // flecks riding up the wall: embers, sparks, leaves, droplets, shards (one instanced mesh)
    const glowF = clamp(K.heat * 1.2 + K.energy * 0.8), leafy = this.el === 'wind' || this.el === 'nature';
    const nF = Math.round((26 + (1 - G.density) * 14) * (0.6 + this.m * 0.5) * clamp(this.W / 9, 0.6, 1.6));
    const fmat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, emissive: glowF > 0.3 ? this.pal.color : 0x000000, emissiveIntensity: glowF * 2.2 });
    this.flecks = new THREE.InstancedMesh(G.sharpness > 0.65 || this.el === 'ice' ? OCTA : FLECK, fmat, nF); this.flecks.frustumCulled = false; this.flecks.userData.noAO = true;
    const fp = leafy ? [0x5f9e34, 0x8cc84a, 0xc8e08a, 0x3f6e28, 0xe6c35a] : glowF > 0.3 ? [this.pal.color.getHex(), this.pal.core.getHex(), this.pal.core.getHex()] : [K.dark.getHex(), K.body.getHex(), K.hi.getHex()];
    this.fl = [];
    for (let i = 0; i < nF; i++) { this.flecks.setColorAt(i, new THREE.Color(pick(fp))); this.fl.push({ x: rand(-0.5, 0.5), z: rand(-0.6, 0.6), y: Math.random(), up: rand(0.25, 0.5) * (1.2 - G.weight * 0.8), sz: rand(0.14, 0.3) * (leafy ? 1.8 : 1), rx: rand(0, TAU), ry: rand(0, TAU), ph: rand(0, TAU) }); }
    this.grp.add(this.flecks); this._fo = new THREE.Object3D();
  }
  // spells that reach either face stop there (the wall is also a world box, so this only decides where they burst and hurts it)
  segment(a, b) {
    if (this.rise < 0.05 || this.t > this.life) return null;
    const n = this.normal, c = this.center;
    const da = _v.subVectors(a, c).dot(n), db = _w.subVectors(b, c).dot(n), face = da >= 0 ? this.T / 2 : -this.T / 2;
    if ((da - face) * (db - face) > 0) return null;
    const t = (da - face) / (da - db), p = _v.copy(a).lerp(b, t).sub(c);
    if (Math.abs(p.dot(this.sideV)) > this.W / 2 || p.y < -0.5 || p.y > this.H * this.rise + 0.6) return null;
    return t;
  }
  damage(d, p) {
    this.hp -= d; this.hitFlash = 1;
    const fx = this.g.fx, side = Math.sign(_v.subVectors(p, this.center).dot(this.normal)) || 1, q = p.clone().addScaledVector(this.normal, side * 0.15);
    if (this.hp <= 0) this.life = Math.min(this.life, this.t);
    if (!this.solid) { // the spell is swallowed by the matter: a gout of it bursts out of the face
      fx.explosion(this.el, q, 0.9 + Math.min(1, d / 50), 0.3, this.pal, { look: this.look, noDecal: true, smokeMul: 0.3 });
      return;
    }
    fx.debris(q, 0.5 + Math.min(1, d / 60), this.el === 'ice' ? 'ice' : 'earth', this.pal, this.look);
    fx.puff(q, { color: this.kit.body.clone().lerp(new THREE.Color(0xd8cbb4), 0.5), size: 0.6, size1: 1.7, life: 1.3, alpha: 0.8, rise: 0.5 });
    // heavy damage knocks merlons off the top, falling away from the blow
    const lost = Math.floor((1 - Math.max(0, this.hp) / this.maxHp) * (this.merlons.length + this.knocked + 1));
    while (this.knocked < lost && this.merlons.length) this.knock(p, side);
  }
  knock(p, side) {
    this.knocked++;
    let bi = 0, bd = Infinity;
    this.merlons.forEach((m, i) => { const d = m.getWorldPosition(_w).distanceTo(p); if (d < bd) { bd = d; bi = i; } });
    const m = this.merlons.splice(bi, 1)[0];
    m.updateWorldMatrix(true, false); m.parent.remove(m);
    m.matrixWorld.decompose(m.position, m.quaternion, m.scale); this.g.scene.add(m);
    const v = this.normal.clone().multiplyScalar(-side * rand(2, 4)).addScaledVector(this.sideV, rand(-1.5, 1.5)).setY(rand(2, 4));
    this.falling.push({ m, v, w: new THREE.Vector3(rand(-5, 5), rand(-2, 2), rand(-5, 5)), t: 0 });
  }
  columnBurst(c) {
    const p = c.wp.clone(); p.y = this.g.world.heightAt(p.x, p.z) + 0.2;
    if (this.solid) this.g.fx.explosion(this.el === 'ice' ? 'ice' : 'earth', p, 1.0, 0.2, null, { noDecal: true });
    else this.g.fx.explosion(this.el, p, 0.9, 0.25, this.pal, { look: this.look, noDecal: true, smokeMul: 0.25 });
  }
  update(dt) {
    this.t += dt;
    const fx = this.g.fx, live = this.t < this.life;
    if (!live && !this.crumbled && !this.solid) { this.crumbled = true; this.g.audio.whoosh(0.6); }
    if (!live && !this.crumbled) {
      this.crumbled = true;
      this.cols.forEach((c, i) => { if (i % 2 === 0) fx.explosion(this.el === 'ice' ? 'ice' : 'earth', c.wp.clone().setY(this.center.y + this.H * 0.4), 1.4, 0.3, null, { noDecal: true, debris: true }); });
      this.g.audio.impact('earth', 0.5, this.center, this.look); fx.addShake(0.2, this.center);
    }
    let sum = 0;
    if (!this.solid) for (const c of this.cols) { // tongues surge up out of the ground, then gutter out
      const p = clamp((this.t - c.delay) / 0.4);
      if (p > 0 && !c.burst) { c.burst = true; this.columnBurst(c); }
      const out = clamp((this.t - this.life - c.delay * 0.5) / 0.6), e = backOut(p) * (1 - out * 0.6);
      const flick = 1 + Math.sin(this.t * 7 + c.x * 3) * 0.04 + Math.sin(this.t * 11.3 + c.x) * 0.03;
      for (const m of c.shells) { const k = m.userData.k; m.scale.set(c.r * k, Math.max(0.01, c.h * m.userData.ky * e * flick), c.r * k * 0.8); m.material.uniforms.uFade.value = clamp(p * 3) * (1 - out); }
      sum += Math.min(1, e);
    }
    else for (const c of this.cols) {
      const p = clamp((this.t - c.delay) / 0.32);
      if (p > 0 && !c.burst) { c.burst = true; this.columnBurst(c); }
      const sink = clamp((this.t - this.life - c.delay * 0.8) / 0.55), e = backOut(p) * (1 - sink * sink);
      c.pivot.position.y = c.base - c.h * (1 - e) - 0.02;
      c.pivot.rotation.set(sink * 0.07 * Math.sin(c.x * 3.1), 0, sink * Math.sign(c.x || 1) * 0.1);
      sum += Math.min(1, e);
    }
    this.rise = sum / this.cols.length;
    if (this.box) { // the collision box grows with the masonry
      const bot = this.center.y - 0.5, top = this.center.y + this.H * this.rise;
      this.box.y = (bot + top) / 2; this.box.hy = Math.max(0.01, (top - bot) / 2);
    }
    if (this.flecks) {
      const o = this._fo, K = this.kit, fade = this.rise * (live ? 1 : 1 - clamp((this.t - this.life) / 0.6));
      this.fl.forEach((f, i) => {
        f.y += dt * f.up; if (f.y > 1.15) { f.y = 0; f.x = rand(-0.5, 0.5); }
        o.position.set(f.x * this.W + Math.sin(this.t * 2 + f.ph) * 0.3, f.y * this.H * 1.1, f.z * this.T + Math.cos(this.t * 1.7 + f.ph) * 0.2);
        o.rotation.set(f.rx + this.t * 3, f.ry + this.t * 2, 0); o.scale.setScalar(f.sz * fade * (1 - clamp((f.y - 0.9) / 0.25)) + 0.001);
        o.updateMatrix(); this.flecks.setMatrixAt(i, o.matrix);
      });
      this.flecks.instanceMatrix.needsUpdate = true;
      // a churning bed of the matter along the foot
      for (let i = 0; i < 0.3 * fx.quality * this.rise && live; i++) {
        const p = this.center.clone().addScaledVector(this.sideV, rand(-this.W / 2, this.W / 2)).addScaledVector(this.normal, rand(-0.6, 0.6) * this.T); p.y = this.g.world.heightAt(p.x, p.z) + rand(0, 0.4);
        fx.puff(p, { color: K.body.clone().lerp(K.hi, K.mix.x * 0.8).lerp(K.dark, rand(0, 0.5) * (1 - K.mix.x)).lerp(this.pal.color, K.heat * rand(0.3, 0.7)), size: rand(1.1, 1.6), size1: rand(2.6, 3.6), life: rand(1, 1.5), vel: new THREE.Vector3(0, rand(0.5, 1.5), 0).addScaledVector(this.normal, rand(-1, 1)), alpha: (0.3 + this.look.g.density * 0.4) * (1 - K.mix.x * 0.5), drag: 1.2, soft: true });
      }
    }
    if (this.trim) this.trim.emissiveIntensity = (1.2 + Math.sin(this.t * 3) * 0.2 + this.hitFlash * 3) * (1 - clamp((this.t - this.life) / 0.4));
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    const k = this.rise;
    if (live && this.rise > 0.3) {
      const along = () => this.center.clone().addScaledVector(this.sideV, rand(-this.W / 2, this.W / 2));
      if (this.kit.heat > 0.2) { // hot matter: flames lick off the wall-walk / the tongue tips
        for (let i = 0; i < 6 * fx.quality * (this.solid ? 1 : 0); i++) { const p = along(); p.y = this.center.y + this.H * k + rand(-0.1, 0.2); fx.flame(p, { color: this.pal.color, size: rand(0.6, 1.2) * (0.5 + this.kit.heat), life: rand(0.5, 0.9), rise: 2 + this.H * 0.4 }); }
        if (Math.random() < (this.solid ? 0.2 : 0.07)) fx.puff(along().setY(this.center.y + this.H + 1), { color: new THREE.Color(0x3b3330), size: this.solid ? 1 : 1.8, size1: this.solid ? null : 3.2, life: 2, alpha: this.solid ? 0.6 : 0.45, rise: 2, soft: !this.solid });
        if (!this.hazeH) this.hazeH = fx.haze(this.center.clone().setY(this.center.y + this.H + 0.8), this.W * 1.1, 1.2, 0);
      }
      if (this.kit.energy > 0.6 && Math.random() < 0.35) { // charged matter: arcs crawl over a face
        const off = this.normal.clone().multiplyScalar((Math.random() < 0.5 ? 1 : -1) * (this.T / 2 + 0.05));
        const a = along().add(off).setY(this.center.y + rand(0.2, this.H)), b = along().add(off).setY(this.center.y + rand(0.2, this.H));
        fx.bolt(a, b, this.pal.color, { look: this.look, width: 0.05, dur: 0.12, jag: 0.25, branches: 1 });
      }
      if (this.kit.heat > 0.2 || this.kit.energy > 0.6 || !this.solid) { // hurts whoever touches it (or wades through it)
        this.tick = (this.tick || 0) - dt;
        if (this.tick <= 0) { this.tick = 0.5; for (const t of this.targets()) if (Math.abs(_v.subVectors(t.pos, this.center).dot(this.normal)) < this.T / 2 + 1 && Math.abs(_v.dot(this.sideV)) < this.W / 2 + 0.5) this.hit(t, 8 + (this.kit.heat + this.kit.energy) * 8, t.center()); }
      }
    }
    if (!live && this.hazeH) this.hazeH.alive = false;
    for (const o of this.falling) { // knocked-off merlons tumble and settle
      if (!o.m.visible) continue;
      o.t += dt; o.v.y -= 20 * dt; o.m.position.addScaledVector(o.v, dt);
      o.m.rotation.x += o.w.x * dt; o.m.rotation.y += o.w.y * dt; o.m.rotation.z += o.w.z * dt;
      const gy = this.g.world.heightAt(o.m.position.x, o.m.position.z) + 0.25;
      if (o.m.position.y < gy) { o.m.position.y = gy; if (Math.abs(o.v.y) > 2) fx.puff(o.m.position, { color: new THREE.Color(0xcbbba0), size: 0.5, size1: 1.2, life: 0.9, alpha: 0.7 }); o.v.multiplyScalar(0.35); o.v.y = Math.abs(o.v.y) * 0.4; o.w.multiplyScalar(0.4); }
      if (o.t > 2.5) { o.m.scale.multiplyScalar(1 - dt * 3); if (o.t > 3.2) { o.m.visible = false; this.g.scene.remove(o.m); } }
    }
    this.light(this.center.clone().setY(this.center.y + this.H * 0.6), (60 + (this.kit.heat + this.kit.energy) * 80) * k * (live ? 1 : 0), this.W);
    if (this.t > this.life + 1) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
  dispose() {
    super.dispose();
    for (const o of this.falling) this.g.scene.remove(o.m);
    const i = this.sys.barriers.indexOf(this.barrier); if (i >= 0) this.sys.barriers.splice(i, 1);
    if (this.box) this.g.world.removeBox(this.box);
    this.mats.forEach((m) => m.dispose());
  }
}

// ------------------------------------------------------------ 9b. BARRIER (magic force field: stops enemy spells, not bodies)
// An arched pane of hex cells on an arc around the caster, pinned by two floating crystals. Cells pop in from the base outward,
// every blocked spell sends a ripple across it, damage cracks cells dark, and when it breaks it bursts into falling hex tiles.
// Sharpness sets the cell size, density how solid the glass looks, luminosity how hot the rims burn.
const HEX_TILE = (() => { const g = new THREE.CylinderGeometry(1, 1, 0.06, 6); g.rotateX(Math.PI / 2); return g; })();
function barrierPaneGeometry(R, theta, H, lean, segU = 48, segV = 16) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= segV; j++) for (let i = 0; i <= segU; i++) {
    const u = i / segU, v = j / segV, a = (u - 0.5) * theta, r = R * (1 - lean * v * v);
    pos.push(Math.sin(a) * r, v * H, Math.cos(a) * r); uv.push(u, v);
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) { const k = j * (segU + 1) + i; idx.push(k, k + segU + 1, k + 1, k + 1, k + segU + 1, k + segU + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
const ARCH = 0.28; // the pane's top edge sags this much toward the sides
function barrierPaneMaterial({ color, core, arc, H, cell, fill, glow }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: TIME, uColor: { value: color.clone() }, uCore: { value: core.clone() }, uSize: { value: new THREE.Vector2(arc, H) }, uCell: { value: cell }, uFill: { value: fill }, uGlow: { value: glow },
      uReveal: { value: 0 }, uDissolve: { value: 0 }, uDamage: { value: 0 }, uFade: { value: 1 }, uHits: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -99, 0)) },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform vec3 uColor,uCore; uniform vec2 uSize; uniform float uTime,uCell,uFill,uGlow,uReveal,uDissolve,uDamage,uFade; uniform vec4 uHits[4];
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec2 P=vec2((vUv.x-0.5)*uSize.x, vUv.y*uSize.y);                 // metres across the arc / up from the base
        float top=uSize.y*(1.0-${ARCH.toFixed(2)}*pow(2.0*vUv.x-1.0,2.0));
        if(P.y>top) discard;
        vec2 q=P/uCell, r=vec2(1.0,1.7320508), hh=r*0.5;                  // hex cells
        vec2 ga=mod(q,r)-hh, gb=mod(q-hh,r)-hh, gv=dot(ga,ga)<dot(gb,gb)?ga:gb, id=q-gv;
        vec2 ap=abs(gv); float edge=0.5-max(dot(ap,normalize(r)),ap.x);    // 0 on the cell rim
        float rnd=h21(id); vec2 cc=id*uCell;
        float front=uReveal*(length(uSize)+1.5)-length(vec2(cc.x,cc.y*1.3))-rnd*0.6;   // cells pop in from the base centre
        if(front<0.0) discard;
        if(uDissolve*1.8-(1.0-cc.y/uSize.y)*0.7-rnd*0.6>0.0) discard;          // and blink out top first
        float pop=exp(-front*2.5);
        float fres=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.0);
        float line=smoothstep(0.09,0.0,edge), bevel=smoothstep(0.28,0.02,edge);   // bright rim + faceted inner bevel
        float sweep=exp(-pow((P.y-mod(uTime*2.6+rnd*0.3,uSize.y+5.0)+2.0)*1.3,2.0));   // a scan band climbing the pane
        float shimmer=0.5+0.5*sin(uTime*2.0+rnd*30.0+P.y*0.6);
        float n=snoise(vec3(P*0.35,uTime*0.4))*0.5+0.5;
        float fe=min(min(P.x+uSize.x*0.5,uSize.x*0.5-P.x),top-P.y);            // frame: sides, arched top, base seam
        float frame=smoothstep(0.14,0.0,fe)+smoothstep(0.3,0.0,P.y)*0.7;
        float rip=0.0;                                                          // ripples from blocked hits
        for(int i=0;i<4;i++){
          float age=uTime-uHits[i].z; if(age<0.0||age>0.9) continue;
          float d=length(P-uHits[i].xy);
          rip+=uHits[i].w*(smoothstep(0.4,0.0,abs(d-age*7.0))*(1.0-age/0.9)+exp(-d*1.5)*exp(-age*8.0)*1.5);
        }
        float broken=step(rnd,uDamage*0.7), flick=broken*step(0.55,fract(uTime*7.0+rnd*9.0));
        float a=(0.08+0.07*n+0.05*shimmer)*(0.7+rnd*0.6)*uFill*(1.0-broken*0.8)+bevel*0.12+fres*0.3+line*(0.55-broken*0.3)+frame*0.9+rip*0.8+pop*0.9+flick*0.25+sweep*(line+bevel)*0.4;
        float hot=line*0.5+bevel*0.2+frame*0.9+rip+pop+sweep*(line+bevel*0.5);
        vec3 c=mix(uColor,uCore,clamp(hot*0.6+fres*0.3,0.0,1.0))*(1.0+hot*uGlow);
        gl_FragColor=vec4(c,clamp(a,0.0,1.0)*uFade);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
class BarrierSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster, aim = c.getAim(), G = this.look.g, world = this.g.world;
    this.f = new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize(); this.sideV = new THREE.Vector3(this.f.z, 0, -this.f.x);
    this.C = c.pos.clone();
    this.R = 3.2 + s.size * 1.6 + this.m * 0.5;
    this.W = Math.min(this.R * 2.4, (5 + s.size * 6) * (0.7 + this.m * 0.4) * this.look.sx);
    this.theta = this.W / this.R; this.lean = 0.12;
    const mid = this.C.clone().addScaledVector(this.f, this.R);
    this.baseY = world.heightAt(mid.x, mid.z) - 0.25;
    this.H = (2.8 + s.size * 2.4) * (0.8 + this.m * 0.3) * this.look.sy + 0.25;
    this.center = mid.setY(this.baseY + this.H * 0.45);
    this.life = 6 + s.duration * 8 + this.m * 2;
    this.hp = this.maxHp = 220 * s.dmgMult;
    const pane = barrierPaneGeometry(this.R, this.theta, this.H, this.lean);
    this.mat = barrierPaneMaterial({ color: this.pal.color, core: this.pal.core, arc: this.W, H: this.H, cell: 0.72 - G.sharpness * 0.32, fill: 0.7 + G.density * 0.6, glow: 0.7 + G.luminosity * 0.9 });
    this.grp = this.add(new THREE.Group()); this.grp.position.set(this.C.x, this.baseY, this.C.z); this.grp.rotation.y = Math.atan2(this.f.x, this.f.z);
    this.pane = new THREE.Mesh(pane, this.mat); this.pane.userData.ownGeo = true; this.pane.renderOrder = 4; this.grp.add(this.pane);
    // a glowing seam traced on the ground along the foot of the pane
    const seam = new THREE.RingGeometry(this.R - 0.12, this.R + 0.12, 48, 1, Math.PI / 2 - this.theta / 2, this.theta); seam.rotateX(Math.PI / 2);
    this.seam = new THREE.Mesh(seam, new THREE.MeshBasicMaterial({ color: this.pal.color.clone().multiplyScalar(1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.seam.userData.ownGeo = true; this.seam.position.y = 0.3; this.grp.add(this.seam);
    // anchor crystals at both ends
    const cm = crystalMaterial({ color: this.pal.color.clone().lerp(new THREE.Color(0xffffff), 0.45), glow: this.pal.color, emissive: 1.4, crack: 0.2 });
    this.anchors = [-1, 1].map((sd) => {
      const m = new THREE.Mesh(OCTA, cm), a = sd * this.theta / 2;
      m.userData.lp = new THREE.Vector3(Math.sin(a) * (this.R + 0.15), 0, Math.cos(a) * (this.R + 0.15)); m.scale.set(0.24, 0.65, 0.24); m.castShadow = true;
      this.grp.add(m); return m;
    });
    this.hits = this.mat.uniforms.uHits.value; this.hitI = 0; this.reveal = 0; this.shards = [];
    this.barrier = { owner: c, segment: (p, q) => this.segment(p, q), damage: (d, p) => this.damage(d, p) };
    this.sys.barriers.push(this.barrier);
    this.g.audio.whoosh(0.8);
  }
  // pane coordinates of a world point: metres across the arc (0 at the middle), metres up, and u in 0..1
  paneCoords(p) {
    const px = p.x - this.C.x, pz = p.z - this.C.z;
    const u = Math.atan2(px * this.f.z - pz * this.f.x, px * this.f.x + pz * this.f.z) / this.theta + 0.5;
    return { x: (u - 0.5) * this.W, y: p.y - this.baseY, u };
  }
  paneWorld(u, v, out = new THREE.Vector3()) {
    const a = (u - 0.5) * this.theta, r = this.R * (1 - this.lean * v * v);
    return out.copy(this.C).addScaledVector(this.sideV, Math.sin(a) * r).addScaledVector(this.f, Math.cos(a) * r).setY(this.baseY + v * this.H);
  }
  // segment × leaning cylinder: solve the circle crossing in XZ, refine the radius at the crossing height, then clip to the arch
  segment(a, b) {
    if (this.endT || this.reveal < 0.15) return null;
    const mx = a.x - this.C.x, mz = a.z - this.C.z, dx = b.x - a.x, dz = b.z - a.z, A = dx * dx + dz * dz;
    if (A < 1e-8) return null;
    const B = 2 * (mx * dx + mz * dz);
    let best = null;
    for (const sg of [-1, 1]) {
      let r = this.R, t = null;
      for (let it = 0; it < 3; it++) {
        const disc = B * B - 4 * A * (mx * mx + mz * mz - r * r);
        if (disc < 0) { t = null; break; }
        t = (-B + sg * Math.sqrt(disc)) / (2 * A);
        const v = clamp((a.y + (b.y - a.y) * t - this.baseY) / this.H); r = this.R * (1 - this.lean * v * v);
      }
      if (t === null || t < 0 || t > 1 || (best !== null && t >= best)) continue;
      const pc = this.paneCoords(_v.copy(a).lerp(b, t));
      if (pc.u < 0 || pc.u > 1 || pc.y < -0.3 || pc.y > this.H * (1 - ARCH * (2 * pc.u - 1) ** 2)) continue;
      best = t;
    }
    return best;
  }
  damage(d, p) {
    if (this.endT) return;
    this.hp -= d;
    const fx = this.g.fx, pc = this.paneCoords(p), n = _w.set(p.x - this.C.x, 0, p.z - this.C.z).normalize().clone();
    this.hits[this.hitI++ % 4].set(pc.x, pc.y, TIME.value, Math.min(1.5, 0.5 + d / 40));
    fx.ring(p, this.pal.core, 1.2 + Math.min(2, d / 40), 0.35, n, 0.1);
    fx.flash(p, this.pal.core, 0.8, 0.12, 2);
    fx.element(this.el, p, { count: 6, speed: 4, size: 0.3, palette: this.pal, dir: n, spread: 0.6 });
    this.g.audio.impact(this.el, 0.25, p, this.look);
    if (this.hp <= 0) this.shatter(p);
  }
  shatter(p) {
    this.endT = this.t; this.broken = true; this.pane.visible = false;
    const i = this.sys.barriers.indexOf(this.barrier); if (i >= 0) this.sys.barriers.splice(i, 1);
    const fx = this.g.fx, cell = this.mat.uniforms.uCell.value;
    const mat = new THREE.MeshStandardMaterial({ color: this.pal.color, emissive: this.pal.color, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    for (let k = 0; k < 44 * fx.quality; k++) {
      const u = Math.random(), v = Math.random() * (1 - ARCH * (2 * u - 1) ** 2), q = this.paneWorld(u, v);
      const m = new THREE.Mesh(HEX_TILE, mat); m.position.copy(q); m.lookAt(this.C.x, q.y, this.C.z); m.scale.setScalar(cell * rand(0.5, 0.8));
      this.add(m);
      const out = q.clone().sub(p).setY(0).normalize().multiplyScalar(rand(1, 4)).addScaledVector(_w.set(q.x - this.C.x, 0, q.z - this.C.z).normalize(), rand(1, 3));
      this.shards.push({ m, v: out.setY(rand(0.5, 3)), w: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)) });
    }
    fx.flash(this.center, this.pal.core, this.W * 0.3, 0.2, 3); fx.shockwave(this.center, this.W, 0.8, 0.4);
    this.g.audio.impact(this.el, 0.7, this.center, this.look);
  }
  update(dt) {
    this.t += dt;
    const fx = this.g.fx, u = this.mat.uniforms;
    if (!this.endT && this.t > this.life) { this.endT = this.t; const i = this.sys.barriers.indexOf(this.barrier); if (i >= 0) this.sys.barriers.splice(i, 1); this.g.audio.whoosh(0.4); }
    const out = this.endT ? clamp((this.t - this.endT) / 0.6) : 0;
    this.reveal = clamp((this.t - 0.15) / 0.45);
    u.uReveal.value = this.reveal; u.uDissolve.value = out; u.uDamage.value = 1 - Math.max(0, this.hp) / this.maxHp;
    this.seam.material.opacity = clamp(this.t / 0.15) * (1 - out) * (0.7 + Math.sin(this.t * 4) * 0.15);
    const up = clamp(this.t / 0.2) * (1 - out);
    this.anchors.forEach((m, i) => { m.position.copy(m.userData.lp).setY(0.25 + (0.8 + Math.sin(this.t * 2 + i * 2) * 0.08) * up); m.rotation.y += dt * 1.6; m.visible = up > 0.01; });
    if (!this.endT) {
      if (this.reveal < 1) for (let i = 0; i < 4; i++) { // the pane is drawn upward from its anchors
        const q = this.paneWorld(Math.random() < 0.5 ? 0 : 1, Math.random() * this.reveal);
        fx.glow.emit({ x: q.x, y: q.y, z: q.z, vx: 0, vy: rand(0.5, 2), vz: 0, life: 0.5, size: 0.22, color: this.pal.core, alpha: 1, drag: 1, frame: 1 });
      }
      if (Math.random() < 0.5) { const q = this.paneWorld(Math.random(), Math.random() * 0.8); fx.glow.emit({ x: q.x, y: q.y, z: q.z, vx: 0, vy: rand(0.3, 1), vz: 0, life: 1.2, size: 0.12, color: Math.random() < 0.5 ? this.pal.core : this.pal.color, alpha: 0.9, drag: 0.5, frame: 1 }); }
      this.light(this.center, 40 * this.reveal, this.W);
    }
    for (const s of this.shards) {
      s.v.y -= 12 * dt; s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
      s.m.material.opacity = 0.8 * (1 - clamp((this.t - this.endT - 0.8) / 0.7));
    }
    if (this.endT && this.t > this.endT + (this.broken ? 1.6 : 0.7)) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
  dispose() { super.dispose(); const i = this.sys.barriers.indexOf(this.barrier); if (i >= 0) this.sys.barriers.splice(i, 1); }
}

// ------------------------------------------------------------ 10. VORTEX
class VortexSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, aim = this.caster.getAim();
    const eye = this.caster.eye(new THREE.Vector3());
    const d = Math.min(45, eye.distanceTo(aim.point));
    this.center = eye.clone().addScaledVector(aim.dir, d);
    this.center.y = Math.max(this.center.y, this.g.world.heightAt(this.center.x, this.center.z) + 1.8);
    this.R = (2 + s.size * 4) * (0.6 + this.m * 0.5) * this.look.sx;
    this.life = 2.5 + s.duration * 4 + this.m;
    this.core = this.add(new THREE.Mesh(SPHERE, this.el === 'darkness' || this.el === 'arcane' ? new THREE.MeshBasicMaterial({ color: 0x000000 }) : energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 3, noiseAmp: 0.2, flow: 5 })));
    this.rim = this.add(new THREE.Mesh(SPHERE_LO, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 2.5, noiseAmp: 0.15, rimPower: 3, opacity: 0.9 })));
    // accretion disk: spiral arms of the element's matter flowing inward (uv.y runs from the rim to the centre)
    this.kit = kitOf(this.el, this.look);
    // a whirlpool bowl: raised churning lip, then the matter slopes down into the eye (reads as a sink, not a flat disc)
    const dp = []; for (let k = 0; k <= 24; k++) { const t = k / 24; dp.push(new THREE.Vector2(1.6 - t * 1.4, Math.sin(t * Math.PI) * 0.14 * (1 - t) - 0.5 * t * t)); }
    const dm = surfaceMaterial({ ...this.kit, opacity: Math.max(0.85, this.kit.opacity) }, { spin: 2.5 + s.speed * 2, twist: 5 + this.look.g.dispersion * 4, bulge: 0.06 });
    dm.uniforms.uFlow.value = 1.2 + s.speed; dm.uniforms.uStreak.value = 3; dm.uniforms.uTopFade.value = 1;
    this.disk = this.add(new THREE.Mesh(new THREE.LatheGeometry(dp, 72), dm)); this.disk.renderOrder = 3;
    this.disk.userData.ownGeo = true;
    if (this.kit.energy > 0.3) { this.diskGlow = new THREE.Mesh(this.disk.geometry, surfaceMaterial(this.kit, { spin: 3, twist: 6, bulge: 0.04, energyOnly: true })); this.diskGlow.material.uniforms.uFlow.value = 1.5; this.disk.add(this.diskGlow); }
    if (!(this.el === 'darkness' || this.el === 'arcane')) { this.core.geometry = SMOOTH; this.core.material.dispose(); this.core.material = surfaceMaterial({ ...this.kit, opacity: 1 }, { spin: 3, twist: 3, bulge: 0.2 }); this.core.material.uniforms.uTopFade.value = 0; this.core.renderOrder = 3; }
    this.disk.rotation.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
    // flecks caught in the pull: chips of the matter spiralling inward, faster as they near the eye
    const K = this.kit, glowF = clamp(K.heat * 1.2 + K.energy * 0.8), nF = Math.round(26 * (0.6 + this.m * 0.6));
    this.flecks = new THREE.InstancedMesh(this.look.g.sharpness > 0.65 || this.el === 'ice' ? OCTA : FLECK, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, emissive: glowF > 0.3 ? this.pal.color : 0x000000, emissiveIntensity: glowF * 2.2 }), nF);
    this.flecks.frustumCulled = false; this.flecks.userData.noAO = true;
    const fp = glowF > 0.3 ? [this.pal.color, this.pal.core, K.dark] : [K.dark, K.body, K.hi];
    this.fl = []; for (let i = 0; i < nF; i++) { this.flecks.setColorAt(i, pick(fp)); this.fl.push({ a: rand(0, TAU), r: rand(0.3, 1.7), sz: rand(0.05, 0.1), rx: rand(0, TAU), t: rand(4, 10) }); }
    this.disk.add(this.flecks); this._fo = new THREE.Object3D();
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.R * 1.5 });
    this.mc.group.rotation.x = -Math.PI / 2; this.mc.group.position.copy(this.center).setY(this.g.world.heightAt(this.center.x, this.center.z) + 0.2); this.add(this.mc.group);
    this.tick = 0;
    this.loopSnd = this.g.audio.loop('darkness', this.center, 0.7, this.look);
    this.lens = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), distortLensMaterial()); this.lens.userData.ownGeo = true;
    this.lens.position.copy(this.center); this.g.fx.distortScene.add(this.lens);
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, c = this.center;
    const grow = clamp(this.t / 0.5), collapse = clamp((this.t - this.life) / 0.25);
    const sc = grow * (1 - collapse);
    this.core.position.copy(c); this.core.scale.setScalar(this.R * 0.35 * sc + 0.01);
    this.lens.quaternion.copy(this.g.camera.quaternion); this.lens.scale.setScalar(this.R * 1.6 * sc + 0.01); this.lens.material.uniforms.uStrength.value = sc;
    this.rim.position.copy(c); this.rim.scale.setScalar(this.R * 0.45 * sc + 0.01);
    this.disk.position.copy(c); this.disk.scale.set(this.R * 1.1 * sc + 0.01, this.R * sc + 0.01, this.R * 1.1 * sc + 0.01); this.disk.rotation.y += dt * (2 + s.speed * 3);
    this.rim.material.uniforms.uOpacity.value = 0.5 * (0.3 + this.kit.energy);
    for (let i = 0; i < this.fl.length; i++) { // local disk space: r shrinks, angular speed ~ 1/r
      const f = this.fl[i], o = this._fo; f.r -= dt * (0.25 + s.speed * 0.3) * (0.4 + 1 / (f.r + 0.3)) * 0.3; f.a += dt * (1.5 + s.speed * 2) / (f.r + 0.25);
      if (f.r < 0.2) { f.r = rand(1.4, 1.8); f.a = rand(0, TAU); }
      const t = clamp((1.6 - f.r) / 1.4); o.position.set(Math.cos(f.a) * f.r, Math.sin(t * Math.PI) * 0.14 * (1 - t) - 0.5 * t * t + 0.06, Math.sin(f.a) * f.r);
      f.rx += dt * f.t; o.rotation.set(f.rx, f.a, f.rx * 0.6); o.scale.setScalar(f.sz * Math.min(1, f.r * 2)); o.updateMatrix(); this.flecks.setMatrixAt(i, o.matrix);
    }
    this.flecks.instanceMatrix.needsUpdate = true;
    this.mc.update(dt); this.mc.target = collapse > 0 ? 0 : 1;
    if (this.t < this.life) {
      this.g.fx.attractors.push({ x: c.x, y: c.y, z: c.z, r2: (this.R * 4) ** 2, k: 45 + s.weight * 30, swirl: 2 });
      for (let i = 0; i < 4 + this.m * 4; i++) {
        const d = new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).normalize().multiplyScalar(this.R * rand(2, 3.5));
        this.g.fx.glow.emit({ x: c.x + d.x, y: c.y + d.y, z: c.z + d.z, vx: -d.z, vy: 0, vz: d.x, life: 0.9, size: rand(0.1, 0.35), color: Math.random() < 0.5 ? this.pal.core : this.pal.color, alpha: 1, drag: 0.4, frame: 1 });
      }
      if (Math.random() < 0.3) this.g.fx.smoke.emit({ x: c.x + rand(-1, 1) * this.R * 2, y: c.y + rand(-1, 1) * this.R, z: c.z + rand(-1, 1) * this.R * 2, life: 1.2, size: 1, size1: 0.2, color: new THREE.Color(0x0c0414), alpha: 0.4, drag: 0.2, frame: 2 });
      this.tick -= dt;
      for (const t of this.targets()) {
        const tc = t.center(), d = tc.distanceTo(c);
        if (d < this.R * 3.2) {
          const k = 1 - d / (this.R * 3.2);
          const pull = c.clone().sub(tc).normalize().multiplyScalar((20 + s.weight * 20) * k * dt);
          t.vel.add(pull);
          if (this.tick <= 0 && d < this.R * 1.4) this.hit(t, 12, tc);
        }
      }
      if (this.tick <= 0) this.tick = 0.3;
      this.light(c, 250, this.R * 4);
    }
    if (collapse >= 1 && !this.done) {
      this.done = true; this.loopSnd?.stop(); this.loopSnd = null;
      this.explode(c, this.R * 1.4, 60, { knock: 12, lift: 6 });
      if (s.payload && !['explode', 'none', 'implode'].includes(s.payload)) runPayload(this, c.clone(), this.R, null, 40);
      this.remove(this.core); this.remove(this.rim); this.remove(this.disk);
      this.g.fx.distortScene.remove(this.lens);
    }
    this.updateCommon(dt);
    return !this.finished() || this.mc.opacity > 0.02;
  }
}

// ------------------------------------------------------------ 11. CHAIN (instant strikes)
class ChainSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.strikes = Math.round(clamp(1 + s.count * 4 + this.m * 1.5, 1, 7));
    this.interval = 0.16 - s.speed * 0.08; this.next = 0.05; this.n = 0;
    this.width = 0.08 + this.m * 0.14 + s.size * 0.08;
  }
  update(dt) {
    this.t += dt; this.next -= dt;
    const s = this.spec;
    if (this.n < this.strikes && this.next <= 0) {
      this.next = this.interval; this.n++;
      const origin = this.sys.castOrigin(this.caster).clone(), aim = this.caster.getAim();
      const target = this.nearestTarget(origin, aim.dir, 0.86, 60);
      let end = target ? target.center() : aim.point.clone();
      const rc = this.g.world.raycast(origin, end.clone().sub(origin).normalize(), origin.distanceTo(end), 0.6);
      let blocked = rc.hit && rc.dist < origin.distanceTo(end) - 0.8;
      if (blocked) end = rc.point;
      const bh = this.barrierHit(origin, end);
      if (bh) { end = origin.clone().lerp(end, bh.t); bh.bar.damage(25 * s.dmgMult, end); blocked = true; }
      const jag = this.el === 'lightning' ? 0.2 + s.chaos * 0.2 : 0.06 + s.chaos * 0.2;
      // proportions pick the strike pattern: tall → called down from the sky, low → crawls along the ground, wide → forks
      const L = this.look, sky = clamp(L.sy - 1.15), crawl = clamp((0.85 - L.sy) * 3);
      let from = origin;
      if (Math.random() < sky) from = end.clone().add(new THREE.Vector3(rand(-2, 2), 10 + L.sy * 8, rand(-2, 2)));
      else if (crawl > 0.3) { from = this.caster.pos.clone().addScaledVector(aim.dir.clone().setY(0).normalize(), 1.2); from.y = this.g.world.heightAt(from.x, from.z) + 0.2; const e2 = end.clone(); e2.y = Math.min(e2.y, this.g.world.heightAt(e2.x, e2.z) + 0.6); end = e2; }
      this.g.fx.bolt(from, end, this.pal.color, { look: this.look, width: this.width, dur: 0.22 + this.m * 0.1, jag: crawl > 0.3 ? jag * 0.5 : jag, branches: this.el === 'lightning' ? 3 : 1 });
      for (let f = 0; f < Math.round(clamp(L.sx - 1.1, 0, 1.5) * 3); f++) {
        const e = end.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(2 + L.sx * 2)); e.y = this.g.world.heightAt(e.x, e.z);
        this.g.fx.bolt(end, e, this.pal.color, { look: this.look, width: this.width * 0.6, dur: 0.2, jag, branches: 1 });
        this.g.fx.explosion(this.el, e, 0.5 + this.m * 0.4, 0.15, this.pal, { noDecal: true, look: this.look });
      }
      this.g.fx.explosion(this.el, end, 0.8 + this.m * 0.8, 0.25, this.pal, { look: this.look, noDecal: this.n > 1 });
      this.g.audio.impact(this.el === 'lightning' ? 'lightning' : this.el, 0.35 + this.m * 0.3, end, this.look);
      if (target && !blocked) this.hit(target, 30, end, { stun: this.el === 'lightning' ? 0.15 : 0 });
      // final smite from the sky for high tiers
      if (this.n === this.strikes && s.tierInt >= 5 && target && !blocked) {
        const top = end.clone().add(new THREE.Vector3(rand(-3, 3), 30, rand(-3, 3)));
        this.g.fx.bolt(top, end, this.pal.core, { look: this.look, width: this.width * 2.5, dur: 0.4, jag: 0.15, branches: 4 });
        this.explode(end, 2 + this.m * 2, 30);
        this.g.fx.addShake(0.3, end);
        escalateImpact(this, end, 2 + this.m, target);
      }
      this.light(end, 800, 30);
    }
    if (this.n >= this.strikes && this.t > this.strikes * this.interval + 0.5) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ------------------------------------------------------------ 12. STORM (area rain)
class StormSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, aim = this.caster.getAim();
    this.center = aim.point.clone(); this.center.y = this.g.world.heightAt(this.center.x, this.center.z);
    this.R = (4.5 + s.size * 7) * (0.6 + this.m * 0.5) * this.look.sx;
    this.life = 3 + s.duration * 5 + this.m;
    this.rate = 8 + s.count * 22 + this.m * 8;
    this.cloudY = this.center.y + (13 + this.m * 4) * Math.sqrt(this.look.sy);
    this.drops = []; this.acc = 0; this.boltT = 0.4;
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.R });
    this.mc.group.rotation.x = Math.PI / 2; this.mc.group.position.set(this.center.x, this.cloudY - 0.5, this.center.z); this.add(this.mc.group);
    this.ground = new MagicCircle({ seed: s.seed + 3, tier: 2, color: this.pal.color, radius: this.R, intensity: 0.8 });
    this.ground.group.rotation.x = -Math.PI / 2; this.ground.group.position.copy(this.center).y += 0.2; this.add(this.ground.group);
    this.cloudCol = (['lightning', 'water', 'darkness'].includes(this.el) ? new THREE.Color(0x2a2a3a) : this.el === 'fire' ? new THREE.Color(0x4a1a10) : new THREE.Color(0xe8eef8))
      .lerp(this.pal.smoke, ['poison', 'arcane', 'nature', 'earth', 'light'].includes(this.el) ? 0.75 : 0.25); // toxic smog, violet aether, pollen, dust…
    // churning cloud shelf: gas matter from the kit, darker and denser for heavy storms, glowing inside for charged ones
    this.kit = kitOf(this.el, this.look);
    const ck = { ...this.kit, mix: new THREE.Vector4(0, this.kit.mix.y * 0.4, 1, 0.05), opacity: 0.75 + this.look.g.density * 0.25, body: this.kit.body.clone().lerp(this.cloudCol, 0.5), dark: this.kit.dark.clone().lerp(this.cloudCol, 0.4).multiplyScalar(0.7) };
    const cp = []; for (let k = 0; k <= 20; k++) { const t = k / 20; cp.push(new THREE.Vector2(0.05 + t * 1.25, Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.22 - t * 0.04)); }
    this.cloud = this.add(new THREE.Mesh(new THREE.LatheGeometry(cp, 64), surfaceMaterial(ck, { spin: 0.3, twist: 0.6, bulge: 0.12 })));
    this.cloud.userData.ownGeo = true; this.cloud.renderOrder = 4; this.cloud.material.uniforms.uTopFade.value = 0; this.cloud.material.uniforms.uFlow.value = 0.25;
    this.cloud.position.set(this.center.x, this.cloudY + 0.5, this.center.z); this.cloud.scale.set(this.R * 1.25, this.R * 0.35 * this.look.sy, this.R * 1.25);
    this.loopSnd = this.g.audio.loop(this.el === 'fire' ? 'fire' : 'water', this.center, 0.4, this.look);
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, active = this.t > 0.6 && this.t < this.life;
    this.mc.update(dt); this.ground.update(dt);
    this.mc.target = this.ground.target = this.t < this.life ? 1 : 0;
    this.cloud.rotation.y += dt * 0.25; this.cloud.material.uniforms.uFade.value = clamp(this.t / 0.6) * clamp((this.life + 0.8 - this.t) / 0.8);
    if (this.kit.energy > 0.5 && Math.random() < 0.08) { const a = rand(0, TAU), r = rand(0, this.R); const p = new THREE.Vector3(this.center.x + Math.cos(a) * r, this.cloudY + 0.3, this.center.z + Math.sin(a) * r); this.g.fx.bolt(p, p.clone().add(new THREE.Vector3(rand(-4, 4), rand(-1, 0.5), rand(-4, 4))), this.pal.color, { look: this.look, width: 0.06, dur: 0.15, jag: 0.25, branches: 1 }); }
    if (this.t < this.life) for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * this.R * 1.1;
      this.g.fx.smoke.emit({ x: this.center.x + Math.cos(a) * r, y: this.cloudY + rand(-0.5, 1.5), z: this.center.z + Math.sin(a) * r, vx: rand(-0.5, 0.5), vy: rand(-0.1, 0.2), vz: rand(-0.5, 0.5), life: 2.5, size: 3, size1: 5, color: this.cloudCol, alpha: 0.45, drag: 0.5, frame: 2, spin: rand(-0.3, 0.3) });
    }
    if (active) {
      this.acc += dt * this.rate;
      while (this.acc >= 1) {
        this.acc--;
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * this.R;
        this.drops.push({ p: new THREE.Vector3(this.center.x + Math.cos(a) * r, this.cloudY, this.center.z + Math.sin(a) * r), v: new THREE.Vector3(rand(-1, 1), -(22 + s.speed * 18), rand(-1, 1)) });
      }
      if (this.el === 'lightning') {
        this.boltT -= dt;
        if (this.boltT <= 0) {
          this.boltT = 0.5 - s.count * 0.25;
          let target = null;
          for (const t of this.targets()) if (Math.hypot(t.pos.x - this.center.x, t.pos.z - this.center.z) < this.R && Math.random() < 0.55) target = t;
          const end = target ? target.center() : this.center.clone().add(new THREE.Vector3(rand(-1, 1) * this.R, 0, rand(-1, 1) * this.R));
          if (!target) end.y = this.g.world.heightAt(end.x, end.z);
          this.g.fx.bolt(new THREE.Vector3(end.x + rand(-2, 2), this.cloudY, end.z + rand(-2, 2)), end, this.pal.color, { look: this.look, width: 0.15 + this.m * 0.1, dur: 0.3, jag: 0.15, branches: 3 });
          this.g.fx.explosion('lightning', end, 1.5, 0.3, this.pal, { look: this.look,});
          this.g.audio.impact('lightning', 0.5, end, this.look);
          if (target) this.hit(target, 22, end);
        }
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.p.addScaledVector(d.v, dt);
      const el = this.el;
      if (el === 'water' || el === 'lightning') this.g.fx.sparks.emit(d.p.x, d.p.y, d.p.z, d.v.x, d.v.y, d.v.z, 0.06, this.pal.color, 0, 0.03);
      else this.g.fx.element(el, d.p, { count: 1, speed: 0.3, size: 0.3 * (0.6 + this.m), palette: this.pal, look: this.look });
      let hit = null;
      for (const t of this.targets()) if (t.hits(d.p, 0.3)) hit = t;
      const gy = this.g.world.heightAt(d.p.x, d.p.z);
      if (hit || d.p.y < gy) {
        if (hit) this.hit(hit, 7, d.p);
        if (Math.random() < 0.35) this.g.fx.explosion(el, d.p.clone().setY(Math.max(gy, d.p.y) + 0.1), 0.5, 0.05, this.pal, { look: this.look, noDecal: true });
        else this.g.fx.element(el, d.p.clone().setY(gy + 0.2), { count: 2, speed: 2, size: 0.2, palette: this.pal, look: this.look });
        this.drops.splice(i, 1);
      }
    }
    this.light(this.center.clone().setY(this.cloudY - 2), 120, this.R * 3);
    if (this.t > this.life + 0.8 && !this.drops.length && !this.done) { this.done = true; this.loopSnd?.stop(); this.loopSnd = null; }
    this.updateCommon(dt);
    return !this.finished();
  }
  threats() { return this.t < this.life ? [{ pos: this.center, vel: new THREE.Vector3(), radius: this.R, area: true }] : []; }
}

// ------------------------------------------------------------ 13. CRESCENT
const crescentMat = (color, core) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(color) }, uCore: { value: new THREE.Color(core) }, uAlpha: { value: 1 }, uTime: TIME },
  vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: `uniform vec3 uColor,uCore; uniform float uAlpha,uTime; varying vec3 vP;
    void main(){ float r=length(vP.xy); float a=atan(vP.x,vP.y); float tip=smoothstep(1.3,0.2,abs(a));
      float edge=smoothstep(0.8,1.0,r); float inner=smoothstep(0.8,0.9,r)*smoothstep(1.0,0.97,r);
      float n=0.7+0.3*sin(a*30.0-uTime*40.0);
      vec3 c=mix(uColor,uCore,edge); float al=tip*(0.25+edge*0.9+inner)*n*uAlpha; gl_FragColor=vec4(c*3.0*al,al); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
// crescent blade body: arc in the XY plane (centred on +Y), thick in the middle, tapering to the tips.
// uv.y runs tip→tip along the arc (so tips fade and matter streams along the swing), uv.x runs inner→outer edge.
function bladeGeo(thick, spanA = 2.6) {
  const NU = 40, NV = 6, pos = [], uv = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, a = Math.PI / 2 - spanA / 2 + u * spanA, taper = Math.pow(Math.sin(u * Math.PI), 0.7);
    for (let j = 0; j <= NV; j++) { const v = j / NV, r = 1 - thick * taper * (1 - v); pos.push(Math.cos(a) * r, Math.sin(a) * r - 0.55, -(1 - Math.sin(a)) * 0.7); uv.push(v, u); } // faces the viewer, tips swept back
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a0 = i * (NV + 1) + j, b0 = a0 + NV + 1; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
class CrescentSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec;
    this.kit = kitOf(this.el, this.look);
    this.n = s.count > 0.45 ? 1 + Math.round((s.count - 0.45) * 4) : 1;
    this.W = (2.6 + s.size * 5) * (0.6 + this.m * 0.5) * this.look.sx;
    this.speed = 22 + s.speed * 30;
    this.blades = []; this.launched = 0; this.next = 0;
  }
  launch(i) {
    const aim = this.caster.getAim(), origin = this.sys.castOrigin(this.caster).clone();
    const dir = aim.point.clone().sub(origin).normalize();
    // arc centred on +Y in the XY plane; rotating the mesh +90° about X points it along +Z (travel direction)
    // body of matter (flame blade, water slash, stone sickle, frost edge, wind cutter…) + a thin bright leading edge
    const G = this.look.g, geo = bladeGeo(0.34 - G.sharpness * 0.2 + G.density * 0.08);
    const bm = surfaceMaterial({ ...this.kit, opacity: Math.max(0.85, this.kit.opacity) }, { spin: 0, twist: 0, bulge: 0 });
    bm.uniforms.uFlow.value = 4 + this.spec.speed * 4; bm.uniforms.uStreak.value = 2; bm.uniforms.uTopFade.value = 1; bm.uniforms.uFoam.value = 0.15;
    const mesh = new THREE.Mesh(geo, bm); mesh.userData.ownGeo = true; mesh.renderOrder = 3;
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.03, 48, 1, Math.PI / 2 - 1.3, 2.6), crescentMat(this.pal.color, this.pal.core)); edge.userData.ownGeo = true; edge.position.y = -0.55;
    edge.material.uniforms.uAlpha.value = 0.35 + G.sharpness * 0.5;
    const g = new THREE.Group(); g.add(mesh); mesh.add(edge); this.add(g);
    if (this.kit.energy > 0.3) { const gl = new THREE.Mesh(geo, surfaceMaterial(this.kit, { spin: 0, twist: 0, bulge: 0, energyOnly: true })); gl.material.uniforms.uFlow.value = 5; mesh.add(gl); }
    mesh.position.z = -0.6;
    g.position.copy(origin); g.lookAt(origin.clone().add(dir));
    // diagonal slashes read from eye level; tall looks swing vertically, low/wide ones sweep flatter
    const base = clamp(0.65 + (this.look.sy - 1) * 0.9, 0.15, Math.PI / 2);
    const roll = (i % 2 ? 1 : -1) * (base + (this.n > 1 ? i * 0.1 : rand(-0.1, 0.1)));
    g.rotateZ(roll);
    this.blades.push({ g, mesh, dir, age: 0, hit: new Set(), pos: origin.clone() });
    this.g.audio.whoosh(this.m + 0.3);
    this.g.audio.cast(this.el, 0.3, origin, this.look);
  }
  update(dt) {
    this.t += dt; this.next -= dt;
    const s = this.spec;
    if (this.launched < this.n && this.next <= 0) { this.launch(this.launched++); this.next = 0.14; }
    for (let i = this.blades.length - 1; i >= 0; i--) {
      const b = this.blades[i]; b.age += dt;
      const prev = b.pos.clone();
      b.pos.addScaledVector(b.dir, this.speed * dt);
      const gy = this.g.world.heightAt(b.pos.x, b.pos.z); if (b.pos.y < gy + 0.6) b.pos.y = gy + 0.6;
      const w = this.W * (0.5 + Math.min(1, b.age * 3) * 0.5);
      b.g.position.copy(b.pos); b.g.scale.setScalar(w);
      b.mesh.material.uniforms.uFade.value = clamp((1.3 - b.age) / 0.3);
      // sample points on the arc
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(b.g.quaternion);
      for (let k = -2; k <= 2; k++) {
        const p = b.pos.clone().addScaledVector(right, (k / 2) * w * 0.8).addScaledVector(b.dir, -Math.abs(k) * 0.25 * w);
        if (Math.random() < 0.5) this.g.fx.element(this.el, p, { count: 1, speed: 1, size: 0.22 * (0.5 + this.m), palette: this.pal, look: this.look, dir: b.dir.clone().negate(), spread: 0.4 });
        for (const t of this.targets()) if (!b.hit.has(t) && t.hits(p, 0.35)) {
          b.hit.add(t);
          this.hit(t, 62 + s.sharpness * 25, p, { knock: b.dir.clone().multiplyScalar(4 + s.weight * 6) });
          this.g.fx.explosion(this.el, p, 1.2, 0.3, this.pal, { look: this.look, noDecal: true });
          this.g.audio.impact(this.el, 0.4, p, this.look);
        }
      }
      const bh = this.barrierHit(prev, b.pos);
      if (bh) { bh.bar.damage(50 * s.dmgMult, b.pos); b.age = 99; }
      if (this.g.world.solid(b.pos.clone().setY(b.pos.y + 0.3)) && b.pos.y > gy + 0.7) b.age = 99;
      this.light(b.pos, 120, 10);
      if (b.age > 1.3) { if (b.age > 50) this.g.fx.explosion(this.el, b.pos, 1.5, 0.3, this.pal, { look: this.look, noDecal: true }); this.remove(b.g); this.blades.splice(i, 1); }
    }
    if (this.launched >= this.n && !this.blades.length) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
  threats() { return this.blades.map((b) => ({ pos: b.pos, vel: b.dir.clone().multiplyScalar(this.speed), radius: this.W * 0.5 })); }
}

// ------------------------------------------------------------ 14. WARD (self buff)
class WardSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster;
    const healBonus = { light: 1.6, nature: 1.4, water: 1.3 }[this.el] || 0.6;
    const heal = 45 * s.dmgMult * healBonus;
    c.heal(heal);
    c.addShield(80 * s.dmgMult * (this.el === 'earth' ? 1.6 : 1), 6 + s.duration * 8, this.el);
    if (this.el === 'light') { c.aura = null; c.dots.length = 0; c.frozen = 0; }
    if (this.el === 'wind') c.haste = 4 + s.duration * 4;
    this.g.onHeal?.(c, heal);
    this.mcs = [0, 1].map((i) => {
      const mc = new MagicCircle({ seed: s.seed + i, tier: s.tierInt, color: this.pal.color, radius: 1.6 + this.m });
      mc.group.rotation.x = -Math.PI / 2; this.add(mc.group); return mc;
    });
    this.g.audio.cast('light', this.m, c.pos, this.look);
    this.g.audio.cast(this.el, this.m * 0.6, c.pos, this.look);
    this.g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), this.pal.color, 5, 0.6);
    // a shell of the element's matter snaps shut around the caster, with fragments orbiting it
    this.kit = kitOf(this.el, this.look);
    this.shell = this.add(new THREE.Mesh(SMOOTH, surfaceMaterial({ ...this.kit, opacity: 0.8 }, { spin: 2.2, twist: 1.2, bulge: 0.1 + this.look.g.dispersion * 0.15 })));
    this.shell.material.uniforms.uTopFade.value = 0; this.shell.material.uniforms.uBands.value = 3; this.shell.material.uniforms.uGap.value = 0.7; this.shell.renderOrder = 3;
    const solid = this.kit.mix.w > 0.35 || this.look.g.sharpness > 0.7;
    this.orbs = [];
    for (let i = 0; i < 7; i++) {
      const m = solid ? new THREE.Mesh(this.look.g.sharpness > 0.6 ? OCTA : ROCK, crystalMaterial({ color: this.kit.body, glow: this.pal.color, emissive: 0.8, crack: 0.4 }))
        : new THREE.Mesh(SPHERE_LO, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.6, noiseAmp: 0.2 }));
      m.scale.setScalar(solid ? rand(0.15, 0.28) : 0.12); this.add(m); this.orbs.push({ m, a: (i / 7) * TAU, y: rand(0.2, 1.8), s: rand(2.5, 4) * (i % 2 ? 1 : -1) });
    }
  }
  update(dt) {
    this.t += dt;
    const c = this.caster;
    this.mcs.forEach((mc, i) => { mc.group.position.copy(c.pos).y += 0.12 + i * 2.2 * clamp(this.t / 0.4); mc.update(dt); mc.target = this.t < 1.2 ? 1 : 0; });
    if (this.t < 1.2) for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU), r = rand(0.5, 1.2);
      this.g.fx.glow.emit({ x: c.pos.x + Math.cos(a) * r, y: c.pos.y + rand(0, 0.5), z: c.pos.z + Math.sin(a) * r, vx: 0, vy: rand(2, 5), vz: 0, life: 0.9, size: 0.3, color: Math.random() < 0.5 ? this.pal.core : this.pal.color, alpha: 1, drag: 0.5, frame: 1 });
    }
    this.light(c.center(), 150 * clamp(1.2 - this.t), 8);
    const k = clamp(this.t / 0.25), out = clamp((this.t - 1.2) / 0.6), cc = c.center();
    this.shell.position.copy(cc); this.shell.scale.setScalar(1.35 * (0.3 + 0.7 * Math.pow(k, 0.5)) * (1 + out * 0.15)); this.shell.material.uniforms.uFade.value = k * (1 - out);
    for (const o of this.orbs) { o.a += dt * o.s; o.m.position.set(cc.x + Math.cos(o.a) * 1.6, c.pos.y + o.y, cc.z + Math.sin(o.a) * 1.6); o.m.rotation.x += dt * 3; o.m.scale.multiplyScalar(out > 0 ? 1 - dt * 3 : 1); }
    if (this.t > 1.8) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ============================================================ POWER ESCALATION
// Greater spells: aftershock ring + glowing scar. Ultimate spells: a multi-stage cataclysm
// (flash → mushroom blast → arena-wide shockwave → ring of secondary detonations → erupting core → lingering ruin + raining debris).
function escalateImpact(sp, pos, R, target, selfCentered = false) {
  const lvl = sp.level, g = sp.g, fx = g.fx, s = sp.spec, pal = sp.pal;
  if (lvl < 2) return;
  const gy = g.world.groundAt(pos.x, pos.z, pos.y + 1);
  const ground = new THREE.Vector3(pos.x, gy + 0.2, pos.z);
  if (lvl === 2) {
    fx.decal(ground, R * 2.4, sp.el, pal.color);
    for (let i = 1; i <= 2; i++) setTimeout(() => { fx.ring(ground, pal.core, R * (2 + i * 1.2), 0.5); fx.shockwave(ground.clone().setY(gy + 1), R * (3 + i * 2), 0.9, 0.45); if (!selfCentered) sp.aoe(ground, R * (1.2 + i * 0.4), 18); }, 220 * i);
    g.audio.impact(sp.el, 0.7, pos, sp.look);
    return;
  }
  // ---- ULTIMATE
  const RR = R * 1.6 + 2;
  g.screenFlash?.('#' + pal.core.getHexString(), 0.18);
  fx.addShake(1.2, pos);
  fx.blast(sp.el, pos, RR * 1.05, 1.3, pal);
  fx.flash(pos, pal.color, RR * 0.55, 0.3, 2.2);
  fx.shockwave(pos, RR * 9, 2.2, 1.0);
  fx.ring(ground, pal.color, RR * 5, 1.2, null, 0.05);
  fx.ring(ground, pal.core, RR * 3, 0.8, null, 0.1);
  fx.decal(ground, RR * 3.2, sp.el, pal.color);
  if (!selfCentered) sp.aoe(pos, RR * 1.3, 70, { knock: 16, lift: 9, falloff: 0.4 });
  g.audio.impact(sp.el, 1.3, pos, sp.look); g.audio.impact('earth', 1.2, pos, sp.look);
  // mushroom stem + cap of toon smoke
  for (let i = 0; i < 26; i++) fx.puff(ground.clone().add(new THREE.Vector3((Math.random() - 0.5) * RR * 0.5, Math.random() * RR * 1.8, (Math.random() - 0.5) * RR * 0.5)), { color: new THREE.Color(sp.el === 'ice' || sp.el === 'light' || sp.el === 'water' ? 0xeaf4ff : 0x3a302c), size: RR * 0.5, size1: RR * 1.1, life: 3.5, alpha: 0.85, rise: 3 + Math.random() * 4 });
  // ring of secondary detonations
  const n = 6 + Math.round(s.count * 4);
  for (let i = 0; i < n; i++) setTimeout(() => {
    const a = (i / n) * TAU + Math.random() * 0.3, d = RR * (1.2 + Math.random() * 0.8);
    const p = new THREE.Vector3(pos.x + Math.cos(a) * d, 0, pos.z + Math.sin(a) * d); p.y = g.world.heightAt(p.x, p.z) + 0.6;
    fx.explosion(sp.el, p, RR * 0.45, 0.8, pal, {});
    if (!selfCentered) sp.aoe(p, RR * 0.5, 14);
  }, 250 + i * 70);
  // erupting core, lingering ruin, raining debris
  setTimeout(() => runPayload(sp, ground.clone(), RR * 0.6, null, 40, 1, null, 'erupt'), 450);
  if (!selfCentered) setTimeout(() => sp.sys.spawnField(s, sp.caster, ground.clone(), RR * 1.2, 5 + s.duration * 4), 600);
  for (let i = 0; i < 10; i++) {
    const dir = new THREE.Vector3(Math.cos((i / 10) * TAU), 1.6 + Math.random(), Math.sin((i / 10) * TAU)).normalize();
    setTimeout(() => fragment(sp, pos.clone().addScaledVector(dir, 1), dir.multiplyScalar(12 + Math.random() * 10), RR * 0.2, 15), 150 + Math.random() * 300);
  }
}

// ============================================================ PROCEDURAL MISSILE ENGINE
// A spell is composed from independent genes: pattern (how many / from where) × trajectory (how it moves)
// × morph (what it looks like) × payload (what happens on impact) × element(s) × continuous parameters.

const STAR_GEO = (() => {
  const sh = new THREE.Shape();
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * TAU + Math.PI / 2, r = i % 2 ? 0.42 : 1; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 1 }); g.center(); return g;
})();
const LANCE_GEO = (() => { const g = new THREE.ConeGeometry(0.28, 2.8, 7); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.3); return g; })();
const BLADE_GEO = (() => { const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.12, 0.55, 1.5); return g; })();
const TORUS_GEO = new THREE.TorusGeometry(1, 0.13, 8, 36);
const BOX_GEO = new THREE.BoxGeometry(1.3, 1.3, 1.3);
const CONE_SM = (() => { const g = new THREE.ConeGeometry(0.22, 0.8, 6); g.rotateX(-Math.PI / 2); return g; })();

function morphMaterial(sp, solid) {
  const { el, pal } = sp, G = sp.look?.g;
  // dense or crystalline spells make solid weapons; the matter colour comes from the look (lava rock, gem, soot…)
  if (solid && G && (G.density > 0.6 || ['ice', 'earth', 'light', 'arcane'].includes(el))) {
    const hot = clamp((G.temperature - 0.55) / 0.3);
    return crystalMaterial({ color: G.sharpness > 0.65 ? pal.color.clone().lerp(new THREE.Color(0xffffff), 0.45) : pal.smoke.clone().lerp(pal.dark, 0.3), glow: pal.color, emissive: 0.8 + hot * 1.6 + G.luminosity * 0.6, crack: 0.3 + hot * 0.5 });
  }
  if (solid && (el === 'ice' || el === 'earth' || el === 'light' || el === 'arcane')) return crystalMaterial({ color: el === 'earth' ? 0x6a5238 : el === 'ice' ? 0xaee4ff : pal.dark, glow: pal.color, emissive: 1.6, crack: 0.45 });
  return energyMaterial({ color: pal.color, core: pal.core, intensity: 2.2 * (sp.look?.intensity ?? 1), noiseAmp: 0.08 + (G ? (1 - G.sharpness) * 0.15 : 0), noiseFreq: 2.5, flow: 3 });
}
// Build the visual body of one missile. Returns a Group; userData.orient → face travel direction.
function morphMesh(sp, r, rng) {
  const s = sp.spec, kind = s.morph, g = new THREE.Group(); g.userData.orient = true;
  const halo = () => { const h = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: sp.pal.color, core: sp.pal.core, intensity: 1.1, noiseAmp: 0.3, opacity: 0.35 })); return h; };
  switch (kind) {
    case 'lance': { const m = new THREE.Mesh(LANCE_GEO, morphMaterial(sp, true)); g.add(m); const h = halo(); h.scale.set(0.45, 0.45, 1.8); g.add(h); break; }
    case 'shard': for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(OCTA, morphMaterial(sp, true)); m.scale.set(0.28, 0.28, 0.9 + rng() * 0.5); m.position.set((rng() - 0.5) * 0.7, (rng() - 0.5) * 0.7, (rng() - 0.5) * 0.4); m.rotation.z = rng() * TAU; g.add(m); } break;
    case 'disc': { g.userData.orient = false; g.userData.spinY = 16; const t = new THREE.Mesh(TORUS_GEO, morphMaterial(sp, true)); t.rotation.x = Math.PI / 2; g.add(t); const d = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), energyMaterial({ color: sp.pal.color, core: sp.pal.core, intensity: 1.2, noiseAmp: 0, opacity: 0.5 })); d.rotation.x = -Math.PI / 2; d.userData.ownGeo = true; g.add(d); for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(CONE_SM, morphMaterial(sp, true)); const a = (i / 6) * TAU; b.position.set(Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05); b.lookAt(Math.cos(a + 1.2) * 3, 0, Math.sin(a + 1.2) * 3); g.add(b); } break; }
    case 'star': { const m = new THREE.Mesh(STAR_GEO, morphMaterial(sp, true)); g.add(m); g.userData.spinZ = 9; g.add(halo()); break; }
    case 'blade': { const m = new THREE.Mesh(BLADE_GEO, morphMaterial(sp, true)); g.add(m); const h = halo(); h.scale.set(0.2, 0.7, 1.8); g.add(h); g.userData.roll = rng() * TAU; break; }
    case 'dragon': {
      const mat = morphMaterial(sp, false);
      const head = new THREE.Mesh(SPHERE, mat); head.scale.set(0.7, 0.55, 1.25); g.add(head);
      const jaw = new THREE.Mesh(CONE_SM, mat); jaw.scale.set(2.2, 1.2, 1.6); jaw.position.set(0, -0.2, 0.9); g.add(jaw);
      for (const x of [-1, 1]) {
        const horn = new THREE.Mesh(CONE_SM, crystalMaterial({ color: sp.pal.dark, glow: sp.pal.color, emissive: 1.2 })); horn.scale.set(0.9, 0.9, 1.6); horn.position.set(x * 0.35, 0.45, -0.5); horn.rotation.x = 0.6; g.add(horn);
        const eye = new THREE.Mesh(SPHERE_LO, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(4) })); eye.scale.setScalar(0.1); eye.position.set(x * 0.3, 0.15, 0.7); g.add(eye);
      }
      g.userData.dragon = true; break;
    }
    case 'skull': {
      const skull = new THREE.Mesh(SPHERE, energyMaterial({ color: sp.pal.color, core: 0xffffff, intensity: 1.8, noiseAmp: 0.1 })); skull.scale.set(0.9, 0.95, 1); g.add(skull);
      for (const x of [-1, 1]) { const e = new THREE.Mesh(SPHERE_LO, new THREE.MeshBasicMaterial({ color: 0x000000 })); e.scale.setScalar(0.24); e.position.set(x * 0.32, 0.12, 0.72); g.add(e); const p = new THREE.Mesh(SPHERE_LO, new THREE.MeshBasicMaterial({ color: sp.pal.core.clone().multiplyScalar(5) })); p.scale.setScalar(0.07); p.position.set(x * 0.32, 0.12, 0.88); g.add(p); }
      const jaw = new THREE.Mesh(BOX_GEO, energyMaterial({ color: sp.pal.color, intensity: 1.4, noiseAmp: 0 })); jaw.scale.set(0.5, 0.22, 0.4); jaw.position.set(0, -0.62, 0.35); g.add(jaw);
      g.userData.wail = true; break;
    }
    case 'bubble': { const m = new THREE.Mesh(SPHERE, energyMaterial({ color: sp.pal.color, core: 0xffffff, intensity: 1.3, noiseAmp: 0.05, rimPower: 3.5, opacity: 0.8 })); g.add(m); const hi = new THREE.Mesh(SPHERE_LO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })); hi.scale.setScalar(0.18); hi.position.set(-0.4, 0.45, 0.5); g.add(hi); g.userData.wobble = true; g.userData.orient = false; break; }
    case 'cube': { const m = new THREE.Mesh(BOX_GEO, morphMaterial(sp, true)); g.add(m); const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), energyMaterial({ color: sp.pal.color, intensity: 1, noiseAmp: 0, opacity: 0.25 })); w.userData.ownGeo = true; g.add(w); g.userData.tumble = true; g.userData.orient = false; break; }
    default: { const c = coreMesh(sp.el, sp.pal, 1, s, sp.look); g.add(c); g.userData.orient = !!c.userData.comet; g.userData.core = c; } // comet skins face their flight
  }
  // non-orb morphs trail a comet sheath of their matter so a lance of fire reads as fire, not a thin stick
  if (sp.look && !s.basic && kind && kind !== 'orb' && g.userData.orient !== false) {
    const sk = new THREE.Mesh(COMET, surfaceMaterial({ ...kitOf(sp.el, sp.look), opacity: 0.7 }, { spin: 2.5, twist: 1.2, bulge: 0.15 }));
    sk.material.uniforms.uTopFade.value = 1; sk.material.uniforms.uFlow.value = 3.5; sk.renderOrder = 3;
    sk.scale.set(0.55, 0.55, kind === 'lance' || kind === 'blade' ? 1.5 : 1.0); sk.position.z = -0.2; g.add(sk);
  }
  // seeded flourish: orbiting satellites
  const nSat = Math.floor(rng() * 4 * (0.4 + s.chaos));
  g.userData.sats = [];
  for (let i = 0; i < nSat; i++) { const m = new THREE.Mesh(OCTA, energyMaterial({ color: sp.pal.core, intensity: 3, noiseAmp: 0 })); m.scale.setScalar(0.14); g.add(m); g.userData.sats.push({ m, a: rng() * TAU, sp: 4 + rng() * 6, tilt: rng() * Math.PI }); }
  g.scale.setScalar(r * (kind && kind !== 'orb' && !s.basic ? 1.35 : 1));
  return g;
}

class Missile {
  constructor(sp, o) {
    Object.assign(this, o);
    this.sp = sp; this.age = -(o.delay || 0); this.alive = true; this.launched = false;
    this.base = o.pos.clone(); this.pos = o.pos.clone(); this.prev = o.pos.clone();
    this.vel = o.dir.clone().multiplyScalar(o.speed);
    const up = Math.abs(o.dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : _up;
    this.u = new THREE.Vector3().crossVectors(o.dir, up).normalize(); this.v = new THREE.Vector3().crossVectors(this.u, o.dir).normalize();
    this.phase = sp.rng() * TAU; this.hitSet = new Set();
  }
  launch() {
    const sp = this.sp, s = sp.spec;
    this.launched = true;
    this.mesh = sp.add(morphMesh(sp, this.r, sp.rng));
    this.mesh.position.copy(this.pos);
    const tw = s.morph === 'dragon' ? this.r * 1.3 : this.r * 0.9;
    const L = sp.look; // trail: wider with width, longer when dispersed / lingering, brighter with luminosity
    this.trail = sp.trail(sp.pal.color, s.basic ? sp.pal.core : sp.pal.color.clone().lerp(sp.pal.core, 0.35), tw * (s.basic ? 1 : Math.sqrt(L.sx)) * 0.8, s.morph === 'dragon' ? 42 : s.basic ? 10 : Math.round(14 + L.g.dispersion * 14 + L.lingerMul * 5), (1.4 + sp.m) * (s.basic ? 1.4 : L.intensity));
    if (s.morph === 'dragon') this.trail2 = sp.trail(sp.pal.core, 0xffffff, tw * 0.35, 42, 3);
    if (this.traj === 'arc') { // ballistic solve to land on the aim point
      const d = this.aimPoint.clone().sub(this.pos), flat = Math.hypot(d.x, d.z), hs = Math.max(10, this.speed * 0.6), T = Math.max(0.4, flat / hs);
      this.g = 16; this.vel.set((d.x / flat) * hs, (d.y + 0.5 * this.g * T * T) / T, (d.z / flat) * hs);
    }
    if (this.traj === 'orbit') { this.orbitT = 0.55 + sp.rng() * 0.25; this.orbitA = this.orbitIndex * (TAU / Math.max(1, this.n)); }
    if (sp.look.g.temperature > 0.62 && !s.basic && this.r > 0.3) this.haze = sp.g.fx.haze(() => this.pos, this.r * 5, 1, 0);
    if (!s.basic && this.index % 3 === 0) sp.g.audio.cast(sp.el, s.basic ? 0.05 : Math.min(0.5, 0.15 + sp.m * 0.3), this.pos, s.basic ? null : sp.look);
  }
  update(dt) {
    const sp = this.sp, s = sp.spec, g = sp.g;
    this.age += dt;
    if (this.age < 0) return true;
    if (!this.launched) this.launch();
    this.prev.copy(this.pos);
    const t = this.age, caster = sp.caster;
    if (this.traj === 'orbit' && t < this.orbitT) {
      const a = this.orbitA + t * 7, c = caster.center(), R = 1.6 + this.r * 2;
      if (caster.isPlayer) c.addScaledVector(caster.getAim().dir, 4 + this.r * 3);
      this.base.set(c.x + Math.cos(a) * R, c.y + 0.4 + Math.sin(t * 5 + this.phase) * 0.3, c.z + Math.sin(a) * R);
      this.pos.copy(this.base);
      if (t + dt >= this.orbitT) this.vel.copy(this.aimPoint).sub(this.pos).normalize().multiplyScalar(this.speed * 1.2);
    } else {
      const homing = this.traj === 'homing' ? 2.2 : s.homing > 0.5 ? s.homing * 1.2 : this.homingBoost || 0;
      if (homing > 0) {
        if (!this.target || !this.target.alive) this.target = sp.nearestTarget(this.pos, null, -1, 80);
        if (this.target) { const sp0 = this.vel.length(); const want = this.target.center().sub(this.base).normalize().multiplyScalar(sp0); this.vel.lerp(want, clamp(homing * dt * 1.6)); this.vel.setLength(sp0); }
      }
      if (this.traj === 'boomerang' && t > this.turnT) {
        const home = caster.center(), sp0 = this.vel.length();
        this.vel.lerp(home.clone().sub(this.base).normalize().multiplyScalar(sp0), clamp(dt * 3.5));
        if (this.base.distanceTo(home) < 1.2) { this.end(null, 'return'); return false; }
      }
      if (this.g) this.vel.y -= this.g * dt;
      else this.vel.y -= (s.weight * 5 + (this.fall || 0)) * dt;
      this.base.addScaledVector(this.vel, dt);
      // lateral offsets
      const k = Math.min(1, t * 2.5), A = this.amp;
      let ox = 0, oy = 0;
      if (this.traj === 'spiral') { ox = Math.cos(t * 11 + this.phase) * A; oy = Math.sin(t * 11 + this.phase) * A; }
      else if (this.traj === 'zigzag') { const tri = (x) => 2 * Math.abs(2 * (x - Math.floor(x + 0.5))) - 1; ox = tri(t * 3.2 + this.phase) * A * 1.4; oy = tri(t * 1.7) * A * 0.3; }
      else if (this.traj === 'serpentine') { ox = Math.sin(t * 5 + this.phase) * A * 1.6; oy = Math.sin(t * 3.1 + this.phase) * A * 0.7; }
      this.pos.copy(this.base).addScaledVector(this.u, ox * k).addScaledVector(this.v, oy * k);
    }
    if (t > (this.traj === 'orbit' ? this.orbitT : 0) + 0.02 || this.traj !== 'orbit') {
      const bh = sp.barrierHit(this.prev, this.pos);
      if (bh) { this.pos.lerpVectors(this.prev, this.pos, bh.t); bh.bar.damage(this.dmg * s.dmgMult, this.pos); this.end(null, 'barrier'); return false; }
      for (const tg of sp.targets()) if (!this.hitSet.has(tg) && tg.hits(this.pos, this.r * 0.9)) {
        if (s.sharpness > 0.78 && this.pierce-- > 0) { this.hitSet.add(tg); sp.hit(tg, this.dmg, this.pos.clone(), { knock: this.vel.clone().setLength(2) }); g.fx.explosion(sp.el, this.pos, this.r * 2, 0.2, sp.pal, { look: sp.look, noDecal: true }); continue; }
        this.end(tg, 'hit'); return false;
      }
      if (g.world.solid(this.pos) && !(this.traj === 'orbit' && t < this.orbitT)) { this.end(null, 'world'); return false; }
    }
    if (t > this.life) { this.end(null, 'expire'); return false; }
    // visuals
    const m = this.mesh;
    m.position.copy(this.pos);
    const d = _v.subVectors(this.pos, this.prev);
    if (m.userData.orient && d.lengthSq() > 1e-6) { m.lookAt(_w.copy(this.pos).add(d)); if (m.userData.roll) m.rotateZ(m.userData.roll); }
    if (m.userData.spinY) m.rotation.y += dt * m.userData.spinY;
    if (m.userData.spinZ) m.rotateZ(dt * m.userData.spinZ);
    if (m.userData.tumble) { m.rotation.x += dt * 4; m.rotation.z += dt * 3; }
    if (m.userData.wobble) { const w = 1 + Math.sin(t * 14) * 0.08; m.scale.set(this.r * w, this.r / w, this.r * w); }
    if (m.userData.core?.userData.spin) { m.userData.core.userData.spin.rotation.x += dt * 3; m.userData.core.userData.spin.rotation.y += dt * 2; }
    const gl = m.userData.core?.userData.glint; if (gl) { gl.material.rotation += dt * 2.5; gl.material.opacity = 0.75 + Math.sin(t * 23) * 0.25; }
    for (const S of m.userData.sats) { S.a += dt * S.sp; S.m.position.set(Math.cos(S.a) * 1.6, Math.sin(S.a) * Math.cos(S.tilt) * 1.6, Math.sin(S.a) * Math.sin(S.tilt) * 1.6); }
    this.trail.push(this.pos); this.trail2?.push(this.pos);
    const fx = g.fx;
    if (!s.basic || Math.random() < 0.5) sp.emit(this.pos, (s.basic ? 1 : 1.5) + sp.m * 3 * this.r, this.r * 1.1, 1.1 + (s.basic ? 0 : sp.look.g.dispersion));
    if (m.userData.dragon && Math.random() < 0.6) fx.flame(this.pos, { color: sp.pal.color, size: this.r * 1.2, life: 0.5, rise: 1 });
    if (m.userData.wail && Math.random() < 0.4) fx.puff(this.pos, { color: new THREE.Color(0x140a20), size: this.r, life: 0.9, alpha: 0.7, rise: 0.5 });
    if ((sp.el === 'lightning' || sp.el2 === 'lightning') && !s.basic && Math.random() < 0.35) fx.bolt(this.pos.clone(), this.pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(this.r * 2.4)), sp.pal.core, { look: sp.look, width: 0.02 + this.r * 0.04, dur: 0.07, jag: 0.3, branches: 0, flicker: false });
    if (this.index === 0) sp.light(this.pos, (50 + this.r * 220) * (s.basic ? 1 : sp.look.lightMul), 8 + this.r * 10);
    return true;
  }
  end(target, why) {
    this.alive = false;
    if (this.haze) this.haze.alive = false;
    if (this.trail) this.trail.dead = true; if (this.trail2) this.trail2.dead = true;
    if (this.mesh) this.sp.remove(this.mesh);
    if (why === 'return' || why === 'expire' && this.traj === 'boomerang') return;
    const sp = this.sp, pos = this.pos.clone();
    if (target) sp.hit(target, this.dmg, pos, { knock: this.vel.clone().setLength(2 + sp.spec.weight * 8), shatter: sp.spec.weight > 0.6 });
    runPayload(sp, pos, this.R, target, this.dmg, this.frac, this.vel);
    if (this.index === 0 && !this.escort) escalateImpact(sp, pos, this.R, target);
  }
}

// ------------------------------------------------------------ payloads (shared by missiles, meteors, beams, tornados, vortices)
function runPayload(sp, pos, R, target, dmg, frac = 1, vel = null, forced = null) {
  const s = sp.spec, g = sp.g, fx = g.fx;
  const kind = forced || s.payload || 'explode';
  const aoe = dmg * 0.4;
  switch (kind) {
    case 'none': fx.explosion(sp.el, pos, R * 0.45, 0.2, sp.pal, { look: sp.look, noDecal: true }); g.audio.impact(sp.el, 0.15, pos, sp.look); break;
    case 'split': {
      sp.explode(pos, R * 0.6, aoe * 0.5, { exclude: target });
      const n = Math.max(3, Math.round((4 + s.count * 6) * Math.sqrt(frac)));
      for (let i = 0; i < n; i++) {
        const dir = new THREE.Vector3(Math.cos((i / n) * TAU), 0.9 + rand(0, 0.7), Math.sin((i / n) * TAU)).normalize();
        fragment(sp, pos.clone().addScaledVector(dir, 0.4), dir.multiplyScalar(9 + s.speed * 8), R * 0.35, dmg * 0.22);
      }
      break;
    }
    case 'linger': sp.explode(pos, R * 0.6, aoe * 0.6, { exclude: target }); sp.sys.spawnField(s, sp.caster, pos, Math.max(1.8, R * 1.1) * Math.sqrt(frac), 2.5 + s.duration * 5 * Math.sqrt(frac)); break;
    case 'erupt': sp.explode(pos, R * 0.5, aoe * 0.4, { exclude: target, noDecal: true }); eruption(sp, pos, R * 0.55, dmg * 0.55); break;
    case 'chain': {
      sp.explode(pos, R * 0.6, aoe * 0.6, { exclude: target });
      let from = pos.clone(), hops = 2 + Math.round(s.count * 3);
      const hit = new Set([target]);
      for (let i = 0; i < hops; i++) {
        let best = null, bd = 16;
        for (const t of sp.targets()) if (!hit.has(t)) { const d = t.center().distanceTo(from); if (d < bd) { bd = d; best = t; } }
        const to = best ? best.center() : from.clone().add(new THREE.Vector3(rand(-5, 5), 0, rand(-5, 5))).setY(g.world.heightAt(from.x, from.z) + 0.2);
        fx.bolt(from.clone(), to, sp.pal.color, { look: sp.look, width: 0.07 + sp.m * 0.05, dur: 0.3, jag: 0.25, branches: 1 });
        if (best) { hit.add(best); sp.hit(best, dmg * 0.45, to); }
        fx.explosion(sp.el, to, 0.8, 0.15, sp.pal, { look: sp.look, noDecal: true });
        from = to;
      }
      break;
    }
    case 'implode': {
      fx.ring(pos, sp.pal.color, R * 3, 0.5); let t = 0;
      g.audio.cast('darkness', 0.4, pos, this.look);
      fx.add((dt) => {
        t += dt;
        fx.attractors.push({ x: pos.x, y: pos.y, z: pos.z, r2: (R * 4) ** 2, k: 60, swirl: 2 });
        for (const tg of sp.targets()) { const d = pos.clone().sub(tg.center()); const L = d.length(); if (L < R * 3.5 && L > 0.5) tg.vel.addScaledVector(d.normalize(), 30 * dt); }
        if (Math.random() < 0.8) fx.glow.emit({ x: pos.x + rand(-1, 1) * R * 3, y: pos.y + rand(-1, 1) * R * 2, z: pos.z + rand(-1, 1) * R * 3, life: 0.4, size: 0.2, color: sp.pal.core, alpha: 1, drag: 0.2, frame: 1 });
        if (t > 0.55) { sp.explode(pos, R * 1.3, aoe * 1.4, { knock: 10, lift: 5 }); return false; }
        return true;
      });
      break;
    }
    case 'echo': {
      sp.explode(pos, R, aoe, { exclude: target });
      const n = 2 + Math.round(s.count * 2 + s.duration);
      for (let i = 1; i <= n; i++) setTimeout(() => { sp.explode(pos, R * (1 + i * 0.25), aoe * 0.45, { noDecal: true }); fx.ring(pos, sp.pal.core, R * (2 + i), 0.5); }, 280 * i);
      break;
    }
    case 'crystallize': sp.explode(pos, R * 0.5, aoe * 0.5, { exclude: target, noDecal: true }); crystalBloom(sp, pos, R * 1.1 * Math.sqrt(frac), dmg * 0.4); break;
    default: {
      const L = vel ? vel.clone().setY(0).setLength(3 + s.weight * 5) : null;
      sp.explode(pos, R, aoe, { exclude: target, knock: 3 + s.weight * 5, lift: 2 });
      if (L) sp.g.fx.shockwave(pos, R * 2.5, 0.8, 0.4);
    }
  }
}
function fragment(sp, pos, vel, r, dmg) {
  const g = sp.g, fx = g.fx, p = pos.clone(), v = vel.clone(); let t = 0;
  fx.add((dt) => {
    t += dt; v.y -= 20 * dt; p.addScaledVector(v, dt);
    fx.element(sp.el, p, { count: 1, speed: 0.3, size: 0.25, palette: sp.pal, life: 0.35 });
    fx.sparks.emit(p.x, p.y, p.z, -v.x * 0.1, -v.y * 0.1, -v.z * 0.1, 0.25, sp.pal.core, 0, 0.05);
    let hitT = null; for (const tg of sp.targets()) if (tg.hits(p, 0.4)) hitT = tg;
    if (hitT || g.world.solid(p) || t > 2.5) {
      if (hitT) sp.hit(hitT, dmg, p.clone());
      fx.explosion(sp.el, p, Math.max(0.6, r * 1.5), 0.2, sp.pal, { look: sp.look, noDecal: true });
      if (Math.random() < 0.5) g.audio.impact(sp.el, 0.12, p, sp.look);
      return false;
    }
    return true;
  });
}
function eruption(sp, pos, R, dmg) {
  const g = sp.g, fx = g.fx, gy = g.world.heightAt(pos.x, pos.z), H = 5 + sp.spec.size * 7 + sp.m * 3;
  const col = new THREE.Mesh(BEAM_GEO, flowMaterial({ color: sp.pal.color, core: sp.pal.core, intensity: 2.6, scroll: -8, twist: 1.5, stripes: 4 }));
  col.rotation.x = -Math.PI / 2; col.position.set(pos.x, gy, pos.z); col.scale.set(0.01, 0.01, H); g.scene.add(col);
  const hitSet = new Set(); let t = 0;
  g.audio.impact(sp.el === 'water' ? 'water' : 'earth', 0.5, pos, sp.look); fx.addShake(0.2, pos);
  fx.add((dt) => {
    t += dt; const k = Math.min(1, t / 0.12) * (1 - Math.max(0, (t - 0.7) / 0.35));
    col.scale.set(R * k + 0.01, R * k + 0.01, H * Math.min(1, t / 0.15));
    for (let i = 0; i < 3; i++) { const p = new THREE.Vector3(pos.x + rand(-R, R) * 0.6, gy + rand(0, H), pos.z + rand(-R, R) * 0.6); if (sp.el === 'fire') fx.flame(p, { color: sp.pal.color, size: R * 0.9, life: 0.5, rise: 8 }); else fx.element(sp.el, p, { count: 1, speed: 3, size: R * 0.5, palette: sp.pal, dir: _up }); }
    if (t < 0.5) for (const tg of sp.targets()) if (!hitSet.has(tg) && Math.hypot(tg.pos.x - pos.x, tg.pos.z - pos.z) < R + 0.6) { hitSet.add(tg); sp.hit(tg, dmg, tg.center(), { knock: new THREE.Vector3(0, 13, 0) }); }
    sp.light(new THREE.Vector3(pos.x, gy + H * 0.4, pos.z), 300 * k, H * 2);
    if (t > 1.05) { g.scene.remove(col); col.material.dispose(); return false; }
    return true;
  });
}
function crystalBloom(sp, pos, R, dmg) {
  const g = sp.g, n = 7 + Math.floor(sp.rng() * 5), mat = sp.el === 'nature' || sp.el === 'poison' ? crystalMaterial({ color: sp.pal.dark, glow: sp.pal.color, emissive: 1.2, crack: 0.4 }) : crystalMaterial({ color: sp.el === 'ice' ? 0x9ad8f8 : sp.pal.dark, glow: sp.pal.color, emissive: 1.4, crack: 0.35 });
  const spikes = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.2, 0.2), d = rand(0.2, 1) * R, p = new THREE.Vector3(pos.x + Math.cos(a) * d, 0, pos.z + Math.sin(a) * d); p.y = g.world.heightAt(p.x, p.z) - 0.1;
    const m = new THREE.Mesh(SPIKE_GEOS[i % 3], mat); m.position.copy(p); m.rotation.set(Math.sin(a) * 0.6 * (d / R), rand(0, TAU), -Math.cos(a) * 0.6 * (d / R));
    m.userData.h = (1.2 + sp.spec.size * 2.2) * rand(0.6, 1.2) * (1.2 - d / R * 0.5); m.userData.w = 0.3 + sp.spec.size * 0.3; m.scale.set(m.userData.w, 0.01, m.userData.w); m.castShadow = true;
    g.scene.add(m); spikes.push(m);
  }
  for (const tg of sp.targets()) if (tg.distTo(pos) < R) sp.hit(tg, dmg, tg.center(), { knock: new THREE.Vector3(0, 6, 0), stun: 0.3 });
  g.audio.impact(sp.el === 'ice' ? 'ice' : 'earth', 0.4, pos, sp.look);
  let t = 0;
  g.fx.add((dt) => {
    t += dt; const k = Math.min(1, t / 0.15) * (1 - Math.max(0, (t - 3) / 0.5));
    spikes.forEach((m) => m.scale.set(m.userData.w, Math.max(0.01, m.userData.h * k), m.userData.w));
    if (t > 3.6) { spikes.forEach((m) => g.scene.remove(m)); mat.dispose(); return false; }
    return true;
  });
}

// ------------------------------------------------------------ MISSILE SPELL (orb / barrage)
class MissileSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, caster = this.caster, aim = caster.getAim();
    let pattern = s.pattern || 'single';
    if (this.spec.shape === 'barrage' && pattern === 'single') pattern = 'cascade';
    if (s.basic) pattern = 'single';
    const cnt = s.count;
    const N = {
      single: 1 + (cnt > 0.45 ? Math.round((cnt - 0.45) * 6) : 0), fan: 3 + Math.round(cnt * 4), ring: 8 + Math.round(cnt * 10), cascade: 5 + Math.round(cnt * 12 * (0.6 + this.m * 0.5)),
      crossfire: 2 * (2 + Math.round(cnt * 3)), rain: 7 + Math.round(cnt * 14), spiral: 9 + Math.round(cnt * 12), swarm: 7 + Math.round(cnt * 10),
    }[pattern] || 1;
    const baseR = (0.16 + s.size * 0.45) * (0.55 + this.m * 0.9) * (s.basic ? 0.6 : 1);
    const r = baseR * Math.pow(N, -0.3);
    const speed = (16 + s.speed * 40) * (1 - s.weight * 0.25) * (s.basic ? 1.3 : 1);
    const dmg = (s.basic ? 22 : 62) * Math.pow(N, -0.55) * (1 + s.sharpness * 0.15);
    const R = s.basic ? 0.9 : 1.1 + r * 2.2 + s.size * 1.8 * this.m * Math.pow(N, -0.35);
    const origin = this.sys.castOrigin(caster).clone();
    if (caster.isPlayer && r > 0.3) origin.addScaledVector(aim.dir, 0.6 + r * 2.2); // keep large orbs out of the lens
    const eye = caster.eye(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(aim.dir, _up).normalize();
    const traj = s.basic ? 'straight' : s.trajectory || 'straight';
    this.missiles = [];
    const mk = (i, pos, dir, delay, extra = {}) => {
      const target = extra.aimPoint || aim.point.clone();
      this.missiles.push(new Missile(this, {
        index: i, n: N, pos, dir: dir.normalize(), speed, delay, r, R, dmg, frac: 1 / N, traj, aimPoint: target, life: traj === 'boomerang' ? 5 : 4.5,
        amp: (0.35 + s.size * 0.6 + s.chaos * 0.8) * (traj === 'serpentine' ? 1.6 : 1), turnT: 0.35 + s.speed * 0.2 + (aim.point.distanceTo(origin) / speed) * 0.45,
        pierce: s.sharpness > 0.78 ? 2 : 0, orbitIndex: i, ...extra,
      }));
    };
    const toAim = (p) => aim.point.clone().sub(p);
    const spread = 0.02 + s.chaos * 0.06;
    const jitter = (d) => { d.x += rand(-spread, spread); d.y += rand(-spread, spread); d.z += rand(-spread, spread); return d; };
    for (let i = 0; i < N; i++) {
      const f = N > 1 ? i / (N - 1) - 0.5 : 0;
      switch (pattern) {
        case 'fan': { const d = toAim(origin).normalize().applyAxisAngle(_up, f * (0.5 + s.chaos * 0.6)); mk(i, origin.clone(), d, 0); break; }
        case 'ring': { const a = (i / N) * TAU; const d = new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)); mk(i, caster.center().addScaledVector(d, 1.2), d, 0.02 * i, { homingBoost: 1.1 }); break; }
        case 'cascade': { const p = eye.clone().addScaledVector(right, rand(-1, 1) * (1.4 + this.m)).addScaledVector(_up, rand(0.2, 1.2)).addScaledVector(aim.dir, -0.4); mk(i, p, jitter(toAim(p).normalize()), 0.02 + i * (0.1 - s.speed * 0.055)); break; }
        case 'crossfire': { const side = i % 2 ? 1 : -1; const p = eye.clone().addScaledVector(right, side * (3 + this.m * 2)).addScaledVector(_up, 0.8 + (i >> 1) * 0.4); mk(i, p, toAim(p).normalize(), (i >> 1) * 0.12); break; }
        case 'rain': { const tp = aim.point.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(2 + s.size * 4)); tp.y = this.g.world.heightAt(tp.x, tp.z); const p = tp.clone().add(new THREE.Vector3(rand(-3, 3), 18 + rand(0, 6), rand(-3, 3))); mk(i, p, tp.clone().sub(p).normalize(), rand(0, 0.9), { aimPoint: tp }); break; }
        case 'spiral': { const a = i * 0.9, cone = 0.18 + s.chaos * 0.2; const d = toAim(origin).normalize(); const u = new THREE.Vector3().crossVectors(d, _up).normalize(), v = new THREE.Vector3().crossVectors(u, d); d.addScaledVector(u, Math.cos(a) * cone).addScaledVector(v, Math.sin(a) * cone); mk(i, origin.clone(), d, i * 0.05); break; }
        case 'swarm': { const p = caster.center().add(new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1)).multiplyScalar(2)); const d = aim.dir.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.1, 0.6), rand(-0.6, 0.6))); mk(i, p, d, rand(0, 0.4), { homingBoost: 1.6, amp: 0.6 + s.chaos }); break; }
        default: { const d = toAim(origin).normalize().applyAxisAngle(_up, N > 1 ? f * 0.18 * N : 0); mk(i, origin.clone().addScaledVector(right, N > 1 ? f * r * 3 : 0), d, 0); }
      }
    }
    // escorts: greater/ultimate spells bring a retinue of lesser copies that orbit, then launch
    if (!s.basic && this.level >= 2 && N <= 2) {
      const E = this.level === 3 ? 8 : 3;
      for (let i = 0; i < E; i++) mk(N + i, caster.center(), aim.dir.clone(), 0.05 + i * 0.05, { traj: 'orbit', r: r * 0.42, R: R * 0.4, dmg: dmg * 0.22, frac: 0.15, orbitIndex: i, n: E, escort: true });
    }
    if (!s.basic) this.g.audio.whoosh(this.m);
    // a travelling roar/hiss/crackle that rides the lead projectile (spin gives it a whooshing sweep)
    if (!s.basic) this.loopSnd = this.g.audio.loop(this.el, origin, 0.25 + this.m * 0.35, this.look, { spin: 0.25 + s.speed * 0.4 });
  }
  update(dt) {
    this.t += dt;
    this.missiles = this.missiles.filter((m) => m.update(dt));
    const lead = this.missiles.find((m) => m.launched);
    if (lead) this.loopSnd?.set(lead.pos);
    this.updateCommon(dt);
    if (!this.missiles.length) { this.done = true; this.loopSnd?.stop(); this.loopSnd = null; }
    return !this.finished();
  }
  threats() { return this.missiles.filter((m) => m.launched).map((m) => ({ pos: m.pos, vel: m.vel, radius: m.r })); }
  dispose() { super.dispose(); for (const m of this.missiles) if (m.haze) m.haze.alive = false; }
}

// ------------------------------------------------------------ FIELD (lingering zone)
const fieldMat = (pal, el) => new THREE.ShaderMaterial({
  uniforms: { uTime: TIME, uColor: { value: pal.color.clone() }, uCore: { value: pal.core.clone() }, uDark: { value: pal.dark.clone() }, uAlpha: { value: 0 }, uKind: { value: ['water', 'poison', 'earth'].includes(el) ? 1 : el === 'ice' ? 2 : 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: NOISE + /* glsl */ `
    uniform float uTime,uAlpha,uKind; uniform vec3 uColor,uCore,uDark; varying vec2 vUv;
    void main(){
      vec2 d=vUv-0.5; float r=length(d)*2.0; if(r>1.0) discard;
      float a=atan(d.y,d.x);
      float n=fbm3(vec3(d*5.0, uTime*0.35))*0.5+0.5;
      float sw=fbm3(vec3(cos(a+r*3.0-uTime*0.6)*r*3.0, sin(a+r*3.0-uTime*0.6)*r*3.0, uTime*0.2))*0.5+0.5;
      float edge=smoothstep(0.78,0.98,r+n*0.12);
      vec3 c=mix(uDark, uColor, smoothstep(0.35,0.75,sw));
      c=mix(c, uCore, smoothstep(0.7,0.95,sw)*0.8);
      if(uKind>1.5) c=mix(vec3(0.75,0.92,1.0), uCore, smoothstep(0.4,0.9,n));
      float body=uKind>0.5? 0.85 : 0.55*smoothstep(0.2,0.8,sw)+0.2;
      float rim=smoothstep(0.0,0.1,1.0-abs(r-0.94)*10.0);
      float alpha=(body*(1.0-edge*0.7)+rim*0.8)*uAlpha*smoothstep(1.0,0.9,r+n*0.1);
      gl_FragColor=vec4(c*(1.1+rim*1.5), alpha);
    }`,
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6,
});
class FieldSpell extends Spell {
  constructor(sys, spec, caster, aim, opts = {}) {
    super(sys, spec, caster, aim);
    const s = this.spec;
    const p = opts.pos ? opts.pos.clone() : aim.point.clone();
    p.y = this.g.world.heightAt(p.x, p.z);
    this.center = p;
    this.R = opts.radius || (2.5 + s.size * 5) * (0.6 + this.m * 0.5) * this.look.sx;
    this.life = opts.dur || 3 + s.duration * 6 + this.m * 2;
    const g = new THREE.CircleGeometry(1, 48); g.rotateX(-Math.PI / 2);
    this.disc = this.add(new THREE.Mesh(g, fieldMat(this.pal, this.el))); this.disc.userData.ownGeo = true;
    this.disc.position.copy(p).y += 0.08; this.disc.scale.setScalar(this.R);
    this.kit = kitOf(this.el, this.look);
    const lp = []; for (let k = 0; k <= 16; k++) { const t = k / 16; lp.push(new THREE.Vector2(1.02 - t * t * 1.0, Math.sin(t * Math.PI * 0.5) * 1)); }
    const lm = surfaceMaterial(this.kit, { spin: 0.2, twist: 0.4, bulge: 0.06 });
    lm.uniforms.uFlow.value = 0.4 + this.kit.heat * 1.5; lm.uniforms.uTopFade.value = 0; lm.uniforms.uFoam.value = 0.15;
    this.layer = this.add(new THREE.Mesh(new THREE.LatheGeometry(lp, 64), lm)); this.layer.userData.ownGeo = true; this.layer.renderOrder = 3;
    this.layer.position.copy(p).y += 0.05; this.layerH = (0.25 + this.kit.mix.y * 1.2 + this.kit.mix.z * 0.5) * (0.6 + this.look.sy * 0.4);
    if (!opts.pos) { this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.R, intensity: 0.8 }); this.mc.group.rotation.x = -Math.PI / 2; this.mc.group.position.copy(p).y += 0.12; this.mc.spin = 0.3; this.add(this.mc.group); }
    this.tick = 0.2;
    if (!opts.pos) { this.g.audio.cast(this.el, this.m, p, this.look); this.g.fx.explosion(this.el, p.clone().setY(p.y + 0.3), this.R * 0.5, 0.3, this.pal, { look: this.look, noDecal: true }); }
    if (this.el === 'fire') this.hazeH = this.g.fx.haze(p.clone().setY(p.y + 1.5), this.R * 2.2, 1.2, 0);
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, fx = this.g.fx, c = this.center, el = this.el;
    const k = clamp(this.t / 0.3) * clamp((this.life - this.t) / 0.6);
    this.disc.material.uniforms.uAlpha.value = k;
    this.layer.scale.set(this.R * (0.4 + 0.6 * k), this.layerH * k + 0.01, this.R * (0.4 + 0.6 * k)); this.layer.material.uniforms.uFade.value = k;
    this.mc?.update(dt); if (this.mc) this.mc.target = k * 0.8;
    const n = Math.ceil(this.R * 1.2 * fx.quality);
    for (let i = 0; i < n; i++) {
      if (Math.random() > 0.5 * k) continue;
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * this.R, p = new THREE.Vector3(c.x + Math.cos(a) * d, c.y + 0.1, c.z + Math.sin(a) * d);
      if (el === 'fire') fx.flame(p, { color: this.pal.color, size: rand(0.4, 0.9), life: 0.7, rise: 2.5 });
      else if (el === 'poison') { fx.glow.emit({ x: p.x, y: p.y, z: p.z, vy: rand(0.4, 1.2), life: rand(0.6, 1.2), size: rand(0.15, 0.35), size1: 0.4, color: this.pal.core, alpha: 0.9, drag: 0.5, frame: 6, style: 3 }); if (Math.random() < 0.3) fx.puff(p, { color: new THREE.Color(0x7aa020), size: 0.9, life: 2, alpha: 0.55, rise: 0.6 }); }
      else if (el === 'lightning') { if (Math.random() < 0.2) fx.bolt(p, p.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(0.2, 1.5), rand(-1.5, 1.5))), this.pal.color, { look: this.look, width: 0.04, dur: 0.12, branches: 0 }); }
      else if (el === 'ice') { if (Math.random() < 0.4) fx.puff(p, { color: new THREE.Color(0xeaf8ff), size: 0.7, life: 1.5, alpha: 0.5, rise: 0.2 }); }
      else if (el === 'darkness') fx.puff(p, { color: new THREE.Color(0x10041a), size: 0.7, life: 1.6, alpha: 0.8, rise: 1.2 });
      else fx.element(el, p, { count: 1, speed: 0.6, size: 0.25, palette: this.pal, life: 0.8 });
    }
    this.light(c.clone().setY(c.y + 1), 120 * k, this.R * 2.5);
    this.tick -= dt;
    if (this.tick <= 0 && this.t < this.life) {
      this.tick = 0.5;
      for (const t of this.g.combatants) {
        if (!t.alive || Math.hypot(t.pos.x - c.x, t.pos.z - c.z) > this.R || t.pos.y - c.y > 2.5) continue;
        if (t === this.caster) {
          if (el === 'light' || el === 'nature' || el === 'water') t.heal(6 * s.dmgMult);
          continue;
        }
        this.hit(t, el === 'poison' ? 6 : 9, t.center(), { noReact: false });
        if (el === 'water' || el === 'earth' || el === 'ice') t.mud = Math.max(t.mud, 0.8);
        if (el === 'nature' && Math.random() < 0.25) t.stun = Math.max(t.stun, 0.6);
        if (el === 'wind') t.vel.add(t.pos.clone().sub(c).setY(0).normalize().multiplyScalar(6));
        if (el === 'darkness' || el === 'arcane') t.vel.add(c.clone().sub(t.pos).setY(0).normalize().multiplyScalar(3));
      }
    }
    if (this.t > this.life) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
  threats() { return this.t < this.life ? [{ pos: this.center, vel: new THREE.Vector3(), radius: this.R, area: true }] : []; }
}

// ------------------------------------------------------------ WAVE (advancing surge)
// A real breaking wave: a swept cross-section that morphs from a rolling swell into a curling, overhanging lip as it
// travels, breaking progressively along its width. The surface is the element kit (water foam, toon flame, avalanche
// rock/snow, dust…), with lip spray, front foam and trailing mist; it crashes into a splash when it ends.
const SWELL = [[0.6, 0], [0.45, 0.08], [0.3, 0.25], [0.18, 0.45], [0.1, 0.62], [0.05, 0.75], [0, 0.8], [-0.05, 0.78], [-0.2, 0.65], [-0.45, 0.4], [-0.75, 0.15], [-1.05, 0]];
const CURL = [[0.3, 0], [0.16, 0.2], [0.12, 0.42], [0.2, 0.62], [0.36, 0.74], [0.52, 0.7], [0.47, 0.88], [0.28, 1.0], [0.02, 0.97], [-0.3, 0.7], [-0.65, 0.3], [-1.05, 0]];
const WCOLS = 56, WROWS = 30;
class WaveSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, aim = this.caster.getAim(), L = this.look, G = L.g;
    this.dir = new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize();
    this.pos = this.caster.pos.clone().addScaledVector(this.dir, 2);
    this.W = (8 + s.size * 11) * (0.6 + this.m * 0.5) * L.sx; this.H = (2.6 + s.size * 4.5) * (0.6 + this.m * 0.5) * L.sy;
    this.speed = (9 + s.speed * 12) * (1.1 - G.weight * 0.3); this.range = 32 + s.duration * 20; this.traveled = 0;
    this.kit = kitOf(this.el, L);
    // heavier / denser matter barely curls (an avalanche rolls), liquids and flame curl hard
    this.curlMax = clamp(1.05 - G.density * 0.45 + this.kit.mix.x * 0.2);
    const geo = new THREE.BufferGeometry();
    this.gPos = new Float32Array(WCOLS * WROWS * 3);
    const uv = new Float32Array(WCOLS * WROWS * 2), idx = [];
    for (let c = 0; c < WCOLS; c++) for (let r = 0; r < WROWS; r++) { const i = c * WROWS + r; uv[i * 2] = c / (WCOLS - 1); uv[i * 2 + 1] = 0; }
    for (let c = 0; c < WCOLS - 1; c++) for (let r = 0; r < WROWS - 1; r++) { const a0 = c * WROWS + r, b0 = a0 + WROWS; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
    geo.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.mat = surfaceMaterial(this.kit, { spin: 0, twist: 0, bulge: 0, opacity: 1 });
    this.mat.uniforms.uStreak.value = 6; this.mat.uniforms.uFoam.value = 0.12; this.mat.uniforms.uCrest.value = 1; this.mat.uniforms.uTopFade.value = 0;
    this.mat.uniforms.uFlow.value = 0.8 + s.speed; this.mat.uniforms.uFlameUp.value = -0.15; // flame waves glow hottest at the lip
    this.mesh = this.add(new THREE.Mesh(geo, this.mat)); this.mesh.userData.ownGeo = true; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    if (this.kit.energy > 0.2) { this.glow = this.add(new THREE.Mesh(geo, surfaceMaterial(this.kit, { spin: 0, twist: 0, bulge: 0, energyOnly: true }))); this.glow.frustumCulled = false; }
    this.lip = []; this.seedPh = rand(0, 10);
    this.hitSet = new Set();
    this.loopSnd = this.g.audio.loop(this.el === 'fire' ? 'fire' : 'water', this.pos, 0.8, this.look);
    this.g.audio.cast(this.el, this.m, this.pos, this.look);
    this.buildShape(0);
  }
  // rebuild the swept surface: per column the break phase leads/lags, ends taper, the lip wobbles
  buildShape(t) {
    const side = _v.set(-this.dir.z, 0, this.dir.x), P = this.gPos, uv = this.mesh.geometry.attributes.uv.array, G = this.look.g;
    const prog = clamp(this.traveled / (this.range * 0.55)), grow = clamp(this.t / 0.4), fade = clamp((this.range - this.traveled) / 5);
    const pts = SWELL.map(() => new THREE.Vector3()), curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.lip.length = 0;
    for (let c = 0; c < WCOLS; c++) {
      const u = c / (WCOLS - 1) - 0.5, taper = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u) * 2, 3)), 0.6);
      const lead = Math.sin(u * 5.3 + this.seedPh) * 0.25 * (0.4 + G.dispersion);
      const curl = clamp(prog * 1.3 + lead - Math.abs(u) * 0.4) * this.curlMax * taper;
      const h = this.H * taper * grow * fade * (1 + Math.sin(u * 9 + t * 2 + this.seedPh) * 0.06 * (0.5 + G.dispersion));
      for (let k = 0; k < SWELL.length; k++) {
        const z = SWELL[k][0] + (CURL[k][0] - SWELL[k][0]) * curl, y = SWELL[k][1] + (CURL[k][1] - SWELL[k][1]) * curl;
        pts[k].set(0, y * h, z * this.H * 1.15 * (0.5 + taper * 0.5));
      }
      for (let r = 0; r < WROWS; r++) {
        const p = curve.getPoint(r / (WROWS - 1), _w), i = (c * WROWS + r);
        const wx = this.pos.x + side.x * u * this.W + this.dir.x * p.z, wz = this.pos.z + side.z * u * this.W + this.dir.z * p.z;
        P[i * 3] = wx; P[i * 3 + 1] = this.pos.y + p.y - 0.1; P[i * 3 + 2] = wz;
        uv[i * 2 + 1] = h > 0.01 ? clamp(p.y / (this.H * 1.0)) : 0;
      }
      const tip = curve.getPoint(5 / 11, new THREE.Vector3());
      if (c % 4 === 2 && taper > 0.3) this.lip.push({ p: new THREE.Vector3(this.pos.x + side.x * u * this.W + this.dir.x * tip.z, this.pos.y + tip.y, this.pos.z + side.z * u * this.W + this.dir.z * tip.z), curl, h });
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, fx = this.g.fx, G = this.look.g, K = this.kit, q = fx.quality;
    const prev = this.pos.clone();
    this.pos.addScaledVector(this.dir, this.speed * dt); this.traveled += this.speed * dt;
    this.pos.y = this.g.world.heightAt(this.pos.x, this.pos.z);
    this.buildShape(this.t);
    const fade = clamp((this.range - this.traveled) / 5), side = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    // lip: spray thrown forward and up, more as the wave curls; element matter streams off the crest
    for (const Lp of this.lip) {
      if (Math.random() < (0.3 + Lp.curl) * q) {
        const v = this.dir.clone().multiplyScalar(this.speed * rand(0.6, 1.1)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(2, 6) * (1 - G.weight * 0.5), rand(-1.5, 1.5)));
        fx.element(this.el, Lp.p, { count: 1.5, speed: v.length() * 0.5, size: 0.18 + this.H * 0.04, palette: this.pal, dir: v.normalize(), spread: 0.25, look: this.look });
      }
      if (Math.random() < Lp.curl * 0.08 * q) fx.puff(Lp.p, { color: K.hi.clone().lerp(K.body, 1 - K.mix.x), size: this.H * 0.14, size1: this.H * 0.35, life: 0.7, vel: this.dir.clone().multiplyScalar(this.speed * 0.6).setY(1.5), alpha: 0.4 + G.density * 0.3, soft: true });
    }
    // solid matter (avalanche rock, ice blocks) tumbles off the crest as real debris
    this.rockT = (this.rockT || 0) - dt;
    if (K.mix.w > 0.35 && this.rockT <= 0 && this.lip.length) { this.rockT = 0.45 / K.mix.w; const Lp = this.lip[Math.floor(Math.random() * this.lip.length)]; fx.debris(Lp.p, 0.5 + this.H * 0.08, this.el, this.pal, this.look); }
    // churning foam / dust along the front toe, mist trailing behind
    for (let i = 0; i < 0.35 * q * fade; i++) {
      const u = rand(-0.45, 0.45) * this.W, front = this.pos.clone().addScaledVector(side, u).addScaledVector(this.dir, this.H * 0.4);
      front.y = this.g.world.heightAt(front.x, front.z) + 0.2;
      if (K.mix.x > 0.5) { // liquid toe: low sheets of spray skidding ahead (the shader already paints the churned foam)
        const v = this.dir.clone().multiplyScalar(this.speed * 1.3).add(new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)));
        fx.element(this.el, front, { count: 2, speed: v.length() * 0.6, size: 0.15 + this.H * 0.03, palette: this.pal, dir: v.normalize(), spread: 0.3, look: this.look });
      } else fx.puff(front, { color: K.hi.clone().lerp(K.body, 0.3 + (1 - K.mix.x) * 0.5), size: this.H * 0.22, size1: this.H * 0.55, life: 0.6, vel: this.dir.clone().multiplyScalar(this.speed * 0.9).setY(0.8), alpha: 0.35 + G.density * 0.3, soft: true });
      if (Math.random() < 0.3) { const back = this.pos.clone().addScaledVector(side, u).addScaledVector(this.dir, -this.H * 1.1); back.y += this.H * rand(0.1, 0.5); fx.puff(back, { color: K.body.clone().lerp(K.hi, 0.5), size: this.H * 0.3, size1: this.H * 0.8, life: 1.4, vel: new THREE.Vector3(0, 0.6, 0), alpha: 0.25, soft: true }); }
    }
    for (const t of this.targets()) {
      if (this.hitSet.has(t)) continue;
      const rel = t.pos.clone().sub(this.pos); const along = rel.dot(this.dir), lat = Math.abs(rel.dot(side));
      if (Math.abs(along) < 1.6 && lat < this.W * 0.5 && t.pos.y < this.pos.y + this.H) { this.hitSet.add(t); this.hit(t, 55, t.center(), { knock: this.dir.clone().multiplyScalar(14 + s.weight * 8).setY(5) }); fx.explosion(this.el, t.center(), 1.8, 0.4, this.pal, { noDecal: true, look: this.look }); }
    }
    const bh = this.barrierHit(prev.clone().setY(prev.y + 1), this.pos.clone().setY(this.pos.y + 1));
    if (bh) { bh.bar.damage(80 * s.dmgMult, this.pos); this.traveled = this.range; }
    this.loopSnd?.set(this.pos);
    this.light(this.pos.clone().setY(this.pos.y + this.H * 0.5), 150 * fade * this.look.lightMul * (0.3 + K.energy), this.W);
    if (this.traveled >= this.range && !this.done) {
      this.done = true; this.loopSnd?.stop(); this.loopSnd = null;
      // the crash: a wall of spray/matter collapsing forward
      for (let i = 0; i < 5; i++) this.g.fx.explosion(this.el, this.pos.clone().addScaledVector(side, (i / 4 - 0.5) * this.W * 0.8).addScaledVector(this.dir, this.H * 0.5).setY(this.pos.y + this.H * 0.4), this.H * 0.45, this.m * 0.6, this.pal, { noDecal: i % 2 === 1, look: this.look });
      runPayload(this, this.pos.clone().setY(this.pos.y + 1), this.W * 0.3, null, 40, 1, null, s.payload === 'explode' ? 'none' : null);
    }
    this.updateCommon(dt);
    return !this.finished();
  }
  threats() { return [{ pos: this.pos, vel: this.dir.clone().multiplyScalar(this.speed), radius: this.W * 0.5 }]; }
}

// ------------------------------------------------------------ ENHANCE (elemental self-buff)
class EnhanceSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster, p = clamp(s.power * 0.6 + s.tier * 0.4);
    const dur = 12 + 18 * p + s.duration * 8;
    for (const el of [this.el, this.el2].filter(Boolean)) {
      c.enh[el] = { t: dur, p, dur };
      if (el === 'ice') c.addShield(40 + 80 * p, dur, 'ice');
      if (el === 'wind') c.haste = Math.max(c.haste, 2);
    }
    this.g.onEnhance?.(c, [this.el, this.el2].filter(Boolean), dur);
    this.g.audio.cast(this.el, this.m, c.pos, this.look); this.g.audio.cast('light', 0.4, c.pos, this.look);
    this.g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), this.pal.color, 6, 0.7);
    this.g.fx.shockwave(c.center(), 5, 0.8, 0.5);
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: 1.8 + this.m });
    this.mc.group.rotation.x = -Math.PI / 2; this.add(this.mc.group);
    // power-up aura: a capsule of the element's matter streaming up around the body (flame aura, plasma, gale…)
    this.kit = kitOf(this.el, this.look);
    const ap = []; for (let k = 0; k <= 20; k++) { const t = k / 20; ap.push(new THREE.Vector2(0.35 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.45 - t * 0.2, t)); }
    const ag = new THREE.LatheGeometry(ap, 40);
    const am = surfaceMaterial({ ...this.kit, opacity: 0.85 }, { spin: 1.2, twist: 0.6, bulge: 0.18 + this.look.g.dispersion * 0.15 });
    am.uniforms.uFlow.value = 2.5 + this.kit.heat * 2; am.uniforms.uStreak.value = 5;
    this.aura = this.add(new THREE.Mesh(ag, am)); this.aura.userData.ownGeo = true; this.aura.renderOrder = 3;
    if (this.kit.energy > 0.2 || this.kit.heat > 0.3) { this.auraGlow = new THREE.Mesh(ag, surfaceMaterial(this.kit, { spin: 1.6, twist: 0.8, bulge: 0.12, energyOnly: true })); this.auraGlow.material.uniforms.uFlow.value = 3; this.auraGlow.scale.setScalar(0.85); this.aura.add(this.auraGlow); }
    this.g.fx.starburst(c.center(), this.pal.core, 4 + this.m * 2, 6 + Math.round(this.look.g.sharpness * 6), 0.25);
    this.g.fx.shockWall(c.pos, 4 + this.m * 2, this.look, this.el, 0.6, 0.8);
  }
  update(dt) {
    this.t += dt;
    const c = this.caster;
    this.mc.group.position.copy(c.pos).y += 0.1 + this.t * 1.6; this.mc.target = this.t < 1 ? 1 : 0; this.mc.update(dt);
    if (this.t < 1.2) for (let i = 0; i < 5; i++) {
      const a = this.t * 9 + i * (TAU / 5), r = 0.9;
      const p = new THREE.Vector3(c.pos.x + Math.cos(a) * r, c.pos.y + this.t * 1.6, c.pos.z + Math.sin(a) * r);
      this.g.fx.element(this.el, p, { count: 1, speed: 0.3, size: 0.3, palette: this.pal, life: 0.6 });
    }
    this.light(c.center(), 150 * clamp(1.2 - this.t), 8);
    const k = clamp(this.t / 0.2), out = clamp((this.t - 1.6) / 0.8);
    this.aura.position.copy(c.pos).y -= 0.1; this.aura.scale.set(1.1 + out * 0.3, 2.3 * (0.6 + 0.4 * k) * (1 + out * 0.3), 1.1 + out * 0.3); this.aura.rotation.y += dt * 2;
    this.aura.material.uniforms.uFade.value = k * (1 - out); if (this.auraGlow) this.auraGlow.material.uniforms.uFade.value = k * (1 - out);
    if (this.t > 2.4) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ------------------------------------------------------------ HAND (summoned spectral hand that fights alongside)
const CAPS = new THREE.CapsuleGeometry(0.5, 1, 6, 16); CAPS.rotateX(Math.PI / 2); // along z
function handMesh(sp) {
  // a giant hand made of the spell's matter: rounded palm + capsule knuckles (stone/crystal when solid)
  const kit = kitOf(sp.el, sp.look), solid = kit.mix.w > 0.4;
  const mat = solid ? crystalMaterial({ color: kit.body, glow: sp.pal.color, emissive: 1.1, crack: 0.45 }) : surfaceMaterial({ ...kit, opacity: 0.95 }, { spin: 0.6, twist: 0.8, bulge: 0.08 });
  if (!solid) { mat.uniforms.uTopFade.value = 0; mat.uniforms.uFlow.value = 1.5; }
  const g = new THREE.Group();
  const palm = new THREE.Mesh(SMOOTH, mat); palm.scale.set(0.42, 0.16, 0.4); palm.renderOrder = 3; g.add(palm);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group(); f.position.set(-0.3 + i * 0.2, 0, -0.38); g.add(f);
    const a = new THREE.Mesh(CAPS, mat); a.scale.set(0.15, 0.15, 0.26); a.position.z = -0.2; a.renderOrder = 3; f.add(a);
    const b = new THREE.Group(); b.position.z = -0.44; f.add(b);
    const c = new THREE.Mesh(CAPS, mat); c.scale.set(0.13, 0.13, 0.2); c.position.z = -0.16; c.renderOrder = 3; b.add(c);
    fingers.push({ f, b });
  }
  const th = new THREE.Group(); th.position.set(-0.45, 0, -0.05); th.rotation.y = 0.8; g.add(th);
  const tm = new THREE.Mesh(CAPS, mat); tm.scale.set(0.16, 0.16, 0.28); tm.position.z = -0.22; tm.renderOrder = 3; th.add(tm);
  const glow = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: sp.pal.color, core: sp.pal.core, intensity: 1.2 + kit.energy, noiseAmp: 0.3, opacity: 0.5 })); glow.scale.set(0.6, 0.3, 0.7); g.add(glow);
  const cuff = new THREE.Mesh(TORUS_GEO, energyMaterial({ color: sp.pal.color, core: sp.pal.core, intensity: 1.1, noiseAmp: 0, opacity: 0.8 })); cuff.scale.setScalar(0.4); cuff.position.z = 0.42; g.add(cuff);
  g.userData.fingers = fingers;
  return g;
}
class HandSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, p = clamp(s.power * 0.6 + s.tier * 0.4);
    this.life = 12 + 18 * p + s.duration * 6;
    this.size = (0.8 + s.size * 0.8 + this.m * 0.4) * 1.4;
    this.hand = this.add(handMesh(this)); this.hand.scale.setScalar(this.size);
    this.hand.position.copy(this.caster.center());
    this.interval = { lightning: 0.35, wind: 0.4, fire: 0.5, water: 0.55, ice: 0.65, light: 0.55, darkness: 0.65, nature: 0.6, poison: 0.55, arcane: 0.45, earth: 1.1 }[this.el] * (1.2 - s.speed * 0.4);
    this.cd = 0.6; this.punch = null; this.shots = [];
    this.g.audio.cast(this.el, this.m, this.caster.pos, this.look);
    this.g.fx.explosion(this.el, this.hand.position, 1.5, 0.3, this.pal, { look: this.look, noDecal: true });
  }
  homePos() {
    const c = this.caster, f = c.forward(new THREE.Vector3()).setY(0).normalize(), r = new THREE.Vector3(-f.z, 0, f.x);
    return c.pos.clone().addScaledVector(r, 1.4 + this.size * 0.5).addScaledVector(f, 0.6).setY(c.pos.y + 2.1 + Math.sin(this.t * 2) * 0.15);
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, fx = this.g.fx, alive = this.t < this.life && this.caster.alive;
    const target = this.nearestTarget(this.caster.eye(new THREE.Vector3()), null, -1, 45);
    const k = clamp(this.t / 0.3) * clamp((this.life - this.t) / 0.4);
    if (this.punch) {
      const P = this.punch; P.t += dt;
      const out = P.t < 0.25, tp = P.target.alive ? P.target.center() : P.to;
      this.hand.position.lerp(out ? tp : this.homePos(), clamp(dt * (out ? 14 : 8)));
      if (out && !P.hit && this.hand.position.distanceTo(tp) < 1.2) { P.hit = true; this.hit(P.target, 40, tp, { knock: tp.clone().sub(this.caster.center()).setY(0).setLength(10).setY(4), shatter: true }); fx.explosion(this.el, tp, 2, 0.6, this.pal, { look: this.look }); }
      if (P.t > 0.7) this.punch = null;
    } else this.hand.position.lerp(this.homePos(), clamp(dt * 6));
    if (target) this.hand.lookAt(target.center()); else this.hand.rotation.y = this.caster.yaw + Math.PI;
    this.hand.scale.setScalar(this.size * Math.max(0.01, k));
    const curl = this.punch ? 1 : 0.3 + Math.sin(this.t * 3) * 0.1;
    for (const F of this.hand.userData.fingers) { F.f.rotation.x = -curl * 0.8; F.b.rotation.x = -curl * 1.1; }
    if (Math.random() < 0.5) fx.element(this.el, this.hand.position, { count: 1, speed: 0.4, size: 0.2 * this.size, palette: this.pal, life: 0.5 });
    this.light(this.hand.position, 80 * k, 6);
    this.cd -= dt;
    if (alive && target && this.cd <= 0 && !this.punch) {
      this.cd = this.interval;
      if (this.el === 'earth' || (this.el === 'darkness' && Math.random() < 0.3)) this.punch = { t: 0, target, to: target.center() };
      else {
        const from = this.hand.position.clone(), to = target.center();
        const bh = this.barrierHit(from, to);
        if (this.el === 'lightning' || this.el === 'light') {
          const end = bh ? from.clone().lerp(to, bh.t) : to;
          fx.bolt(from, end, this.pal.color, { look: this.look, width: 0.06, dur: 0.14, jag: this.el === 'lightning' ? 0.2 : 0.03, branches: 0, flicker: false });
          if (bh) bh.bar.damage(8, end); else this.hit(target, 8, end);
          fx.explosion(this.el, end, 0.5, 0.1, this.pal, { look: this.look, noDecal: true });
        } else {
          const p = from.clone(), v = to.clone().sub(from).normalize().multiplyScalar(40); let tt = 0;
          const tr = this.trail(this.pal.color, this.pal.core, 0.12, 10, 2.5);
          fx.add((d2) => {
            tt += d2; const pr = p.clone(); p.addScaledVector(v, d2); tr.push(p);
            fx.element(this.el, p, { count: 1, speed: 0.2, size: 0.18, palette: this.pal, life: 0.3 });
            const b2 = this.barrierHit(pr, p);
            let hitT = null; for (const tg of this.targets()) if (tg.hits(p, 0.3)) hitT = tg;
            if (b2 || hitT || this.g.world.solid(p) || tt > 1.5) {
              if (hitT) this.hit(hitT, 9, p.clone()); if (b2) b2.bar.damage(8, p);
              fx.explosion(this.el, p, 0.6, 0.12, this.pal, { look: this.look, noDecal: true }); tr.dead = true; return false;
            }
            return true;
          });
        }
        this.g.audio.cast(this.el, 0.08, from, this.look);
      }
    }
    if (this.t > this.life + 0.5 && !this.done) { this.done = true; fx.explosion(this.el, this.hand.position, 1.2, 0.3, this.pal, { look: this.look, noDecal: true }); }
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ------------------------------------------------------------ MOVEMENT: leap / flight / blink
class LeapSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster, p = clamp(s.power * 0.6 + s.tier * 0.4);
    const f = c.forward(new THREE.Vector3()).setY(0).normalize();
    c.vel.y = 12 + 9 * p; c.vel.addScaledVector(f, 4 + s.speed * 6); c.grounded = false;
    this.g.fx.explosion(this.el, c.pos.clone().setY(c.pos.y + 0.3), 1.6 + p, 0.4, this.pal, { look: this.look,});
    this.g.fx.shockwave(c.pos.clone(), 6, 1, 0.4);
    for (const t of this.targets()) if (t.distTo(c.pos) < 3.5) this.hit(t, 18, t.center(), { knock: t.pos.clone().sub(c.pos).setY(0).setLength(9).setY(3) });
    this.g.audio.whoosh(0.8);
  }
  update(dt) {
    this.t += dt;
    if (this.t < 0.8) this.g.fx.element(this.el, this.caster.pos.clone().setY(this.caster.pos.y + 0.2), { count: 2, speed: 0.8, size: 0.35, palette: this.pal });
    if (this.t > 0.9) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
}
// one feather: a tapered leaf blade pointing up (uv.y runs root→tip so matter streams outward)
function bladeFeather(len) {
  const pts = [], NU = 10, pos = [], uv = [], idx = [];
  for (let i = 0; i <= NU; i++) { const t = i / NU, w = Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.16 * (1 - t * 0.3); for (const sx of [-1, 1]) { pos.push(sx * w + t * 0.35 * len * 0.3, t * len, 0); uv.push(sx < 0 ? 0 : 1, t); } }
  for (let i = 0; i < NU; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
class FlightSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, p = clamp(s.power * 0.6 + s.tier * 0.4);
    this.life = 5 + 9 * p + s.duration * 5;
    this.caster.flying = this.life; this.caster.vel.y = Math.max(this.caster.vel.y, 7);
    this.g.fx.ring(this.caster.pos.clone().setY(this.caster.pos.y + 0.2), this.pal.color, 5, 0.6);
    this.g.audio.cast('wind', this.m, this.caster.pos, this.look); this.g.audio.cast(this.el, 0.4, this.caster.pos, this.look);
    // wings: a fan of feather blades made of the spell's matter (flame, water, light…), with a glowing core for energy
    this.kit = kitOf(this.el, this.look);
    const fm = surfaceMaterial({ ...this.kit, opacity: 0.9 }, { spin: 0, twist: 0.3, bulge: 0 }); fm.uniforms.uFlow.value = 2.5; fm.uniforms.uTopFade.value = 1;
    this.mats = [fm];
    this.wings = [];
    for (const side of [-1, 1]) {
      const w = new THREE.Group(); w.userData.side = side; this.add(w);
      for (let k = 0; k < 6; k++) { // feathers fan out and lengthen toward the wing tip
        const len = 0.9 + k * 0.28, fg = bladeFeather(len);
        const f = new THREE.Mesh(fg, fm); f.userData.ownGeo = true; f.renderOrder = 3;
        f.rotation.z = side * (0.25 + k * 0.22); f.scale.x = side; f.position.x = side * 0.1; w.add(f);
      }
      this.wings.push(w);
    }
  }
  update(dt) {
    this.t += dt;
    const c = this.caster, fx = this.g.fx, on = c.flying > 0 && c.alive;
    const f = c.forward(new THREE.Vector3()).setY(0).normalize();
    for (const w of this.wings) {
      w.visible = on && !(c.isPlayer && this.g.firstPerson);
      w.position.copy(c.pos).addScaledVector(f, 0.25).setY(c.pos.y + 1.35);
      w.rotation.set(0, c.yaw, w.userData.side * (Math.sin(this.t * 6) * 0.35 - 0.1));
    }
    if (on) {
      const feet = c.pos.clone(); feet.y += 0.1;
      fx.element(this.el, feet, { count: 2, speed: 1.2, size: 0.3, palette: this.pal, dir: new THREE.Vector3(0, -1, 0), spread: 0.4 });
      if (Math.random() < 0.3) fx.ring(feet, this.pal.color, 1.6, 0.4);
    }
    for (const m of this.mats) m.uniforms.uFade.value = on ? clamp(this.t / 0.3) : 0;
    if (!on && this.t > 0.5) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
  dispose() { super.dispose(); }
}
class BlinkSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster, aim = c.getAim(), p = clamp(s.power * 0.6 + s.tier * 0.4);
    const range = 6 + 14 * p + s.size * 4;
    const from = c.pos.clone();
    const dir = aim.dir.clone(); if (c.grounded) dir.y = Math.max(dir.y, -0.1); dir.normalize();
    const eye = c.eye(new THREE.Vector3());
    const rc = this.g.world.raycast(eye, dir, range, 0.4);
    const dest = eye.clone().addScaledVector(dir, Math.max(0, rc.dist - 1)); dest.y -= 1.62;
    dest.y = Math.max(dest.y, this.g.world.groundAt(dest.x, dest.z, dest.y + 1.5));
    c.pos.copy(dest); c.vel.multiplyScalar(0.2);
    const fx = this.g.fx;
    for (const q of [from, dest]) { fx.explosion(this.el, q.clone().setY(q.y + 1), 1.4, 0.3, this.pal, { look: this.look, noDecal: true }); fx.shockwave(q.clone().setY(q.y + 1), 5, 1.2, 0.35); }
    // afterimage streak
    const pts = []; for (let i = 0; i <= 12; i++) pts.push(from.clone().lerp(dest, i / 12).setY(from.y + 1 + (dest.y - from.y) * (i / 12)));
    this.g.fx.bolt(pts[0], pts[pts.length - 1], this.pal.color, { look: this.look, width: 0.18, dur: 0.35, jag: 0.02, branches: 0, flicker: false });
    for (const t of this.targets()) { // damage anything crossed
      const ab = dest.clone().sub(from), ap = t.pos.clone().sub(from), k = clamp(ap.dot(ab) / Math.max(0.01, ab.lengthSq()));
      if (from.clone().addScaledVector(ab, k).distanceTo(t.pos) < 1.4) this.hit(t, 25, t.center(), { stun: this.el === 'lightning' ? 0.6 : 0.2 });
    }
    this.g.audio.cast('arcane', 0.6, dest, this.look); this.g.audio.whoosh(1);
    if (c.isPlayer) this.g.screenFlash?.('#' + this.pal.color.getHexString(), 0.25);
  }
  update(dt) { this.t += dt; if (this.t > 0.4) this.done = true; this.updateCommon(dt); return !this.finished(); }
}

// ------------------------------------------------------------ CONSTRUCT (solid structures you can stand on)
// conjured masonry shares the ruins' weathered stone shader (tinted per element); ice is translucent glacier glass
const CONSTRUCT_MAT = {
  earth: () => stoneMaterial(0xb8a080, { moss: 0.3, joint: 0.9 }), ice: () => new THREE.MeshStandardMaterial({ color: 0x9fd4f0, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.85, emissive: 0x1a4a70, emissiveIntensity: 0.25, vertexColors: true }),
  light: () => stoneMaterial(0xf0e2bc, { moss: 0, joint: 0.9 }), darkness: () => stoneMaterial(0x4a3a5a, { moss: 0.2, joint: 0.9 }), nature: () => stoneMaterial(0x8a9a6a, { moss: 1.2, joint: 0.9 }), fire: () => stoneMaterial(0x6a4a3c, { moss: 0, joint: 0.9 }),
};
function toonStone(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }); }
class ConstructSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster, aim = c.getAim(), W = this.g.world;
    const kind = s.construct || 'platform';
    const f = new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize(), yaw = Math.atan2(f.x, f.z);
    const scale = 0.7 + s.size * 0.8 + this.m * 0.4;
    this.life = 20 + 40 * clamp(s.power * 0.6 + s.tier * 0.4) + s.duration * 20;
    const mat = (CONSTRUCT_MAT[this.el] || (() => stoneMaterial(0xc8bca8, { moss: 0.4, joint: 0.9 })))();
    const trim = new THREE.MeshStandardMaterial({ color: this.pal.color, emissive: this.pal.color, emissiveIntensity: 1.2 });
    this.mats = [mat, trim];
    this.parts = []; // { mesh, box, h }
    const add = (cx, baseY, cz, hx, hy, hz) => {
      const box = W.addBox({ x: cx, y: baseY + hy, z: cz, hx, hy, hz, yaw });
      const bg = new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, Math.min(hx, hy, hz) * 0.25);
      bg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(bg.attributes.position.count * 3).fill(1), 3)); // stone shader reads vertex tint
      const m = new THREE.Mesh(bg, mat); m.userData.ownGeo = true;
      m.position.set(cx, baseY + hy, cz); m.rotation.y = yaw; m.castShadow = m.receiveShadow = true;
      for (const sz of [-1, 1]) { const edge = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.04, 0.07, 0.09), trim); edge.userData.ownGeo = true; edge.position.set(0, hy - 0.02, sz * (hz - 0.03)); m.add(edge); }
      this.add(m); m.scale.y = 0.01; m.userData.baseY = baseY; m.userData.hy = hy;
      this.parts.push({ m, box });
    };
    const P = c.pos.clone();
    const at = (d) => P.clone().addScaledVector(f, d);
    if (kind === 'stairs') {
      const n = Math.round(6 + s.size * 8 + this.m * 4);
      for (let i = 0; i < n; i++) { const q = at(1.6 + i * 0.85); const g = W.groundAt(q.x, q.z, P.y + i * 0.5 + 1); add(q.x, g, q.z, 1.3 * scale, Math.max(0.25, (P.y + (i + 1) * 0.5) - g) / 2, 0.45); }
    } else if (kind === 'box') {
      const q = aim.point.distanceTo(P) < 16 ? aim.point.clone() : at(8); const h = 1.3 * scale; add(q.x, W.heightAt(q.x, q.z) - 0.1, q.z, h, h, h);
    } else if (kind === 'pillar') { // rises under the caster, lifting them
      const h = 2 + s.size * 5 + this.m * 3; add(P.x, W.heightAt(P.x, P.z) - 0.2, P.z, 1.1, h / 2, 1.1); this.lift = h;
    } else if (kind === 'rampart') {
      const q = aim.point.distanceTo(P) < 14 ? aim.point.clone() : at(7); const w = 4 * scale, h = 1.8 + s.size * 1.6;
      add(q.x, W.heightAt(q.x, q.z) - 0.2, q.z, w, h, 0.6);
    } else { // platform / bridge extends forward at foot level
      const L = 5 + s.size * 10 + this.m * 4, q = at(L / 2 + 0.8);
      add(q.x, P.y - 0.45 + Math.max(0, aim.dir.y) * L * 0.3, q.z, 1.8 * scale, 0.22, L / 2);
      this.parts[0].m.rotation.x = 0; // flat
    }
    this.g.audio.impact('earth', 0.5, P, this.look); this.g.fx.addShake(0.15, P);
    for (const pt of this.parts) this.g.fx.explosion(this.el === 'ice' ? 'ice' : 'earth', pt.m.position, 1.2, 0.2, null, { noDecal: true });
  }
  update(dt) {
    this.t += dt;
    const rise = clamp(this.t / 0.35), fall = clamp((this.t - this.life) / 0.6), k = rise * (1 - fall);
    this.parts.forEach(({ m, box }, i) => {
      const kk = clamp(rise * 1.3 - i * 0.03) * (1 - fall);
      m.scale.y = Math.max(0.01, kk); m.position.y = m.userData.baseY + m.userData.hy * kk;
      box.y = m.userData.baseY + m.userData.hy * kk; box.hy = m.userData.hy * kk;
    });
    if (this.lift && this.t < 0.45) { const top = this.parts[0].box.y + this.parts[0].box.hy; if (this.caster.pos.y < top) { this.caster.pos.y = top; this.caster.vel.y = Math.max(0, this.caster.vel.y); } }
    if (fall >= 1 && !this.done) { this.done = true; for (const { m } of this.parts) this.g.fx.explosion('earth', m.position, 1.5, 0.3, null, { noDecal: true, debris: true }); }
    this.updateCommon(dt);
    return !this.finished() && k >= 0;
  }
  dispose() { super.dispose(); for (const { box } of this.parts) this.g.world.removeBox(box); this.mats.forEach((m) => m.dispose()); }
}

const SHAPE_CLASS = { orb: MissileSpell, barrage: MissileSpell, field: FieldSpell, wave: WaveSpell, enhance: EnhanceSpell, hand: HandSpell, leap: LeapSpell, flight: FlightSpell, blink: BlinkSpell, construct: ConstructSpell, funnels: FunnelSpell, beam: BeamSpell, tornado: TornadoSpell, meteor: MeteorSpell, nova: NovaSpell, spikes: SpikeSpell, wall: WallSpell, barrier: BarrierSpell, vortex: VortexSpell, chain: ChainSpell, storm: StormSpell, crescent: CrescentSpell, ward: WardSpell };

// ------------------------------------------------------------ system
export class SpellSystem {
  constructor(game) { this.game = game; this.active = []; this.barriers = []; this.seeds = []; }
  castOrigin(c) { return c.castOrigin ? c.castOrigin() : c.eye(new THREE.Vector3()); }
  cast(spec, caster) {
    const Cls = SHAPE_CLASS[spec.shape] || OrbSpell;
    const g = this.game;
    const origin = this.castOrigin(caster).clone();
    if (!spec.basic) {
      g.audio.cast(spec.element, spec.mag, origin, this.look);
      const pal = lookOf(spec, paletteFor(spec.element, spec.temperature)).pal;
      const fp = caster.isPlayer;
      g.fx.flash(origin, pal.color, fp ? 0.15 + spec.mag * 0.15 : 0.6 + spec.mag * 0.8, 0.2, fp ? 1.5 : 4);
      // casting sigil in front of the caster
      const mc = new MagicCircle({ seed: spec.seed, tier: spec.tierInt, color: pal.color, radius: fp ? 0.3 + spec.mag * 0.35 : 0.6 + spec.mag * 1.2, intensity: fp ? 1.1 : 2.2 });
      const aim = caster.getAim();
      g.scene.add(mc.group); let t = 0;
      g.fx.add((dt) => {
        t += dt; mc.target = t < 0.35 ? 1 : 0; mc.update(dt);
        mc.group.position.copy(this.castOrigin(caster)).addScaledVector(aim.dir, fp ? 1.4 + spec.mag * 0.6 : 0.6 + spec.mag * 0.3);
        mc.group.lookAt(_v.copy(mc.group.position).add(aim.dir));
        mc.group.scale.setScalar(1 + t * (fp ? 0.8 : 1.5));
        if (t > 0.9) { mc.dispose(); return false; }
        return true;
      });
    }
    if (!spec.basic && (spec.level ?? 1) >= 2) this.manifest(spec, caster);
    const s = new Cls(this, spec, caster, caster.getAim());
    this.active.push(s);
    return s;
  }
  // Greater: ground sigil + pillar of light around the caster. Ultimate: a full domain takeover of the sky.
  manifest(spec, caster) {
    const g = this.game, fx = g.fx, pal = lookOf(spec, paletteFor(spec.element, spec.temperature)).pal, lvl = spec.level;
    const fp = caster.isPlayer;
    const base = caster.pos.clone(); base.y = g.world.groundAt(base.x, base.z, base.y + 0.5) + 0.12;
    const R = lvl === 3 ? 7 : 3.5;
    const colBase = fp ? base.clone().addScaledVector(caster.forward(new THREE.Vector3()).setY(0).normalize(), 9) : base.clone();
    if (fp) colBase.y = g.world.groundAt(colBase.x, colBase.z, base.y + 2);
    const circles = [0, 1, 2].slice(0, lvl === 3 ? 3 : 1).map((i) => {
      const mc = new MagicCircle({ seed: spec.seed + i * 17, tier: spec.tierInt, color: pal.color, radius: R * (1 - i * 0.28), intensity: 1.6 });
      mc.group.rotation.x = -Math.PI / 2; mc.group.position.copy(base).y += i * 0.05; mc.spin = (i % 2 ? -1 : 1) * (0.8 + i * 0.4); g.scene.add(mc.group); return mc;
    });
    const col = new THREE.Mesh(BEAM_GEO, flowMaterial({ color: pal.color, core: pal.core, intensity: fp ? 1.4 : 2.2, scroll: -6, twist: 0.8, stripes: 3, opacity: fp ? 0.55 : 0.8 }));
    col.rotation.x = -Math.PI / 2; col.position.copy(colBase); g.scene.add(col);
    fx.shockwave(colBase.clone().setY(colBase.y + 1), R * 2, fp ? 0.6 : 1.2, 0.6);
    fx.ring(base, pal.color, R * 2.2, 0.8);
    g.audio.cast('light', 0.9, base, this.look); g.audio.impact(spec.element, 0.5 + lvl * 0.2, base, this.look);
    if (lvl === 3) g.domain?.(spec.element, pal, base);
    let t = 0; const life = lvl === 3 ? 2.6 : 1.4, H = lvl === 3 ? 60 : 14;
    fx.add((dt) => {
      t += dt; const k = Math.min(1, t / 0.25) * Math.max(0, 1 - Math.max(0, t - life + 0.6) / 0.6);
      circles.forEach((mc) => { mc.target = k; mc.update(dt); });
      const cw = (fp ? 0.18 : 0.35) * R;
      col.scale.set(cw * k * (1 + Math.sin(t * 30) * 0.05) + 0.01, cw * k + 0.01, H * Math.min(1, t / 0.3));
      for (let i = 0; i < 3 + lvl * 3; i++) { const a = Math.random() * TAU, d = R * Math.sqrt(Math.random()); fx.glow.emit({ x: base.x + Math.cos(a) * d, y: base.y, z: base.z + Math.sin(a) * d, vy: 3 + Math.random() * 6 * lvl, life: 1, size: 0.15 + Math.random() * 0.2, color: Math.random() < 0.5 ? pal.core : pal.color, alpha: k, drag: 0.3, frame: 1 }); }
      fx.lights.request(colBase.clone().setY(colBase.y + 3), pal.color, (fp ? 200 : 500) * k, R * 5);
      if (t > life) { circles.forEach((mc) => mc.dispose()); g.scene.remove(col); col.material.dispose(); return false; }
      return true;
    });
  }
  spawnField(spec, caster, pos, radius, dur) {
    const f = new FieldSpell(this, spec, caster, caster.getAim(), { pos, radius, dur });
    this.active.push(f); return f;
  }
  spikeRing(spell, center, R) {
    const n = 14, mat = crystalMaterial({ color: spell.el === 'ice' ? 0x9ad8f8 : 0x7a6248, glow: spell.pal.color, emissive: 1.0, crack: 0.3 });
    const spikes = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, p = center.clone().add(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
      p.y = this.game.world.heightAt(p.x, p.z) - 0.2;
      const m = new THREE.Mesh(SPIKE_GEOS[i % 3], mat); m.position.copy(p); m.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); m.scale.set(0.5, 0.01, 0.5);
      this.game.scene.add(m); spikes.push(m);
    }
    let t = 0;
    this.game.fx.add((dt) => {
      t += dt; const k = clamp(t / 0.15) * (1 - clamp((t - 1.2) / 0.4));
      spikes.forEach((m) => (m.scale.y = Math.max(0.01, 2.5 * k)));
      if (t > 1.6) { spikes.forEach((m) => this.game.scene.remove(m)); mat.dispose(); return false; }
      return true;
    });
  }
  spawnSeeds(pos, n, dmg, src) {
    const g = this.game, pal = paletteFor('nature');
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: pal.color, core: 0xffffff, intensity: 2.5, noiseAmp: 0.2 }));
      m.scale.setScalar(0.25); m.position.copy(pos); g.scene.add(m);
      const v = new THREE.Vector3(rand(-4, 4), rand(4, 7), rand(-4, 4));
      let t = 0;
      g.fx.add((dt) => {
        t += dt; v.y -= 14 * dt; m.position.addScaledVector(v, dt);
        const gy = g.world.heightAt(m.position.x, m.position.z); if (m.position.y < gy + 0.25) { m.position.y = gy + 0.25; v.set(0, 0, 0); }
        m.scale.setScalar(0.25 + Math.sin(t * 20) * 0.04 * t);
        if (t > 1.3) {
          g.scene.remove(m); m.material.dispose();
          g.fx.explosion('nature', m.position, 2.2, 0.4, pal, { noDecal: true });
          g.audio.impact('nature', 0.3, m.position, this.look);
          for (const c of g.combatants) if (c !== src && c.alive && c.distTo(m.position) < 2.5) applyHit(g, c, { dmg, el: null, src, point: m.position.clone(), dotEl: 'nature' });
          return false;
        }
        return true;
      });
    }
  }
  threatsFor(c) {
    const out = [];
    for (const s of this.active) if (s.caster !== c) out.push(...s.threats());
    return out;
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      let alive;
      try { alive = s.update(dt); } catch (e) { console.error(e); alive = false; }
      if (!alive) { s.dispose(); this.active.splice(i, 1); }
    }
  }
  clear() { for (const s of this.active) s.dispose(); this.active.length = 0; this.barriers.length = 0; }
}
