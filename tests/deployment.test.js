import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiHandler } from '../api-handler.js';

async function request(t, { hosted = true, localModel, method = 'GET', path = '/api/status', body, headers = {} } = {}) {
  const server = http.createServer(createApiHandler({ hosted, localModel }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test('hosted API advertises local-only feature limits', async t => {
  const {data} = await request(t);
  assert.deepEqual(data.capabilities, {localModel: false});
  assert.equal(data.local.phase, 'disabled');
  assert.equal(JSON.stringify(data).includes('Bearer '), false);
});

test('hosted status recognizes request-context OIDC without a token environment variable', async () => {
  const oldVercel = process.env.VERCEL;
  const oldOidc = process.env.VERCEL_OIDC_TOKEN;
  process.env.VERCEL = '1';
  delete process.env.VERCEL_OIDC_TOKEN;
  try {
    const handler = createApiHandler({ hosted: true });
    let data;
    await handler({ url: '/api/status', method: 'GET', headers: {} }, {
      writeHead() {}, end(value) { data = JSON.parse(value); },
    });
    assert.equal(data.jev.keyLoaded, true);
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = oldVercel;
    if (oldOidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = oldOidc;
  }
});
test('local API keeps local inference available', async t => {
  const localModel = {status:()=>({phase:'ready'}), interpret:async text=>({params:{element:'fire'}, text})};
  const {data} = await request(t, {hosted:false, localModel});
  assert.deepEqual(data.capabilities, {localModel:true});
  const result = await request(t, {hosted:false, localModel, method:'POST', path:'/api/spell', body:{text:'Fireball',provider:'local'}});
  assert.equal(result.data.ok,true); assert.equal(result.data.params.element,'fire');
});
test('hosted local inference is rejected without loading a model', async t => {
  for (const path of ['/api/local/load','/api/spell']) {
    const result = await request(t, {method:'POST',path,body:{text:'Fireball',provider:'local'}});
    assert.equal(result.status,503); assert.match(result.data.error,/local server/);
  }
});
test('invalid spell input is rejected before a paid upstream call', async t => {
  for (const body of [null, [], {text:42}, {text:''}, {text:'a'.repeat(601)}, {text:'Fireball',chantSeconds:'oops'}, {text:'Fireball',provider:'unknown'}]) {
    const result = await request(t, {method:'POST',path:'/api/spell',body});
    assert.equal(result.status,400);
  }
});
test('cross-origin requests cannot use the interpretation API', async t => {
  const result = await request(t, {method:'POST',path:'/api/spell',body:{text:'Fireball'},headers:{Origin:'https://other.example'}});
  assert.equal(result.status,403);
});
test('framework-parsed bodies work with the serverless handler', async () => {
  let code, data;
  const handler=createApiHandler({hosted:false,localModel:{interpret:async()=>({params:{element:'ice'}})}});
  await handler({url:'/api/spell',method:'POST',headers:{},body:{text:'Ice spear',provider:'local'}},{writeHead(c){code=c;},end(s){data=JSON.parse(s);}});
  assert.equal(code,200); assert.equal(data.params.element,'ice');
});

test('Vercel wildcard rewrite reaches the status endpoint', async () => {
  const {default: handler} = await import('../api/index.js');
  let code, data;
  await handler({url:'/api?path=status',method:'GET',headers:{}},{writeHead(c){code=c;},end(s){data=JSON.parse(s);}});
  assert.equal(code,200); assert.equal(data.capabilities.localModel,false);
  await handler({url:'/api?path=spell-cache&language=ja-JP',method:'GET',headers:{}},{writeHead(c){code=c;},end(s){data=JSON.parse(s);}});
  assert.equal(code,200); assert.equal(data.language,'ja-JP');
});

test('hosted spell calls use the budgeted gateway and hide provider errors', async () => {
  const oldGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.AI_GATEWAY_API_KEY = 'gateway-test-token';
  let requestedUrl, authorization, code, data;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    authorization = options.headers.Authorization;
    return { ok: false, status: 502, text: async () => 'upstream-private-error-marker' };
  };
  try {
    const handler = createApiHandler({ hosted: true, apiKey: 'direct-test-token' });
    const res = { writeHead(value) { code = value; }, end(value) { data = JSON.parse(value); } };
    await handler({ url: '/api/spell', method: 'POST', headers: {}, body: { text: 'Fireball' } }, res);
    assert.equal(requestedUrl, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
    assert.equal(authorization, 'Bearer gateway-test-token');
    assert.equal(code, 200);
    assert.equal(data.ok, false);
    assert.equal(data.errorCode, 'upstream_unavailable');
    assert.equal(data.retryable, true);
    assert.equal(JSON.stringify(data).includes('upstream-private-error-marker'), false);
    await handler({ url: '/api/status', method: 'GET', headers: {} }, res);
    assert.equal(JSON.stringify(data).includes('upstream-private-error-marker'), false);
    assert.equal(data.jev.url, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = oldGatewayKey;
  }
});
