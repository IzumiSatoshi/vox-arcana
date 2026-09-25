import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createApiHandler } from '../api-handler.js';
import { ELEMENTS, SHAPES } from '../spell-ontology.js';

const source = readFileSync(new URL('../public/js/spellbook.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const context = vm.createContext({
  clamp: n => Math.max(0, Math.min(1, n)), hashStr: () => 42, spellName: () => 'Test spell',
  ELEMENT_KEYS: Object.keys(ELEMENTS), SHAPE_KEYS: Object.keys(SHAPES),
  performance, AbortSignal,
});
const { buildJevSpec, buildSpec, localParse, askJev } = vm.runInContext(source + '\n({buildJevSpec, buildSpec, localParse, askJev})', context);
const result = { ok: true, params: {
  element: 'ice', shape: 'beam', power: 0.3, tier: 0.25, isSpell: 1,
  size: 0.4, duration: 0.6, trajectory: 'straight', morph: 'orb',
} };
const gameplay = spec => {
  const { chantSeconds, loudness, ...rest } = spec;
  return rest;
};

test('every finalized spell characteristic is independent of casting time and loudness', () => {
  const baseline = gameplay(buildJevSpec('Fireball', result, { chantSeconds: 0, loudness: 0 }));
  for (const chantSeconds of [0.1, 2, 8, 10, 60]) {
    for (const loudness of [0, 0.4, 1]) {
      const spec = buildJevSpec('Fireball', result, { chantSeconds, loudness });
      assert.equal(spec.power, result.params.power);
      assert.equal(spec.tier, result.params.tier);
      assert.deepEqual(gameplay(spec), baseline);
    }
  }
});

test('rival builder uses completed JEV parameters without keyword blending', () => {
  const text = 'ultimate huge homing fire dragon';
  const meta = { chantSeconds: 30, loudness: 1 };
  assert.deepEqual(buildSpec(text, localParse(text), result, meta), buildJevSpec(text, result, meta));
});

test('offline spells also receive no timing or loudness bonuses', () => {
  const text = 'Fireball', local = localParse(text);
  assert.deepEqual(gameplay(buildSpec(text, local, null, { chantSeconds: 0, loudness: 0 })),
    gameplay(buildSpec(text, local, null, { chantSeconds: 60, loudness: 1 })));
});

test('browser sends words, provider, and recognition language without voice strength metadata', async () => {
  let body;
  context.fetch = async (_, options) => {
    body = JSON.parse(options.body);
    return { json: async () => result };
  };
  await askJev('Fireball', { chantSeconds: 30, loudness: 1, provider: 'jev', language: 'ja-JP' });
  assert.deepEqual(body, { text: 'Fireball', provider: 'jev', language: 'ja-JP' });
});

test('Jev receives the selected recognition language and returns the full reply, including probabilities', async t => {
  const states = [];
  const raw = { model: 'test', answers: { element: { choice: 'fire', probabilities: { fire: 0.8, ice: 0.2 } } } };
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    states.push(JSON.parse(options.body).state);
    return { ok: true, text: async () => JSON.stringify(raw) };
  });
  const handler = createApiHandler({ apiKey: 'test-key' });
  const call = async language => {
    let data;
    await handler({ url: '/api/spell', method: 'POST', headers: {}, body: { text: 'Fireball', language } },
      { writeHead(code) { assert.equal(code, 200); }, end(body) { data = JSON.parse(body); } });
    return data;
  };
  assert.deepEqual((await call('en-GB')).raw, raw);
  assert.deepEqual((await call('ja-JP')).raw, raw);
  assert.match(states[0], /voice recognition language: en-GB/);
  assert.match(states[1], /voice recognition language: ja-JP/);
  assert.equal(states.length, 2);
});

test('server ignores legacy timing and loudness even on uncached JEV calls', async t => {
  const states = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    states.push(JSON.parse(options.body).state);
    return { ok: true, text: async () => JSON.stringify({ answers: {} }) };
  });
  for (const meta of [{ chantSeconds: 0, loudness: 0 }, { chantSeconds: 60, loudness: 1 }]) {
    // Separate handlers ensure this tests fresh upstream requests, not cache hits.
    const handler = createApiHandler({ apiKey: 'test-key' });
    await handler({ url: '/api/spell', method: 'POST', headers: {}, body: { text: 'Fireball', ...meta } },
      { writeHead(code) { assert.equal(code, 200); }, end(body) { assert.equal(JSON.parse(body).ok, true); } });
  }
  assert.equal(states.length, 2);
  assert.equal(states[0], states[1]);
  assert.doesNotMatch(states[0], /Chant duration|Voice intensity/);
});


test('insufficient mana blocks a player cast without weakening it or spending mana', () => {
  const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  const Game = vm.runInNewContext(main.slice(main.indexOf('class Game {'), main.indexOf('window.game = new Game();')) + '\nGame;', {
    t: key => key, audio: { ui() {} },
  });
  const g = Object.create(Game.prototype);
  g.player = { canAct: () => true, costMult: () => 1, mana: 5 };
  g.hud = { preview() {}, chant() {} };
  g.spells = { cast() { assert.fail('Unaffordable spell must not cast'); } };
  const spec = buildJevSpec('Fireball', result);
  const before = { ...spec };
  g.performCast(spec, true);
  assert.equal(g.player.mana, 5);
  assert.deepEqual({ ...spec }, before);
});
