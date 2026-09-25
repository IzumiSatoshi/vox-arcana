// Ten further base forms: whip · prison · decoy · drain · beast · halo · sword · rush · totem · mark.
// Same rules as spells.js: every volume is the element's own matter (vfxkit surface / crystal), sized and timed by the
// look axes, with additive glow only as an accent.
import * as THREE from 'three';
import { energyMaterial, crystalMaterial } from './shaders.js';
import { kitOf, surfaceMaterial } from './vfxkit.js';
import { stoneMaterial } from './world.js';
import { MagicCircle } from './magicCircle.js';
import { boltSpec } from './spellbook.js';
import { Spell, registerShape, SPHERE_LO, OCTA, SMOOTH, COMET, TORUS_GEO, BLADE_GEO, coreMesh, escalateImpact } from './spells.js';
import { rand, clamp, lerp, TAU } from './util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const solidKit = (sp) => sp.kit.mix.w > 0.4 || (sp.look.g.sharpness > 0.75 && sp.look.g.density > 0.5);

// ------------------------------------------------------------ helpers
// A tube swept along N points with parallel-transport frames (whips, tethers, serpent bodies). uv.x runs around the
// tube, uv.y from the first point to the last, so the kit's matter streams along it. World-space geometry: the kit
// material must be built with bulge 0 (its bulge scales positions about the origin).
class Tube {
  constructor(N, radial, material) {
    this.N = N; this.S = radial;
    const cnt = N * (radial + 1), g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cnt * 3); this.nor = new Float32Array(cnt * 3);
    const uv = new Float32Array(cnt * 2), idx = [];
    for (let i = 0; i < N; i++) for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; uv[k * 2] = j / radial; uv[k * 2 + 1] = i / (N - 1); }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.userData.ownGeo = true; this.mesh.renderOrder = 3;
    this.T = new THREE.Vector3(); this.n = new THREE.Vector3(); this.b = new THREE.Vector3();
  }
  // pts: N Vector3s, radius(t 0..1, i) -> r
  update(pts, radius) {
    const N = this.N, S = this.S, T = this.T, n = this.n, b = this.b, P = this.pos, Nr = this.nor;
    T.subVectors(pts[1], pts[0]).normalize();
    n.crossVectors(T, Math.abs(T.y) > 0.9 ? _v.set(1, 0, 0) : _up).normalize();
    for (let i = 0; i < N; i++) {
      T.subVectors(pts[Math.min(N - 1, i + 1)], pts[Math.max(0, i - 1)]);
      if (T.lengthSq() < 1e-8) T.set(0, 0, 1); T.normalize();
      n.addScaledVector(T, -n.dot(T)); if (n.lengthSq() < 1e-6) n.crossVectors(T, _up); n.normalize();
      b.crossVectors(T, n);
      const r = radius(i / (N - 1), i), p = pts[i];
      for (let j = 0; j <= S; j++) {
        const a = (j / S) * TAU, c = Math.cos(a), s = Math.sin(a), k = (i * (S + 1) + j) * 3;
        const nx = n.x * c + b.x * s, ny = n.y * c + b.y * s, nz = n.z * c + b.z * s;
        P[k] = p.x + nx * r; P[k + 1] = p.y + ny * r; P[k + 2] = p.z + nz * r; Nr[k] = nx; Nr[k + 1] = ny; Nr[k + 2] = nz;
      }
    }
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  }
}
// kit surface for world-space tubes / blades (no vertex bulge)
function tubeMat(kit, { opacity = 0.95, flow = 3, streak = 4, topFade = 0, energyOnly = false } = {}) {
  const m = surfaceMaterial(energyOnly ? kit : { ...kit, opacity: Math.max(opacity, kit.opacity) }, { spin: 0, twist: 0, bulge: 0, energyOnly });
  m.uniforms.uFlow.value = flow; m.uniforms.uStreak.value = streak; m.uniforms.uTopFade.value = topFade; m.uniforms.uFlameUp.value = 0; // full flame coverage (reads as fire, not peach, over sky)
  return m;
}
const groundY = (g, p) => g.world.heightAt(p.x, p.z);
const ptArray = (n) => Array.from({ length: n }, () => new THREE.Vector3());
// point along a polyline history (newest first) at arc length d
function alongHistory(hist, d, out) {
  let acc = 0;
  for (let i = 1; i < hist.length; i++) {
    const L = hist[i - 1].distanceTo(hist[i]);
    if (acc + L >= d) return out.lerpVectors(hist[i - 1], hist[i], (d - acc) / Math.max(1e-6, L));
    acc += L;
  }
  return out.copy(hist[hist.length - 1]);
}

// ============================================================ 1. WHIP — a lash of matter that sweeps in front and drags foes in
class WhipSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, L = this.look;
    this.kit = kitOf(this.el, L);
    this.reach = (7.5 + s.size * 7) * (0.65 + this.m * 0.45) * (0.75 + 0.25 * L.sx);
    this.r0 = (0.22 + s.size * 0.16 + s.weight * 0.08) * (0.65 + this.m * 0.45) * Math.sqrt(L.sx);
    this.lashes = 1 + (s.count > 0.45 ? 1 : 0) + (this.level >= 2 ? 1 : 0);
    this.dur = 0.62 - s.speed * 0.2;
    this.N = 44; this.pts = ptArray(this.N);
    this.tube = new Tube(this.N, 10, tubeMat(this.kit, { flow: 5 + s.speed * 4, streak: 5 })); this.add(this.tube.mesh);
    if (this.kit.energy > 0.25 || this.kit.heat > 0.3) { this.glow = new Tube(this.N, 8, tubeMat(this.kit, { flow: 7, energyOnly: true })); this.add(this.glow.mesh); }
    this.tip = this.trail(this.pal.color, this.pal.core, this.r0 * 2.2, 18, 1.6 + this.m);
    this.hitSets = Array.from({ length: this.lashes }, () => new Set());
    this.cracked = -1; this.hist = [];
    this.vertical = L.sy > 1.25;
    // sharp / solid matter grows thorns along the lash (briar, ice, flint); charged matter crawls with arcs
    if (L.g.sharpness > 0.6 || solidKit(this)) {
      this.thornMat = crystalMaterial({ color: this.kit.body.clone().lerp(this.kit.hi, 0.3), glow: this.pal.color, emissive: 0.7 + this.kit.heat, crack: 0.2 });
      this.thorns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1, 5), this.thornMat, 24); this.thorns.frustumCulled = false; this.thorns.geometry.translate(0, 0.5, 0);
      this.add(this.thorns); this._o = new THREE.Object3D();
    } // tall looks slam overhead, others sweep side to side
    this.g.audio.whoosh(0.6 + this.m * 0.4);
  }
  frame(u, li) {
    const aim = this.caster.getAim(), f = aim.dir.clone(), side = li % 2 ? -1 : 1;
    const right = _w.crossVectors(f, _up).normalize().clone();
    const axis = this.vertical ? right.clone().multiplyScalar(side) : _up.clone().applyAxisAngle(f, side * 0.45);
    return { f, axis, side, right };
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, li = Math.floor(this.t / this.dur);
    if (li >= this.lashes) { this.done = true; this.tube.mesh.visible = false; if (this.thorns) this.thorns.visible = false; if (this.glow) this.glow.mesh.visible = false; this.tip.dead = true; this.updateCommon(dt); return !this.finished(); }
    const u = (this.t % this.dur) / this.dur, { f, axis, side } = this.frame(u, li);
    const origin = this.sys.castOrigin(this.caster).clone();
    const ext = smooth(u / 0.18) * (1 - smooth((u - 0.8) / 0.2) * 0.9);
    const sweep = (x) => (this.vertical ? -1.1 + 2.0 * easeOut(clamp(x)) : -1.35 + 2.7 * easeOut(clamp(x))) * (this.vertical ? 1 : side);
    const seg = (this.reach * ext) / (this.N - 1), P = this.pts;
    P[0].copy(origin);
    for (let i = 1; i < this.N; i++) {
      const q = i / (this.N - 1);
      const d = f.clone().applyAxisAngle(axis, sweep(u * 1.25 - q * 0.32));
      const wave = Math.sin(q * 11 - this.t * 26) * 0.35 * q * (1 - ext * 0.6);
      d.addScaledVector(axis, wave).normalize();
      P[i].copy(P[i - 1]).addScaledVector(d, seg);
      const gy = groundY(this.g, P[i]) + 0.15; if (P[i].y < gy) P[i].y = gy;
    }
    // thin at the hand (it starts right under the caster's eye), thickest a little way out, tapering to the tip
    const r0 = this.r0, hand = this.caster.isPlayer ? 0.22 : 0.1, rad = (q) => r0 * (1.15 - 0.85 * q) * (0.4 + 0.6 * ext) * (0.2 + 0.8 * smooth(q / hand));
    this.tube.update(P, rad); this.glow?.update(P, (q) => rad(q) * 0.55);
    const fade = clamp(ext * 1.5);
    this.tube.mesh.material.uniforms.uFade.value = fade; if (this.glow) this.glow.mesh.material.uniforms.uFade.value = fade;
    const tip = P[this.N - 1];
    this.tip.push(tip);
    if (this.thorns) {
      for (let k = 0; k < 24; k++) {
        const i = 3 + Math.floor(k * (this.N - 5) / 24), q = i / (this.N - 1), t = _v.subVectors(P[i + 1], P[i - 1]).normalize();
        const side = _w.crossVectors(t, _up).normalize().applyAxisAngle(t, k * 2.4);
        const o = this._o, r = rad(q); o.position.copy(P[i]).addScaledVector(side, r * 0.8); o.quaternion.setFromUnitVectors(_up, side.clone().addScaledVector(t, -0.6).normalize());
        o.scale.set(r * 0.45, r * 1.6, r * 0.45); o.updateMatrix(); this.thorns.setMatrixAt(k, o.matrix);
      }
      this.thorns.instanceMatrix.needsUpdate = true;
    }
    if ((this.el === 'lightning' || this.look.g.temperature > 0.93) && Math.random() < 0.6) { const i = Math.floor(rand(4, this.N - 6)); this.g.fx.bolt(P[i].clone(), P[i + 5].clone().add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5))), this.pal.core, { look: this.look, width: 0.04, dur: 0.07, jag: 0.4, branches: 0, flicker: false }); }
    // tip speed peaks mid-swing: the crack
    if (u > 0.42 && this.cracked < li) { this.cracked = li; this.g.audio.crack?.(this.m, tip); this.g.fx.starburst(tip, this.pal.core, 1.2 + this.m, 6, 0.12); this.g.fx.shockwave(tip, 2.5, 0.8, 0.25); }
    for (let k = 0; k < 3; k++) { const p = P[Math.floor(rand(4, this.N))]; this.emit(p, 1, r0 * 1.4, 0.8); }
    this.light(tip, 120 * fade, 8);
    // hits: any target crossed by the lash, once per lash — dragged toward the caster
    for (let i = 6; i < this.N; i += 3) {
      const p = P[i];
      for (const tg of this.targets()) {
        if (this.hitSets[li].has(tg) || !tg.hits(p, rad(i / (this.N - 1)) + 0.25)) continue;
        this.hitSets[li].add(tg);
        const pull = this.caster.pos.clone().sub(tg.pos).setY(0); const Lp = pull.length();
        pull.normalize().multiplyScalar(Math.min(Lp, 8) * (0.9 + s.weight * 0.6)).setY(3);
        this.hit(tg, 46 + s.sharpness * 16, p.clone(), { knock: pull, stun: 0.12 });
        this.g.fx.explosion(this.el, p, 1.1 + this.m * 0.5, 0.3, this.pal, { look: this.look, noDecal: true });
        this.g.audio.impact(this.el, 0.45, p, this.look);
      }
    }
    this.updateCommon(dt);
    return !this.finished();
  }
  threats() { return [{ pos: this.caster.pos, vel: new THREE.Vector3(), radius: this.reach * 0.8, area: true }]; }
  dispose() { super.dispose(); this.thornMat?.dispose(); this.thorns?.geometry.dispose(); }
}

