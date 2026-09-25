import test from 'node:test';
import assert from 'node:assert/strict';
import { equip, grant, stormDps, PHASES, STORM_SECONDS, COMMON_RELICS, RARE_RELICS, POTION_CAP } from '../public/js/royale-rules.js';

const mage = () => { const c = {}; equip(c); return c; };

test('a fresh loadout carries one healing draught and neutral multipliers', () => {
  const c = mage();
  assert.deepEqual(c.inv, { hp: 1, mana: 0, shield: 0 });
  assert.equal(c.maxHp, 600); assert.equal(c.maxMana, 120);
  for (const k of ['manaRegen', 'speedMult', 'costBonus', 'allDmg']) assert.equal(c[k], 1, k);
});

test('element cores stack +20% per core and cap at +80%', () => {
  const c = mage();
  for (let i = 0; i < 6; i++) grant(c, { type: 'core', el: 'fire' });
  assert.equal(c.affinity.fire, 0.8);
  grant(c, { type: 'core', el: 'ice' });
  assert.ok(Math.abs(c.affinity.ice - 0.2) < 1e-9);
});

test('relics change the stats they promise', () => {
  const c = mage();
  grant(c, { type: 'relic', id: 'heart' }); assert.equal(c.maxHp, 750); assert.equal(c.hp, 750);
  grant(c, { type: 'relic', id: 'vessel' }); assert.equal(c.maxMana, 150);
  grant(c, { type: 'relic', id: 'font' }); assert.ok(Math.abs(c.manaRegen - 1.4) < 1e-9);
  grant(c, { type: 'relic', id: 'boots' }); assert.ok(Math.abs(c.speedMult - 1.12) < 1e-9);
  grant(c, { type: 'relic', id: 'focus' }); assert.ok(Math.abs(c.costBonus - 0.88) < 1e-9);
  grant(c, { type: 'relic', id: 'crown' }); assert.ok(Math.abs(c.allDmg - 1.15) < 1e-9);
  grant(c, { type: 'relic', id: 'phoenix' }); assert.equal(c.relics.phoenix, 1);
  assert.deepEqual(RARE_RELICS.sort(), ['crown', 'phoenix']);
  assert.ok(!COMMON_RELICS.some((k) => RARE_RELICS.includes(k)));
});

test('potions stack into their slot up to the cap', () => {
  const c = mage();
  for (let i = 0; i < 9; i++) grant(c, { type: 'potion', id: 'shield' });
  assert.equal(c.inv.shield, POTION_CAP);
});

test('the storm always closes: radii shrink to zero, damage climbs, and the final storm keeps growing', () => {
  for (let i = 1; i < PHASES.length; i++) { assert.ok(PHASES[i].r < PHASES[i - 1].r); assert.ok(PHASES[i].dps > PHASES[i - 1].dps); }
  assert.equal(PHASES.at(-1).r, 0);
  assert.ok(stormDps(PHASES.length, 20) > stormDps(PHASES.length, 0));
  assert.ok(STORM_SECONDS > 180 && STORM_SECONDS < 330, `a match lasts ${STORM_SECONDS}s of storm`);
});
