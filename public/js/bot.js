// Rival archmage AI. Chants generated incantations (spoken via speechSynthesis),
// exploits elemental reactions, dodges projectiles and uses defensive magic.
import * as THREE from 'three';
import { localParse, buildSpec, askJev, generateIncantation, boltSpec } from './spellbook.js';
import { rand, pick, clamp, mulberry32 } from './util.js';
import { ELEMENT_KEYS } from './elements.js';
import { getLang } from './i18n.js';

const DIFF = {
  easy: { dodge: 0.2, aim: 2.6, cd: [5.5, 8], grand: 0.25, speed: 5, bolt: [2.2, 3.5] },
  normal: { dodge: 0.45, aim: 1.4, cd: [3.2, 5.5], grand: 0.45, speed: 6.2, bolt: [1.3, 2.4] },
  hard: { dodge: 0.75, aim: 0.6, cd: [2.0, 3.6], grand: 0.65, speed: 7.2, bolt: [0.8, 1.6] },
};
// which element to throw at an enemy wearing a given aura
const COUNTER = { poison: ['fire', 'light', 'wind'], water: ['ice', 'lightning', 'fire'], fire: ['water', 'lightning', 'wind'], ice: ['fire', 'lightning', 'earth'], lightning: ['fire', 'water', 'ice'], nature: ['fire', 'water'], darkness: ['light'], light: ['darkness', 'fire'] };
const SHAPE_POOL = ['orb', 'orb', 'orb', 'barrage', 'funnels', 'beam', 'tornado', 'meteor', 'spikes', 'chain', 'storm', 'crescent', 'vortex', 'nova', 'field', 'wave', 'hand'];

