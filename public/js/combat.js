import * as THREE from 'three';
import { ELEMENTS, reactionFor, paletteFor, COMBOS } from './elements.js';
import { rand, clamp } from './util.js';

const _a = new THREE.Vector3();

// Elemental self-enhancements (from the Enhance form). power 0..1
export const ENHANCE = {
  fire: { name: 'Cinder Heart', ja: '焔心' },       // +damage
  wind: { name: 'Gale Stride', ja: '疾風歩' },       // +move speed
  ice: { name: 'Frost Mantle', ja: '霜鎧' },         // frost shield
  lightning: { name: 'Storm Nerves', ja: '雷脈' },   // faster bolts, cheaper spells
  earth: { name: 'Stone Armament', ja: '岩の武装' }, // damage reduction, no chant break
  water: { name: 'Flowing Renewal', ja: '流水再生' },// hp regen
  darkness: { name: 'Umbral Hunger', ja: '影喰らい' },// lifesteal
  light: { name: 'Dawn Reservoir', ja: '暁の泉' },   // mana regen
  nature: { name: 'Verdant Pulse', ja: '翠の脈動' },  // hp regen + cleanse poison
  poison: { name: 'Venom Coat', ja: '毒纏い' },       // hits apply poison
  arcane: { name: 'Astral Focus', ja: '星辰集中' },   // spells cost less
};

export class Combatant {
  constructor({ id, name, team = 0, authoritative = true, isPlayer = false }) {
    this.id = id; this.name = name; this.team = team; this.authoritative = authoritative; this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.grounded = false;
    this.maxHp = 600; this.hp = 600; this.maxMana = 120; this.mana = 120; this.stamina = 100;
    this.shield = 0; this.shieldTime = 0; this.shieldEl = null;
    this.aura = null;
    this.frozen = 0; this.stun = 0; this.defDown = 0; this.mud = 0; this.weaken = 0; this.curse = 0; this.dots = [];
    this.enh = {}; this.haste = 0; this.flying = 0; this.cloak = 0;
    this.hist = []; this.chain = { src: null, n: 0, t: 0, last: null };
    this.alive = true; this.chanting = false; this.chantText = '';
    this.model = null; this.kills = 0; this.deaths = 0;
    this.statusTick = 0;
  }
  eye(out = _a) { return out.set(this.pos.x, this.pos.y + 1.62, this.pos.z); }
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + 1.0, this.pos.z); }
  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  hits(p, r = 0) {
    const y = clamp(p.y, this.pos.y + 0.35, this.pos.y + 1.5);
    const dx = p.x - this.pos.x, dy = p.y - y, dz = p.z - this.pos.z, R = 0.5 + r;
    return dx * dx + dy * dy + dz * dz < R * R;
  }
  distTo(p) {
    const y = clamp(p.y, this.pos.y + 0.35, this.pos.y + 1.5);
    return Math.max(0, Math.hypot(p.x - this.pos.x, p.y - y, p.z - this.pos.z) - 0.5);
  }
  heal(n) { if (this.alive) this.hp = Math.min(this.maxHp, this.hp + n * (this.dots.some((d) => d.el === 'poison') ? 0.5 : 1)); }
  addShield(n, t = 8, el = null) { this.shield = Math.min(400, this.shield + n); this.shieldTime = Math.max(this.shieldTime, t); this.shieldEl = el; }
  canAct() { return this.alive && this.frozen <= 0 && this.stun <= 0 && !this.onShip; }
  enhP(el) { return this.enh[el] ? this.enh[el].p : null; }
  moveMult() {
    if (this.frozen > 0 || this.stun > 0) return 0;
    let m = this.mud > 0 ? 0.5 : this.aura?.el === 'ice' ? 0.75 : 1;
    const w = this.enhP('wind'); if (w !== null) m *= 1.2 + 0.25 * w;
    return m * (this.speedMult || 1);
  }
  outgoing() { let m = this.weaken > 0 ? 0.8 : 1; const f = this.enhP('fire'); if (f !== null) m *= 1.12 + 0.25 * f; return m; }
  incoming() {
    let m = (this.defDown > 0 ? 1.4 : 1) * (this.curse > 0 ? 1.1 : 1);
    m = Math.min(1.6, m);
    const e = this.enhP('earth'); if (e !== null) m *= 0.8 - 0.25 * e;
    return m;
  }
  costMult() { let m = this.costBonus || 1; if (this.enhP('arcane') !== null) m *= 0.75; if (this.enhP('lightning') !== null) m *= 0.9; return m; }
  resetStats() {
    this.hp = this.maxHp; this.mana = this.maxMana; this.stamina = 100; this.shield = 0; this.aura = null;
    this.frozen = 0; this.stun = 0; this.defDown = 0; this.mud = 0; this.weaken = 0; this.curse = 0; this.dots.length = 0;
    this.enh = {}; this.haste = 0; this.flying = 0; this.cloak = 0; this.hist = []; this.alive = true; this.vel.set(0, 0, 0);
  }
  updateStatus(dt, game) {
    if (!this.alive) return;
    this.mana = Math.min(this.maxMana, this.mana + dt * (this.chanting ? 4 : 9) * (this.manaRegen || 1));
    this.stamina = Math.min(100, this.stamina + dt * 22);
    if (this.aura) { this.aura.t -= dt; if (this.aura.t <= 0) this.aura = null; }
    if (this.frozen > 0) { this.frozen -= dt; if (this.frozen <= 0 && this.model) game.fx.explosion('ice', this.center(), 1.2, 0.2, null, { noDecal: true }); }
    for (const k of ['stun', 'defDown', 'mud', 'weaken', 'curse', 'haste', 'flying', 'cloak']) this[k] = Math.max(0, this[k] - dt);
    if (this.shieldTime > 0) { this.shieldTime -= dt; if (this.shieldTime <= 0) this.shield = 0; }
    // enhancements
    for (const [el, e] of Object.entries(this.enh)) {
      e.t -= dt;
      if (el === 'water') this.heal(dt * (2 + 4 * e.p));
      if (el === 'nature') { this.heal(dt * (1.5 + 3 * e.p)); this.dots = this.dots.filter((d) => d.el !== 'poison'); }
      if (el === 'light') this.mana = Math.min(this.maxMana, this.mana + dt * (8 + 12 * e.p));
      if (e.t <= 0) delete this.enh[el];
    }
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const d = this.dots[i]; d.t -= dt; d.acc += dt;
      if (d.acc >= 0.5) { d.acc -= 0.5; if (this.authoritative) applyHit(game, this, { dmg: d.dps * 0.5, el: null, src: d.src, point: this.center(), dot: true, dotEl: d.el }); }
      if (d.t <= 0) this.dots.splice(i, 1);
    }
    this.statusTick -= dt;
    const enhEls = Object.keys(this.enh);
    if (this.statusTick <= 0 && (this.aura || this.dots.length || enhEls.length || this.mud > 0)) {
      this.statusTick = 0.06;
      const el = this.dots.length ? this.dots[0].el : this.aura ? this.aura.el : this.mud > 0 ? 'earth' : enhEls[Math.floor(Math.random() * enhEls.length)];
      const c = this.center(); c.x += rand(-0.4, 0.4); c.y += rand(-0.7, 0.6); c.z += rand(-0.4, 0.4);
      if (!(this.isPlayer && game.firstPerson)) game.fx.element(el, c, { count: 1, speed: 0.6, size: 0.25, life: 0.6 });
    }
  }
}