// ============================================================ 2. PRISON — a cage of matter erupts around the target
const BAR_GEO = (() => { const g = new THREE.CylinderGeometry(0.55, 1, 1, 6, 1); g.translate(0, 0.5, 0); return g; })();
const BAR_TIP = (() => { const g = new THREE.ConeGeometry(0.55, 0.6, 6, 1); g.translate(0, 1.3, 0); return g; })();
const COLUMN_GEO = (() => { const pts = [[0.9, 0], [0.62, 0.1], [0.5, 0.35], [0.46, 0.7], [0.52, 0.88], [0.3, 0.98], [0.02, 1.02]].map(([r, y]) => new THREE.Vector2(r, y)); return new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(20), 20); })();
class PrisonSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, L = this.look, aim = this.caster.getAim();
    this.kit = kitOf(this.el, L);
    this.target = this.nearestTarget(this.caster.eye(new THREE.Vector3()), aim.dir, 0.72, 60);
    this.center = (this.target ? this.target.pos : aim.point).clone(); this.center.y = groundY(this.g, this.center);
    this.R = (1.6 + s.size * 1.4) * (0.75 + this.m * 0.3) * Math.sqrt(L.sx);
    this.H = (3.2 + s.size * 2.4) * (0.75 + this.m * 0.3) * L.sy;
    this.life = 2.4 + s.duration * 2.6 + this.m;
    this.n = 9 + Math.round(s.size * 5 + this.level * 2);
    this.solid = solidKit(this);
    this.rough = this.solid && L.g.sharpness < 0.6; // blunt matter is rough-hewn stone (thick, grey, few veins), sharp matter clean crystal
    this.mat = this.solid ? crystalMaterial({ color: this.rough ? this.kit.body.clone().lerp(new THREE.Color(0x8a8278), 0.5) : this.kit.body.clone().lerp(new THREE.Color(0xffffff), 0.15), glow: this.pal.color, emissive: (this.rough ? 0.5 : 1.1) + this.kit.heat * 1.5, crack: (this.rough ? 0.12 : 0.35) + this.kit.heat * 0.5, rough: this.rough })
      : tubeMat(this.kit, { flow: 2.5, topFade: 1 });
    if (!this.solid) { this.mat.uniforms.uCrest.value = 0.5; this.glowMat = this.kit.energy > 0.25 ? tubeMat(this.kit, { flow: 3, energyOnly: true }) : null; }
    this.bars = [];
    for (let i = 0; i < this.n; i++) {
      const a = (i / this.n) * TAU + rand(-0.08, 0.08), p = new THREE.Vector3(this.center.x + Math.cos(a) * this.R, 0, this.center.z + Math.sin(a) * this.R);
      p.y = groundY(this.g, p) - 0.3;
      const bar = new THREE.Group();
      const body = new THREE.Mesh(this.solid ? BAR_GEO : COLUMN_GEO, this.mat); body.renderOrder = 3; bar.add(body);
      if (this.solid) { const tip = new THREE.Mesh(BAR_TIP, this.mat); tip.scale.set(1, 0.6, 1); bar.add(tip); }
      else if (this.glowMat) { const gm = new THREE.Mesh(COLUMN_GEO, this.glowMat); gm.scale.setScalar(0.7); bar.add(gm); }
      // lean the bar in toward the axis so the cage closes like a claw
      const top = this.center.clone().setY(p.y + this.H).addScaledVector(_v.set(Math.cos(a), 0, Math.sin(a)), this.R * 0.45);
      bar.position.copy(p); bar.quaternion.setFromUnitVectors(_up, top.clone().sub(p).normalize());
      const w = (0.16 + s.size * 0.08 + this.m * 0.05) * (this.rough ? 1.3 : this.solid ? 1 : 1.5) * rand(0.85, 1.15);
      bar.userData = { w, h: top.distanceTo(p) * rand(0.9, 1.08), delay: (i % 2) * 0.05 + rand(0, 0.06), a };
      bar.scale.set(w, 0.01, w); this.add(bar); this.bars.push(bar);
    }
    // crown: a ring of the matter binding the tops
    this.crown = this.add(new THREE.Mesh(TORUS_GEO, this.solid ? this.mat : energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.4, noiseAmp: 0.1, opacity: 0.8 })));
    this.crown.rotation.x = Math.PI / 2; this.crown.visible = false;
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.R * 1.35, intensity: 1.3 });
    this.mc.group.rotation.x = -Math.PI / 2; this.mc.group.position.copy(this.center).y += 0.12; this.mc.spin = 1.2; this.add(this.mc.group);
    this.trapped = new Set(); this.tick = 0.3; this.closed = false;
    this.loopSnd = this.g.audio.loop(this.el, this.center.clone().setY(this.center.y + 1.5), 0.22, this.look, { spin: 0.15 });
    this.g.audio.cast(this.el, this.m, this.center, this.look);
  }
  update(dt) {
    this.t += dt;
    const c = this.center, fx = this.g.fx;
    const endT = this.life, out = clamp((this.t - endT) / 0.25);
    this.mc.update(dt); this.mc.target = this.t < endT ? 1 : 0;
    for (const bar of this.bars) {
      const u = bar.userData, k = easeOut((this.t - u.delay) / 0.22);
      const over = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.12 : 1;
      bar.scale.set(u.w * (1 - out * 0.7), Math.max(0.01, u.h * k * over * (1 - out)), u.w * (1 - out * 0.7));
      if (!u.burst && k > 0.05) { u.burst = true; const bp = bar.position.clone().setY(bar.position.y + 0.4); fx.element(this.el, bp, { count: 4, speed: 3, size: Math.min(0.5, u.w * 2), palette: this.pal, look: this.look }); if (this.solid) fx.puff(bp, { color: new THREE.Color(0x8a7a60).lerp(this.kit.body, 0.5), size: 0.8, life: 1, alpha: 0.4, rise: 1.2 }); }
      if (this.mat.uniforms?.uFade) this.mat.uniforms.uFade.value = 1 - out;
    }
    const topY = c.y + this.H * 0.93;
    if (this.t > 0.18) {
      if (!this.closed) {
        this.closed = true; this.crown.visible = true;
        fx.ring(c.clone().setY(c.y + 0.2), this.pal.color, this.R * 2.4, 0.5); fx.shockwave(c.clone().setY(c.y + 1), this.R * 3, 1, 0.4); fx.addShake(0.2, c);
        this.g.audio.impact(this.el, 0.5 + this.m * 0.3, c, this.look); if (this.solid) this.g.audio.clang?.(c.clone().setY(c.y + this.H * 0.8)); // the bars slam home
        for (const tg of this.targets()) if (Math.hypot(tg.pos.x - c.x, tg.pos.z - c.z) < this.R * 1.1) { this.trapped.add(tg); this.hit(tg, 20, tg.center(), { stun: 0.35 }); if (tg === this.g.player) this.g.hud.banner('', this.g.hud.tr?.('warn.trapped') || 'TRAPPED', 1.6); }
      }
      const ck = easeOut((this.t - 0.18) / 0.2) * (1 - out);
      this.crown.position.set(c.x, topY, c.z); this.crown.scale.setScalar(Math.max(0.01, this.R * 0.55 * ck)); this.crown.scale.z = (0.8 + this.m * 0.4) * Math.max(0.01, ck);
      this.crown.rotation.z += dt * 0.8;
    }
    // the trapped can't leave the ring: bodies are held inside and slowed; the cage burns / chills / shocks them
    if (this.closed && this.t < endT) {
      this.tick -= dt;
      for (const tg of this.trapped) {
        if (!tg.alive) continue;
        const dx = tg.pos.x - c.x, dz = tg.pos.z - c.z, d = Math.hypot(dx, dz), lim = Math.max(0.3, this.R - 0.6);
        if (d > lim) { tg.pos.x = c.x + (dx / d) * lim; tg.pos.z = c.z + (dz / d) * lim; tg.vel.x *= 0.2; tg.vel.z *= 0.2; }
        if (tg.pos.y > topY - 1.6) { tg.pos.y = topY - 1.6; tg.vel.y = Math.min(0, tg.vel.y); }
        tg.mud = Math.max(tg.mud, 0.3);
        if (this.tick <= 0) this.hit(tg, 8, tg.center(), { noReact: true });
      }
      if (this.tick <= 0) this.tick = 0.45;
      if (Math.random() < 0.5) { const a = rand(0, TAU); fx.element(this.el, new THREE.Vector3(c.x + Math.cos(a) * this.R, c.y + rand(0.3, this.H * 0.8), c.z + Math.sin(a) * this.R), { count: 1, speed: 0.5, size: 0.3, palette: this.pal, look: this.look }); }
      // charged cages crackle: arcs jump between neighbouring bars
      if ((this.kit.energy > 0.5 || this.el === 'lightning') && Math.random() < 0.45) {
        const i = Math.floor(rand(0, this.n)), b0 = this.bars[i], b1 = this.bars[(i + 1) % this.n], h = rand(0.3, 0.85);
        const p0 = b0.position.clone().addScaledVector(_v.set(0, 1, 0).applyQuaternion(b0.quaternion), b0.userData.h * h), p1 = b1.position.clone().addScaledVector(_w.set(0, 1, 0).applyQuaternion(b1.quaternion), b1.userData.h * h);
        fx.bolt(p0, p1, this.pal.core, { look: this.look, width: 0.05, dur: 0.1, jag: 0.35, branches: 0, flicker: false });
      }
      this.light(c.clone().setY(c.y + this.H * 0.5), 140, this.R * 3);
    }
    // collapse: the bars snap inward and burst
    if (this.t >= endT && !this.burst) {
      this.burst = true; this.loopSnd?.stop(); this.loopSnd = null;
      this.explode(c.clone().setY(c.y + 1), this.R * 1.25, 48, { knock: 9, lift: 7 });
      fx.addShake(0.3 + this.m * 0.2, c);
      if (this.solid) fx.debris?.(c.clone().setY(c.y + 1), this.R, this.el, this.pal, this.look);
    }
    if (this.t > endT + 0.35) this.done = true;
    this.updateCommon(dt);
    return !this.finished() || this.mc.opacity > 0.02;
  }
  threats() { return this.t < this.life ? [{ pos: this.center, vel: new THREE.Vector3(), radius: this.R + 0.5, area: true }] : []; }
  dispose() { super.dispose(); this.mat.dispose(); this.glowMat?.dispose(); }
}

