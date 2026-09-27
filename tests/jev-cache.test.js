import test from 'node:test';
import assert from 'node:assert/strict';
import { requestCachedSpell } from '../public/js/jev-cache.js';

const result = { ok: true, params: { element: 'fire', isSpell: 1 }, cacheVersion: 'v1' };
test('all completed requests are cached immediately and concurrent identical requests share a call', async () => {
  const owner = {}; let finish, calls = 0;
  const request = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = requestCachedSpell(owner, 'Fireball', { language: 'en-US' }, request);
  const second = requestCachedSpell(owner, ' fireball ', { language: 'en-US' }, request);
  assert.equal(first, second); assert.equal(calls, 1);
  finish(result); await first;
  assert.equal(owner.jevCache.size, 1);
  assert.deepEqual(await requestCachedSpell(owner, 'FIREBALL', { language: 'en-US' }, request), { ...result, cached: true, latency: 0, rtt: 0 });
  assert.equal(result.cached, undefined, 'Cache hits must not relabel the original live response');
  assert.equal(calls, 1);
});
test('language and provider separate results; failures and partial results never enter cache', async () => {
  const owner = {}; let calls = 0;
  const request = async () => { calls++; return result; };
  await requestCachedSpell(owner, 'fire', { language: 'en-US' }, request);
  await requestCachedSpell(owner, 'fire', { language: 'ja-JP' }, request);
  await requestCachedSpell(owner, 'fire', { provider: 'local', language: 'en-US' }, request);
  assert.equal(calls, 3);
  for (const bad of [{ ok: false, retryable: true }, { ...result, partial: true }]) {
    await requestCachedSpell(owner, 'unknown', {}, async () => bad);
    assert.equal(owner.jevCache.size, 3); assert.equal(owner.jevPending.size, 0);
  }
});
test('a result from the previous deployment cannot restore an invalidated cache', async () => {
  const owner = { cacheVersion: 'v1' }; let finish;
  const pending = requestCachedSpell(owner, 'fire', {}, () => new Promise(resolve => { finish = resolve; }));
  owner.cacheVersion = 'v2'; finish(result);
  assert.equal((await pending).ok, false); assert.equal(owner.jevCache.size, 0);
});
