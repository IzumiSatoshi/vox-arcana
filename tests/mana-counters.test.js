import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Combatant, applyHit } from '../public/js/combat.js';
import { SpellSystem } from '../public/js/spells.js';
import '../public/js/spells-extra.js';
import { World } from '../public/js/world.js';
import { buildJevSpec, boltSpec } from '../public/js/spellbook.js';
import { baseManaCost, effectiveManaCost, spendSpellMana, manaRegenRate, funnelUpkeep } from '../public/js/mana.js';
import { SimClock, installEnvironment, makeFX, makeAudio } from '../scripts/balance/environment.js';
import { mulberry32 } from '../public/js/util.js';

function spec(shape, params = {}) {
  return buildJevSpec('counter test', { ok: true, params: { element: 'arcane', shape, power: 0.5, tier: 0.5, isSpell: 1, ...params } });
}
function arena(fn) {
  const clock = new SimClock(), restore = installEnvironment(clock, mulberry32(55));
  const world = Object.assign(Object.create(World.prototype), { heightAt: () => 0, obstacles: [], boxes: [] });
  const a = new Combatant({ id: 'a' }), b = new Combatant({ id: 'b' }); b.pos.z = -18;
  for (const [c, foe] of [[a, b], [b, a]]) c.getAim = () => {
    const origin = c.eye(new THREE.Vector3()), point = c.aimPoint?.clone() || foe.center();
    return { origin, point, dir: point.clone().sub(origin).normalize() };
  };
  const g = { world, combatants: [a, b], scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), fx: makeFX(THREE), audio: makeAudio(), onDamage() {}, onDeath(c) { c.alive = false; } };
  g.spells = new SpellSystem(g);
  const cast = (c, shape, params) => { const s = spec(shape, params); assert.ok(spendSpellMana(c, s)); return g.spells.cast(s, c); };
  const tick = sec => { for (let i = 0; i < Math.round(sec * 60); i++) { clock.advance(1000 / 60); g.spells.update(1 / 60); g.fx.update(1 / 60); } };
  try { fn({ g, a, b, cast, tick }); } finally { g.spells.clear(); restore(); }
}

test('medium costs distinguish cheap aim, defense, control and reliable strikes', () => {
  assert.equal(spec('orb').cost, 34); assert.equal(spec('chain').cost, 71);
  assert.equal(spec('barrier').cost, 27); assert.equal(spec('prison').cost, 60);
  assert.equal(spec('funnels').cost, 40); assert.equal(boltSpec('arcane').cost, 1);
  assert.ok(spec('chain', { count: 1 }).cost > spec('chain', { count: 0 }).cost);
  assert.ok(spec('prison', { duration: 1 }).cost > spec('prison', { duration: 0 }).cost);
  assert.ok(spec('chain', { power: 1, tier: 1, count: 1, size: 1, element2: 'fire' }).cost <= 120);
  assert.equal(baseManaCost({ ...spec('chain'), chantSeconds: 300, loudness: 1 }), spec('chain').cost);
});

test('discounts are charged once, failed payments do not weaken or spend, and bolts cost one', () => {
  const c = new Combatant({ id: 'c' }), s = spec('chain');
  c.enh.arcane = { p: 0.5, t: 10 };
  const cost = effectiveManaCost(c, s), copy = structuredClone(s);
  c.mana = cost - 1; assert.equal(spendSpellMana(c, s), false); assert.equal(c.mana, cost - 1);
  c.mana = cost; assert.ok(spendSpellMana(c, s)); assert.equal(c.mana, 0); assert.equal(c.manaSpent, cost);
  assert.deepEqual(s, copy);
  c.mana = 1; assert.ok(spendSpellMana(c, boltSpec('light'))); assert.equal(c.mana, 0);
});

test('regeneration slows during chants; light and relic stacking cannot exceed twice base', () => {
  const c = new Combatant({ id: 'c' });
  assert.equal(manaRegenRate(c), 6); c.chanting = true; assert.equal(manaRegenRate(c), 2);
  c.enh.light = { p: 0.5, t: 10 }; c.chanting = false; assert.ok(Math.abs(manaRegenRate(c) - 8.4) < 1e-9);
  c.manaRegen = 20; assert.equal(manaRegenRate(c), 12);
  c.chanting = true; assert.equal(manaRegenRate(c), 4);
});

