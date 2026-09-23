import * as THREE from 'three';
import { toon } from './world.js';
import { energyMaterial, barrierMaterial, addOutline, TIME } from './shaders.js';
import { MagicCircle } from './magicCircle.js';
import { ELEMENTS } from './elements.js';

const cyl = (rt, rb, h, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, -h / 2, 0); return g; }; // hangs down from its pivot

// ------------------------------------------------------------------ battlemage (bots / remote players). Faces -Z.
export class MageModel {
  constructor({ robe = 0x2a2350, trim = 0xe0b95a, accent = 0xff4a6a, skin = 0xf3d2b8, hat = 0x1d1838 } = {}) {
    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group()); root.add(body);
    const coat = toon(robe), coatDark = toon(new THREE.Color(robe).multiplyScalar(0.6)), trimM = toon(trim, { emissive: new THREE.Color(trim).multiplyScalar(0.12) });
    const leather = toon(0x3a2a22), metal = toon(0x4a4e5a), hood = toon(hat), mask = toon(0x15121a);
    this.accentColor = new THREE.Color(accent);
    this.glowMat = new THREE.MeshBasicMaterial({ color: this.accentColor.clone().multiplyScalar(3.5) });
    // legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0.11 * s, 0.93, 0); body.add(hip);
      hip.add(new THREE.Mesh(cyl(0.085, 0.07, 0.46), coatDark));
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      knee.add(new THREE.Mesh(cyl(0.068, 0.055, 0.4), leather));
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.26), leather); boot.position.set(0, -0.43, -0.05); knee.add(boot);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10), trimM); cuff.position.y = -0.28; knee.add(cuff);
      this.legs.push({ hip, knee, s });
    }
    // coat skirt
    const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.3 - 0.1 * t + Math.sin(t * 9) * 0.006, 0.52 + t * 0.46)); }
    this.skirt = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), coat); body.add(this.skirt);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 24), trimM); hem.rotation.x = Math.PI / 2; hem.position.y = 0.52; body.add(hem);
    // torso
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.19, 0.52, 12), coat); chest.position.y = 1.2; chest.scale.z = 0.8; body.add(chest);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 20), leather); belt.rotation.x = Math.PI / 2; belt.position.y = 0.97; belt.scale.y = 0.8; body.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), trimM); buckle.position.set(0, 0.97, -0.17); body.add(buckle);
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), trimM); sash.position.set(0.05, 1.2, -0.19); sash.rotation.z = 0.5; body.add(sash);
    const mantle = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.26, 16, 1, true), hood); mantle.position.y = 1.47; body.add(mantle);
    for (const s of [-1, 1]) { const pad = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal); pad.position.set(0.27 * s, 1.43, 0); pad.scale.set(1.2, 0.8, 1.1); body.add(pad); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.015, 5, 16), trimM); rim.rotation.x = Math.PI / 2; rim.position.set(0.27 * s, 1.43, 0); body.add(rim); }
    // head: hood + mask with glowing eyes
    const head = (this.head = new THREE.Group()); head.position.y = 1.64; body.add(head);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), toon(skin)));
    const maskM = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.35, Math.PI * 0.45), mask); maskM.rotation.y = Math.PI; head.add(maskM);
    const hoodM = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14, Math.PI * 0.2, Math.PI * 1.6, 0, Math.PI * 0.72), hood); hoodM.position.set(0, 0.03, 0.02); hoodM.rotation.y = Math.PI * 0.5; head.add(hoodM);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 10), hood); tip.position.set(0, 0.18, 0.08); tip.rotation.x = 0.7; head.add(tip);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.02), this.glowMat); e.position.set(0.045 * s, 0.01, -0.13); e.rotation.z = -0.25 * s; head.add(e); }
    // arms with gauntlets
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0.3 * s, 1.4, 0); body.add(sh);
      sh.add(new THREE.Mesh(cyl(0.06, 0.055, 0.3), coat));
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      el.add(new THREE.Mesh(cyl(0.05, 0.045, 0.14), coatDark));
      const gnt = new THREE.Mesh(cyl(0.085, 0.07, 0.17, 10), metal); gnt.position.y = -0.1; el.add(gnt);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.014, 5, 18), this.glowMat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.17; el.add(ring);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 5, 18), trimM); ring2.rotation.x = Math.PI / 2; ring2.position.y = -0.25; el.add(ring2);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.07), metal); hand.position.y = -0.33; el.add(hand);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), this.glowMat); gem.position.set(0, -0.3, 0.04 * -1); el.add(gem);
      this.arms.push({ sh, el, gem, s });
    }
    this.handGem = this.arms[1].gem;
    // cape
    const capeGeo = new THREE.PlaneGeometry(0.55, 1.1, 4, 10); capeGeo.translate(0, -0.55, 0);
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.cape = new THREE.Mesh(capeGeo, toon(accent, { side: THREE.DoubleSide })); this.cape.position.set(0, 1.45, 0.17); this.cape.rotation.x = 0.1; body.add(this.cape);
    // outlines
    body.traverse((m) => { if (m.isMesh && m.material.type === 'MeshToonMaterial' && m !== this.cape) addOutline(m, 0.012); });
    // status visuals
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x3aa8ff, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.75, flatShading: true }));
    this.shell.scale.set(0.7, 1.15, 0.7); this.shell.position.y = 1.0; this.shell.visible = false; root.add(this.shell);
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 20), barrierMaterial({ color: 0xffd46a, intensity: 1.5 })); this.bubble.position.y = 1.0; this.bubble.visible = false; root.add(this.bubble);
    this.auraRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.auraRing.rotation.x = -Math.PI / 2; this.auraRing.position.y = 0.05; this.auraRing.visible = false; root.add(this.auraRing);
    this.chantOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 3), energyMaterial({ color: accent, intensity: 2.2, noiseAmp: 0.03, flow: 4 }));
    this.chantOrb.visible = false; body.add(this.chantOrb);
    root.traverse((m) => { if (m.isMesh && m.material.type === 'MeshToonMaterial') { m.castShadow = true; m.receiveShadow = true; } });
    this.walk = 0; this.castAnim = 0; this.chant = 0;
  }
  setElement(el) { const c = new THREE.Color(ELEMENTS[el]?.color ?? 0xffffff); this.glowMat.color.copy(c).multiplyScalar(3.5); this.chantOrb.material.uniforms.uColor.value.copy(c); }
  handWorld(out = new THREE.Vector3()) { return (this.chant > 0.3 ? this.chantOrb : this.handGem).getWorldPosition(out); }
  update(dt, s) {
    const t = TIME.value, sp = Math.min(1, (s.speed || 0) / 6);
    this.walk += dt * (s.speed || 0) * 1.35;
    this.castAnim = Math.max(0, this.castAnim - dt * 3.5);
    this.chant += ((s.chanting ? 1 : 0) - this.chant) * Math.min(1, dt * 8);
    const w = this.walk;
    for (const L of this.legs) {
      const ph = w + (L.s > 0 ? Math.PI : 0);
      L.hip.rotation.x = Math.sin(ph) * 0.65 * sp;
      L.knee.rotation.x = -Math.max(0, Math.sin(ph - 1.2)) * 1.0 * sp;
    }
    this.body.position.y = Math.abs(Math.sin(w)) * 0.05 * sp + Math.sin(t * 2) * 0.008;
    this.body.rotation.x = 0.08 * sp;
    this.skirt.rotation.x = -0.06 * sp;
    for (const A of this.arms) {
      const swing = Math.sin(w + (A.s > 0 ? 0 : Math.PI)) * 0.5 * sp;
      const castR = A.s > 0 ? this.castAnim : 0;
      A.sh.rotation.x = swing * (1 - this.chant) + this.chant * 1.25 + castR * 1.5;
      A.sh.rotation.z = A.s * (0.12 - this.chant * 0.35);
      A.el.rotation.x = 0.25 + this.chant * 0.5 - castR * 0.2;
    }
    this.chantOrb.visible = this.chant > 0.05;
    this.chantOrb.position.set(0, 1.25, -0.52);
    this.chantOrb.scale.setScalar(this.chant * (1 + Math.sin(t * 12) * 0.1));
    this.head.rotation.x = -(s.pitch || 0) * 0.5;
    const cp = this.cape.geometry.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = this.capeBase[i * 3 + 1], x = this.capeBase[i * 3];
      cp.setZ(i, this.capeBase[i * 3 + 2] + Math.sin(t * 4 + y * 4 + x * 3) * 0.04 * -y + -y * 0.35 * sp);
    }
    cp.needsUpdate = true;
    this.shell.visible = !!s.frozen;
    this.bubble.visible = s.shield > 0;
    if (this.bubble.visible) this.bubble.material.uniforms.uAlpha.value = Math.min(1, 0.4 + s.shield / 150);
    this.auraRing.visible = !!s.aura;
    if (s.aura) { this.auraRing.material.color.set(ELEMENTS[s.aura].color).multiplyScalar(2); this.auraRing.rotation.z += dt; this.auraRing.material.opacity = 0.5 + Math.sin(t * 6) * 0.3; }
  }
}

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
let _env = null;
export function initViewEnv(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  _env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
}

