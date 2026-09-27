import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../public/js/audio.js';

function engine() {
  const audio = new AudioEngine(), nodes = [], sources = [];
  const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => {
    const n = { connections: [], connect(to) { this.connections.push(to); },
      disconnect() { this.connections = []; }, start() {}, stop(t) { this.stopTime = t; },
      end() { if (!this.ended) { this.ended = true; this.onended?.(); } } };
    for (const key of ['gain', 'frequency', 'Q', 'detune', 'playbackRate', 'delayTime', 'positionX', 'positionY', 'positionZ']) n[key] = param();
    nodes.push(n); return n;
  };
  const source = () => { const n = node(); sources.push(n); return n; };
  audio.ctx = { currentTime: 0, createGain: node, createBiquadFilter: node,
    createPanner: node, createDelay: node, createWaveShaper: node,
    createBufferSource: source, createOscillator: source };
  audio.sfx = node(); audio.reverbIn = node(); audio.enabled = true;
  audio.lp = { x: 0, y: 0, z: 0 };
  return { audio, nodes, sources };
}

test('loud and delayed layers have a hard cap and recover when ended', () => {
  const { audio, sources } = engine();
  const out = audio.out(null, 1, 0, true);
  for (let i = 0; i < 1000; i++) {
    audio.noise(out, { gain: 1.5, delay: 2 });
    audio.tone(out, { gain: 1.5, delay: 2 });
  }
  assert.equal(sources.length, 96);
  assert.equal(audio.voices, 96);
  sources.forEach(s => s.end());
  assert.equal(audio.voices, 0);
  assert.ok(audio.tone(out, { gain: 0.1 }));
});

test('same-place impact bursts are merged before creating audio nodes', () => {
  const { audio, nodes } = engine();
  audio.impact('fire', 1, { x: 2, y: 0, z: 0 });
  const count = nodes.length;
  for (let i = 0; i < 500; i++) audio.impact('fire', 1, { x: 3, y: 0, z: 0 });
  assert.equal(nodes.length, count);
  audio.ctx.currentTime = 0.061;
  audio.impact('fire', 0.2, { x: 2, y: 0, z: 0 });
  assert.ok(nodes.length > count);
});

test('world bursts leave event capacity for sounds near the listener', () => {
  const { audio } = engine();
  for (let i = 0; i < 6; i++) assert.equal(audio.admitSpell('impact', 'earth', { x: 30 + i * 10, y: 0, z: 0 }), true);
  assert.equal(audio.admitSpell('impact', 'earth', { x: 100, y: 0, z: 0 }), false);
  assert.equal(audio.admitSpell('cast', 'fire', { x: 1, y: 0, z: 0 }), true);
  audio.ctx.currentTime = 0.1;
  assert.equal(audio.admitSpell('impact', 'earth', { x: 100, y: 0, z: 0 }), true);
});

test('all element recipes remain bounded under sustained mixed bursts', () => {
  const { audio, sources } = engine();
  const elements = ['fire', 'ice', 'water', 'lightning', 'wind', 'earth', 'darkness', 'light', 'nature', 'poison', 'arcane'];
  for (let i = 0; i < 100; i++) {
    audio.ctx.currentTime += 0.07;
    for (const el of elements) {
      audio.cast(el, 1.3);
      audio.impact(el, 1.3);
      audio.shatter(null, 1);
      audio.roar(el, 1);
    }
    assert.ok(audio.voices <= 96);
  }
  // Roar modulation oscillators are separate, but can only accompany admitted tones.
  assert.ok(sources.length <= 192);
});

test('transient spatial and distortion chains disconnect after their last source', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { audio, sources } = engine();
  const out = audio.out({ x: 40, y: 0, z: 0 });
  const distortion = audio.distort(out);
  audio.tone(distortion, { gain: 1 });
  audio.noise(out, { gain: 1, delay: 1 });
  const chain = [...out._nodes];
  await Promise.resolve();
  sources[0].end();
  t.mock.timers.tick(500);
  assert.ok(out.connections.length);
  sources[1].end();
  t.mock.timers.tick(399);
  assert.ok(out.connections.length);
  t.mock.timers.tick(1);
  assert.ok(chain.every(n => n.connections.length === 0));
  assert.equal(audio.voices, 0);
});

test('loops are bounded, repeated stop is safe, and ended loops release capacity', async () => {
  const { audio, nodes, sources } = engine();
  const handles = Array.from({ length: 12 }, () => audio.loop('wind', null, 0.5, null, { spin: 1 }));
  const count = nodes.length;
  const skipped = audio.loop('wind', null);
  skipped.set(null, 1); skipped.stop();
  assert.equal(nodes.length, count);
  await Promise.resolve();
  handles.forEach(h => { h.stop(); h.stop(); h.set(null, 1); });
  assert.equal(audio.loopCount, 12); // Fading loops still consume resources.
  sources.forEach(s => s.end());
  assert.equal(audio.loopCount, 0);
  assert.ok(nodes.every(n => n.connections.length === 0));
  audio.loop('water', null);
  assert.equal(audio.loopCount, 1);
});
