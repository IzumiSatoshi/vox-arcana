import test from 'node:test';
import assert from 'node:assert/strict';
import { equip, grant, replaces, autoTake, isUpgrade, carried, rollItem, rollTier, runeCooldown, stormDps, PHASES, STORM_SECONDS, TIERS, GEAR, ODDS, RUNES, POTION_CAP } from '../public/js/royale-rules.js';
import { mulberry32 } from '../public/js/util.js';

const mage = (el = 'fire') => { const c = {}; equip(c, el); return c; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a fresh loadout: one Common grimoire, one healing draught, neutral stats', () => {
  const c = mage('ice');
  assert.deepEqual(c.inv, { hp: 1, mana: 0, shield: 0 });
  assert.equal(c.gear.focus.length, 1); assert.equal(c.gear.focus[0].tier, 0);
  assert.ok(near(c.affinity.ice, GEAR.focus.stat[0]));
  assert.equal(c.maxHp, 600); assert.equal(c.maxMana, 120); assert.equal(c.maxArmor, 0); assert.equal(c.potionCap, POTION_CAP);
  for (const k of ['manaRegen', 'speedMult', 'costBonus', 'allDmg']) assert.equal(c[k], 1, k);
});

test('five tiers, and every stat grows with the tier', () => {
  assert.equal(TIERS.length, 5);
  for (const [slot, g] of Object.entries(GEAR)) for (let i = 1; i < 5; i++) {
    if (slot === 'rune') assert.ok(g.stat[i] < g.stat[i - 1], 'rune cooldowns shrink'); else assert.ok(g.stat[i] > g.stat[i - 1], slot);
  }
});

test('grimoires: two slots; the same element upgrades in place, a new element fills or replaces the weakest', () => {
  const c = mage('fire');
  assert.equal(replaces(c, { type: 'focus', tier: 1, el: 'ice' }), null);
  assert.ok(autoTake(c, { type: 'focus', tier: 1, el: 'ice' }));
  grant(c, { type: 'focus', tier: 1, el: 'ice' });
  assert.deepEqual(c.gear.focus.map((f) => f.el).sort(), ['fire', 'ice']);
  // same element, better tier: walked over and taken, the old one drops
  const up = { type: 'focus', tier: 3, el: 'fire' };
  assert.ok(autoTake(c, up));
  const out = grant(c, up);
  assert.equal(out.el, 'fire'); assert.equal(out.tier, 0);
  assert.ok(near(c.affinity.fire, GEAR.focus.stat[3]));
  // same element, worse: not wanted at all
  assert.equal(replaces(c, { type: 'focus', tier: 0, el: 'fire' }), false);
  // a third element is a trade-off: it replaces the weakest book but only on the interact key
  const third = { type: 'focus', tier: 2, el: 'lightning' };
  assert.equal(replaces(c, third).el, 'ice');
  assert.ok(!autoTake(c, third)); assert.ok(isUpgrade(c, third));
  grant(c, third);
  assert.ok(!('ice' in c.affinity));
});

test('armor, amulet, boots and belt change the stats they promise; worse pieces are ignored', () => {
  const c = mage();
  grant(c, { type: 'mantle', tier: 2 }); assert.equal(c.maxArmor, GEAR.mantle.stat[2]); assert.equal(c.armor, c.maxArmor, 'new armor arrives charged');
  assert.equal(autoTake(c, { type: 'mantle', tier: 1 }), false);
  grant(c, { type: 'amulet', tier: 1 }); assert.equal(c.maxMana, 120 + GEAR.amulet.stat[1]); assert.ok(near(c.manaRegen, 1 + GEAR.amulet.regen[1]));
  grant(c, { type: 'boots', tier: 4 }); assert.ok(near(c.speedMult, 1 + GEAR.boots.stat[4])); assert.equal(c.stormRes, 0.5, 'legendary boots walk the storm');
  grant(c, { type: 'belt', tier: 3 }); assert.equal(c.potionCap, GEAR.belt.stat[3]);
  for (let i = 0; i < 12; i++) grant(c, { type: 'potion', id: 'shield' });
  assert.equal(c.inv.shield, GEAR.belt.stat[3]);
  assert.equal(replaces(c, { type: 'potion', id: 'shield' }), false, 'a full slot leaves the potion for someone else');
});

test('legendary perks: echo on the amulet, phoenix on the mantle; runes cool down faster with tier', () => {
  const c = mage();
  grant(c, { type: 'amulet', tier: 4 }); assert.equal(c.echo, 0.25);
  grant(c, { type: 'mantle', tier: 4 }); assert.equal(c.relics.phoenix, 1);
  grant(c, { type: 'rune', tier: 0, id: 'blink' }); const slow = runeCooldown(c);
  assert.equal(slow, RUNES.blink.cd);
  assert.ok(autoTake(c, { type: 'rune', tier: 3, id: 'blink' }), 'the same rune, better: auto');
  assert.ok(!autoTake(c, { type: 'rune', tier: 3, id: 'ward' }), 'another rune: your call');
  grant(c, { type: 'rune', tier: 3, id: 'blink' }); assert.ok(runeCooldown(c) < slow);
});

test('the fallen drop everything they carried', () => {
  const c = mage('water');
  grant(c, { type: 'boots', tier: 1 }); grant(c, { type: 'potion', id: 'mana' });
  const pile = carried(c);
  assert.equal(pile.filter((k) => k.type === 'focus').length, 1);
  assert.equal(pile.filter((k) => k.type === 'boots').length, 1);
  assert.equal(pile.filter((k) => k.type === 'potion').length, 2);
});

test('loot odds: every source sums to 100, better sources roll better, vaults and caches never hold potions', () => {
  for (const [k, w] of Object.entries(ODDS)) assert.equal(w.reduce((a, b) => a + b, 0), 100, k);
  const avg = (src) => { const r = mulberry32(7); let n = 0; for (let i = 0; i < 4000; i++) n += rollTier(src, r()); return n / 4000; };
  assert.ok(avg('floor') < avg('chest') && avg('chest') < avg('iron') && avg('iron') < avg('vault') && avg('vault') < avg('cache'));
  const r = mulberry32(3);
  for (let i = 0; i < 500; i++) { const it = rollItem('vault', ['fire', 'ice'], r); assert.notEqual(it.type, 'potion'); assert.ok(it.tier >= 2); if (it.type === 'focus') assert.ok(['fire', 'ice'].includes(it.el)); }
});

test('the storm always closes: radii shrink to zero, damage climbs, and the final storm keeps growing', () => {
  for (let i = 1; i < PHASES.length; i++) { assert.ok(PHASES[i].r < PHASES[i - 1].r); assert.ok(PHASES[i].dps > PHASES[i - 1].dps); }
  assert.equal(PHASES.at(-1).r, 0);
  assert.ok(stormDps(PHASES.length, 20) > stormDps(PHASES.length, 0));
  assert.ok(STORM_SECONDS > 240 && STORM_SECONDS < 420, `a match lasts ${STORM_SECONDS}s of storm`);
});
