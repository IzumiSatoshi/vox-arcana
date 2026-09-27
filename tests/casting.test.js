import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Voice } from '../public/js/voice.js';
import { uiLanguage, recognitionLanguage, defaultRecognitionLanguage } from '../public/js/languages.js';

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
  const handlers = new Map(), canvas = { addEventListener: (name, fn) => handlers.set(name, fn) };
  const document = { pointerLockElement: canvas, addEventListener() {} };
  const Game = vm.runInNewContext(classSource + '\nGame;', {
    performance: { now: () => now }, audio: { chantStop() {} }, t: key => key,
    localParse: text => ({ isSpell: /fire|ice/.test(text) ? 1 : 0 }),
    document, addEventListener() {}, $: id => id === 'c' ? canvas : { addEventListener() {} },
  });
  const g = Object.create(Game.prototype); g.voice = new Voice(); await g.voice.init();
  g.settings = { useJev: false }; g.player = { chanting: true }; g.chanting = true; g.cast = [];
  g.hud = { chant(text) { g.message = text; }, preview() {} };
  g.bestJev = () => null; g.castIncantation = text => g.cast.push(text);
  g.voice.beginChant();
  g.mouse = { lmb: false }; g.bindInput();
  return { g, rec: g.voice.rec, advance: ms => { now += ms; }, click: button => handlers.get('mousedown')({ button, preventDefault() {} }) };
}
test('late incomplete words do not prematurely end an actual Game grace window', async () => {
  const { g, rec } = await game(); g.endChant();
  rec.result('Sum'); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, []); assert.ok(g.grace);
  rec.result('Summon ice spear'); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, []); rec.onend(); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, ['Summon ice spear']); assert.equal(g.grace, null); g.voice.dispose();
});
test('incomplete words already visible at release remain eligible for correction', async () => {
  const { g, rec } = await game(); rec.result('Sum'); g.endChant();
  assert.deepEqual(g.cast, []); assert.ok(g.grace); assert.equal(rec.stopped, true);
  rec.result('Summon fireball', true); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, []); rec.onend(); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, ['Summon fireball']); g.voice.dispose();
});
test('an exact valid Jev preview still dispatches on release with no added wait', async () => {
  const { g, rec, advance } = await game(); rec.result('fireball');
  g.settings.useJev=true;g.spec={changedAt:0};g.bestJev=()=>({ok:true,params:{isSpell:1}});advance(1000);g.endChant();
  assert.deepEqual(g.cast, ['fireball']); assert.equal(g.grace, undefined); g.voice.dispose();
});
test('a long chant without a preview waits for recognition completion after release', async () => {
  const { g, rec, advance } = await game();
  advance(30000);
  assert.equal(g.chanting, true);
  rec.result('summon fireball', true);
  assert.equal(g.voice.chantText(), 'summon fireball');
  assert.deepEqual(g.cast, []);
  g.endChant();
  assert.deepEqual(g.cast, []); rec.onend();g.resolveVoiceGrace();
  assert.deepEqual(g.cast, ['summon fireball']);
  g.voice.dispose();
});
test('Jev waits for the flushed final word and casts the exact transcript', async () => {
  const { g, rec } = await game();
  g.settings.useJev = true;
  const sent = [];
  g.speculate = text => sent.push(text);
  g.voice.onText = () => { if (g.grace) { g.speculate(g.voice.textOf(g.grace.win)); g.resolveVoiceGrace(); } };
  rec.result('この大地に眠るし精霊たちよ 今そのなまなこを開け', true);
  g.endChant();
  assert.deepEqual(g.cast, []);
  assert.equal(rec.stopped, true);
  rec.result('この大地に眠るし精霊たちよ 今そのなまなこを開け ファイアートルネード', true);
  g.resolveVoiceGrace();
  assert.deepEqual(g.cast, []);
  rec.onend(); g.resolveVoiceGrace();
  assert.deepEqual(g.cast, ['この大地に眠るし精霊たちよ 今そのなまなこを開け ファイアートルネード']);
  assert.ok(sent.includes('この大地に眠るし精霊たちよ 今そのなまなこを開け ファイアートルネード'));
  g.voice.dispose();
});
test('silence eventually fizzles and cannot cast from later callbacks', async () => {
  const { g, rec } = await game(); g.endChant(); rec.onend();g.resolveVoiceGrace();
  assert.equal(g.message, 'chant.silence'); assert.equal(g.grace, null);
  rec.result('fireball', true); g.resolveVoiceGrace(); assert.deepEqual(g.cast, []); g.voice.dispose();
});