export class BotBrain {
  constructor(game, c, difficulty = 'normal', dummy = false) {
    this.g = game; this.c = c; this.dummy = dummy;
    this.d = DIFF[difficulty] || DIFF.normal;
    this.strafe = 1; this.strafeT = 0; this.castCd = 3; this.boltCd = 2; this.dodgeCd = 0;
    this.chant = null; this.rng = mulberry32(Date.now() & 0xffff);
    this.aimDir = new THREE.Vector3(0, 0, -1); this.aimPoint = new THREE.Vector3();
    this.jumpT = rand(2, 5);
    c.getAim = () => ({ origin: c.eye(new THREE.Vector3()), dir: this.aimDir, point: this.aimPoint });
  }
  target() { return this.g.combatants.find((o) => o !== this.c && o.alive); }
  update(dt) {
    const c = this.c, g = this.g;
    if (!c.alive) { this.cancelChant(); return { wish: new THREE.Vector3(), jump: false }; }
    const tgt = this.target();
    const wish = new THREE.Vector3();
    let jump = false;
    if (this.dummy) {
      c.hp = Math.min(c.maxHp, c.hp + dt * 40);
      if (tgt) { const d = tgt.pos.clone().sub(c.pos); c.yaw = Math.atan2(-d.x, -d.z); }
      this.aimDir.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw); this.aimPoint.copy(c.pos).addScaledVector(this.aimDir, 10);
      return { wish, jump };
    }
    if (!tgt) return { wish, jump };
    // ---------- aim with lead + inaccuracy
    const tc = tgt.center();
    const eye = c.eye(new THREE.Vector3());
    const dist = eye.distanceTo(tc);
    const lead = tgt.vel.clone().setY(0).multiplyScalar(dist / 40);
    const err = new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).multiplyScalar(this.d.aim * (0.3 + dist / 40));
    this.aimPoint.lerp(tc.clone().add(lead).add(err), Math.min(1, dt * 5));
    this.aimDir.subVectors(this.aimPoint, eye).normalize();
    c.yaw = Math.atan2(-this.aimDir.x, -this.aimDir.z); c.pitch = Math.asin(clamp(this.aimDir.y, -1, 1));
    // ---------- movement: keep preferred range, strafe, dodge
    const to = tgt.pos.clone().sub(c.pos).setY(0); const flatD = to.length(); to.normalize();
    const side = new THREE.Vector3(-to.z, 0, to.x);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(1.2, 3); }
    const pref = this.chant ? 22 : 18;
    wish.addScaledVector(to, flatD > pref + 4 ? 1 : flatD < pref - 5 ? -1 : 0);
    wish.addScaledVector(side, this.strafe * (this.chant ? 0.5 : 1));
    // keep inside the arena
    if (Math.hypot(c.pos.x, c.pos.z) > 95) wish.addScaledVector(c.pos.clone().setY(0).normalize(), -1.5);
    // steer along cliff faces instead of grinding into them
    if (wish.lengthSq() > 0.01) {
      const w = wish.clone().normalize(), H = (x, z) => g.world.heightAt(x, z), top = c.pos.y + 0.7;
      if (H(c.pos.x + w.x * 1.6, c.pos.z + w.z * 1.6) > top) {
        const l = new THREE.Vector3(-w.z, 0, w.x), hl = H(c.pos.x + l.x * 2, c.pos.z + l.z * 2), hr = H(c.pos.x - l.x * 2, c.pos.z - l.z * 2);
        wish.copy(hl < hr ? l : l.negate()).addScaledVector(w, -0.2);
      }
    }
    this.dodgeCd -= dt;
    let dashDir = null;
    if (this.dodgeCd <= 0) {
      for (const th of g.spells.threatsFor(c)) {
        if (th.area) {
          const d = Math.hypot(th.pos.x - c.pos.x, th.pos.z - c.pos.z);
          if (d < th.radius + 1) { dashDir = c.pos.clone().sub(th.pos).setY(0).normalize(); break; }
          continue;
        }
        const rel = c.center().sub(th.pos), v = th.vel;
        const vv = v.lengthSq(); if (vv < 1) continue;
        const tca = rel.dot(v) / vv; if (tca < 0 || tca > 0.9) continue;
        const closest = th.pos.clone().addScaledVector(v, tca).distanceTo(c.center());
        if (closest < (th.radius || 0.5) + 1.2) { dashDir = new THREE.Vector3(-v.z, 0, v.x).normalize().multiplyScalar(Math.random() < 0.5 ? -1 : 1); break; }
      }
      if (dashDir) {
        this.dodgeCd = 0.6;
        if (Math.random() < this.d.dodge) { this.dash = dashDir; } else dashDir = null;
      }
    }
    this.jumpT -= dt;
    if (this.jumpT <= 0) { jump = true; this.jumpT = rand(2.5, 6); }
    // ---------- casting
    this.castCd -= dt; this.boltCd -= dt;
    if (this.chant) this.updateChant(dt, tgt);
    else if (c.canAct()) {
      const hpFrac = c.hp / c.maxHp;
      if (this.castCd <= 0) this.startChant(tgt, hpFrac);
      else if (this.boltCd <= 0 && dist < 50) {
        this.boltCd = rand(...this.d.bolt);
        if (c.mana > 6) { c.mana -= 4; g.spells.cast(boltSpec(this.favEl || pick(ELEMENT_KEYS)), c); c.model.castAnim = 0.6; c.model.setElement(this.favEl || 'arcane'); }
      }
    }
    const out = { wish: wish.lengthSq() ? wish.normalize() : wish, jump, speed: this.d.speed * (this.chant ? 0.6 : 1) };
    if (this.dash) { out.dash = this.dash; this.dash = null; }
    return out;
  }
  startChant(tgt, hpFrac) {
    const c = this.c, d = this.d;
    let element, shape;
    const aura = tgt.aura?.el;
    if (hpFrac < 0.35 && c.shield <= 0 && Math.random() < 0.5) { shape = 'ward'; element = pick(['light', 'nature', 'water', 'earth']); }
    else if (tgt.chanting && Math.random() < 0.3) { if (Math.random() < 0.65) { shape = 'barrier'; element = pick(['light', 'arcane', 'water', 'lightning']); } else { shape = 'wall'; element = pick(['earth', 'ice', 'fire']); } }
    else {
      element = aura && COUNTER[aura] && Math.random() < 0.75 ? pick(COUNTER[aura]) : pick(ELEMENT_KEYS);
      shape = tgt.frozen > 0 ? pick(['meteor', 'spikes', 'orb']) : pick(SHAPE_POOL);
      if (element === 'lightning' && Math.random() < 0.3) shape = 'chain';
      if (element === 'wind' && Math.random() < 0.4) shape = pick(['tornado', 'crescent']);
      if (c.hp / c.maxHp > 0.7 && !Object.keys(c.enh).length && Math.random() < 0.08) shape = 'enhance';
    }
    this.favEl = element;
    c.model?.setElement(element);
    // spend grandeur according to mana
    let grand = clamp(this.d.grand + rand(-0.35, 0.4));
    if (c.mana < 60) grand *= 0.5;
    const text = generateIncantation(this.rng, grand, element, shape, getLang());
    const ja = getLang() === 'ja';
    const words = ja ? text.split(/(?<=[、！])/) : text.split(/\s+/);
    const units = ja ? text.length / 3.2 : words.length;
    this.chant = { text, t: 0, dur: 0.6 + units * 0.3, words, grand, joiner: ja ? '' : ' ' };
    c.chanting = true; c.chantText = '';
    const chant = this.chant;
    chant.voicePending = true;
    const voiced = this.g.onBotChant?.(c, text, () => { chant.voicePending = false; });
    if (!voiced) chant.voicePending = false;
    // ask Jev during the chant so the latency is hidden
    const meta = { chantSeconds: this.chant.dur, loudness: 0.4 + grand * 0.5 };
    this.chant.meta = meta;
    this.chant.local = localParse(text);
    this.useJev = this.g.settings.botJev && this.g.jevOnline && this.g.mode !== 'menu';
    if (this.useJev) askJev(text, { ...meta, provider: this.g.settings.spellProvider, language: this.g.voice?.lang || this.g.settings.lang }).then((j) => { if (this.chant === chant) chant.jev = j; });
  }
  updateChant(dt, tgt) {
    const ch = this.chant, c = this.c;
    if (!c.canAct()) { this.cancelChant(); return; }
    ch.t += dt;
    const shown = Math.min(ch.words.length, Math.floor((ch.t / ch.dur) * ch.words.length) + 1);
    c.chantText = ch.words.slice(0, shown).join(ch.joiner);
    if (!ch.voicePending && ch.t >= ch.dur && (ch.jev || !this.useJev || ch.t > ch.dur + 1.2)) {
      const spec = buildSpec(ch.text, ch.local, ch.jev, ch.meta);
      const cost = spec.cost;
      if (c.mana >= cost) {
        c.mana = Math.max(0, c.mana - cost);
        this.g.spells.cast(spec, c);
        this.g.onCast?.(c, spec);
        c.model.castAnim = 1;
      }
      this.castCd = rand(...this.d.cd) + spec.mag * 1.5;
      this.chant = null; c.chanting = false; c.chantText = '';
    }
  }
  cancelChant() {
    if (!this.chant) return;
    this.chant = null; this.c.chanting = false; this.c.chantText = ''; this.castCd = 1.5;
    this.g.onBotChantCancel?.(this.c);
  }
}