// ============================================================ 3. DECOY — illusory doubles that run off and draw fire
const PLAYER_COLORS = { robe: 0x1f2f6a, trim: 0xe0b95a, accent: 0x6fd8ff, hat: 0x141a3a };
let DECOY_ID = 0;
class DecoySpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster, g = this.g;
    this.life = 7 + s.duration * 6 + this.m * 2;
    const n = 2 + Math.round(s.count * 2) + (this.level >= 2 ? 1 : 0);
    this.decoys = [];
    const colors = c.colors || PLAYER_COLORS;
    for (let i = 0; i < n; i++) {
      if (!g.makeCombatant) break;
      const d = g.makeCombatant({ id: 'decoy' + ++DECOY_ID, name: c.name }, colors);
      // the double shows its owner's health bar, but takes damage many times over (its real toughness is small)
      const tough = 30 + 60 * clamp(s.power * 0.6 + s.tier * 0.4);
      d.decoy = true; d.owner = c; d.maxHp = c.maxHp; d.hp = Math.max(1, c.hp); d.fragile = d.hp / tough; d.shield = c.shield;
      const off = (i - (n - 1) / 2) * 1.2;
      const f = c.forward(new THREE.Vector3()).setY(0).normalize(), r = new THREE.Vector3(-f.z, 0, f.x);
      d.pos.copy(c.pos).addScaledVector(r, off); d.pos.y = g.world.groundAt(d.pos.x, d.pos.z, c.pos.y + 1);
      d.yaw = c.yaw; d.heading = c.yaw + Math.PI + (n > 1 ? (i / (n - 1) - 0.5) * 2.6 : 0) + rand(-0.3, 0.3);
      d.turnT = rand(0.8, 2); d.jumpT = rand(1, 3);
      const aimD = new THREE.Vector3(), aimP = new THREE.Vector3();
      d.getAim = () => d.aimAt ? { origin: d.eye(new THREE.Vector3()), dir: aimD.copy(d.aimAt).sub(d.eye(new THREE.Vector3())).normalize(), point: aimP.copy(d.aimAt) }
        : { origin: d.eye(new THREE.Vector3()), dir: aimD.set(-Math.sin(d.yaw), 0, -Math.cos(d.yaw)), point: aimP.copy(d.pos).addScaledVector(aimD, 10) };
      d.shootT = rand(0.8, 2);
      if (d.model) { d.model.setElement?.(this.el); d.model.root.position.copy(d.pos); }
      this.decoys.push(d);
      g.fx.explosion(this.el, d.center(), 1.3, 0.3, this.pal, { look: this.look, noDecal: true });
    }
    // the caster blurs for a moment: rivals lose track of which one is real
    c.cloak = 1.2 + s.duration;
    for (let k = 0; k < 10; k++) g.fx.puff(c.pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0.2, 1.8), rand(-1, 1))), { color: this.pal.color.clone().lerp(new THREE.Color(0xffffff), 0.55), size: 0.9, life: 0.9, alpha: 0.6, rise: 0.6, soft: true });
    g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), this.pal.color, 5, 0.5);
    if (c.isPlayer) g.screenFlash?.('#' + this.pal.color.getHexString(), 0.15);
    g.audio.cast('arcane', 0.5, c.pos, this.look); g.audio.shimmer?.(c.pos);
  }
  pop(d, dmg) {
    const g = this.g, p = d.center();
    g.fx.explosion(this.el, p, 1.8 + this.m * 0.6, 0.5, this.pal, { look: this.look, noDecal: true });
    for (let k = 0; k < 8; k++) g.fx.puff(p.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.8, 0.8), rand(-0.6, 0.6))), { color: this.pal.color.clone().lerp(new THREE.Color(0xffffff), 0.5), size: 0.8, life: 0.8, alpha: 0.6, rise: 1, soft: true });
    if (dmg) this.aoe(p, 2.8 + this.m, dmg, { knock: 6, lift: 3 });
    g.audio.impact(this.el, 0.3, p, this.look); g.audio.shatter?.(p, 0.4);
    for (let k = 0; k < 18; k++) g.fx.glow.emit({ x: p.x + rand(-0.3, 0.3), y: p.y + rand(-0.8, 0.8), z: p.z + rand(-0.3, 0.3), vx: rand(-5, 5), vy: rand(0, 6), vz: rand(-5, 5), life: rand(0.5, 0.9), size: 0.2, size1: 0.04, color: this.pal.core, color1: this.pal.color, alpha: 1, drag: 1.2, grav: 9, frame: 4, spin: rand(-8, 8) }); // the illusion shatters like glass
    if (d.alive) { d.alive = false; }
    g.removeCombatant?.(d);
  }
  update(dt) {
    this.t += dt;
    const g = this.g;
    for (const d of this.decoys) {
      if (d.gone) continue;
      if (!d.alive) { d.gone = true; this.pop(d, 0); continue; } // shot down (onDeath already flagged it)
      if (this.t > this.life || !this.caster.alive) { d.gone = true; this.pop(d, 22); continue; }
      d.turnT -= dt; d.jumpT -= dt;
      if (d.turnT <= 0) { d.turnT = rand(0.7, 2); d.heading += rand(-1.2, 1.2); }
      if (Math.hypot(d.pos.x, d.pos.z) > 90) d.heading = Math.atan2(d.pos.x, d.pos.z); // turn back toward the middle
      const wish = new THREE.Vector3(-Math.sin(d.heading), 0, -Math.cos(d.heading));
      d.yaw = Math.atan2(-wish.x, -wish.z);
      const jump = d.jumpT <= 0; if (jump) d.jumpT = rand(1.5, 4);
      g.stepBody?.(d, dt, wish, 6.8, jump, false);
      d.chanting = Math.sin(this.t * 1.3 + d.heading) > 0.6;
      // the act: doubles loose harmless bolts at the nearest foe, like the real caster would
      d.shootT -= dt;
      if (d.shootT <= 0) {
        d.shootT = rand(1.2, 2.6); d.aimAt = null;
        let foe = null, fd = 32; for (const o of this.targets()) { const dd = o.pos.distanceTo(d.pos); if (dd < fd) { fd = dd; foe = o; } }
        if (foe) {
          d.aimAt = foe.center(); d.yaw = Math.atan2(d.pos.x - foe.pos.x, d.pos.z - foe.pos.z);
          const spec = boltSpec(this.el); spec.dmgMult = 0.03; g.spells.cast(spec, d);
          if (d.model) d.model.castAnim = 0.6;
        }
      }
      if (Math.random() < 0.15) g.fx.element(this.el, d.center(), { count: 1, speed: 0.4, size: 0.18, palette: this.pal, life: 0.5 });
    }
    this.caster.decoyN = this.decoys.filter((d) => !d.gone).length; // HUD status
    if (this.decoys.every((d) => d.gone)) this.done = true;
    this.updateCommon(dt);
    return !this.finished();
  }
  dispose() { super.dispose(); this.caster.decoyN = 0; for (const d of this.decoys) if (!d.gone) { d.gone = true; d.alive = false; this.g.removeCombatant?.(d); } }
}

// ============================================================ 4. DRAIN — a siphon tether that pulls life back to the caster
class DrainSpell extends Spell {
  constructor(sys, spec, caster, aim0, opts = {}) {
    super(sys, spec, caster, aim0);
    const s = this.spec, aim = this.caster.getAim();
    this.kit = kitOf(this.el, this.look);
    this.target = opts.target || this.nearestTarget(this.sys.castOrigin(this.caster), aim.dir, 0.75, 38);
    // the count axis splits the siphon across more victims nearby
    if (!opts.target && this.target && s.count > 0.5) {
      const extra = s.count > 0.8 ? 2 : 1, from = this.caster.pos;
      this.targets().filter((o) => o !== this.target && o.pos.distanceTo(from) < 30).sort((x, y) => x.pos.distanceTo(from) - y.pos.distanceTo(from)).slice(0, extra)
        .forEach((o) => this.sys.active.push(new DrainSpell(sys, { ...s, count: 0 }, caster, aim0, { target: o })));
    }
    this.life = this.target ? 2.2 + s.duration * 2 + this.m * 0.6 : 0.45;
    this.r0 = (0.17 + s.size * 0.12) * (0.7 + this.m * 0.4);
    this.N = 30; this.pts = ptArray(this.N);
    this.tube = new Tube(this.N, 8, tubeMat(this.kit, { flow: -5, streak: 6 })); this.add(this.tube.mesh);
    this.glow = new Tube(this.N, 6, tubeMat(this.kit, { flow: -7, energyOnly: true })); this.add(this.glow.mesh);
    this.motes = Array.from({ length: 10 }, (_, i) => ({ s: i / 10, v: rand(0.7, 1.2) }));
    this.tick = 0.1; this.stored = 0; this.popT = 0;
    this.far = this.target ? null : aim.point.clone();
    this.loopSnd = this.g.audio.loop(this.el, this.caster.pos, 0.35, this.look, { spin: 0.35 });
    this.g.audio.cast('darkness', 0.35, this.caster.pos, this.look);
  }
  curve(q, a, b, mid, out) { const u = 1 - q; return out.set(u * u * a.x + 2 * u * q * mid.x + q * q * b.x, u * u * a.y + 2 * u * q * mid.y + q * q * b.y, u * u * a.z + 2 * u * q * mid.z + q * q * b.z); }
  update(dt) {
    this.t += dt;
    const s = this.spec, tg = this.target, fx = this.g.fx, c = this.caster;
    const to = this.sys.castOrigin(c).clone();
    let from = tg ? tg.center() : this.far.clone().lerp(to, clamp(this.t / this.life));
    let broken = false;
    if (tg && (!tg.alive || !c.alive || tg.center().distanceTo(to) > 42)) broken = true;
    if (tg && !broken) { const dir = from.clone().sub(to), L = dir.length(); const rc = this.g.world.raycast(to, dir.normalize(), L, 0.6); if (rc.hit && rc.dist < L - 1) broken = true; }
    const end = this.t > this.life || broken;
    const k = clamp(this.t / 0.15) * (end ? 0 : 1);
    const mid = from.clone().lerp(to, 0.5); const span = from.distanceTo(to);
    mid.y += span * 0.18; mid.addScaledVector(_w.crossVectors(from.clone().sub(to).normalize(), _up).normalize(), Math.sin(this.t * 2.5) * span * 0.08);
    for (let i = 0; i < this.N; i++) {
      const q = i / (this.N - 1); this.curve(q, from, to, mid, this.pts[i]);
      const wob = Math.sin(q * 14 - this.t * 16) * 0.12 * Math.sin(q * Math.PI);
      this.pts[i].y += wob; this.pts[i].x += Math.cos(q * 9 - this.t * 11) * 0.08 * Math.sin(q * Math.PI);
    }
    const rad = (q) => this.r0 * (0.55 + 0.45 * Math.sin(q * Math.PI) + 0.35 * (1 - q)) * k;
    this.tube.update(this.pts, rad); this.glow.update(this.pts, (q) => rad(q) * 0.6 + 0.01);
    this.tube.mesh.material.uniforms.uFade.value = k; this.glow.mesh.material.uniforms.uFade.value = k;
    // life motes riding the stream home
    for (const m of this.motes) {
      m.s += dt * m.v * (1.1 + s.speed); if (m.s > 1) m.s -= 1;
      const p = this.curve(m.s, from, to, mid, _v);
      fx.glow.emit({ x: p.x, y: p.y, z: p.z, life: 0.09, size: this.r0 * 3.2, size1: this.r0 * 1.5, color: this.pal.core, color1: this.pal.color, alpha: k, drag: 0, frame: 1 });
    }
    if (Math.random() < 0.5) fx.element(this.el, from, { count: 1, speed: 1.2, size: 0.25, palette: this.pal, look: this.look, dir: to.clone().sub(from).normalize() });
    if (tg && k > 0) for (let q = 0; q < 2; q++) { // essence spirals off the victim into the stream
      const a = this.t * 7 + q * Math.PI + rand(-0.3, 0.3), r = 0.9 + rand(-0.1, 0.2), d = to.clone().sub(from).normalize();
      const px = from.x + Math.cos(a) * r, pz = from.z + Math.sin(a) * r, py = from.y + rand(-0.7, 0.7);
      fx.glow.emit({ x: px, y: py, z: pz, vx: -Math.sin(a) * 3 + d.x * 2 + (from.x - px) * 2, vy: (from.y - py) * 2, vz: Math.cos(a) * 3 + d.z * 2 + (from.z - pz) * 2, life: 0.35, size: 0.14, size1: 0.03, color: q ? this.pal.core : this.pal.color, alpha: 1, drag: 0.5, frame: 1 });
    }
    this.light(from, 120 * k, 6); this.light(to, 60 * k, 4);
    this.loopSnd?.set(to);
    if (tg && !end) {
      this.tick -= dt;
      if (this.tick <= 0) {
        this.tick = 0.22;
        const res = this.hit(tg, 6.5, tg.center(), { noReact: this.t > 0.3 });
        const heal = (res?.dmg || 0) * (0.65 + s.power * 0.3) + 0.5;
        c.heal(heal); this.stored += heal;
        tg.mud = Math.max(tg.mud, 0.3);
        const pull = to.clone().sub(tg.pos).setY(0); if (pull.length() > 4) tg.vel.addScaledVector(pull.normalize(), 0.6 + s.weight);
        fx.ring(tg.center(), this.pal.color, 1.6 + this.m, 0.3, to.clone().sub(from).normalize(), 0.08);
      }
      this.popT -= dt;
      if (this.popT <= 0 && this.stored > 2) { this.popT = 0.8; this.g.onHeal?.(c, this.stored); this.stored = 0; }
    }
    if (end && !this.done) {
      this.done = true; this.loopSnd?.stop(); this.loopSnd = null;
      if (this.stored > 1) this.g.onHeal?.(c, this.stored);
      fx.explosion(this.el, from, 0.9, 0.2, this.pal, { look: this.look, noDecal: true });
      this.tube.mesh.visible = this.glow.mesh.visible = false;
    }
    this.updateCommon(dt);
    return !this.finished();
  }
}