function addDot(t, el, dps, dur, src) {
  const d = t.dots.find((x) => x.el === el && x.src === src);
  if (d) { d.t = Math.max(d.t, dur); d.dps = Math.max(d.dps, dps) * (el === 'poison' ? 1.15 : 1); }
  else t.dots.push({ dps, t: dur, acc: 0, el, src });
}

// Central damage + reaction resolution. Only authoritative targets actually lose HP.
export function applyHit(game, target, hit) {
  if (!target.alive) return null;
  const fx = game.fx;
  if (!target.authoritative) { if (!hit.dot) game.onVisualHit?.(target, hit); return null; }
  let mult = hit.src && !hit.dot ? hit.src.outgoing() : 1, reaction = null, trueDmg = false, finisher = null;
  const el = hit.el, dm = hit.dmgMult || 1, pos = hit.point || target.center();
  if (el && hit.noReact) {
    if (!target.aura) applyAura(target, el, hit);
  } else if (el) {
    if (target.frozen > 0 && (el === 'earth' || (hit.weight ?? 0) > 0.6 || hit.shatter)) {
      reaction = { name: 'Shatter', color: '#bff4ff' }; mult *= 2.2; target.frozen = 0;
      fx.explosion('ice', target.center(), 2.2, 0.8, null, { debris: true });
    } else if (target.aura && target.aura.el !== el) {
      const r = reactionFor(target.aura.el, el);
      if (r) {
        reaction = r; mult *= r.mult;
        if (r.name !== 'Resonance') target.aura = null;
        runEffects(game, target, hit, r.effects, dm, r.inc || el, r.aura);
        if (r.effects.trueDmg) trueDmg = true;
        reactionVisual(game, target, r);
      } else applyAura(target, el, hit);
    } else if (target.aura && target.aura.el === el) target.aura.t = Math.max(target.aura.t, 5 + (hit.mag || 0.5) * 4);
    else applyAura(target, el, hit);
    // combo finishers: the last three distinct spells from the same caster
    if (hit.src && hit.spellId && !hit.basic) {
      const H = target.hist;
      if (!H.length || H[H.length - 1].id !== hit.spellId) {
        H.push({ id: hit.spellId, els: [el, hit.el2].filter(Boolean), src: hit.src, t: performance.now() });
        while (H.length > 3) H.shift();
        if (H.length === 3 && H.every((h) => h.src === hit.src && performance.now() - h.t < 24000)) {
          const combo = COMBOS.find((c) => c.seq.every((e, i) => H[i].els.includes(e)));
          if (combo) {
            finisher = combo; mult *= 1 + combo.bonus;
            runEffects(game, target, hit, combo.effects, dm, el, null);
            game.onCombo?.(target, combo);
            fx.explosion(el, target.center(), 4, 1.2); fx.ring(target.center(), new THREE.Color(combo.color), 9, 0.7);
            target.hist = [];
          }
        }
      }
    }
    // chain multiplier: different spells landing in quick succession
    if (hit.src && hit.spellId && !hit.basic) {
      const C = target.chain, now = performance.now();
      if (C.last !== hit.spellId) {
        C.n = C.src === hit.src && now - C.t < 8000 ? Math.min(8, C.n + 1) : 1;
        C.src = hit.src; C.t = now; C.last = hit.spellId;
      }
      mult *= 1 + Math.max(0, C.n - 1) * 0.08;
    }
  }
  if (el && !hit.dot && hit.src?.affinity?.[el]) mult *= 1 + hit.src.affinity[el]; // battle royale element cores
  if (!hit.dot && hit.src?.allDmg) mult *= hit.src.allDmg;
  if (hit.src?.enhP?.('poison') != null && !hit.dot && hit.src !== target) addDot(target, 'poison', 6 + 10 * hit.src.enhP('poison'), 4, hit.src);
  if (!hit.dot || hit.dotEl) mult *= target.incoming();
  let dmg = Math.max(0, hit.dmg * mult);
  if (hit.src && hit.src === target) dmg *= 0.35;
  let absorbed = 0;
  if (target.shield > 0 && !trueDmg) {
    const eff = target.shieldEl && el && reactionFor(target.shieldEl, el) ? 1.6 : 1;
    absorbed = Math.min(target.shield, dmg * eff); target.shield -= absorbed; dmg -= absorbed / eff;
    if (target.shield <= 0.5) { target.shield = 0; fx.explosion(target.shieldEl || 'earth', target.center(), 1.8, 0.4, null, { noDecal: true }); }
  }
  target.hp -= dmg;
  if (dmg > 0.5 && !hit.dot) target.hitFlash = Math.min(1, 0.45 + dmg / 60); // model flashes white on a real hit
  if (hit.src && hit.src !== target) {
    if (target.curse > 0 || target.aura?.el === 'darkness') hit.src.heal(dmg * 0.15);
    const dk = hit.src.enhP?.('darkness'); if (dk != null) hit.src.heal(dmg * (0.05 + 0.08 * dk));
  }
  if (hit.knock && target.frozen <= 0) target.vel.add(hit.knock);
  if (hit.stun) target.stun = Math.max(target.stun, hit.stun);
  const res = { dmg: dmg + absorbed, absorbed, reaction: finisher ? { name: finisher.name, color: finisher.color, combo: true } : reaction, chain: target.chain.n };
  game.onDamage(target, res, pos, el || hit.dotEl, hit);
  if (target.hp <= 0) { target.hp = 0; game.onDeath(target, hit.src); }
  return res;
}

