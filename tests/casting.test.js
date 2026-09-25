import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Voice } from '../public/js/voice.js';

// Exercise the real Game methods without constructing its WebGL scene.
const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const classSource = main.slice(main.indexOf('class Game {'), main.indexOf('window.game = new Game();'));
class Recognition {
  start() { this.onstart?.(); }
  stop() { this.stopped = true; }
  abort() { this.onend?.(); }
  result(text, final = false) { this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] }); }
}
globalThis.window = { SpeechRecognition: Recognition };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({}) } } });
async function game() {
  let now = performance.now();
  const Game = vm.runInNewContext(classSource + '\nGame;', {
    performance: { now: () => now }, audio: { chantStop() {} }, t: key => key,
    localParse: text => ({ isSpell: /fire|ice/.test(text) ? 1 : 0 }),
  });
  const g = Object.create(Game.prototype); g.voice = new Voice(); await g.voice.init();
  g.settings = { useJev: false }; g.player = { chanting: true }; g.chanting = true; g.cast = [];
  g.hud = { chant(text) { g.message = text; }, preview() {} };
  g.bestJev = () => null; g.castIncantation = text => g.cast.push(text);
  g.voice.beginChant();
  return { g, rec: g.voice.rec, advance: ms => { now += ms; } };
}
test('late incomplete words do not prematurely end an actual Game grace window', async () => {
  const { g, rec } = await game(); g.endChant();
  rec.result('Sum'); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, []); assert.ok(g.grace);
  rec.result('Summon ice spear'); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, ['Summon ice spear']); assert.equal(g.grace, null); g.voice.dispose();
});
test('incomplete words already visible at release remain eligible for correction', async () => {
  const { g, rec } = await game(); rec.result('Sum'); g.endChant();
  assert.deepEqual(g.cast, []); assert.ok(g.grace); assert.equal(rec.stopped, true);
  rec.result('Summon fireball', true); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, ['Summon fireball']); g.voice.dispose();
});
test('known spell still dispatches on release with no added wait', async () => {
  const { g, rec } = await game(); rec.result('fireball'); g.endChant();
  assert.deepEqual(g.cast, ['fireball']); assert.equal(g.grace, undefined); g.voice.dispose();
});
test('a chant held past the former circle fill still accepts words and casts on release', async () => {
  const { g, rec, advance } = await game();
  advance(30000);
  assert.equal(g.chanting, true);
  rec.result('summon fireball', true);
  assert.equal(g.voice.chantText(), 'summon fireball');
  assert.deepEqual(g.cast, []);
  g.endChant();
  assert.deepEqual(g.cast, ['summon fireball']);
  g.voice.dispose();
});
test('silence eventually fizzles and cannot cast from later callbacks', async () => {
  const { g, rec, advance } = await game(); g.endChant(); advance(1801); g.resolveVoiceGrace();
  assert.equal(g.message, 'chant.silence'); assert.equal(g.grace, null);
  rec.result('fireball', true); g.resolveVoiceGrace(); assert.deepEqual(g.cast, []); g.voice.dispose();
});
test('old saved defaults migrate once while later explicit opt-ins persist', () => {
  let stored = JSON.stringify({ localVoice: true, warmVoice: true, lang: 'ja-JP' });
  const code = main.slice(main.indexOf('const DEFAULTS ='), main.indexOf('const REACTIONS ='));
  const context = vm.createContext({ navigator: { language: 'ja-JP' }, localStorage: { getItem: () => stored, setItem: (key, value) => { stored = value; } } });
  const settings = vm.runInContext(code + '\nloadSettings();', context);
  assert.equal(settings.instantCast, false); assert.equal(settings.music, 0.175); assert.equal(settings.localVoice, false); assert.equal(settings.warmVoice, false); assert.equal(settings.lang, 'ja-JP');
  stored = JSON.stringify({ ...settings, localVoice: true });
  assert.equal(vm.runInContext('loadSettings()', context).localVoice, true);
});
