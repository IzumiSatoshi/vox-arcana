import test from 'node:test';
import assert from 'node:assert/strict';
import { createP2PSignaling } from '../p2p-signaling.js';
import { createApiHandler } from '../api-handler.js';

const cache = () => ({ version: 'test', shared: false });
const credentials = result => ({ code: result.room.code, token: result.token });
test('P2P rooms hide secrets, admit exactly one guest, and close for both peers', async () => {
  const service = createP2PSignaling(cache());
  const host = await service.act({ action: 'create', name: 'Host', public: true });
  const list = await service.act({ action: 'list' });
  assert.equal(list.rooms.length, 1); assert.equal(JSON.stringify(list).includes(host.token), false);
  const joins = await Promise.allSettled(['A','B'].map(name => service.act({ action: 'join', code: host.room.code, name })));
  assert.equal(joins.filter(j => j.status === 'fulfilled').length, 1);
  const guest = joins.find(j => j.status === 'fulfilled').value;
  assert.equal((await service.act({ action: 'list' })).rooms.length, 0);
  await assert.rejects(service.act({ action: 'poll', code: host.room.code, token: 'a'.repeat(48) }), { status: 403 });
  const description = { type: 'offer', sdp: 'test-sdp' };
  await service.act({ action: 'signal', ...credentials(host), description });
  assert.deepEqual((await service.act({ action: 'poll', ...credentials(guest) })).description, description);
  await assert.rejects(service.act({ action: 'signal', ...credentials(guest), description }), { status: 400 });
  await assert.rejects(service.act({ action: 'signal', ...credentials(host), description: { type: 'offer', sdp: 'x'.repeat(24001) } }), { status: 400 });
  await service.act({ action: 'leave', ...credentials(guest) });
  await assert.rejects(service.act({ action: 'poll', ...credentials(host) }), { status: 404 });
});
test('hosted P2P refuses per-instance memory; separate handlers share Redis atomically', async () => {
  const unavailable = createP2PSignaling(cache(), { hosted: true });
  assert.equal(unavailable.status().available, false);
  await assert.rejects(unavailable.act({ action: 'create', name: 'Host', public: false }), { status: 503 });
  const rows = new Map();
  const redis = { version: 'test', shared: true, commands: async commands => commands.map(([cmd, ...args]) => {
    if (cmd === 'GET') return rows.get(args[0]) ?? null;
    if (cmd === 'EVAL') { const [, , key, previous, next] = args; if ((rows.get(key) || '') !== previous) return 0; rows.set(key, next); return 1; }
    if (cmd === 'ZREM') return 1;
    throw new Error(cmd);
  }) };
  const a = createP2PSignaling(redis, { hosted: true }), b = createP2PSignaling(redis, { hosted: true });
  const host = await a.act({ action: 'create', name: 'Host', public: false });
  const results = await Promise.allSettled([a,b].map(s => s.act({ action: 'join', code: host.room.code, name: 'Guest' })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await b.act({ action: 'poll', ...credentials(host) })).room.players.length, 2);
});
test('TURN credentials are temporary, private, and reused for the same participant', async () => {
  const oldId = process.env.TURN_KEY_ID, oldToken = process.env.TURN_KEY_API_TOKEN;
  process.env.TURN_KEY_ID = 'test-id'; process.env.TURN_KEY_API_TOKEN = 'private-api-token';
  let calls = 0;
  try {
    const service = createP2PSignaling(cache(), { fetcher: async (url, request) => {
      calls++; assert.match(url, /test-id\/credentials\/generate-ice-servers$/);
      assert.equal(request.headers.Authorization, 'Bearer private-api-token'); assert.equal(JSON.parse(request.body).ttl, 3600);
      return { ok: true, json: async () => ({ iceServers: [{ urls: ['turn:example.test:3478'], username: 'temporary', credential: 'temporary-password' }] }) };
    } });
    const host = await service.act({ action: 'create', name: 'Host', public: true, relayOnly: true });
    const first = await service.act({ action: 'ice', ...credentials(host) });
    assert.deepEqual(first, await service.act({ action: 'ice', ...credentials(host) })); assert.equal(calls, 1); assert.equal(first.relayOnly, true);
    const publicData = JSON.stringify(await service.act({ action: 'list' }));
    assert.equal(publicData.includes('temporary-password'), false); assert.equal(JSON.stringify(first).includes('private-api-token'), false);
  } finally {
    if (oldId === undefined) delete process.env.TURN_KEY_ID; else process.env.TURN_KEY_ID = oldId;
    if (oldToken === undefined) delete process.env.TURN_KEY_API_TOKEN; else process.env.TURN_KEY_API_TOKEN = oldToken;
  }
});
test('P2P API rejects cross-origin writes and reports missing hosted storage', async () => {
  const handler = createApiHandler({ hosted: true, spellCache: { ...cache(), status: () => ({}) } });
  let status, result;
  const response = { writeHead: code => { status = code; }, end: value => { result = JSON.parse(value); } };
  await handler({ url: '/api/p2p', method: 'POST', headers: { origin: 'https://other.test', host: 'game.test' }, body: { action: 'create', name: 'Host', public: false } }, response);
  assert.equal(status, 403);
  await handler({ url: '/api/p2p', method: 'GET', headers: {} }, response);
  assert.equal(status, 200); assert.equal(result.available, false);
});


test('room creation requires explicit visibility and private rooms remain unlisted', async () => {
  const service=createP2PSignaling(cache());
  for (const visibility of [undefined, null, 'false', 0]) {
    await assert.rejects(service.act({action:'create',name:'Host',public:visibility}), {status:400});
  }
  const privateRoom=await service.act({action:'create',name:'Host',public:false});
  assert.equal(privateRoom.room.public,false);
  assert.equal((await service.act({action:'list'})).rooms.length,0);
  const publicRoom=await service.act({action:'create',name:'Host',public:true});
  assert.equal(publicRoom.room.public,true);
  assert.equal((await service.act({action:'list'})).rooms.length,1);
});


test('relay-only rooms fail closed when TURN is unavailable', async () => {
  const previousKey=process.env.TURN_KEY_ID; delete process.env.TURN_KEY_ID;
  try {
    const service=createP2PSignaling(cache());
    await assert.rejects(service.act({action:'create',name:'Host',public:true,relayOnly:true}),{status:503});
    const direct=await service.act({action:'create',name:'Host',public:true,relayOnly:false});
    assert.equal(direct.room.relayOnly,false);
    const ice=await service.act({action:'ice',...credentials(direct)});
    assert.equal(ice.relayOnly,false);
  } finally {if(previousKey===undefined)delete process.env.TURN_KEY_ID;else process.env.TURN_KEY_ID=previousKey;}
});


test('win target is validated, advertised and shared with the guest', async () => {
  const service = createP2PSignaling(cache());
  for (const winsToWin of [0, -1, 1.5, 11, '3', null]) {
    await assert.rejects(service.act({ action:'create', name:'Host', public:true, winsToWin }), /whole number/);
  }
  const host = await service.act({ action:'create', name:'Host', public:true, winsToWin:3 });
  assert.equal(host.room.winsToWin, 3);
  assert.equal((await service.act({ action:'list' })).rooms[0].winsToWin, 3);
  const guest = await service.act({ action:'join', name:'Guest', code:host.room.code });
  assert.equal(guest.room.winsToWin, 3);
  assert.equal((await service.act({ action:'poll', ...credentials(host) })).room.winsToWin, 3);
  assert.equal((await service.act({ action:'create', name:'Default', public:false })).room.winsToWin, 2);
});
