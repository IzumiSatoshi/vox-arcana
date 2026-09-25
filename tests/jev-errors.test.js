import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const book = readFileSync(new URL('../public/js/spellbook.js', import.meta.url), 'utf8');
const code = book.slice(book.indexOf('export async function askJev'), book.indexOf('// Jev-only interpretation:')).replace('export ', '');
function client(fetch) {
  return vm.runInNewContext(code + '\naskJev;', { fetch, performance, AbortSignal });
}
test('firewall HTML 429 is reported as a game rate limit without JSON parsing or immediate retry', async () => {
  const ask = client(async () => ({ status: 429, json() { throw new Error('HTML body'); } }));
  const result = await ask('Fireball');
  assert.equal(result.errorCode, 'rate_limit'); assert.equal(result.retryable, false);
});
test('upstream outage and upstream rate limit remain distinct from game rate limit', async () => {
  for (const errorCode of ['upstream_unavailable', 'upstream_rate_limit']) {
    const ask = client(async () => ({ status: 200, json: async () => ({ ok: false, errorCode, retryable: true }) }));
    assert.equal((await ask('Fireball')).errorCode, errorCode);
  }
});
test('timeout and network failure have distinct messages', async () => {
  for (const [name, expected] of [['TimeoutError', 'timeout'], ['TypeError', 'network_error']]) {
    const ask = client(async () => { throw Object.assign(new Error('failed'), { name }); });
    assert.equal((await ask('Fireball')).errorCode, expected);
  }
});
