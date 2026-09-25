import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const bot = readFileSync(new URL('../public/js/bot.js', import.meta.url), 'utf8');
function setup({ voice = true, supported = true, throws = false } = {}) {
  const utterances = [];
  const speechSynthesis = {
    getVoices: () => [], cancel() {},
    speak(u) { if (throws) throw new Error('Speech unavailable'); utterances.push(u); },
  };
  const context = vm.createContext({
    window: { speechSynthesis: supported ? speechSynthesis : undefined }, speechSynthesis,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    getLang: () => 'en', clamp: x => Math.max(0, Math.min(1, x)), rand: a => a,
    pick: xs => xs[0], ELEMENT_KEYS: ['fire'], generateIncantation: () => 'Summon fire',
    localParse: () => ({}), buildSpec: () => ({ cost: 10, mag: 0.5 }),
  });
  const Game = vm.runInContext(main.slice(main.indexOf('class Game {'), main.indexOf('window.game = new Game();')) + '\nGame;', context);
  const BotBrain = vm.runInContext(bot.replace(/^import .*;\r?\n/gm, '').replace('export class', 'class') + '\nBotBrain;', context);
  const g = Object.create(Game.prototype);
  g.mode = 'duel'; g.settings = { botVoice: voice, vol: 0.8, botJev: false };
  g.onCast = () => {};
  const casts = []; g.spells = { cast: spec => casts.push(spec) };
  const c = { hp: 100, maxHp: 100, mana: 100, enh: {}, model: { setElement() {} }, canAct: () => true };
  const brain = Object.create(BotBrain.prototype);
  Object.assign(brain, { g, c, d: { grand: 0.5, cd: [3, 5] }, rng: () => 0 });
  const start = () => brain.startChant({}, 1);
  start();
  return { brain, c, casts, utterances, start };
}

test('a slow spoken chant blocks casting past the timer and casts once after voice end', () => {
  const { brain, c, casts, utterances } = setup();
  brain.updateChant(30, {});
  assert.equal(casts.length, 0); assert.equal(c.chanting, true);
  utterances[0].onend();
  assert.equal(casts.length, 0);
  brain.updateChant(0.016, {});
  assert.equal(casts.length, 1); assert.equal(brain.chant, null);
  utterances[0].onend(); assert.equal(casts.length, 1);
});

test('a short voice still respects the minimum chant duration', () => {
  const { brain, casts, utterances } = setup();
  utterances[0].onend(); brain.updateChant(0.01, {});
  assert.equal(casts.length, 0);
  brain.updateChant(10, {}); assert.equal(casts.length, 1);
});

for (const options of [{ voice: false }, { supported: false }, { throws: true }]) {
  test(`silent fallback remains playable: ${JSON.stringify(options)}`, () => {
    const { brain, casts } = setup(options);
    brain.updateChant(10, {}); assert.equal(casts.length, 1);
  });
}

test('speech errors release the chant gate', () => {
  const { brain, casts, utterances } = setup();
  utterances[0].onerror({ error: 'synthesis-failed' });
  brain.updateChant(10, {}); assert.equal(casts.length, 1);
});

test('late speech callbacks from an interrupted chant cannot release its replacement', () => {
  const { brain, casts, utterances, start } = setup();
  brain.cancelChant(); start();
  utterances[0].onend(); utterances[0].onerror();
  brain.updateChant(30, {}); assert.equal(casts.length, 0);
  utterances[1].onend(); brain.updateChant(0.016, {});
  assert.equal(casts.length, 1);
});