// one feather blade pointing along +y (uv.y root→tip so matter streams outward)
function featherGeo(len, w = 0.2) {
  const NU = 10, pos = [], uv = [], idx = [];
  for (let i = 0; i <= NU; i++) { const t = i / NU, ww = Math.sin(Math.pow(t, 0.7) * Math.PI) * w * (1 - t * 0.3); for (const sx of [-1, 1]) { pos.push(sx * ww + t * t * len * 0.25, t * len, 0); uv.push(sx < 0 ? 0 : 1, t); } }
  for (let i = 0; i < NU; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const _m4 = new THREE.Matrix4();

// ============================================================ 5. BEAST — a serpent dragon of the element that hunts the foe
class BeastSpell extends Spell {
  constructor(sys, spec, caster, aim, opts = {}) {
    super(sys, spec, caster, aim);
    const s = this.spec, c = this.caster, L = this.look;
    this.twin = opts.twin ? -1 : 1; this.dmgK = opts.twin ? 0.6 : 1;
    if (!opts.twin && s.count > 0.65) this.sys.active.push(new BeastSpell(sys, { ...s, count: 0 }, caster, aim, { twin: true }));
    this.kit = kitOf(this.el, L);
    this.r = (0.5 + s.size * 0.4) * (0.65 + this.m * 0.45);
    this.N = 40; this.len = this.r * 26 * (0.85 + 0.15 * L.sx); this.pts = ptArray(this.N);
    this.speed = 15 + s.speed * 13;
    this.passes = 1 + Math.round(s.count * 2) + (this.level >= 2 ? 1 : 0);
    this.life = 7 + s.duration * 3;
    this.solid = solidKit(this);
    const bodyM = tubeMat(this.kit, { opacity: 1, flow: 1.5, streak: 9 }); bodyM.uniforms.uBands.value = 2; // scales read as bands
    this.body = new Tube(this.N, 12, bodyM); this.add(this.body.mesh);
    if (this.kit.energy > 0.25 || this.kit.heat > 0.35) { this.bodyGlow = new Tube(this.N, 8, tubeMat(this.kit, { flow: 2, energyOnly: true })); this.add(this.bodyGlow.mesh); }
    // head: a long skull, swept horns, glowing eyes, a hinged jaw
    const head = (this.head = new THREE.Group());
    const skinM = this.solid ? crystalMaterial({ color: this.kit.body, glow: this.pal.color, emissive: 0.9 + this.kit.heat, crack: 0.4 }) : tubeMat(this.kit, { opacity: 1, flow: 1.5 });
    const hornM = crystalMaterial({ color: this.kit.hi.clone().lerp(this.pal.core, 0.3), glow: this.pal.color, emissive: 0.8, crack: 0.2 });
    this.mats = [bodyM, skinM, hornM];
    const skull = new THREE.Mesh(SMOOTH, skinM); skull.scale.set(0.95, 0.7, 1.55); skull.position.z = 0.35; skull.renderOrder = 3; head.add(skull);
    const snout = new THREE.Mesh(SMOOTH, skinM); snout.scale.set(0.6, 0.42, 0.9); snout.position.set(0, -0.05, 1.45); snout.renderOrder = 3; head.add(snout);
    const jaw = (this.jaw = new THREE.Group()); jaw.position.set(0, -0.25, 0.4); head.add(jaw);
    const jm = new THREE.Mesh(SMOOTH, skinM); jm.scale.set(0.55, 0.22, 1.1); jm.position.z = 0.8; jm.renderOrder = 3; jaw.add(jm);
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.5, 6), hornM); horn.userData.ownGeo = true;
      horn.position.set(0.42 * sx, 0.5, -0.3); horn.rotation.set(-1.1, 0, -0.35 * sx); head.add(horn);
      const eye = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: this.pal.core, core: 0xffffff, intensity: 3, noiseAmp: 0 })); eye.scale.setScalar(0.17); eye.position.set(0.42 * sx, 0.2, 0.95); head.add(eye);
      const wh = new THREE.Mesh(new THREE.ConeGeometry(0.05, 1.2, 4), hornM); wh.userData.ownGeo = true; wh.position.set(0.3 * sx, -0.15, 1.6); wh.rotation.set(-2.0, 0.4 * sx, 0); head.add(wh);
    }
    head.scale.setScalar(this.r * 1.6); this.add(head);
    // light-bodied serpents (air, flame, lightning, holy light…) spread feathered wings behind the head
    if (L.g.weight < 0.3 || this.kit.mix.z > 0.4) {
      const wm = tubeMat(this.kit, { opacity: 0.95, flow: 2.5, streak: 3, topFade: 1 }); this.mats.push(wm);
      this.wings = [-1, 1].map((side) => {
        const w = new THREE.Group(); w.userData.side = side; this.add(w);
        for (let k = 0; k < 6; k++) { const f = new THREE.Mesh(featherGeo(1.2 + k * 0.35, 0.22), wm); f.userData.ownGeo = true; f.renderOrder = 3; f.rotation.z = -side * (0.35 + k * 0.2); f.scale.x = side; w.add(f); }
        return w;
      });
    }
    // dorsal fins riding the spine
    this.fins = [];
    for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(OCTA, hornM); this.add(f); this.fins.push(f); }
    // spawn from a sigil in front of the caster, rising
    const f = c.forward(new THREE.Vector3()).setY(0).normalize();
    this.pos = c.pos.clone().addScaledVector(f, 2.5).addScaledVector(new THREE.Vector3(-f.z, 0, f.x), this.twin < 0 ? 3 : 0).setY(c.pos.y + 0.3);
    this.vel = new THREE.Vector3(0, 1, 0).addScaledVector(f, 0.3).normalize().multiplyScalar(this.speed * 0.8);
    this.hist = [];
    for (let i = 0; i < 12; i++) this.hist.push(this.pos.clone().addScaledVector(_up, -i * this.len / 11));
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: 2 + this.m, intensity: 1.6 });
    this.mc.group.rotation.x = -Math.PI / 2; this.mc.group.position.copy(this.pos).setY(groundY(this.g, this.pos) + 0.1); this.add(this.mc.group);
    this.state = 'rise'; this.stT = 0; this.bite = 0; this.hits = 0;
    if (this.twin > 0) this.g.audio.roar?.(this.el, this.m, this.pos, this.look);
    this.loopSnd = this.g.audio.loop(this.el, this.pos, 0.3, this.look, { spin: 0.2 });
  }
  steer(want, dt, turn) { const sp = this.vel.length(); this.vel.lerp(want.clone().setLength(sp), clamp(dt * turn)); this.vel.setLength(lerp(sp, this.speed, clamp(dt * 2))); }
  update(dt) {
    this.t += dt; this.stT += dt;
    const s = this.spec, fx = this.g.fx, tgt = this.state === 'hunt' || this.state === 'loop' ? (this.target?.alive ? this.target : (this.target = this.nearestTarget(this.pos, null, -1, 80))) : null;
    this.mc.update(dt); this.mc.target = this.t < 1 ? 1 : 0;
    if (this.state === 'rise') {
      const c = this.caster.pos, w = this.t * 3 * this.twin + (this.twin < 0 ? Math.PI : 0); const around = new THREE.Vector3(Math.cos(w) * 4, 8 + this.t * 2, Math.sin(w) * 4).add(c).sub(this.pos);
      this.steer(around, dt, 3);
      if (this.stT > 0.9) { this.state = 'hunt'; this.stT = 0; this.target = this.nearestTarget(this.pos, null, -1, 80); this.g.audio.roar?.(this.el, this.m * 0.6, this.pos, this.look); }
    } else if (this.state === 'hunt') {
      if (tgt) {
        const tc = tgt.center(), to = tc.clone().sub(this.pos);
        const side = _w.crossVectors(to, _up).normalize().multiplyScalar(Math.sin(this.t * 5) * 0.5 * clamp(to.length() / 12));
        this.steer(to.normalize().add(side), dt, 3.2 + s.homing * 2);
        if (to.length() < 5) this.bite = Math.min(1, this.bite + dt * 5);
        if (tgt.hits(this.pos, this.r * 1.4 + 0.3)) {
          this.hit(tgt, 58 * this.dmgK, this.pos.clone(), { knock: this.vel.clone().setLength(9 + s.weight * 6).setY(5), shatter: this.solid });
          fx.explosion(this.el, this.pos, 1.8 + this.m, 0.6, this.pal, { look: this.look, noDecal: true });
          fx.addShake(0.2, this.pos); this.g.audio.impact(this.el, 0.7, this.pos, this.look);
          this.hits++; this.bite = 0;
          if (this.hits >= this.passes) { this.state = 'dive'; this.stT = 0; }
          else { this.state = 'loop'; this.stT = 0; this.way = tc.clone().addScaledVector(this.vel.clone().setY(0).normalize(), 10).add(new THREE.Vector3(rand(-4, 4), 7, rand(-4, 4))); }
        }
      } else this.steer(new THREE.Vector3(Math.cos(this.t), 0.1, Math.sin(this.t)), dt, 1);
      if (this.t > this.life) { this.state = 'dive'; this.stT = 0; }
    } else if (this.state === 'loop') {
      this.steer(this.way.clone().sub(this.pos), dt, 3.5);
      if (this.pos.distanceTo(this.way) < 3 || this.stT > 1.4) { this.state = 'hunt'; this.stT = 0; }
    } else if (this.state === 'dive') {
      const at = (this.target?.alive ? this.target.pos : this.pos.clone().addScaledVector(this.vel, 0.5)).clone(); at.y = groundY(this.g, at);
      this.steer(at.sub(this.pos), dt, 5); this.vel.setLength(this.speed * 1.4);
      if (this.pos.y < groundY(this.g, this.pos) + 0.3 || this.stT > 1.6) {
        this.state = 'gone'; this.stT = 0; this.loopSnd?.stop(); this.loopSnd = null;
        const p = this.pos.clone(); p.y = Math.max(p.y, groundY(this.g, p) + 0.4);
        this.explode(p, 2.5 + this.m * 1.5, 45 * this.dmgK, { knock: 10, lift: 7 });
        fx.shockWall?.(p, 3 + this.m * 2, this.look, this.el, 0.6, 0.9); fx.addShake(0.35, p);
        escalateImpact(this, p, 2 + this.m, null);
      }
    }
    if (this.state !== 'gone') {
      this.pos.addScaledVector(this.vel, dt);
      const gy = groundY(this.g, this.pos) + 0.6; if (this.state !== 'dive' && this.pos.y < gy) { this.pos.y = gy; this.vel.y = Math.abs(this.vel.y) * 0.5; }
      if (this.hist[0].distanceTo(this.pos) > this.r * 0.4) { this.hist.unshift(this.pos.clone()); if (this.hist.length > 400) this.hist.pop(); }
      else this.hist[0].copy(this.pos);
    }
    // body follows the path: the head's history, resampled at even arc length
    const fade = this.state === 'gone' ? 1 - clamp(this.stT / 0.35) : clamp(this.t / 0.2);
    const len = this.len * (this.state === 'rise' ? 0.4 + 0.6 * clamp(this.t / 0.9) : 1);
    for (let i = 0; i < this.N; i++) alongHistory(this.hist, (i / (this.N - 1)) * len, this.pts[i]);
    const r = this.r, rad = (q) => r * fade * (q < 0.06 ? 0.7 + q / 0.06 * 0.3 : Math.pow(1 - (q - 0.06) / 0.94, 0.8) * 0.95 + 0.05) * (1 + Math.sin(q * 30 - this.t * 8) * 0.04);
    this.body.update(this.pts, rad); this.bodyGlow?.update(this.pts, (q) => rad(q) * 0.7);
    this.body.mesh.material.uniforms.uFade.value = fade; if (this.bodyGlow) this.bodyGlow.mesh.material.uniforms.uFade.value = fade;
    const H = this.head;
    H.visible = this.state !== 'gone' || fade > 0.05; H.position.copy(this.pts[0]);
    H.lookAt(_v.copy(this.pts[0]).add(this.vel)); H.scale.setScalar(this.r * 1.6 * Math.max(0.01, fade));
    this.jaw.rotation.x = 0.1 + this.bite * 0.6 + Math.sin(this.t * 7) * 0.05;
    if (this.wings) { // wings ride the shoulders (segment 5) and beat slowly
      const i0 = 5, p = this.pts[i0], t = _v.subVectors(this.pts[i0 - 1], this.pts[i0 + 1]).normalize(); // forward
      const side = new THREE.Vector3().crossVectors(t, _up).normalize(), upv = new THREE.Vector3().crossVectors(side, t).normalize();
      for (const w of this.wings) {
        _m4.makeBasis(side, upv, t); w.quaternion.setFromRotationMatrix(_m4);
        w.rotateZ(w.userData.side * (Math.sin(this.t * 5) * 0.45 - 0.25)); w.rotateX(0.5); // flap, swept back
        w.position.copy(p).addScaledVector(upv, this.r * 0.6); w.scale.setScalar(this.r * 2.8 * fade); w.visible = fade > 0.05;
      }
    }
    this.fins.forEach((f, i) => {
      const q = 0.1 + i * 0.085, idx = Math.floor(q * (this.N - 1)), p = this.pts[idx], n = this.pts[Math.min(this.N - 1, idx + 1)];
      const t = _w.subVectors(p, n).normalize(); const side = new THREE.Vector3().crossVectors(t, _up).normalize(); const upv = new THREE.Vector3().crossVectors(side, t).normalize();
      const rr = rad(q); f.position.copy(p).addScaledVector(upv, rr * 0.95);
      f.quaternion.setFromUnitVectors(_up, upv); f.scale.set(rr * 0.25, rr * 0.9, rr * 0.6); f.visible = fade > 0.05;
    });
    for (let k = 0; k < 2; k++) { const p = this.pts[Math.floor(rand(2, this.N - 4))]; this.emit(p, 1, r * 0.9, 0.6); }
    if (this.state !== 'gone') { this.light(this.pos, 120, 8); this.loopSnd?.set(this.pos); }
    const camD = this.pos.distanceTo(this.g.camera.position); if (camD < 7 && (this.camD ?? 99) >= 7) this.g.audio.passby?.(this.pos, this.m); this.camD = camD; // it swept past your head
    if (this.state === 'gone' && this.stT > 0.4) this.done = true;
    this.updateCommon(dt);
    return !this.finished() || this.mc.opacity > 0.02;
  }
  threats() { return this.state === 'gone' ? [] : [{ pos: this.pos, vel: this.vel, radius: this.r * 1.5 }]; }
  dispose() { super.dispose(); this.mats.forEach((m) => m.dispose()); }
}