// ------------------------------------------------------------------ first-person magic staff
function helix(r0, r1, y0, y1, turns, phase = 0) {
  const pts = [];
  for (let i = 0; i <= 80; i++) { const t = i / 80, a = phase + t * turns * Math.PI * 2, r = r0 + (r1 - r0) * t; pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + (y1 - y0) * t, Math.sin(a) * r)); }
  return new THREE.CatmullRomCurve3(pts);
}
export class ViewModel {
  constructor(camera) {
    this.group = new THREE.Group(); camera.add(this.group);
    const staff = (this.staff = new THREE.Group()); this.group.add(staff);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.55, metalness: 0.05, envMap: _env, envMapIntensity: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8c068, metalness: 1, roughness: 0.22, envMap: _env, envMapIntensity: 1.3 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.8 });
    // carved shaft (lathe profile with knots)
    const prof = []; for (let i = 0; i <= 40; i++) { const y = -1.3 + (i / 40) * 1.45; const r = 0.022 + 0.004 * Math.sin(i * 1.7) + (y > 0.05 ? 0.008 : 0) + (i < 3 ? -0.01 * (3 - i) / 3 : 0); prof.push(new THREE.Vector2(Math.max(0.006, r), y)); }
    staff.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 14), wood));
    staff.add(new THREE.Mesh(new THREE.TubeGeometry(helix(0.027, 0.03, -0.9, 0.08, 4.5), 160, 0.0045, 5), gold));
    staff.add(new THREE.Mesh(new THREE.TubeGeometry(helix(0.027, 0.03, -0.9, 0.08, 4.5, Math.PI), 160, 0.003, 5), gold));
    for (let i = 0; i < 9; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.007, 6, 16), leather); r.rotation.x = Math.PI / 2; r.position.y = -0.52 - i * 0.022; r.rotation.z = i * 0.4; staff.add(r); }
    for (const y of [-0.42, -0.74, 0.08]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.008, 8, 20), gold); r.rotation.x = Math.PI / 2; r.position.y = y; staff.add(r); }
    // head: golden cradle of four curling claws + halo ring
    const head = (this.head = new THREE.Group()); head.position.y = 0.12; staff.add(head);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.05, 0.05, Math.sin(a) * 0.05), new THREE.Vector3(Math.cos(a) * 0.07, 0.13, Math.sin(a) * 0.07), new THREE.Vector3(Math.cos(a) * 0.035, 0.2, Math.sin(a) * 0.035), new THREE.Vector3(Math.cos(a + 0.4) * 0.012, 0.215, Math.sin(a + 0.4) * 0.012)]);
      head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.007, 6), gold));
    }
    this.haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.005, 6, 48), gold); this.haloRing.position.y = 0.11; head.add(this.haloRing);
    this.crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0x9fd8ff, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0, transmission: 0.3, thickness: 0.1, flatShading: true, envMap: _env, envMapIntensity: 1.5 });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), this.crystalMat); this.crystal.scale.set(1, 1.9, 1); this.crystal.position.y = 0.11; head.add(this.crystal);
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 3), energyMaterial({ color: 0x9fd8ff, core: 0xffffff, intensity: 2, noiseAmp: 0.006, flow: 4 })); this.core.position.y = 0.11; head.add(this.core);
    this.runes = [];
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.012, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fd8ff).multiplyScalar(3) })); m.scale.y = 1.8; head.add(m); this.runes.push(m); }
    // charge orb + sigil that grow while chanting
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 4), energyMaterial({ color: 0x9fd8ff, core: 0xffffff, intensity: 2, noiseAmp: 0.01, noiseFreq: 3, flow: 6 }));
    this.orb.position.y = 0.11; head.add(this.orb);
    this.sigil = null; this.sigilTier = 0;
    this.light = new THREE.PointLight(0x9fd8ff, 0.3, 2.5, 2); this.light.position.y = 0.11; head.add(this.light);
    this.group.traverse((m) => { if (m.isMesh) m.renderOrder = 20; });
    this.bob = 0; this.kick = 0; this.flick = 0; this.charge = 0; this.color = new THREE.Color(0x9fd8ff);
  }
  setElement(el) {
    const c = new THREE.Color(ELEMENTS[el]?.color ?? 0x9fd8ff); this.color.copy(c);
    this.crystalMat.emissive.copy(c); this.core.material.uniforms.uColor.value.copy(c); this.orb.material.uniforms.uColor.value.copy(c);
    for (const r of this.runes) r.material.color.copy(c).multiplyScalar(3);
    this.light.color.copy(c);
    if (this.sigil) this.sigil.setColor(c, 1.4);
  }
  setTier(tier) {
    if (tier === this.sigilTier) return;
    this.sigilTier = tier;
    if (this.sigil) { this.sigil.dispose(); this.sigil = null; }
    if (tier > 0) { this.sigil = new MagicCircle({ seed: 3, tier, color: this.color, radius: 0.09 + tier * 0.012, intensity: 1.4 }); this.sigil.group.position.set(0, 0.11, -0.12); this.sigil.group.traverse((m) => { if (m.isMesh) m.renderOrder = 21; }); this.head.add(this.sigil.group); }
  }
  set visible(v) { this.group.visible = v; }
  tipWorld(out = new THREE.Vector3()) { return this.crystal.getWorldPosition(out); }
  update(dt, { speed = 0, chanting = false, charge = 0, grounded = true }) {
    const t = TIME.value;
    this.bob += dt * speed * 1.4;
    this.kick = Math.max(0, this.kick - dt * 3.2); this.flick = Math.max(0, this.flick - dt * 6);
    this.charge += ((chanting ? 1 : 0) - this.charge) * Math.min(1, dt * 8);
    const b = grounded ? Math.min(1, speed / 7) : 0.2, c = this.charge, k = Math.sin(Math.min(1, this.kick) * Math.PI * 0.5), f = this.flick;
    const sway = Math.sin(t * 1.4) * 0.004;
    this.group.position.set(0.3 - c * 0.12 + Math.cos(this.bob) * 0.012 * b, -0.36 + c * 0.1 + Math.abs(Math.sin(this.bob)) * 0.02 * b + sway - k * 0.03, -0.62 - k * 0.14 - f * 0.06);
    this.group.rotation.set(0.12 + c * 0.25 - k * 0.55 - f * 0.25, -0.1 + c * 0.15, -0.1 - c * 0.12 + Math.sin(t * 2) * 0.01);
    this.crystal.rotation.y += dt * (1.5 + c * 8);
    this.haloRing.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.2; this.haloRing.rotation.z += dt * (0.5 + c * 3);
    this.runes.forEach((r, i) => { const a = t * (2 + c * 5) + (i * Math.PI * 2) / 3, R = 0.07 + c * 0.03; r.position.set(Math.cos(a) * R, 0.11 + Math.sin(t * 3 + i) * 0.02, Math.sin(a) * R); r.rotation.y += dt * 4; });
    const orbK = Math.max(c, k);
    this.orb.visible = orbK > 0.03;
    this.orb.scale.setScalar(orbK * (0.6 + charge * 1.2) * (1 + Math.sin(t * 16) * 0.05));
    this.crystalMat.emissiveIntensity = 0.7 + c * 1.6 + k * 2.4;
    this.light.intensity = 0.3 + c * (0.6 + charge * 1.2) + k * 1.5;
    if (this.sigil) { this.sigil.target = c; this.sigil.update(dt); }
  }
}
