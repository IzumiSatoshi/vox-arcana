import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { SpellCache } from '../spell-cache.js';
import { createApiHandler } from '../api-handler.js';

const value = { params: { element: 'fire', shape: 'orb', isSpell: 1, power: 0.7 }, raw: { answers: { element: { choice: 'fire' } } }, model: 'test', endpoint: 'direct' };
// Exercise the REST command protocol across independent server cache objects.
function redis() {
  const strings = new Map(), sets = new Map();
  return async (url, options) => {
    assert.equal(url, 'https://cache.example/pipeline');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    const rows = JSON.parse(options.body).map(([command, key, ...args]) => {
      let result;
      if (command === 'GET') result = strings.get(key) ?? null;
      else if (command === 'SET') { assert.equal(args[1], 'EX'); strings.set(key, args[0]); result = 'OK'; }
      else if (command === 'EXPIRE') result = 1;
      else if (command === 'ZINCRBY') {
        if (!sets.has(key)) sets.set(key, new Map());
        const set = sets.get(key); result = (set.get(args[1]) || 0) + Number(args[0]); set.set(args[1], result);
      } else if (command === 'ZREMRANGEBYRANK') result = 0;
      else if (command === 'ZREVRANGE') result = [...(sets.get(key) || [])].sort((a,b) => b[1]-a[1]).slice(Number(args[0]), Number(args[1])+1).map(([id])=>id);
      else if (command === 'MGET') result = [key, ...args].map(id => strings.get(id) ?? null);
      else throw new Error(`Unexpected Redis command: ${command}`);
      return { result };
    });
    return { ok: true, json: async () => rows };
  };
}
const remote = (fetcher, version = 'release-1') => new SpellCache({ version, url: 'https://cache.example', token: 'test-secret', fetcher });

test('independent servers share results; language and release versions remain isolated', async () => {
  const transport = redis(), first = remote(transport), second = remote(transport);
  let calls = 0; const interpret = async () => { calls++; return value; };
  await first.resolve('Fireball', 'en-US', interpret);
  const hit = await second.resolve(' fireball ', 'en-US', interpret);
  assert.equal(hit.cached, true); assert.equal(calls, 1);
  await second.resolve('fireball', 'ja-JP', interpret); assert.equal(calls, 2);
  await remote(transport, 'release-2').resolve('fireball', 'en-US', interpret); assert.equal(calls, 3);
});

test('identical concurrent requests share one provider call and errors are never cached', async () => {
  const cache = new SpellCache({ version: 'test', url: '', token: '' });
  let calls = 0, finish;
  const interpret = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const a = cache.resolve('fire', 'en-US', interpret), b = cache.resolve('fire', 'en-US', interpret);
  await new Promise(resolve => setImmediate(resolve)); finish(value);
  await Promise.all([a,b]); assert.equal(calls, 1);
  await assert.rejects(cache.resolve('ice', 'en-US', async () => { throw new Error('temporary'); }));
  assert.equal(cache.pending.size, 0);
  await cache.resolve('ice', 'en-US', async () => { calls++; return value; }); assert.equal(calls, 2);
});

test('preload ranks spells, excludes rejected chatter, and strips provider responses', async () => {
  const transport = redis(), cache = remote(transport);
  for (const text of ['fire', 'ice', 'wind']) await cache.resolve(text, 'en-US', async () => value);
  await cache.get('ice', 'en-US'); await cache.get('ice', 'en-US');
  await cache.resolve('private non-spell chatter', 'en-US', async () => ({ ...value, params: { isSpell: 0 } }));
  await cache.resolve('炎', 'ja-JP', async () => value);
  const pack = await remote(transport).top('en-US', 2);
  assert.equal(pack.entries.length, 2); assert.equal(pack.entries[0].text, 'ice');
  assert.equal(pack.entries.some(entry => entry.raw || entry.text.includes('private')), false);
  assert.equal(JSON.stringify(pack).includes('test-secret'), false);
});

test('Redis outages fall back to bounded server memory without blocking casting', async () => {
  let tries = 0;
  const cache = new SpellCache({ version: 'test', url: 'https://cache.example', token: 'secret', maxMemory: 2,
    fetcher: async () => { tries++; throw new Error('offline'); } });
  await cache.resolve('fire', 'en-US', async () => value);
  assert.equal((await cache.get('fire', 'en-US')).cached, true);
  assert.equal(cache.status().degraded, true); assert.equal(tries, 1);
  await cache.put('ice', 'en-US', value); await cache.put('wind', 'en-US', value);
  assert.equal(cache.memory.size, 2);
});