// ============================================================ 6. HALO — a ring of blades circling the caster that cuts and intercepts
class HaloSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, L = this.look;
    this.kit = kitOf(this.el, L);
    this.n = 4 + Math.round(s.count * 4) + this.level;
    this.R = (1.7 + s.size * 1.1) * (0.8 + this.m * 0.25) * Math.sqrt(L.sx);
    this.life = 8 + s.duration * 8 + this.m * 2;
    this.spin = (2.2 + s.speed * 2.6) * (L.g.weight > 0.7 ? 0.7 : 1);
    const solid = solidKit(this), sharp = L.g.sharpness > 0.55;
    this.orbit = [];
    for (let i = 0; i < this.n; i++) {
      let m;
      if (solid) { m = new THREE.Group(); const sh = new THREE.Mesh(OCTA, crystalMaterial({ color: this.kit.body.clone().lerp(new THREE.Color(0xffffff), 0.2), glow: this.pal.color, emissive: 1 + this.kit.heat, crack: 0.3 })); sh.scale.set(0.26, 0.26, 0.95); m.add(sh); }
      else if (sharp) { m = new THREE.Group(); const b = new THREE.Mesh(BLADE_GEO, crystalMaterial({ color: this.pal.color.clone().lerp(this.kit.hi, 0.4), glow: this.pal.color, emissive: 1.6, crack: 0.1 })); b.scale.setScalar(0.55); m.add(b); const h = new THREE.Mesh(SPHERE_LO, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.2, noiseAmp: 0.2, opacity: 0.35 })); h.scale.set(0.15, 0.4, 0.9); m.add(h); }
      else m = coreMesh(this.el, this.pal, 0.24 + s.size * 0.08, s, this.look);
      m.userData.baseS = m.scale.clone();
      this.add(m);
      this.orbit.push({ m, a: (i / this.n) * TAU, alive: true, tr: this.trail(this.pal.color, this.pal.core, 0.14 + s.size * 0.06, 12, 1.2 + this.m) });
    }
    this.cd = new Map();
    // the orbit itself: a faint band of the element so the ring reads even between blades
    this.band = this.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.3, noiseAmp: 0.1, opacity: 0.55 })));
    this.band.userData.ownGeo = true; this.band.rotation.x = Math.PI / 2;
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.R * 1.1, intensity: 1.2 });
    this.mc.group.rotation.x = -Math.PI / 2; this.add(this.mc.group);
    this.g.fx.ring(this.caster.pos.clone().setY(this.caster.pos.y + 1), this.pal.color, this.R * 2.5, 0.5);
    this.g.audio.cast(this.el, this.m, this.caster.pos, this.look); this.g.audio.shimmer?.(this.caster.pos);
    this.loopSnd = this.g.audio.loop(this.el, this.caster.pos, 0.18, this.look, { spin: 0.6 });
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, c = this.caster, cc = c.center(), fx = this.g.fx;
    const grow = easeOut(this.t / 0.35), out = clamp((this.t - this.life) / 0.5);
    this.mc.group.position.copy(c.pos).y += 0.1; this.mc.update(dt); this.mc.target = this.t < 0.8 ? 1 : 0;
    const R = this.R * grow * (1 + out * 2.5), tilt = Math.sin(this.t * 0.7) * 0.18;
    this.band.position.set(cc.x, cc.y + 0.1, cc.z); this.band.scale.set(Math.max(0.01, R), Math.max(0.01, R), 1 + (1 - out) * 3); this.band.rotation.y = tilt * 0.3; this.band.visible = out < 0.95 && !this.done;
    for (const b of this.orbit) {
      if (!b.alive) continue;
      b.a += dt * this.spin;
      const x = Math.cos(b.a) * R, z = Math.sin(b.a) * R, y = Math.sin(b.a * 2 + this.t) * 0.22 + x * tilt * 0.3;
      b.m.position.set(cc.x + x, cc.y + 0.1 + y, cc.z + z);
      b.m.lookAt(_v.set(cc.x - Math.sin(b.a) * 10, cc.y + y, cc.z + Math.cos(b.a) * 10).add(b.m.position).sub(_w.copy(cc).setY(cc.y + y)));
      b.m.scale.copy(b.m.userData.baseS).multiplyScalar(Math.max(0.01, grow * (1 - out)));
      b.tr.push(b.m.position);
      if (Math.random() < 0.2) this.emit(b.m.position, 1, 0.18, 0.4);
    }
    if (this.t < this.life && c.alive) {
      // cut whoever steps inside the ring
      for (const tg of this.targets()) {
        const last = this.cd.get(tg) || 0; if (this.t - last < 0.38) continue;
        for (const b of this.orbit) if (b.alive && tg.hits(b.m.position, 0.35)) {
          this.cd.set(tg, this.t);
          this.hit(tg, 12 + s.sharpness * 6, b.m.position.clone(), { knock: tg.pos.clone().sub(c.pos).setY(0).setLength(4).setY(1.5) });
          fx.explosion(this.el, b.m.position, 0.7, 0.15, this.pal, { look: this.look, noDecal: true });
          this.g.audio.impact(this.el, 0.25, b.m.position, this.look);
          break;
        }
      }
      // intercept incoming projectiles: each blade can stop one, and is spent doing it
      for (const sp of this.sys.active) {
        if (sp.caster === c || !(sp.projectiles?.length || sp.missiles?.length)) continue;
        const shots = [...(sp.projectiles || []), ...(sp.missiles || []).filter((m) => m.launched)];
        for (const q of shots) {
          if (!q.alive) continue;
          const qr = q.radius ?? q.r ?? 0.3;
          if (q.pos.distanceTo(cc) > R + 1.5 + qr) continue;
          const b = this.orbit.find((bb) => bb.alive && bb.m.position.distanceTo(q.pos) < 0.75 + qr);
          if (!b) continue;
          b.alive = false; b.tr.dead = true; b.m.visible = false;
          q.end(null, 'barrier');
          fx.explosion(this.el, b.m.position, 1.2, 0.35, this.pal, { look: this.look, noDecal: true }); fx.starburst(b.m.position, this.pal.core, 1.6, 6, 0.14);
          this.g.audio.clang?.(b.m.position);
        }
      }
    }
    this.loopSnd?.set(cc);
    c.haloN = this.done ? 0 : this.orbit.filter((b) => b.alive).length; // HUD status
    if (this.t > this.life + 0.5 || !this.orbit.some((b) => b.alive) || !c.alive) {
      if (!this.done) { this.done = true; this.loopSnd?.stop(); this.loopSnd = null; for (const b of this.orbit) { b.tr.dead = true; if (b.alive) b.m.visible = false; } }
    }
    this.updateCommon(dt);
    return !this.finished() || this.mc.opacity > 0.02;
  }
  dispose() { super.dispose(); this.caster.haloN = 0; }
}