test('chain gives a visible damage-free warning; terrain blocks the paid strikes', () => arena(({ g, a, b, cast, tick }) => {
  const chain = cast(a, 'chain'), paid = a.mana;
  assert.equal(chain.threats()[0].target, b);
  tick(1); assert.equal(b.hp, 600);
  g.world.addBox({ x: 0, y: 2, z: -9, hx: 6, hy: 4, hz: 0.5 });
  tick(2); assert.equal(b.hp, 600); assert.equal(a.mana, paid);
}));

test('a prepared cheap barrier blocks chain and leaves the defender more mana', () => arena(({ a, b, cast, tick }) => {
  const barrier = cast(b, 'barrier'); tick(0.5);
  const before = barrier.hp; cast(a, 'chain'); tick(3);
  assert.equal(b.hp, 600); assert.ok(barrier.hp < before); assert.ok(b.mana > a.mana);
}));

test('chain loses its locked target when aim turns away and never retargets', () => arena(({ a, b, cast, tick }) => {
  const chain = cast(a, 'chain'); a.aimPoint = new THREE.Vector3(20, 1, 0);
  tick(1.2); assert.equal(chain.lock, null);
  a.aimPoint = null; tick(2); assert.equal(b.hp, 600);
}));

test('incapacitating a chain caster cancels the committed attack without refund', () => arena(({ a, b, cast, tick }) => {
  cast(a, 'chain'); const paid = a.mana; a.stun = 1; tick(2);
  assert.equal(b.hp, 600); assert.equal(a.mana, paid);
}));

test('prison can be dodged during formation', () => arena(({ b, cast, a, tick }) => {
  const prison = cast(a, 'prison'); tick(0.3); b.pos.x = 8; tick(0.8);
  assert.equal(prison.trapped.has(b), false); assert.equal(b.hp, 600);
}));

test('destroying the prison core releases its victim and prevents all further damage', () => arena(({ g, a, b, cast, tick }) => {
  const prison = cast(a, 'prison'); tick(1.1); assert.ok(prison.trapped.has(b));
  applyHit(g, prison.core, { dmg: 100, src: b, el: 'fire' });
  const hp = b.hp; assert.ok(prison.broken); assert.equal(prison.trapped.size, 0);
  b.pos.x = 8; tick(7); assert.equal(b.pos.x, 8); assert.equal(b.hp, hp);
}));

test('blink genuinely escapes a closed prison without being clamped back', () => arena(({ a, b, cast, tick }) => {
  const prison = cast(a, 'prison'); tick(1.1);
  b.aimPoint = new THREE.Vector3(0, 1, -40); cast(b, 'blink');
  const z = b.pos.z; assert.ok(z < -25); tick(0.2);
  assert.equal(prison.trapped.has(b), false); assert.equal(b.pos.z, z);
}));

test('a longer cage buys durability at the expense of damage', () => arena(({ a, b, cast }) => {
  const short = cast(a, 'prison', { duration: 0 }), long = cast(b, 'prison', { duration: 1 });
  assert.ok(long.core.hp > short.core.hp); assert.ok(long.life > short.life);
}));

test('funnels pay upkeep, stop attacking when mana runs out, and have shootable bodies', () => arena(({ g, a, b, cast, tick }) => {
  const swarm = cast(a, 'funnels'), before = a.mana;
  tick(0.5); assert.ok(Math.abs(before - a.mana - funnelUpkeep(swarm.spec) * 0.5) < 1e-8);
  const drone = swarm.drones[0]; applyHit(g, drone.body, { dmg: 99, src: b }); assert.ok(drone.dead);
  a.mana = 0; const hp = b.hp; tick(2); assert.equal(b.hp, hp); assert.equal(g.spells.structures.length, 0);
}));

test('funnels cannot fire through terrain cover', () => arena(({ g, a, b, cast, tick }) => {
  g.world.addBox({ x: 0, y: 4, z: -9, hx: 30, hy: 8, hz: 1 });
  cast(a, 'funnels'); tick(4); assert.equal(b.hp, 600);
}));

test('recasting funnels replaces the previous swarm and cleanup removes targets', () => arena(({ g, a, cast, tick }) => {
  const first = cast(a, 'funnels'); tick(0.3); const second = cast(a, 'funnels'); tick(1);
  assert.ok(!g.spells.active.includes(first)); assert.ok(g.spells.active.includes(second));
  assert.equal(g.spells.structures.filter(s => s.alive).length, second.n);
  g.spells.clear(); assert.equal(g.spells.structures.length, 0);
}));