test('a confirmed Redis expiry is not overridden by an older memory entry', async () => {
  const cache = remote(async () => ({ ok: true, json: async () => [{ result: null }] }));
  cache.remember(cache.keys('fire', 'en-US').key, { text: 'fire', language: 'en-US', value });
  assert.equal(await cache.get('fire', 'en-US'), null);
});

test('preload stays under 1000 spells and 2 MiB; representative payload has measurable size', async t => {
  const cache = new SpellCache({ version: 'test', url: '', token: '' });
  for (let i=0; i<1100; i++) await cache.put(`fire spell ${i}`, 'en-US', value);
  const pack = await cache.top('en-US'); const body = JSON.stringify(pack);
  assert.equal(pack.entries.length,1000); assert.ok(Buffer.byteLength(body) < 2*1024*1024);
  t.diagnostic(`Small fixture: ${Buffer.byteLength(body)} bytes JSON, ${gzipSync(body).length} bytes gzip`);
  const large = { ...value, params: { ...value.params, extra: 'x'.repeat(10000) } };
  for (let i=0;i<1100;i++) await cache.put(`large ${i}`, 'ja-JP', large);
  assert.ok(JSON.stringify(await cache.top('ja-JP')).length < 2*1024*1024+1024);
});

async function call(handler, path, body) {
  let status, data;
  await handler({ url: path, method: body ? 'POST' : 'GET', body, headers: {} }, { writeHead(code) {status=code;}, end(text) {data=JSON.parse(text);} });
  return { status, data };
}
test('API serves language-specific preload, advertises storage, and rejects invalid locales', async () => {
  const cache = new SpellCache({ version: 'test', url: '', token: '' });
  await cache.put('炎', 'ja-JP', value); await cache.put('fire', 'en-US', value);
  const handler = createApiHandler({ spellCache: cache });
  const result = await call(handler, '/api/spell-cache?language=ja-JP');
  assert.equal(result.data.entries[0].text, '炎'); assert.equal(result.data.entries.length,1);
  assert.equal((await call(handler, '/api/spell-cache?language=bad_locale')).status,400);
  assert.equal((await call(handler, '/api/status')).data.cache.shared,false);
});

const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
function browser(fetch) {
  const context = vm.createContext({ fetch, AbortSignal, encodeURIComponent });
  const Game = vm.runInContext(main.slice(main.indexOf('class Game {'),main.indexOf('window.game = new Game();'))+';Game',context);
  const game=Object.create(Game.prototype); game.settings={lang:'ja-JP'};
  return game;
}
test('browser downloads current-language parameters and clears prior versions', async () => {
  let version='v1';
  const game = browser(async url => { assert.match(url,/language=ja-JP/); return {ok:true,text:async()=>JSON.stringify({ok:true,version,language:'ja-JP',shared:true,entries:[{text:'炎',...value}]})}; });
  await game.preloadSpellCache();
  const cached=game.jevCache.get(JSON.stringify(['jev','ja-JP','炎']));
  assert.equal(cached.cached,true); assert.equal(cached.raw.cachedSummary,true); assert.equal(game.spellCacheStats.loaded,1);
  game.jevCache.set('old spell',value); version='v2'; await game.preloadSpellCache();
  assert.equal(game.jevCache.has('old spell'),false); assert.equal(game.cacheVersion,'v2');
  version='v1'; await game.preloadSpellCache();
  assert.equal(game.cacheVersion,'v2');
});
test('failed preload is optional and a superseded language download cannot win', async () => {
  const replies=[]; const game=browser(()=>new Promise(resolve=>replies.push(resolve)));
  const first=game.preloadSpellCache('en-US'), second=game.preloadSpellCache('ja-JP');
  replies[1]({ok:true,text:async()=>JSON.stringify({ok:true,version:'v2',language:'ja-JP',entries:[]})});await second;
  replies[0]({ok:true,text:async()=>JSON.stringify({ok:true,version:'v1',language:'en-US',entries:[]})});await first;
  assert.equal(game.cacheVersion,'v2');
  await browser(async()=>{throw new Error('offline');}).preloadSpellCache();
});