// ============================================================ 7. SWORD — a colossal blade forms in the sky and plunges down
const SWORD_PARTS = (() => {
  const sh = new THREE.Shape(); // blade profile: tip at y=0, hilt end at y=0.72
  sh.moveTo(0, 0); sh.lineTo(0.085, 0.13); sh.lineTo(0.07, 0.7); sh.lineTo(0.1, 0.72); sh.lineTo(-0.1, 0.72); sh.lineTo(-0.07, 0.7); sh.lineTo(-0.085, 0.13); sh.lineTo(0, 0);
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.012, bevelSegments: 2, curveSegments: 1 });
  blade.translate(0, 0, -0.006);
  // uv for kit flow: along the blade
  const p = blade.attributes.position, uv = blade.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 5 + 0.5, p.getY(i) / 0.72);
  const guard = new THREE.BoxGeometry(0.34, 0.05, 0.07); guard.translate(0, 0.745, 0);
  const grip = new THREE.CylinderGeometry(0.022, 0.026, 0.19, 10); grip.translate(0, 0.865, 0);
  const pommel = new THREE.SphereGeometry(0.042, 16, 12); pommel.translate(0, 0.98, 0);
  const gem = new THREE.OctahedronGeometry(0.035, 0); gem.translate(0, 0.745, 0.04);
  return { blade, guard, grip, pommel, gem };
})();
class SwordSpell extends Spell {
  constructor(sys, spec, caster, aim, opts = {}) {
    super(sys, spec, caster, aim);
    const s = this.spec, L = this.look;
    aim = this.caster.getAim();
    this.kit = kitOf(this.el, L);
    this.target = opts.target !== undefined ? opts.target : this.nearestTarget(this.caster.eye(new THREE.Vector3()), aim.dir, 0.75, 60);
    this.at = (opts.at || (this.target ? this.target.pos : aim.point)).clone(); this.at.y = groundY(this.g, this.at);
    this.minor = !!opts.at;
    if (opts.at) this.target = null; // satellites strike the ground around the foe, they do not track it
    this.pt = -(opts.delay || 0);
    const extra = opts.at ? 0 : Math.round(clamp((s.count - 0.35) / 0.65) * 5);
    for (let i = 0; i < extra; i++) { // a ring of lesser blades closes in around the main one
      const a = (i / extra) * TAU + rand(-0.2, 0.2), r = rand(3, 5.5) * (0.8 + s.size * 0.4);
      const at = this.at.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      this.sys.active.push(new SwordSpell(sys, { ...s, size: s.size * 0.55, count: 0 }, caster, aim, { at, delay: 0.12 + i * 0.1, target: null }));
    }
    this.Ls = (6 + s.size * 6) * (0.65 + this.m * 0.45) * L.sy;
    this.R = (2.6 + s.size * 2.5) * (0.65 + this.m * 0.45) * L.sx;
    this.hover = 12 + this.Ls * 0.8;
    const solid = solidKit(this) || L.g.sharpness > 0.6;
    this.bladeM = solid ? crystalMaterial({ color: this.kit.body.clone().lerp(this.kit.hi, 0.35), glow: this.pal.color, emissive: 1.1 + this.kit.heat * 1.5, crack: 0.25 + this.kit.heat * 0.4 }) : tubeMat(this.kit, { opacity: 1, flow: 3, streak: 3 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3440, roughness: 0.45, metalness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: this.pal.color, emissive: this.pal.color, emissiveIntensity: 1.3 });
    this.mats = [this.bladeM, metal, trim];
    const sw = (this.sword = new THREE.Group());
    const blade = new THREE.Mesh(SWORD_PARTS.blade, this.bladeM); blade.renderOrder = 3; sw.add(blade);
    this.edge = new THREE.Mesh(SWORD_PARTS.blade, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.6, noiseAmp: 0.1, rimPower: 1.5, opacity: 0.45 })); this.edge.scale.set(1.18, 1.03, 2.2); this.edge.position.y = -0.01; sw.add(this.edge);
    sw.add(new THREE.Mesh(SWORD_PARTS.guard, metal), new THREE.Mesh(SWORD_PARTS.grip, metal), new THREE.Mesh(SWORD_PARTS.pommel, trim), new THREE.Mesh(SWORD_PARTS.gem, trim));
    sw.children.forEach((m) => { m.castShadow = true; });
    this.add(sw);
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: this.Ls * 0.35, intensity: 1.8 });
    this.mc.group.rotation.x = Math.PI / 2; this.add(this.mc.group);
    this.ground = new MagicCircle({ seed: s.seed + 5, tier: 2, color: this.pal.color, radius: this.R, intensity: 1 });
    this.ground.group.rotation.x = -Math.PI / 2; this.add(this.ground.group);
    this.phase = 'form'; this.y = this.at.y + this.hover; this.vy = 0;
    if (!opts.at) { this.g.audio.cast('light', 0.4 + this.m * 0.4, this.at, this.look); this.g.audio.cast(this.el, this.m, this.at, this.look); }
    this.sword.visible = this.pt >= 0;
  }
  update(dt) {
    this.t += dt; this.pt += dt;
    const s = this.spec, fx = this.g.fx, sw = this.sword, Ls = this.Ls;
    if (this.phase === 'form' && this.target?.alive && this.pt < 0.45) { const tp = this.target.pos; this.at.x += (tp.x - this.at.x) * clamp(dt * 6); this.at.z += (tp.z - this.at.z) * clamp(dt * 6); this.at.y = groundY(this.g, this.at); }
    this.ground.group.position.copy(this.at).y += 0.12; this.ground.update(dt); this.ground.target = this.phase === 'form' || this.phase === 'fall' ? 1 : 0;
    this.mc.update(dt); this.mc.target = this.phase === 'form' ? 1 : 0;
    const formK = easeOut(Math.max(0, this.pt) / 0.5);
    if (this.phase === 'form') sw.visible = this.pt >= 0;
    if (this.phase === 'form') {
      this.y = this.at.y + this.hover + Math.sin(this.t * 3) * 0.2;
      sw.rotation.set(0, this.t * 0.8, 0); // geometry is point-down: tip at the origin, hilt at +y
      sw.scale.set(Ls * (0.4 + 0.6 * formK), Ls * formK, Ls * (0.4 + 0.6 * formK));
      // matter gathers into the blade
      for (let k = 0; k < 5; k++) {
        const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(Ls * 0.8), c = _v.set(this.at.x, this.y - Ls * 0.4, this.at.z);
        fx.glow.emit({ x: c.x + d.x, y: c.y + d.y, z: c.z + d.z, vx: -d.x * 2, vy: -d.y * 2, vz: -d.z * 2, life: 0.4, size: 0.25, size1: 0.05, color: this.pal.core, alpha: 1, drag: 0, frame: 1 });
      }
      this.light(_v.set(this.at.x, this.y - Ls * 0.5, this.at.z), 250 * formK, Ls * 2);
      if (this.pt > 0.62) { this.phase = 'fall'; this.pt = 0; this.vy = 25; this.g.audio.whoosh(1.2); this.g.audio.swordFall?.(this.at, this.m); }
    } else if (this.phase === 'fall') {
      this.vy += 160 * dt; this.y -= this.vy * dt;
      const tipY = this.y - Ls;
      for (let k = 0; k < 3; k++) { const p = _v.set(this.at.x + rand(-0.3, 0.3) * Ls * 0.12, this.y - rand(0, Ls), this.at.z + rand(-0.3, 0.3) * Ls * 0.12); fx.sparks.emit(p.x, p.y, p.z, 0, 30, 0, 0.25, this.pal.core, 0, 0.12); }
      if (tipY <= this.at.y - Ls * 0.22) {
        this.y = this.at.y - Ls * 0.22 + Ls; this.phase = 'stuck'; this.pt = 0;
        const c = this.at.clone().setY(this.at.y + 0.6);
        if (this.target?.alive && Math.hypot(this.target.pos.x - this.at.x, this.target.pos.z - this.at.z) < 1.4 + Ls * 0.06) this.hit(this.target, 70, this.target.center(), { stun: 0.4, shatter: true });
        this.explode(c, this.R, this.minor ? 22 : 62, { knock: (12 + s.weight * 8) * (this.minor ? 0.5 : 1), lift: 7, falloff: 0.5 });
        fx.decal(this.at.clone().setY(this.at.y + 0.05), this.R * 1.6, this.el, this.pal.color);
        fx.shockWall?.(this.at, this.R * 1.4, this.look, this.el, 0.7, 1.1);
        fx.ring(this.at.clone().setY(this.at.y + 0.2), this.pal.core, this.R * 3, 0.6); fx.shockwave(c, this.R * 4, 1.6, 0.5);
        fx.addShake(0.5 + this.m * 0.35, c); if (this.caster.isPlayer || this.target === this.g.player) this.g.screenFlash?.('#' + this.pal.core.getHexString(), 0.12);
        fx.debris?.(c, this.R * 0.8, this.el, this.pal, this.look);
        if (this.el === 'earth' || this.el === 'ice') this.sys.spikeRing(this, this.at, this.R * 0.8);
        if (!this.minor) escalateImpact(this, c, this.R * 0.8, this.target);
        this.g.audio.impact('earth', (0.8 + this.m * 0.4) * (this.minor ? 0.5 : 1), c, this.look);
      }
    } else if (this.phase === 'stuck') {
      const pulse = 1 + Math.sin(this.pt * 14) * 0.06;
      this.edge.material.uniforms.uOpacity.value = 0.45 * pulse;
      if (Math.random() < 0.5) fx.element(this.el, _v.set(this.at.x, this.at.y + rand(0, Ls * 0.7), this.at.z), { count: 1, speed: 1, size: 0.35, palette: this.pal, look: this.look, dir: _up });
      this.light(this.at.clone().setY(this.at.y + Ls * 0.4), 160, Ls * 1.5);
      if (this.pt > 1.4 + s.duration) {
        this.phase = 'gone'; this.pt = 0;
        const mid = this.at.clone().setY(this.at.y + Ls * 0.45);
        fx.explosion(this.el, mid, Ls * 0.35, 0.5, this.pal, { look: this.look, noDecal: true, debris: true });
        for (let k = 0; k < 12; k++) fx.glow.emit({ x: mid.x, y: mid.y + rand(-Ls * 0.4, Ls * 0.4), z: mid.z, vx: rand(-6, 6), vy: rand(0, 6), vz: rand(-6, 6), life: rand(0.5, 1), size: 0.35, size1: 0.05, color: this.pal.core, alpha: 1, drag: 1, grav: 8, frame: 4 });
        this.g.audio.shatter?.(mid, this.m);
        sw.visible = false;
      }
    }
    sw.position.set(this.at.x, this.y - sw.scale.y, this.at.z); // this.y is the hilt height
    this.mc.group.position.set(this.at.x, this.y + 0.9, this.at.z);
    if (this.phase === 'gone' && this.pt > 0.3) this.done = true;
    this.updateCommon(dt);
    return !this.finished() || this.ground.opacity > 0.02;
  }
  threats() { return this.phase === 'form' || this.phase === 'fall' ? [{ pos: this.at, vel: new THREE.Vector3(), radius: this.R, area: true }] : []; }
  dispose() { super.dispose(); this.mats.forEach((m) => m.dispose()); }
}

