import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalSpellModel } from '../local-model.js';

test('unloaded model gives an actionable error without initiating a download', async () => {
  const model = new LocalSpellModel(() => { throw new Error('must not load'); });
  await assert.rejects(model.interpret('fireball'), /Settings/);
  assert.equal(model.status().phase, 'unloaded');
});

test('load failures are visible and retryable', async () => {
  let calls = 0;
  const model = new LocalSpellModel(async () => {
    if (++calls === 1) throw new Error('network unavailable');
    return async texts => texts.map(() => [1, 0]);
  });
  await assert.rejects(model.load(), /network unavailable/);
  assert.equal(model.status().phase, 'error');
  await model.load();
  assert.equal(model.status().phase, 'ready');
});

test('concurrent loads and duplicate chants share work; successful chants are cached', async () => {
  let loads = 0, encodes = 0, active = 0;
  const model = new LocalSpellModel(async () => {
    loads++;
    return async texts => {
      assert.equal(active++, 0, 'inference must be serialized');
      await new Promise(resolve => setImmediate(resolve));
      active--; encodes++; return texts.map(() => [1, 0]);
    };
  });
  await Promise.all([model.load(), model.load()]);
  assert.equal(loads, 1);
  const before = encodes;
  const [a, b] = await Promise.all([model.interpret('Fireball'), model.interpret('fireball')]);
  assert.deepEqual(a, b); assert.equal(encodes, before + 1);
  assert.equal((await model.interpret('FIREBALL')).cached, true);
  await Promise.all([model.interpret('ice'), model.interpret('wind')]);
  assert.equal(encodes, before + 3);
});
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const book = readFileSync(new URL('../public/js/spellbook.js', import.meta.url), 'utf8');
const transport = book.slice(book.indexOf('export async function askJev'), book.indexOf('// Jev-only interpretation')).replace('export ', '');
test('client sends local selection and preserves its result identity without cloud retry', async () => {
  const calls = [];
  const context = vm.createContext({ performance, AbortSignal, fetch: async (url, init) => {
    calls.push({url, body: JSON.parse(init.body)});
    return {json: async () => ({ok: true, provider: 'local', params: {element: 'ice'}, latency: 15})};
  }});
  const ask = vm.runInContext(transport + '; askJev;', context);
  const r = await ask('氷の槍', {provider: 'local'});
  assert.equal(calls.length, 1); assert.equal(calls[0].body.provider, 'local');
  assert.equal(r.provider, 'local'); assert.equal(r.params.element, 'ice');
});

test('local inference errors reach the client without a fallback request', async () => {
  let calls = 0;
  const context = vm.createContext({ performance, AbortSignal, fetch: async () => {
    calls++; return {json: async () => ({ok: false, error: 'model unavailable'})};
  }});
  const ask = vm.runInContext(transport + '; askJev;', context);
  const r = await ask('fireball', {provider: 'local'});
  assert.equal(r.ok, false); assert.equal(r.error, 'model unavailable'); assert.equal(calls, 1);
});
