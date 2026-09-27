import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatch } from '../scripts/balance/run-match.js';
import { SimClock, installEnvironment, makeFX, makeAudio } from '../scripts/balance/environment.js';
import { Combatant, applyHit, interruptBotOnDamage } from '../public/js/combat.js';
import { summarize } from '../scripts/balance/report.js';
import { SHAPE_KEYS } from '../scripts/balance/profiles.js';
import * as THREE from 'three';

test('seeded matches reproduce exact events even after another match', async () => {
  const options = { seed: 9123, seconds: 18, trace: true };
  const a = await runMatch('form:chain', 'form:beam', options);
  await runMatch('native:hard', 'form:decoy', { seconds: 10 });
  const b = await runMatch('form:chain', 'form:beam', options);
  assert.deepEqual(a, b);
  assert.ok(a.events.some(e => e.type === 'hit'));
  assert.ok(a.stats.every(s => s.manaSpent > 0));
  const changed = await runMatch('form:chain', 'form:beam', { ...options, seed: 9124 });
  assert.notDeepEqual(a.events, changed.events);
});

test('every registered form casts through the real runtime without swallowed errors', async () => {
  for (const shape of SHAPE_KEYS) {
    const m = await runMatch(`form:${shape}`, 'bolts', { seconds: 12, seed: 423, arena: 'flat' });
    assert.ok(m.casts[`${shape}:arcane`] > 0, `${shape} must actually cast`);
    assert.ok(m.stats.every(s => Number.isFinite(s.hp) && s.hp >= 0 && s.hp <= 600));
  }
});

test('simulation clocks execute delayed hits in order and allow cancellation', () => {
  const clock = new SimClock(), seen = [];
  clock.schedule(() => seen.push('later'), 400);
  clock.schedule(() => { seen.push('early'); clock.schedule(() => seen.push('nested'), 50); }, 100);
  const id = clock.schedule(() => assert.fail('cancelled callback'), 100);
  clock.timers.delete(id);
  clock.advance(100); assert.deepEqual(seen, ['early']);
  clock.advance(50); assert.deepEqual(seen, ['early', 'nested']);
  clock.advance(250); assert.deepEqual(seen, ['early', 'nested', 'later']);
});

test('FX callbacks run until completion (gameplay uses them for secondary damage)', () => {
  const fx = makeFX(THREE); let count = 0;
  fx.add(() => ++count < 3);
  for (let i = 0; i < 8; i++) fx.update(1 / 60);
  assert.equal(count, 3);
});

test('real reaction smites wait for simulation time; chains expire in simulated time', () => {
  const clock = new SimClock(), restore = installEnvironment(clock, () => 0.5);
  try {
    const src = new Combatant({ id: 'src' }), target = new Combatant({ id: 'target' });
    const g = { fx: makeFX(THREE), audio: makeAudio(), combatants: [src, target], onDamage() {}, onDeath(c) { c.alive = false; } };
    target.aura = { el: 'light', t: 8 };
    applyHit(g, target, { dmg: 1, el: 'lightning', src, spellId: 1, dmgMult: 1 });
    const initial = target.hp;
    clock.advance(179); assert.equal(target.hp, initial);
    clock.advance(1); assert.equal(target.hp, initial - 35);
    clock.advance(180); assert.equal(target.hp, initial - 70);
    applyHit(g, target, { dmg: 1, el: 'arcane', src, spellId: 2 });
    assert.equal(target.chain.n, 2);
    clock.advance(8001);
    applyHit(g, target, { dmg: 1, el: 'arcane', src, spellId: 3 });
    assert.equal(target.chain.n, 1);
  } finally { restore(); }
});

test('the shared bot damage rule interrupts heavy hits at the original threshold', () => {
  let cancelled = 0;
  const target = { brain: { chant: {}, cancelChant() { cancelled++; } } };
  const restore = installEnvironment(new SimClock(), () => 0.39);
  try {
    interruptBotOnDamage(target, { dmg: 70 }); assert.equal(cancelled, 0);
    interruptBotOnDamage(target, { dmg: 71 }); assert.equal(cancelled, 1);
    target.brain.chant = null;
    interruptBotOnDamage(target, { dmg: 100 }); assert.equal(cancelled, 1);
  } finally { restore(); }
});

test('headless globals restore after failures and network calls fail closed', () => {
  const before = { random: Math.random, now: Date.now, performance, setTimeout, fetch };
  const restore = installEnvironment(new SimClock(), () => 0.25);
  try { assert.equal(Math.random(), 0.25); assert.throws(() => fetch('/api/spell'), /forbidden/); }
  finally { restore(); }
  assert.deepEqual({ random: Math.random, now: Date.now, performance, setTimeout, fetch }, before);
});

test('timeouts remain draws; swapped games are grouped into seed pairs', async () => {
  const a = await runMatch('form:ward', 'form:barrier', { seconds: 0.1 });
  const b = await runMatch('form:barrier', 'form:ward', { seconds: 0.1 });
  const summary = summarize([a, b]);
  assert.equal(a.winner, null); assert.equal(a.outcome, 'timeout');
  assert.equal(summary.timeouts, 2);
  assert.equal(summary.matchups[0].seedPairs, 1);
  assert.equal(summary.matchups[0].firstProfileScore, 50);
  assert.equal(summary.matchups[0].pairedScoreStandardError, null);
});

test('invalid inputs fail before simulation', async () => {
  await assert.rejects(runMatch('unknown', 'bolts'), /Unknown profile/);
  await assert.rejects(runMatch('bolts', 'native:normal', { hz: 0 }), /hz/);
});