// ============================================================ 8. RUSH — the caster becomes a comet of matter and rams through
class RushSpell extends Spell {
  constructor(...a) {
    super(...a);
    const s = this.spec, c = this.caster, aim = c.getAim();
    this.kit = kitOf(this.el, this.look);
    this.dir = aim.dir.clone(); if (!(c.flying > 0)) this.dir.y = 0; this.dir.normalize();
    this.speed = 30 + s.speed * 18;
    this.dist = (12 + s.size * 10) * (0.7 + this.m * 0.4);
    this.time = this.dist / this.speed;
    this.hitSet = new Set(); this.last = c.pos.clone(); this.stall = 0;
    const sk = surfaceMaterial({ ...this.kit, opacity: Math.max(this.kit.opacity, 0.85) }, { spin: 2.5, twist: 1.5, bulge: 0.15 });
    sk.uniforms.uTopFade.value = 1; sk.uniforms.uFlow.value = 4;
    this.shell = this.add(new THREE.Mesh(COMET, sk)); this.shell.renderOrder = 3;
    if (this.kit.energy > 0.2 || this.kit.heat > 0.3) { const gm = surfaceMaterial(this.kit, { spin: 3, twist: 2, bulge: 0.1, energyOnly: true }); gm.uniforms.uFlow.value = 5; this.shellGlow = new THREE.Mesh(COMET, gm); this.shellGlow.scale.setScalar(0.8); this.shell.add(this.shellGlow); }
    this.tr = this.trail(this.pal.color, this.pal.core, 0.9 + this.m * 0.4, 20, 1.4 + this.m);
    this.g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), this.pal.color, 4, 0.4); this.g.fx.shockwave(c.center(), 5, 1, 0.35);
    this.g.fx.shockWall?.(c.pos, 2.5, this.look, this.el, 0.4, 0.6);
    this.g.audio.whoosh(1.2); this.g.audio.cast(this.el, this.m, c.pos, this.look); this.g.audio.rushBoom?.(c.pos, this.m);
    if (c.isPlayer) this.g.screenFlash?.('#' + this.pal.color.getHexString(), 0.12);
  }
  update(dt) {
    this.t += dt;
    const s = this.spec, c = this.caster, fx = this.g.fx, cc = c.center();
    const active = this.t < this.time && c.alive && !this.ended;
    if (active) {
      c.vel.x = this.dir.x * this.speed; c.vel.z = this.dir.z * this.speed; if (c.flying > 0) c.vel.y = this.dir.y * this.speed; else c.vel.y = Math.min(c.vel.y, 2);
      const moved = c.pos.distanceTo(this.last); this.last.copy(c.pos);
      if (this.t > 0.08 && moved < this.speed * dt * 0.25) { this.stall += dt; if (this.stall > 0.06) this.ended = true; } else this.stall = 0;
      for (const tg of this.targets()) {
        if (this.hitSet.has(tg) || tg.distTo(cc) > 1.9 + this.m * 0.4) continue;
        this.hitSet.add(tg);
        const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x); if (side.dot(tg.pos.clone().sub(c.pos)) < 0) side.negate();
        this.hit(tg, 52 + s.weight * 20, tg.center(), { knock: this.dir.clone().multiplyScalar(10).addScaledVector(side, 5).setY(7), stun: 0.3, shatter: s.weight > 0.6 });
        fx.explosion(this.el, tg.center(), 1.6 + this.m * 0.5, 0.5, this.pal, { look: this.look, noDecal: true }); fx.addShake(0.25, cc);
        this.g.audio.impact(this.el, 0.6, tg.center(), this.look);
      }
      this.emit(cc, 3 + this.m * 3, 0.5, 2, this.dir.clone().negate());
      for (let k = 0; k < 3; k++) fx.sparks.emit(cc.x + rand(-0.8, 0.8), cc.y + rand(-0.8, 0.8), cc.z + rand(-0.8, 0.8), -this.dir.x * 30, -this.dir.y * 30, -this.dir.z * 30, 0.2, this.pal.core, 0, 0.1);
      if (c.grounded && Math.random() < 0.5) fx.puff(c.pos.clone().setY(c.pos.y + 0.1), { color: new THREE.Color(0xcdbb96), size: 0.8, life: 0.9, alpha: 0.5, rise: 0.5 });
      if (c.grounded && c.pos.distanceTo(this.lastMark || _w.set(1e9, 0, 0)) > 1.6) { this.lastMark = c.pos.clone(); fx.decal(c.pos.clone().setY(c.pos.y + 0.05), 0.9 + this.m * 0.3, this.el, this.pal.color); } // a scorched track behind the charge
      this.tr.push(cc);
      this.light(cc, 200, 10);
      if (!c.isPlayer) { const camD = cc.distanceTo(this.g.camera.position); if (camD < 6 && (this.camD ?? 99) >= 6) this.g.audio.passby?.(cc, this.m); this.camD = camD; }
      if (c.isPlayer) this.g.fovKick = 16; // the world stretches past you
    } else if (!this.burst) {
      this.burst = true; c.vel.multiplyScalar(0.25);
      this.explode(cc, 2.4 + this.m * 1.4, 30, { knock: 10, lift: 5 }); fx.shockwave(cc, 6, 1.2, 0.4); fx.addShake(0.3, cc); this.tr.dead = true;
    }
    const k = active ? clamp(this.t / 0.08) : 1 - clamp((this.t - this.time) / 0.25);
    this.shell.visible = k > 0.01 && !(c.isPlayer && this.g.firstPerson && active && this.t > 0.05) ;
    this.shell.position.copy(cc); this.shell.lookAt(_v.copy(cc).add(this.dir)); this.shell.scale.set(1.3 + this.m * 0.3, 1.3 + this.m * 0.3, (1.6 + this.m * 0.5) * (active ? 1.4 : 1)).multiplyScalar(Math.max(0.01, k));
    this.shell.material.uniforms.uFade.value = k; if (this.shellGlow) this.shellGlow.material.uniforms.uFade.value = k;
    if (this.burst && this.t > this.time + 0.3) this.done = true;
    if (this.ended && !this.burst) this.time = Math.min(this.time, this.t);
    this.updateCommon(dt);
    return !this.finished();
  }
}

// ============================================================ 9. TOTEM — a floating crystal obelisk that fires at foes nearby
const TOTEM_BASE = (() => { const g = new THREE.CylinderGeometry(0.75, 1.05, 0.55, 8, 1); g.translate(0, 0.275, 0); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; })();
class TotemSpell extends Spell {
  constructor(sys, spec, caster, aim0, opts = {}) {
    super(sys, spec, caster, aim0);
    const s = this.spec, c = this.caster, aim = c.getAim(), L = this.look;
    this.kit = kitOf(this.el, L);
    const f = aim.dir.clone().setY(0).normalize();
    this.at = opts.at ? opts.at.clone() : aim.point.distanceTo(c.pos) < 20 ? aim.point.clone() : c.pos.clone().addScaledVector(f, 8);
    if (!opts.at && s.count > 0.6) this.sys.active.push(new TotemSpell(sys, { ...s, count: 0 }, caster, aim0, { at: this.at.clone().addScaledVector(new THREE.Vector3(-f.z, 0, f.x), 4.5) }));
    this.at.y = this.g.world.groundAt(this.at.x, this.at.z, this.at.y + 1);
    this.life = 10 + s.duration * 10 + this.m * 4;
    this.range = 24 + s.size * 10;
    this.interval = (1.05 - s.speed * 0.45) * (this.level >= 2 ? 0.75 : 1);
    this.S = (0.9 + s.size * 0.5) * (0.8 + this.m * 0.3) * L.sy;
    const baseM = stoneMaterial(0xb8a888, { moss: 0.3, joint: 0.9 });
    const cryM = crystalMaterial({ color: this.kit.body.clone().lerp(new THREE.Color(0xffffff), 0.25), glow: this.pal.color, emissive: 1.3 + this.kit.heat, crack: 0.3 });
    this.mats = [baseM, cryM];
    const bg = TOTEM_BASE.clone(); bg.setAttribute('aGround', new THREE.Float32BufferAttribute(new Float32Array(bg.attributes.position.count).fill(this.at.y), 1)); // stone shader grime reads height above the ground
    this.base = this.add(new THREE.Mesh(bg, baseM)); this.base.userData.ownGeo = true; this.base.position.copy(this.at); this.base.castShadow = this.base.receiveShadow = true;
    this.cry = this.add(new THREE.Mesh(OCTA, cryM)); this.cry.castShadow = true;
    if (!solidKit(this)) { const sh = surfaceMaterial({ ...this.kit, opacity: 0.6 }, { spin: 1.5, twist: 1, bulge: 0.12 }); sh.uniforms.uTopFade.value = 0; this.shell = new THREE.Mesh(SMOOTH, sh); this.shell.scale.set(0.8, 0.55, 0.8); this.shell.renderOrder = 3; this.cry.add(this.shell); this.mats.push(sh); }
    this.rings = [0, 1].map(() => { const r = new THREE.Mesh(TORUS_GEO, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.4, noiseAmp: 0.05, opacity: 0.85 })); this.add(r); return r; });
    this.shards = [0, 1, 2].map(() => { const m = new THREE.Mesh(OCTA, cryM); this.add(m); return m; });
    this.mc = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: 2.2 * this.S, intensity: 1.2 });
    this.mc.group.rotation.x = -Math.PI / 2; this.mc.group.position.copy(this.at).y += 0.08; this.mc.spin = 0.5; this.add(this.mc.group);
    this.cd = 0.8; this.pulse = 0;
    // its reach, drawn faintly on the ground
    this.reach = this.add(new THREE.Mesh(new THREE.RingGeometry(this.range - 0.25, this.range, 96), new THREE.MeshBasicMaterial({ color: this.pal.color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })));
    this.reach.userData.ownGeo = true; this.reach.rotation.x = -Math.PI / 2; this.reach.position.copy(this.at).y += 0.15; this.reach.renderOrder = 4;
    this.loopSnd = this.g.audio.loop(this.el, this.at.clone().setY(this.at.y + 2.4), 0.1, this.look);
    this.g.audio.impact('earth', 0.35, this.at, this.look); this.g.audio.cast(this.el, this.m * 0.8, this.at, this.look);
    this.g.fx.ring(this.at.clone().setY(this.at.y + 0.15), this.pal.color, 4 * this.S, 0.45); this.g.fx.shockwave(this.at.clone().setY(this.at.y + 1), 5, 0.8, 0.35);
    this.g.fx.element(this.el, this.at.clone().setY(this.at.y + 0.6), { count: 8, speed: 3, size: 0.35, palette: this.pal, look: this.look }); // planted with a clean pulse, no lingering dust
  }
  fire(tg, from) {
    const fx = this.g.fx, to = tg.center(), bh = this.barrierHit(from, to);
    this.pulse = 1;
    if (this.el === 'lightning' || this.el === 'light') {
      const end = bh ? from.clone().lerp(to, bh.t) : to;
      fx.bolt(from, end, this.pal.color, { look: this.look, width: 0.08, dur: 0.16, jag: this.el === 'lightning' ? 0.2 : 0.02, branches: 1, flicker: false });
      if (bh) bh.bar.damage(10, end); else this.hit(tg, 11, end, { noReact: Math.random() < 0.5 });
      fx.explosion(this.el, end, 0.6, 0.12, this.pal, { look: this.look, noDecal: true });
    } else {
      const p = from.clone(), v = to.clone().sub(from).normalize().multiplyScalar(34); let tt = 0;
      const tr = this.trail(this.pal.color, this.pal.core, 0.16, 10, 2);
      fx.add((d2) => {
        tt += d2; const pr = p.clone();
        if (tg.alive) v.lerp(tg.center().sub(p).setLength(34), clamp(d2 * 2));
        p.addScaledVector(v, d2); tr.push(p);
        fx.element(this.el, p, { count: 1, speed: 0.2, size: 0.2, palette: this.pal, life: 0.3 });
        const b2 = this.barrierHit(pr, p);
        let hitT = null; for (const o of this.targets()) if (o.hits(p, 0.3)) hitT = o;
        if (b2 || hitT || this.g.world.solid(p) || tt > 1.6) {
          if (hitT) this.hit(hitT, 11, p.clone(), { noReact: Math.random() < 0.5 }); if (b2) b2.bar.damage(10, p);
          fx.explosion(this.el, p, 0.7, 0.14, this.pal, { look: this.look, noDecal: true }); tr.dead = true; return false;
        }
        return true;
      });
    }
    this.g.audio.zap?.(this.el, from);
  }
  update(dt) {
    this.t += dt;
    const fx = this.g.fx, at = this.at, S = this.S;
    const rise = easeOut(this.t / 0.4), out = clamp((this.t - this.life) / 0.5), k = rise * (1 - out);
    this.base.scale.set(S, Math.max(0.01, S * rise * (1 - out)), S);
    const hy = at.y + (2.4 + Math.sin(this.t * 2) * 0.15) * S + (1 - rise) * 5 - out * 1.5;
    this.pulse = Math.max(0, this.pulse - dt * 5);
    this.cry.position.set(at.x, hy, at.z); this.cry.rotation.y += dt * 1.2;
    this.cry.scale.set(0.45 * S * (1 + this.pulse * 0.25), 1.35 * S * (1 + this.pulse * 0.1), 0.45 * S * (1 + this.pulse * 0.25)).multiplyScalar(Math.max(0.01, k));
    this.rings.forEach((r, i) => { r.position.copy(this.cry.position); r.rotation.set(Math.PI / 2 + Math.sin(this.t * (1 + i)) * 0.6, this.t * (i ? -1.3 : 1.7), 0); r.scale.setScalar(Math.max(0.01, (0.8 + i * 0.3) * S * k)); });
    this.shards.forEach((m, i) => { const a = this.t * 2.2 + (i / 3) * TAU; m.position.set(at.x + Math.cos(a) * 1.3 * S, hy - 0.6 * S + Math.sin(a * 2) * 0.2, at.z + Math.sin(a) * 1.3 * S); m.rotation.set(a, a * 0.7, 0); m.scale.set(0.1, 0.3, 0.1).multiplyScalar(S * Math.max(0.01, k)); });
    this.mc.update(dt); this.mc.target = this.t < this.life ? 0.9 : 0;
    this.reach.material.opacity = 0.22 * k * (0.7 + 0.3 * Math.sin(this.t * 3));
    if (Math.random() < 0.3 * k) fx.element(this.el, this.cry.position, { count: 1, speed: 0.5, size: 0.25, palette: this.pal, look: this.look });
    this.light(this.cry.position, (80 + this.pulse * 300) * k, 8);
    if (this.t > 0.5 && this.t < this.life && this.caster.alive) {
      this.cd -= dt;
      if (this.cd <= 0) {
        const from = this.cry.position.clone();
        let best = null, bd = this.range;
        for (const tg of this.targets()) { const d = tg.center().distanceTo(from); if (d < bd) { const rc = this.g.world.raycast(from, tg.center().sub(from).normalize(), d, 0.6); if (!rc.hit || rc.dist > d - 1) { bd = d; best = tg; } } }
        if (best) { this.cd = this.interval; this.fire(best, from); } else this.cd = 0.25;
      }
    }
    if (this.t >= this.life && !this.burst) { this.burst = true; this.loopSnd?.stop(); this.loopSnd = null; fx.explosion(this.el, this.cry.position, 1.8, 0.4, this.pal, { look: this.look, noDecal: true, debris: true }); this.g.audio.shatter?.(this.cry.position, 0.5); }
    if (this.t > this.life + 0.55) this.done = true;
    this.updateCommon(dt);
    return !this.finished() || this.mc.opacity > 0.02;
  }
  threats() { return []; }
  dispose() { super.dispose(); this.mats.forEach((m) => m.dispose()); }
}

