import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const online = readFileSync(new URL('../public/js/online.js', import.meta.url), 'utf8');

test('solo and PvP normal attacks use identical half-rate cooldowns', () => {
  const context = vm.createContext({ boltSpec: () => ({ basic: true }), spendSpellMana: () => true, audio: { bolt() {} } });
  const Game = vm.runInContext(main.slice(main.indexOf('class Game {'), main.indexOf('window.game = new Game();')) + '\nGame;', context);
  for (const mode of ['practice', 'online']) for (const lightning of [false, true]) {
    const g = Object.create(Game.prototype); let shots = 0;
    Object.assign(g, { mode, player: { canAct: () => true, enhP: () => lightning ? 0.5 : null },
      boltCd: 0, spells: { cast: () => shots++ }, viewModel: { kick: 1 },
      online: { canPlay: () => true, send: () => shots++ } });
    g.fireBolt(); assert.equal(shots, 1); assert.equal(g.boltCd, lightning ? 0.36 : 0.56);
    g.fireBolt(); assert.equal(shots, 1);
    g.boltCd = 0; g.fireBolt(); assert.equal(shots, 2);
  }
});

test('PvP basic attacks flick the wand without replacing chant text or showing a spell card', () => {
  let sounds = 0, cards = 0, chants = 0;
  const context = vm.createContext({ structuredClone, audio: { bolt: () => sounds++ } });
  const Online = vm.runInContext(online.replace(/^import .*;\r?\n/gm, '').replace('export class', 'class') + '\nOnlineDuel;', context);
  const duel = Object.create(Online.prototype);
  const proxy = { id: 'self', vel: { fromArray() {} }, pos: { fromArray() {} } };
  duel.active = true; duel.id = 'self'; duel.proxies = [proxy];
  duel.g = { combatants: [], spells: { cast() {} }, viewModel: { kick: 1, setElement() {} },
    hud: { setEl() {}, chant: () => chants++, spellCard: () => cards++ } };
  const message = { type: 'cast', caster: 'self', player: { pos: [], vel: [] }, spec: { basic: true, text: 'mana bolt', element: 'arcane' } };
  duel.receive(message);
  assert.equal(duel.g.viewModel.kick, 0); assert.equal(duel.g.viewModel.flick, 1); assert.equal(sounds, 1); assert.equal(chants, 0); assert.equal(cards, 0);
  duel.receive({ ...message, spec: { element: 'fire', text: 'Fire orb' } });
  assert.equal(duel.g.viewModel.kick, 1); assert.equal(chants, 1); assert.equal(cards, 1);
});
