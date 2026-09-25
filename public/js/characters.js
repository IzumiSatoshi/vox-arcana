import * as THREE from 'three';
import { toon } from './world.js';
import { energyMaterial, barrierMaterial, addOutline, TIME } from './shaders.js';
import { MagicCircle } from './magicCircle.js';
import { ELEMENTS } from './elements.js';
import { elementKit, surfaceMaterial } from './vfxkit.js';

const cyl = (rt, rb, h, seg = 20) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, -h / 2, 0); return g; }; // hangs down from its pivot

// lathe from [radius, y] pairs (bottom to top); phi 0 faces +Z (the back), the model faces -Z
const lathe = (pts, seg = 32, phiStart = 0, phiLen = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
const FLASH = new THREE.Color(1.0, 0.92, 0.85);
const lift = (c, k) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k);
const waveHem = (g, below, amp = 1) => { // scalloped hem that dips toward the back
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) if (P.getY(i) < below) { const a = Math.atan2(P.getX(i), P.getZ(i)); P.setY(i, P.getY(i) + (Math.sin(a * 6) * 0.025 - Math.max(0, Math.cos(a)) * 0.05) * amp); }
  g.computeVertexNormals(); return g;
};

// ------------------------------------------------------------------ battlemage (bots / remote players). Faces -Z.
// Stylised anime silhouette: wide-brimmed bent witch hat over a shadowed face with glowing eyes, high collar, a long
// front-split coat with a contrasting lining, bell sleeves, belt with pouches and a grimoire, scarf tails and a notched cape.
export class MageModel {
  constructor({ robe = 0x2a2350, trim = 0xe0b95a, accent = 0xff4a6a, hat = 0x1d1838 } = {}) {
    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group()); root.add(body);
    // daylight palette: lift the very dark cloth so the cel bands read at a distance
    const robeC = lift(robe, 0.14), hatC = lift(hat, 0.1);
    const coat = toon(robeC), coatDark = toon(robeC.clone().multiplyScalar(0.62)), trimM = toon(trim, { emissive: new THREE.Color(trim).multiplyScalar(0.12) });
    const lining = toon(new THREE.Color(accent).multiplyScalar(0.55), { side: THREE.BackSide });
    const leather = toon(0x4a3326), metal = toon(0x5c6270), hood = toon(hatC), voidM = new THREE.MeshBasicMaterial({ color: 0x0c0a12 });
    const cloth = toon(new THREE.Color(accent).multiplyScalar(0.9), { side: THREE.DoubleSide });
    this.accentColor = new THREE.Color(accent);
    this.glowMat = new THREE.MeshBasicMaterial({ color: this.accentColor.clone().multiplyScalar(3.5) });
    // legs: slim trousers into cuffed boots
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0.1 * s, 0.93, 0); body.add(hip);
      hip.add(new THREE.Mesh(cyl(0.08, 0.062, 0.46), coatDark));
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      knee.add(new THREE.Mesh(lathe([[0.05, -0.47], [0.066, -0.4], [0.064, -0.2], [0.075, -0.06], [0.07, 0.0]], 16), leather));
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 10), leather); toe.scale.set(0.9, 0.55, 1.7); toe.position.set(0, -0.45, -0.07); knee.add(toe);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.016, 8, 24), trimM); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.05; knee.add(cuff);
      this.legs.push({ hip, knee, s });
    }
    // long coat: flares from the waist, split open at the front, scalloped hem, contrasting lining
    const OPEN = 0.32, coatGeo = waveHem(lathe([[0.44, 0.3], [0.41, 0.4], [0.35, 0.57], [0.29, 0.74], [0.235, 0.88], [0.2, 0.99]], 40, Math.PI + OPEN, Math.PI * 2 - OPEN * 2), 0.31);
    this.skirt = new THREE.Mesh(coatGeo, coat); body.add(this.skirt);
    const lin = new THREE.Mesh(coatGeo, lining); lin.scale.set(0.97, 1, 0.97); this.skirt.add(lin);
    this.skirt.add(new THREE.Mesh(waveHem(lathe([[0.446, 0.27], [0.446, 0.315]], 40, Math.PI + OPEN, Math.PI * 2 - OPEN * 2), 1), trimM));
    // torso with a waist, chest and shoulders; vest front with buttons; high open collar
    const chest = new THREE.Mesh(lathe([[0.17, 0.94], [0.18, 1.04], [0.215, 1.2], [0.235, 1.33], [0.2, 1.43], [0.09, 1.5]], 28), coat); chest.scale.z = 0.8; body.add(chest);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.02), coatDark); vest.position.set(0, 1.2, -0.185); body.add(vest);
    for (let k = 0; k < 3; k++) { const btn = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), trimM); btn.position.set(0, 1.1 + k * 0.1, -0.198); body.add(btn); }
    const collar = new THREE.Mesh(lathe([[0.12, 1.43], [0.145, 1.52], [0.175, 1.62]], 28, Math.PI + 0.55, Math.PI * 2 - 1.1), coat); body.add(collar);
    const collarIn = new THREE.Mesh(collar.geometry, lining); collarIn.scale.set(0.96, 1, 0.96); body.add(collarIn);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 10, 36), leather); belt.rotation.x = Math.PI / 2; belt.position.y = 0.98; belt.scale.y = 0.8; body.add(belt);
    const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 8, 16), trimM); buckle.position.set(0, 0.98, -0.16); body.add(buckle);
    for (const [a, w] of [[0.9, 0.07], [2.4, 0.06]]) { const pouch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.05), leather); pouch.position.set(Math.sin(a) * 0.2, 0.93, Math.cos(a) * 0.16); pouch.rotation.y = a; body.add(pouch); }
    const book = new THREE.Group(); book.position.set(-0.22, 0.9, 0.02); book.rotation.set(0, Math.PI / 2, 0.15); body.add(book);
    book.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), toon(new THREE.Color(accent).multiplyScalar(0.5))));
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.056), trimM); clasp.position.x = 0.07; book.add(clasp);
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal); pad.position.set(0.25 * s, 1.42, 0); pad.scale.set(1.25, 0.75, 1.1); pad.rotation.z = -0.25 * s; body.add(pad);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.013, 8, 28), trimM); rim.rotation.set(Math.PI / 2, 0.25 * s, 0); rim.position.set(0.25 * s, 1.42, 0); body.add(rim);
    }
    // head: a shadowed void under the brim with two glowing eyes; wide drooping brim; crown bent back at the tip
    const head = (this.head = new THREE.Group()); head.position.y = 1.64; body.add(head);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.125, 28, 20), voidM));
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), this.glowMat); e.scale.set(1, 1.5, 0.5); e.position.set(0.045 * s, 0.0, -0.112); head.add(e); }
    const hatG = new THREE.Group(); hatG.position.y = 0.07; hatG.rotation.x = -0.12; head.add(hatG);
    const brimGeo = lathe([[0.46, -0.045], [0.4, -0.02], [0.3, 0.004], [0.2, 0.012], [0.14, 0.014]], 40);
    { const P = brimGeo.attributes.position; for (let i = 0; i < P.count; i++) { const a = Math.atan2(P.getX(i), P.getZ(i)), r = Math.hypot(P.getX(i), P.getZ(i)); P.setY(i, P.getY(i) - Math.max(0, Math.cos(a)) * (r - 0.14) * 0.18 + Math.sin(a * 3) * 0.008 * r); } brimGeo.computeVertexNormals(); }
    hatG.add(new THREE.Mesh(brimGeo, hood));
    hatG.add(new THREE.Mesh(brimGeo, toon(hatC.clone().multiplyScalar(0.7), { side: THREE.BackSide })));
    const crownGeo = lathe([[0.155, 0], [0.15, 0.08], [0.125, 0.18], [0.09, 0.3], [0.055, 0.42], [0.025, 0.52], [0.0, 0.58]], 28);
    { const P = crownGeo.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i), k = Math.max(0, y - 0.18); P.setZ(i, P.getZ(i) + k * k * 1.3); P.setY(i, y - k * k * 0.35); } crownGeo.computeVertexNormals(); }
    hatG.add(new THREE.Mesh(crownGeo, hood));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.02, 8, 36), trimM); band.rotation.x = Math.PI / 2; band.position.y = 0.035; hatG.add(band);
    const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), this.glowMat); charm.position.set(0.1, 0.05, -0.12); hatG.add(charm);
    // arms: fitted upper sleeve, bell cuff with lining, metal gauntlet with a glowing ring and a palm gem
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0.28 * s, 1.39, 0); body.add(sh);
      sh.add(new THREE.Mesh(cyl(0.062, 0.056, 0.3), coat));
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      const bell = new THREE.Mesh(lathe([[0.1, -0.2], [0.085, -0.12], [0.06, -0.02], [0.055, 0.02]], 20), coat); el.add(bell);
      const bellIn = new THREE.Mesh(bell.geometry, lining); bellIn.scale.set(0.95, 1, 0.95); el.add(bellIn);
      const bellHem = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 28), trimM); bellHem.rotation.x = Math.PI / 2; bellHem.position.y = -0.2; el.add(bellHem);
      const gnt = new THREE.Mesh(cyl(0.05, 0.048, 0.12, 16), metal); gnt.position.y = -0.14; el.add(gnt);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.011, 8, 28), this.glowMat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.2; el.add(ring);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), metal); hand.scale.set(0.9, 1.15, 0.75); hand.position.y = -0.3; el.add(hand);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), this.glowMat); gem.position.set(0, -0.3, -0.04); el.add(gem);
      this.arms.push({ sh, el, gem, s });
    }
    this.handGem = this.arms[1].gem;
    // a staff in the casting hand (crook of gilt wire round a glowing focus): the silhouette reads "mage" at any range,
    // and spells leave from its tip
    {
      const el = this.arms[1].el, staff = new THREE.Group(); staff.position.set(0, -0.3, -0.07); staff.rotation.set(-0.45, 0, -0.38); el.add(staff); // leans out past the hat brim
      const wood = toon(0x5a3a24);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 1.55, 8), wood); shaft.position.y = 0.25; staff.add(shaft);
      const crook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 20, Math.PI * 1.5), trimM); crook.position.set(0, 1.08, 0); crook.rotation.z = -Math.PI * 0.25; staff.add(crook);
      const focus = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), this.glowMat); focus.scale.y = 1.6; focus.position.y = 1.08; staff.add(focus);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 6, 16), trimM); ring.rotation.x = Math.PI / 2; ring.position.y = 1.0; staff.add(ring);
      this.staffTip = focus;
    }
    // cape: tapered, flaring toward a notched hem (animated in update via capeBase)
    const capeGeo = new THREE.PlaneGeometry(0.5, 1.05, 6, 12); capeGeo.translate(0, -0.525, 0);
    { const P = capeGeo.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), t = -y / 1.05; P.setX(i, x * (0.8 + t * 0.55)); if (t > 0.99) P.setY(i, y + (Math.abs(Math.round(x / 0.0833)) % 2) * 0.09); } }
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.cape = new THREE.Mesh(capeGeo, cloth); this.cape.position.set(0, 1.44, 0.17); this.cape.rotation.x = 0.1; body.add(this.cape);
    // scarf tails fluttering from the collar
    this.scarves = [];
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.1, 0.62, 1, 10); g.translate(0, -0.31, 0);
      const m = new THREE.Mesh(g, cloth); m.position.set(0.08 * s, 1.5, 0.12); m.rotation.set(0.35, 0.3 * s, 0.1 * s); body.add(m);
      this.scarves.push({ m, base: g.attributes.position.array.slice(), ph: s > 0 ? 0 : 1.7 });
    }
    // outlines on the solid cloth/metal (not the flat cloth planes or the back-face linings)
    body.traverse((m) => { if (m.isMesh && m.material.type === 'MeshToonMaterial' && m.material.side === THREE.FrontSide) addOutline(m, 0.012); });
    // hit flash: every cloth/metal material of this model lerps its emissive toward warm white
    this.flashMats = [];
    body.traverse((m) => { if (m.isMesh && m.material.type === 'MeshToonMaterial' && !this.flashMats.some((f) => f.m === m.material)) this.flashMats.push({ m: m.material, base: m.material.emissive.clone() }); });
    this._hf = 0;
    // status visuals
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x3aa8ff, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.75, flatShading: true }));
    this.shell.scale.set(0.7, 1.15, 0.7); this.shell.position.y = 1.0; this.shell.visible = false; root.add(this.shell);
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1.25, 64, 40), barrierMaterial({ color: 0xffd46a, intensity: 1.5 })); this.bubble.position.y = 1.0; this.bubble.visible = false; root.add(this.bubble);
    this.auraRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.auraRing.rotation.x = -Math.PI / 2; this.auraRing.position.y = 0.05; this.auraRing.visible = false; root.add(this.auraRing);
    this.chantOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 3), energyMaterial({ color: accent, intensity: 2.2, noiseAmp: 0.03, flow: 4 }));
    this.chantOrb.visible = false; body.add(this.chantOrb);
    root.traverse((m) => { if (m.isMesh && m.material.type === 'MeshToonMaterial') { m.castShadow = true; m.receiveShadow = true; } });
    this.walk = 0; this.castAnim = 0; this.chant = 0;
    // status aura: a thin capsule of the afflicting / empowering element hugging the body (burning, poisoned, charged…)
    const ap = []; for (let k = 0; k <= 16; k++) { const t = k / 16; ap.push(new THREE.Vector2(0.32 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.26 - t * 0.12, t * 1.95)); }
    this.statusGeo = new THREE.LatheGeometry(ap, 32); this.statusMats = {}; this.statusEl = null; this.statusK = 0;
    this.statusMesh = new THREE.Mesh(this.statusGeo); this.statusMesh.visible = false; this.statusMesh.renderOrder = 3; root.add(this.statusMesh);
  }
  status(el, k, dt) {
    this.statusK += ((el ? k : 0) - this.statusK) * Math.min(1, dt * 5);
    if (el && el !== this.statusEl) {
      this.statusEl = el;
      if (!this.statusMats[el]) { const m = surfaceMaterial({ ...elementKit(el), opacity: 0.8 }, { spin: 1.5, twist: 0.8, bulge: 0.15 }); m.uniforms.uFlow.value = 2.2; m.uniforms.uBands.value = 3; m.uniforms.uGap.value = 0.8; this.statusMats[el] = m; }
      this.statusMesh.material = this.statusMats[el];
    }
    this.statusMesh.visible = this.statusK > 0.02 && !!this.statusEl;
    if (this.statusMesh.visible) { this.statusMesh.material.uniforms.uFade.value = this.statusK; this.statusMesh.rotation.y += dt * 1.5; }
  }
  setElement(el) { const c = new THREE.Color(ELEMENTS[el]?.color ?? 0xffffff); this.glowMat.color.copy(c).multiplyScalar(3.5); this.chantOrb.material.uniforms.uColor.value.copy(c); }
  handWorld(out = new THREE.Vector3()) { return (this.chant > 0.3 ? this.chantOrb : this.staffTip || this.handGem).getWorldPosition(out); }
  update(dt, s) {
    const t = TIME.value, sp = Math.min(1, (s.speed || 0) / 6);
    const hf = s.hit || 0;
    if (hf > 0 || this._hf > 0) { for (const f of this.flashMats) f.m.emissive.copy(f.base).lerp(FLASH, hf * 0.85); this._hf = hf; }
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
    for (const S of this.scarves) {
      const P = S.m.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) { const y = S.base[i * 3 + 1]; P.setZ(i, S.base[i * 3 + 2] + Math.sin(t * 5.5 + y * 6 + S.ph) * 0.06 * -y - y * 0.5 * sp); P.setX(i, S.base[i * 3] + Math.sin(t * 3.7 + y * 4 + S.ph) * 0.03 * -y); }
      P.needsUpdate = true;
    }
    this.shell.visible = !!s.frozen;
    this.bubble.visible = s.shield > 0;
    if (this.bubble.visible) { this.bubble.material.uniforms.uAlpha.value = Math.min(1, 0.4 + s.shield / 150); this.bubble.material.uniforms.uColor.value.set(ELEMENTS[s.shieldEl]?.color ?? 0xffd46a); }
    this.auraRing.visible = !!s.aura;
    if (s.aura) { this.auraRing.material.color.set(ELEMENTS[s.aura].color).multiplyScalar(2); this.auraRing.rotation.z += dt; this.auraRing.material.opacity = 0.5 + Math.sin(t * 6) * 0.3; }
  }
}

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { voiceChargeFeedback } from './voice-feedback.js';
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
    // gloved hand wrapped round the shaft, and the coat sleeve with its gilt cuff leading off-screen
    const glove = new THREE.MeshStandardMaterial({ color: 0x3b2a36, roughness: 0.6, metalness: 0.05, envMap: _env, envMapIntensity: 0.35 });
    const sleeveM = new THREE.MeshStandardMaterial({ color: 0x2c3f78, roughness: 0.85, envMap: _env, envMapIntensity: 0.2 });
    const hand = new THREE.Group(); hand.position.y = -0.075; staff.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), glove); palm.scale.set(1.1, 1.5, 1.0); palm.position.set(0.03, 0, 0.012); hand.add(palm);
    for (let k = 0; k < 4; k++) { // curled fingers: partial tori hugging the shaft
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0115, 8, 16, Math.PI * 1.25), glove);
      f.rotation.set(Math.PI / 2, 0, Math.PI * 0.55); f.position.y = 0.036 - k * 0.024; f.scale.setScalar(1 - k * 0.04); hand.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 4, 8), glove); thumb.position.set(-0.01, 0.045, -0.03); thumb.rotation.set(0.9, 0, 0.5); hand.add(thumb);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.035, 20), gold); cuff.position.set(0.05, -0.045, 0.03); cuff.rotation.set(0.5, 0, -0.9); hand.add(cuff);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.1, 0.42, 20, 1, true), sleeveM); sleeve.material.side = THREE.DoubleSide;
    sleeve.position.set(0.19, -0.14, 0.12); sleeve.rotation.set(0.5, 0, -0.9); hand.add(sleeve);
    // head: golden cradle of four curling claws + halo ring
    const head = (this.head = new THREE.Group()); head.position.y = 0.12; staff.add(head);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.05, 0.05, Math.sin(a) * 0.05), new THREE.Vector3(Math.cos(a) * 0.07, 0.13, Math.sin(a) * 0.07), new THREE.Vector3(Math.cos(a) * 0.035, 0.2, Math.sin(a) * 0.035), new THREE.Vector3(Math.cos(a + 0.4) * 0.012, 0.215, Math.sin(a + 0.4) * 0.012)]);
      head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.007, 6), gold));
    }
    this.haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.005, 6, 48), gold); this.haloRing.position.y = 0.11; head.add(this.haloRing);
    // no transmission: a transmissive material makes three.js re-render the whole scene into an extra buffer every frame (~5 ms)
    this.crystalMat = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, emissive: 0x9fd8ff, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.6, flatShading: true, envMap: _env, envMapIntensity: 1.8 });
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
  update(dt, { speed = 0, chanting = false, charge = 0, grounded = true, voiceLevel = 0 }) {
    const t = TIME.value;
    const voice = voiceChargeFeedback(voiceLevel, chanting);
    this.bob += dt * speed * 1.4;
    this.kick = Math.max(0, this.kick - dt * 3.2); this.flick = Math.max(0, this.flick - dt * 6);
    this.charge += ((chanting ? 1 : 0) - this.charge) * Math.min(1, dt * 8);
    const b = grounded ? Math.min(1, speed / 7) : 0.2, c = this.charge, k = Math.sin(Math.min(1, this.kick) * Math.PI * 0.5), f = this.flick;
    const sway = Math.sin(t * 1.4) * 0.004;
    this.group.position.set(0.3 - c * 0.12 + Math.cos(this.bob) * 0.012 * b, -0.36 + c * 0.1 + Math.abs(Math.sin(this.bob)) * 0.02 * b + sway - k * 0.03, -0.62 - k * 0.14 - f * 0.06);
    this.group.rotation.set(0.12 + c * 0.25 - k * 0.55 - f * 0.25, -0.1 + c * 0.15, -0.1 - c * 0.12 + Math.sin(t * 2) * 0.01);
    this.crystal.rotation.y += dt * (1.5 + c * 8 + voice.spin);
    this.haloRing.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.2; this.haloRing.rotation.z += dt * (0.5 + c * 3);
    this.runes.forEach((r, i) => { const a = t * (2 + c * 5) + (i * Math.PI * 2) / 3, R = 0.07 + c * 0.03; r.position.set(Math.cos(a) * R, 0.11 + Math.sin(t * 3 + i) * 0.02, Math.sin(a) * R); r.rotation.y += dt * 4; });
    const orbK = Math.max(c, k);
    this.orb.visible = orbK > 0.03;
    this.orb.scale.setScalar(orbK * (0.6 + charge * 1.2) * (1 + Math.sin(t * 16) * 0.05) * voice.scale);
    this.crystalMat.emissiveIntensity = 0.7 + c * 1.6 + k * 2.4 + voice.glow;
    this.light.intensity = 0.3 + c * (0.6 + charge * 1.2) + k * 1.5 + voice.glow * 0.6;
    if (this.sigil) { this.sigil.target = c; this.sigil.update(dt); }
  }
}