// ============================================================ 10. MARK — a rune branded on the foe that detonates after a beat
class MarkSpell extends Spell {
  constructor(sys, spec, caster, aim, target = undefined) {
    super(sys, spec, caster, aim);
    const s = this.spec, L = this.look;
    this.kit = kitOf(this.el, L);
    const origin = this.sys.castOrigin(caster).clone();
    this.target = target !== undefined ? target : this.nearestTarget(caster.eye(new THREE.Vector3()), aim.dir, 0.8, 60);
    this.point = this.target ? null : aim.point.clone();
    this.delay = 2.3 - s.speed * 0.9;
    this.startHp = this.target ? this.target.hp : 0;
    const to = this.target ? this.target.center() : this.point;
    if (target === undefined) this.g.fx.bolt(origin, to, this.pal.color, { look: L, width: 0.06, dur: 0.22, jag: 0.03, branches: 0, flicker: false });
    this.g.fx.flash(to, this.pal.color, 1.2, 0.2, 2);
    this.sigil = new MagicCircle({ seed: s.seed, tier: s.tierInt, color: this.pal.color, radius: 0.85 + this.m * 0.3, intensity: 2.2 }); this.add(this.sigil.group); this.sigil.spin = 2;
    this.floor = new MagicCircle({ seed: s.seed + 9, tier: s.tierInt, color: this.pal.color, radius: 1.6 + this.m * 0.4, intensity: 1.3 });
    this.floor.group.rotation.x = -Math.PI / 2; this.add(this.floor.group); this.floor.spin = -1.4;
    this.beats = 0; this.stage = 'mark'; this.st = 0;
    // a gyroscope of rune bands locked around the body, readable from any angle, closing in as the mark ripens
    this.bands = [0, 1].map((i) => { const b = this.add(new THREE.Mesh(TORUS_GEO, energyMaterial({ color: this.pal.color, core: this.pal.core, intensity: 1.8, noiseAmp: 0.05, opacity: 0.9 }))); b.userData.tilt = i ? 1.2 : 0.35; return b; });
    this.g.audio.cast('arcane', 0.35, to, L); this.g.audio.tick?.(to, 0);
    if (this.target && this.target === this.g.player) { this.g.hud.banner('', this.g.hud.tr?.('warn.marked') || 'MARKED', 1.6); this.g.screenFlash?.('#' + this.pal.color.getHexString(), 0.2); }
  }
  where() { return this.target?.alive ? this.target.center() : this.point || this.lastPos; }
  update(dt) {
    this.t += dt; this.st += dt;
    const fx = this.g.fx, cam = this.g.camera;
    const p = this.where(); if (p) this.lastPos = p.clone();
    if (!p) { this.done = true; return false; }
    const gy = this.g.world.groundAt(p.x, p.z, p.y);
    const u = clamp(this.t / this.delay);
    this.sigil.group.position.set(p.x, p.y + 1.7, p.z); this.sigil.group.quaternion.copy(cam.quaternion);
    this.sigil.spin = 2 + u * 10; this.sigil.update(dt);
    this.floor.group.position.set(p.x, gy + 0.1, p.z); this.floor.update(dt);
    if (this.stage === 'mark') {
      this.sigil.target = this.floor.target = 1;
      this.sigil.group.scale.setScalar(1.3 - u * 0.5); this.floor.group.scale.setScalar(1.25 - u * 0.55);
      this.bands.forEach((b, i) => { b.position.copy(p); b.rotation.set(b.userData.tilt + Math.sin(this.t * 3 + i) * 0.2, this.t * (4 + u * 10) * (i ? -1 : 1), 0); b.scale.set(0.95 - u * 0.35, 0.95 - u * 0.35, 0.6 + u * 0.8); });
      // accelerating heartbeat before it goes off
      const beatAt = this.delay * (1 - Math.pow(0.55, this.beats + 1));
      if (this.t >= beatAt && this.beats < 6) { this.beats++; this.g.audio.tick?.(p, this.beats); fx.ring(p.clone().setY(gy + 0.15), this.pal.color, 2.4, 0.3); }
      if (Math.random() < 0.4) fx.glow.emit({ x: p.x + rand(-0.6, 0.6), y: p.y + rand(-0.8, 0.8), z: p.z + rand(-0.6, 0.6), vy: 1.5, life: 0.5, size: 0.14, size1: 0.02, color: this.pal.core, alpha: 1, drag: 0.5, frame: 1 });
      this.light(p, 60 + u * 200, 5);
      if (this.t >= this.delay) { this.stage = 'boom'; this.st = 0; this.detonate(p, gy); }
    } else {
      this.sigil.target = this.floor.target = 0;
      for (const b of this.bands) b.visible = false;
      if (this.col) {
        const k = easeOut(this.st / 0.14), f = 1 - clamp((this.st - 0.15) / 0.5);
        this.col.scale.set(this.colR * (1 - this.st * 0.4), this.colH * k, this.colR * (1 - this.st * 0.4));
        this.col.material.uniforms.uFade.value = f; if (this.colGlow) this.colGlow.material.uniforms.uFade.value = f;
      }
      if (this.st > 0.7) this.done = true;
    }
    this.updateCommon(dt);
    return !this.finished() || this.sigil.opacity > 0.02;
  }
  detonate(p, gy) {
    const s = this.spec, fx = this.g.fx, tg = this.target;
    const extra = tg ? clamp(this.startHp - tg.hp, 0, 400) * 0.35 : 0; // damage taken while marked feeds the blast
    fx.flash(p, this.pal.core, 2.5 + this.m, 0.25, 3); fx.blast(this.el, p, 1.2 + this.m * 0.8, this.m, this.pal, this.look);
    fx.shockwave(p, 6 + this.m * 3, 1.3, 0.4); fx.addShake(0.3 + this.m * 0.2, p);
    if (tg?.alive) this.hit(tg, 95 + extra / Math.max(0.3, s.dmgMult), p, { stun: 0.45, knock: new THREE.Vector3(0, 6, 0) });
    this.explode(p, 2.4 + this.m, 30, { exclude: tg, knock: 7, lift: 4 });
    // a column of the matter bursts up through the mark
    this.colR = 0.9 + this.m * 0.5; this.colH = 6 + this.m * 4;
    const cm = tubeMat(this.kit, { flow: 4, topFade: 1 }); cm.uniforms.uCrest.value = 0.4;
    this.col = this.add(new THREE.Mesh(COLUMN_GEO, cm)); this.col.position.set(p.x, gy - 0.1, p.z); this.col.scale.set(this.colR, 0.01, this.colR); this.col.renderOrder = 3;
    if (this.kit.energy > 0.25) { this.colGlow = new THREE.Mesh(COLUMN_GEO, tubeMat(this.kit, { flow: 5, energyOnly: true })); this.colGlow.scale.setScalar(0.7); this.col.add(this.colGlow); }
    escalateImpact(this, p, 1.5 + this.m, tg);
    this.g.audio.impact(this.el, 0.8 + this.m * 0.3, p, this.look); this.g.audio.runeBurst?.(p, this.m);
    // a counted mark leaps to the next foe close by
    if (s.count > 0.45 && !this.spread) {
      const next = this.g.combatants.filter((o) => o.alive && o !== this.caster && o !== tg && !(o.decoy && o.owner === this.caster) && o.center().distanceTo(p) < 14).sort((a, b) => a.center().distanceTo(p) - b.center().distanceTo(p))[0];
      if (next) { this.g.fx.bolt(p, next.center(), this.pal.color, { look: this.look, width: 0.06, dur: 0.2, jag: 0.05, branches: 0 }); const child = new MarkSpell(this.sys, { ...s, count: 0 }, this.caster, this.aim, next); child.spread = true; this.sys.active.push(child); }
    }
  }
}

registerShape('whip', WhipSpell);
registerShape('prison', PrisonSpell);
registerShape('decoy', DecoySpell);
registerShape('drain', DrainSpell);
registerShape('beast', BeastSpell);
registerShape('halo', HaloSpell);
registerShape('sword', SwordSpell);
registerShape('rush', RushSpell);
registerShape('totem', TotemSpell);
registerShape('mark', MarkSpell);