function applyAura(target, el, hit) {
  if (!ELEMENTS[el]?.aura) return;
  target.aura = { el, t: 5 + (hit.mag || 0.5) * 4 };
  if (el === 'poison') addDot(target, 'poison', 5 + 8 * (hit.mag || 0.5), 5, hit.src);
}

// Visual signature of each reaction (explosion element blends the two inputs)
function reactionVisual(game, target, r) {
  const fx = game.fx, c = target.center();
  const a = r.aura, b = r.inc;
  if (a && ELEMENTS[a]) fx.explosion(a, c, 1.6, 0.4, null, { noDecal: true });
  if (b && ELEMENTS[b]) fx.explosion(b, c, 2.0, 0.5, null, { noDecal: true });
  fx.ring(c, new THREE.Color(r.color), 5, 0.5);
  game.audio.reaction(r.name, c);
}

// Interpret reaction / combo effect data
function runEffects(game, target, hit, E, dm, inc, aura) {
  const fx = game.fx, c = target.center(), src = hit.src;
  if (E.freeze) target.frozen = Math.max(target.frozen, E.freeze + (hit.mag || 0.5) * 1.2);
  if (E.stun) target.stun = Math.max(target.stun, E.stun);
  if (E.mud) { target.mud = Math.max(target.mud, E.mud); for (let i = 0; i < 16; i++) fx.puff(target.pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0.2, rand(-1.5, 1.5))), { color: new THREE.Color(0x6a5030), size: 0.8, life: 2, alpha: 0.9, rise: 0.2 }); }
  if (E.weaken) target.weaken = Math.max(target.weaken, E.weaken);
  if (E.fracture) target.defDown = Math.max(target.defDown, E.fracture);
  if (E.curse) target.curse = Math.max(target.curse, E.curse);
  if (E.burn) addDot(target, 'fire', 30 * dm, E.burn, src);
  if (E.poison) addDot(target, 'poison', 22 * dm, E.poison, src);
  if (E.shock) addDot(target, 'lightning', 26 * dm, E.shock, src);
  if (E.purge) { target.aura = null; target.enh = {}; target.shield = 0; target.dots = target.dots.filter((d) => d.src === src); }
  if (E.knock) target.vel.y += E.knock;
  if (E.pull && src) { const d = src.pos.clone().sub(target.pos).setY(0); const L = d.length(); if (L > 2) target.vel.addScaledVector(d.normalize(), Math.min(L, 10) * E.pull * 1.4); }
  if (E.steam) for (let i = 0; i < 40; i++) fx.puff(c.clone().add(new THREE.Vector3(rand(-2, 2), rand(-1, 2), rand(-2, 2))), { color: new THREE.Color(0xf4f8ff), size: 1.2, life: rand(2, 3.5), alpha: 0.7, rise: 1 });
  if (E.blind && target.isPlayer) game.screenFlash?.('#fff2c0', 0.6);
  if (E.blast) {
    fx.explosion(inc || 'arcane', c, E.blast * 0.8, 0.9);
    splash(game, c, E.blast, 40 * dm, null, src, target, 10);
  }
  if (E.spread) { fx.ring(c, paletteFor(E.spread).color, 7, 0.6); splash(game, c, 6, 25 * dm, E.spread, src, target, 5); }
  if (E.bolts) for (let i = 0; i < E.bolts; i++) fx.bolt(c, c.clone().add(new THREE.Vector3(rand(-3, 3), rand(-1, 3), rand(-3, 3))), paletteFor(inc || 'lightning').color, { width: 0.05, dur: 0.4, branches: 0 });
  if (E.smite) {
    for (let i = 0; i < E.smite; i++) setTimeout(() => {
      if (!target.alive) return;
      const p = target.center(); const top = p.clone().add(new THREE.Vector3(rand(-2, 2), 26, rand(-2, 2)));
      fx.bolt(top, p, paletteFor('light').core, { width: 0.35, dur: 0.4, jag: 0.15, branches: 4 });
      fx.explosion('light', p, 2.5, 0.8);
      applyHit(game, target, { dmg: 35 * dm, el: null, src, point: p, dotEl: 'light' });
      game.audio.impact('lightning', 0.7, p);
    }, 180 * (i + 1));
  }
  if (E.bloom) game.spells.spawnSeeds(c, E.bloom + Math.round(dm), 26 * dm, src);
  if (src && src.alive) {
    if (E.heal) { src.heal(E.heal * dm); game.onHeal?.(src, E.heal * dm); }
    if (E.mana) src.mana = Math.min(src.maxMana, src.mana + E.mana);
    if (E.haste) src.haste = Math.max(src.haste, E.haste);
    if (E.shield) { src.addShield(E.shield * dm, 12, 'earth'); game.onShield?.(src); }
  }
}

function splash(game, c, radius, dmg, el, src, exclude, knock = 0) {
  for (const t of game.combatants) {
    if (!t.alive || t === exclude) continue;
    const d = t.distTo(c);
    if (d > radius) continue;
    const k = 1 - d / radius;
    const dir = t.center().sub(c).setY(0.5).normalize().multiplyScalar(knock * k);
    applyHit(game, t, { dmg: dmg * (0.5 + 0.5 * k), el: el && ELEMENTS[el] ? el : null, src, point: t.center(), knock: dir, noReact: true });
  }
}