test('recognition remains pending at 4999 ms and cancels at exactly five seconds', async () => {
  const {g,rec,advance}=await game();rec.result('partial');g.endChant();
  advance(4999);g.resolveVoiceGrace();assert.ok(g.grace);assert.deepEqual(g.cast,[]);
  advance(1);g.resolveVoiceGrace();assert.equal(g.grace,null);assert.equal(g.message,'chant.recognitiontimeout');
  rec.result('fireball',true);rec.onend();g.resolveVoiceGrace();assert.deepEqual(g.cast,[]);g.voice.dispose();
});

test('either mouse button consumes the cancellation click and ignores late recognition', async () => {
  for (const mode of ['practice','online']) for (const button of [0,2]) {
    const {g,rec,advance,click}=await game();g.mode=mode;
    g.beginChant=()=>{throw new Error('Cancellation click must not begin another chant');};
    g.endChant();advance(2000);click(button);
    assert.equal(g.grace,null);assert.equal(g.mouse.lmb,false);assert.equal(g.chanting,false);
    assert.equal(g.message,'chant.cancelled');
    rec.result('fireball',true);rec.onend();g.resolveVoiceGrace();assert.deepEqual(g.cast,[]);
    g.voice.dispose();
  }
});

test('a rejected fragment is not a valid preview and must wait for complete words', async () => {
  const {g,rec,advance}=await game();g.settings.useJev=true;g.spec={changedAt:0};
  g.bestJev=()=>({ok:true,params:{isSpell:0}});g.speculate=()=>{};
  rec.result('fi');advance(1000);g.endChant();assert.deepEqual(g.cast,[]);
  rec.result('fire tornado',true);rec.onend();g.resolveVoiceGrace();
  assert.deepEqual(g.cast,['fire tornado']);g.voice.dispose();
});
test('old saved defaults migrate once while later explicit opt-ins persist', () => {
  let stored = JSON.stringify({ localVoice: true, warmVoice: false, handsFree: true, jevPauseMs: 1200, botJev: true, lang: 'ja-JP' });
  const code = main.slice(main.indexOf('const DEFAULTS ='), main.indexOf('const REACTIONS ='));
  const context = vm.createContext({ navigator: { language: 'ja-JP' }, uiLanguage, recognitionLanguage, defaultRecognitionLanguage, localStorage: { getItem: () => stored, setItem: (key, value) => { stored = value; } } });
  const settings = vm.runInContext(code + '\nloadSettings();', context);
  assert.equal(settings.instantCast, false); assert.equal(settings.music, 0.175); assert.equal(settings.localVoice, false); assert.equal(settings.warmVoice, true); assert.equal(settings.lang, 'ja-JP');
  assert.equal(settings.botJev, undefined);
  assert.equal(settings.handsFree, false); assert.equal(settings.jevPauseMs, 300);
  stored = JSON.stringify({ ...settings, localVoice: true, botJev: true, warmVoice: false, handsFree: true, jevPauseMs: 0 });
  assert.equal(vm.runInContext('loadSettings()', context).localVoice, true);
  const reloaded = vm.runInContext('loadSettings()', context);
  assert.equal(reloaded.botJev, undefined); assert.equal(reloaded.warmVoice, true);
  assert.equal(reloaded.handsFree, false); assert.equal(reloaded.jevPauseMs, 300);
});
