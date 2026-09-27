import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../api-handler.js';

const envKeys = ['JEV_ENDPOINT', 'JEV_API_KEY', 'TYPESAFE_API_KEY', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'JEV_URL', 'JEV_MODEL'];
function environment(t, values = {}) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, values);
  t.after(() => {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}
async function call(handler, body, path = '/api/spell') {
  let data;
  await handler({ url: path, method: body ? 'POST' : 'GET', headers: {}, body }, {
    writeHead() {}, end(value) { data = JSON.parse(value); },
  });
  return data;
}
const spell = { text: 'Fireball', language: 'ja-JP' };

for (const endpoint of ['direct', 'gateway']) {
  test(`${endpoint} uses only its own credentials and model, regardless of request overrides`, async t => {
    environment(t, { JEV_ENDPOINT: endpoint, JEV_API_KEY: 'direct-secret', AI_GATEWAY_API_KEY: 'gateway-secret' });
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push({ url, ...options });
      return { ok: true, text: async () => JSON.stringify({ answers: { element: { choice: 'fire' } } }) };
    });
    const handler = createApiHandler({ hosted: true });
    const result = await call(handler, { ...spell, endpoint: endpoint === 'direct' ? 'gateway' : 'direct', url: 'https://example.com', apiKey: 'client-key' });
    assert.equal(result.ok, true);
    assert.equal(result.endpoint, endpoint);
    assert.equal(result.model, endpoint === 'direct' ? 'jev-latest' : 'typesafe-ai/jev');
    assert.equal(requests[0].url, endpoint === 'direct' ? 'https://api.typesafe.ai/v1/systemone' : 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
    assert.equal(requests[0].headers.Authorization, `Bearer ${endpoint}-secret`);
    assert.equal(JSON.parse(requests[0].body).model, result.model);
    assert.match(JSON.parse(requests[0].body).state, /ja-JP/);
    const status = await call(handler, null, '/api/status');
    assert.equal(status.jev.endpoint, endpoint);
    assert.equal(status.jev.model, result.model);
    assert.equal(status.jev.keyLoaded, true);
    assert.doesNotMatch(JSON.stringify([result, status]), /direct-secret|gateway-secret|client-key/);
    await call(handler, spell);
    assert.equal(requests.length, 1, 'same-language request is cached');
  });
}

test('missing selected credentials and invalid endpoints fail without fallback or requests', async t => {
  environment(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('unexpected request'); });
  for (const [endpoint, otherKey, expected] of [
    ['direct', 'AI_GATEWAY_API_KEY', 'missing_credentials'],
    ['gateway', 'JEV_API_KEY', 'missing_credentials'],
    ['invalid-value', 'JEV_API_KEY', 'invalid_endpoint'],
  ]) {
    process.env.JEV_ENDPOINT = endpoint;
    delete process.env.JEV_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    process.env[otherKey] = 'other-secret';
    const handler = createApiHandler({ hosted: true });
    const result = await call(handler, spell);
    assert.equal(result.errorCode, expected);
    assert.equal(result.retryable, false);
    const status = await call(handler, null, '/api/status');
    assert.equal(status.jev.keyLoaded, false);
    assert.equal(status.jev.errorCode, expected);
  }
  assert.equal(requests, 0);
});

test('local config chooses gateway even with a disk key, and environment overrides config', async t => {
  environment(t, { AI_GATEWAY_API_KEY: 'gateway-secret' });
  let status = await call(createApiHandler({ config: { endpoint: 'gateway' }, apiKey: 'disk-key' }), null, '/api/status');
  assert.equal(status.jev.endpoint, 'gateway');
  process.env.JEV_ENDPOINT = 'direct';
  status = await call(createApiHandler({ config: { endpoint: 'gateway' }, apiKey: 'disk-key' }), null, '/api/status');
  assert.equal(status.jev.endpoint, 'direct');
  assert.equal(status.jev.keyLoaded, true);
});

for (const endpoint of ['direct', 'gateway']) {
  test(`${endpoint} errors are classified, sanitized, and never sent to another provider`, async t => {
    environment(t, { JEV_ENDPOINT: endpoint, JEV_API_KEY: 'direct-secret', AI_GATEWAY_API_KEY: 'gateway-secret' });
    const logs = [];
    t.mock.method(console, 'warn', (...args) => logs.push(args));
    let response;
    const urls = [];
    t.mock.method(globalThis, 'fetch', async url => {
      urls.push(url);
      if (response instanceof Error) throw response;
      return response;
    });
    const cases = [
      [401, 'authentication_failed', false], [403, 'access_denied', false],
      [402, 'billing_error', false], [429, 'upstream_rate_limit', true],
      [500, 'upstream_unavailable', true], [503, 'upstream_unavailable', true],
      [400, 'upstream_rejected', false], [408, 'timeout', true],
    ];
    const handler = createApiHandler({ hosted: true });
    for (const [status, errorCode, retryable] of cases) {
      response = { ok: false, status, text: async () => 'direct-secret gateway-secret private-upstream-body' };
      const result = await call(handler, spell);
      assert.equal(result.errorCode, errorCode);
      assert.equal(result.retryable, retryable);
      assert.equal(result.endpoint, endpoint);
      assert.doesNotMatch(JSON.stringify(result), /secret|private-upstream-body/);
    }
    for (const body of ['not JSON', 'null', '{"error":"private-upstream-body"}', '{"answers":[]}']) {
      response = { ok: true, text: async () => body };
      assert.equal((await call(handler, spell)).errorCode, 'invalid_response');
    }
    response = Object.assign(new Error('private-timeout'), { name: 'TimeoutError' });
    assert.equal((await call(handler, spell)).errorCode, 'timeout');
    response = new TypeError('private-network-error');
    assert.equal((await call(handler, spell)).errorCode, 'provider_network_error');
    assert.equal(urls.length, cases.length + 6);
    assert.equal(new Set(urls).size, 1);
    assert.doesNotMatch(JSON.stringify(logs), /secret|private-/);
  });
}
