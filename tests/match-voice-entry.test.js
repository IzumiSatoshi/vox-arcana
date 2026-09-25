import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const startMode = main.slice(main.indexOf('  startMode(mode) {'), main.indexOf('  endToMenu()'));
const enableVoice = main.slice(main.indexOf('  enableVoice() {'), main.indexOf('  beginChant()'));

test('entering either match mode requests voice access', () => {
  const Game = vm.runInNewContext(`class Game { ${startMode} }; Game`, {
    audio: { init() {} }, t: key => key, Math,
  });
  for (const mode of ['practice', 'duel']) {
    const calls = [];
    const g = Object.create(Game.prototype);
    g.settings = { diff: 'normal' };
    g.clearArena = () => {};
    g.createPlayer = () => ({});
    g.spawnAt = () => {};
    g.createBot = () => ({});
    g.hud = { round() {}, banner() {}, show() {}, setEl() {}, hint() {}, chant() {}, preview() {} };
    g.viewModel = { setElement() {} };
    g.showScreen = () => {};
    g.enableVoice = () => { calls.push('voice'); return Promise.resolve(true); };
    g.lock = () => calls.push('lock');
    g.startMode(mode);
    assert.deepEqual(calls, ['voice', 'lock']);
  }
});

test('denied microphone access leaves typed casting available and retry visible', async () => {
  const nodes = Object.fromEntries(['menu-enable-voice', 'menu-disable-voice', 'menu-mic-badge', 'menu-mic-message'].map(id => [id, {
    classList: { toggle() {} },
  }]));
  const Game = vm.runInNewContext(`class Game { ${enableVoice} }; Game`, {
    $: id => nodes[id], audio: { init() {} }, t: key => key,
  });
  const g = Object.create(Game.prototype);
  const hints = [];
  g.mode = 'practice'; g.hud = { hint: key => hints.push(key) };
  g.voice = { supported: true, dispose() { this.disposed = true; } };
  g.initVoice = async () => { throw new Error('permission denied'); };
  assert.equal(await g.enableVoice(), false);
  assert.equal(g.voice.disposed, true);
  assert.equal(g.voiceInit, false);
  assert.equal(nodes['menu-enable-voice'].hidden, false);
  assert.equal(nodes['menu-mic-message'].textContent, 'menu.mic.failed');
  assert.deepEqual(hints, ['hint.mic']);
});
