import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { createDuelServer } from '../online/server.js';
import { readInput, validName } from '../online/protocol.js';
import { escapeHTML } from '../public/js/safe-html.js';
import { canvasDocument } from '../scripts/balance/environment.js';
import http from 'node:http';
import { duelEndpoint } from '../public/js/online-endpoint.js';

const collision = { obstacles: [], solids: [], bound: 80 };
const origin = 'http://localhost:8787';
test('local integrated and hosted endpoints resolve correctly', () => {
  assert.equal(duelEndpoint({ url: '/duel' }, 'http://localhost:9000/'), 'ws://localhost:9000/duel');
  assert.equal(duelEndpoint({ url: '/duel' }, 'https://game.example/'), 'wss://game.example/duel');
  assert.equal(duelEndpoint({ url: 'wss://duel.example/duel' }, 'https://game.example/'), 'wss://duel.example/duel');
  assert.equal(duelEndpoint({}, 'https://game.example/'), null);
  assert.throws(() => duelEndpoint({ url: 'ws://duel.example/duel' }, 'https://game.example/'));
});
async function connect(url) {
  const ws = new WebSocket(url, { origin });
  const inbox = [], waiters = [];
  ws.on('message', data => {
    const m = JSON.parse(data);
    const i = waiters.findIndex(w => w.match(m));
    if (i >= 0) { const [w] = waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(m); } else inbox.push(m);
  });
  const next = (type, check = () => true) => {
    const match = m => m.type === type && check(m), i = inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { match, resolve, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error(`Timed out: ${type}`)); }, 10000) }; waiters.push(w);
    });
  };
  await once(ws, 'open'); const hello = await next('hello');
  return { ws, next, id: hello.id, send: m => ws.send(JSON.stringify(m)) };
}

test('online inputs reject nonfinite values, normalize movement, and preserve safe display names', () => {
  assert.throws(() => readInput({ seq: 1, yaw: Infinity, pitch: 0, x: 0, z: 0 }));
  assert.throws(() => readInput({ seq: 1, yaw: 0, pitch: 0, x: 100, z: 0 }));
  const i = readInput({ seq: 1, yaw: 0, pitch: 20, x: 1, z: 1 });
  assert.equal(i.pitch, 1.5); assert.ok(Math.abs(Math.hypot(i.x, i.z) - 1) < 1e-9);
  assert.equal(validName('  Mage\u0000  '), 'Mage');
  assert.throws(() => validName('x'.repeat(25)));
  assert.equal(escapeHTML('<img src=x>'), '&lt;img src=x&gt;');
});

test('two real sockets create/join/ready, share server combat, reject a third player, and handle disconnect', { timeout: 20000 }, async t => {
  const app = createDuelServer({ collision, interpreter: 'keywords' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${app.server.address().port}/duel`;
  t.after(() => app.close());
  const a = await connect(url), b = await connect(url), c = await connect(url);
  a.send({ type: 'create', name: '<b>A</b>', public: true });
  const room = (await a.next('room')).room;
  c.send({ type: 'list' }); assert.equal((await c.next('rooms')).rooms[0].code, room.code);
  b.send({ type: 'join', name: 'B', code: room.code }); await b.next('room');
  c.send({ type: 'join', name: 'C', code: room.code }); assert.match((await c.next('error')).error, /full/);
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  const [ra, rb] = await Promise.all([a.next('round'), b.next('round')]); assert.deepEqual(ra, rb);
  await a.next('state', m => m.phase === 'playing');
  a.send({ type: 'input', seq: 1, yaw: 0, pitch: 0, x: 100, z: 0 }); assert.match((await a.next('error')).error, /Invalid/);
  a.send({ type: 'cast', text: 'fireball', language: 'en-US', spec: { power: 999, dmgMult: 999, cost: 0 } });
  const [ca, cb] = await Promise.all([a.next('cast'), b.next('cast')]);
  assert.deepEqual(ca, cb); assert.ok(ca.spec.power <= 1); assert.ok(ca.player.mana < 120); assert.notEqual(ca.spec.cost, 0);
  a.send({ type: 'input', seq: 2, yaw: 0, pitch: 0, x: 1, z: 0 });
  const moved = await a.next('state', s => s.ack[0] === 2 && s.players[0].pos[0] > 0);
  assert.equal(moved.players[0].id, a.id);
  b.ws.close(); await a.next('opponentLeft');
  const waiting = await a.next('room', m => m.room.phase === 'waiting' && m.room.players.length === 1);
  assert.equal(waiting.room.players[0].ready, false);
  a.send({ type: 'leave' }); await a.next('left'); assert.equal(app.rooms.size, 0);
});

test('websocket upgrades require an allowed origin', async t => {
  const app = createDuelServer({ collision });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const socket = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/duel`, { origin: 'https://wrong.example' });
  const [error] = await once(socket, 'error'); assert.match(error.message, /403/);
});

test('duels attach to the website server and share its spell handler', async t => {
  const httpServer = http.createServer((req, res) => { res.end('website'); });
  let interpreted = false, worker;
  const app = createDuelServer({ httpServer, collision,
    apiHandler: async (req, res) => {
      interpreted = req.body.text === 'fireball';
      res.end(JSON.stringify({ ok: true, params: { element: 'fire', shape: 'orb', isSpell: 1 } }));
    },
    workerFactory: () => { worker = new EventEmitter(); worker.sent = []; worker.postMessage = m => worker.sent.push(m); worker.terminate = async () => {}; return worker; },
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  assert.equal(await (await fetch(base)).text(), 'website');
  const url = base.replace('http:', 'ws:') + '/duel', a = await connect(url), b = await connect(url);
  a.send({ type: 'create', name: 'A' }); const room = (await a.next('room')).room;
  b.send({ type: 'join', name: 'B', code: room.code }); await b.next('room');
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true }); await a.next('room', m => m.room.phase === 'loading');
  worker.emit('message', { type: 'state', phase: 'playing' });
  a.send({ type: 'cast', text: 'fireball', language: 'en-US' }); await a.next('interpretation');
  assert.equal(interpreted, true); assert.equal(worker.sent.at(-1).spec.element, 'fire');
});

test('rematches use a fresh worker and late Jev replies cannot cross rounds', async t => {
  const workers = []; let finishInterpretation;
  const app = createDuelServer({ collision, interpreter: 'jev',
    interpret: () => new Promise(resolve => { finishInterpretation = resolve; }),
    workerFactory: () => {
      const w = new EventEmitter(); w.sent = []; w.postMessage = m => w.sent.push(m); w.terminate = async () => {};
      workers.push(w); return w;
    } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const url = `ws://127.0.0.1:${app.server.address().port}/duel`, a = await connect(url), b = await connect(url);
  a.send({ type: 'create', name: 'A' }); const room = (await a.next('room')).room;
  b.send({ type: 'join', name: 'B', code: room.code }); await b.next('room');
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  await a.next('room', m => m.room.phase === 'loading');
  workers[0].emit('message', { type: 'round', round: 1 });
  workers[0].emit('message', { type: 'state', phase: 'playing' });
  a.send({ type: 'cast', text: 'fireball', language: 'en-US' });
  for (let i = 0; !finishInterpretation && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(finishInterpretation);
  workers[0].emit('message', { type: 'round', round: 2 });
  workers[0].emit('message', { type: 'state', phase: 'playing' });
  finishInterpretation({ ok: true, params: { element: 'fire', shape: 'orb', isSpell: 1 } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(workers[0].sent.filter(m => m.type === 'cast').length, 0);
  workers[0].emit('message', { type: 'result', finished: true, winner: 0, score: [2, 0] });
  await a.next('room', m => m.room.phase === 'finished');
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  await a.next('room', m => m.room.phase === 'loading');
  assert.equal(workers.length, 2);
});

test('Jev failure reports an error and never falls back to keyword damage', async t => {
  let worker;
  const app = createDuelServer({ collision, interpret: async () => ({ ok: false, error: 'Provider unavailable' }),
    workerFactory: () => { worker = new EventEmitter(); worker.sent = []; worker.postMessage = m => worker.sent.push(m); worker.terminate = async () => {}; return worker; } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const url = `ws://127.0.0.1:${app.server.address().port}/duel`, a = await connect(url), b = await connect(url);
  a.send({ type: 'create', name: 'A' }); const room = (await a.next('room')).room;
  b.send({ type: 'join', name: 'B', code: room.code }); await b.next('room');
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true }); await a.next('room', m => m.room.phase === 'loading');
  worker.emit('message', { type: 'state', phase: 'playing' });
  a.send({ type: 'cast', text: 'fireball', language: 'en-US' });
  assert.equal((await a.next('castError')).error, 'Provider unavailable');
  assert.equal(worker.sent.filter(m => m.type === 'cast').length, 0);
});

test('server simulation owns damage, mana, input expiry, rounds, and match results', async () => {
  globalThis.document = canvasDocument();
  const { DuelSimulation } = await import('../online/simulation.js');
  const { finalizeSpec, localParse } = await import('../public/js/spellbook.js');
  const { applyHit } = await import('../public/js/combat.js');
  const events = [], sim = new DuelSimulation([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], collision, e => events.push(e));
  try {
    const spec = finalizeSpec({ ...localParse('fireball'), text: 'fireball' });
    assert.equal(sim.cast(0, spec), false);
    for (let i = 0; i < 181; i++) sim.step(1 / 60);
    assert.equal(sim.cast(0, spec), true); assert.ok(sim.players[0].mana < 120);
    assert.equal(sim.cast(0, spec), false);
    sim.input(0, readInput({ seq: 1, yaw: 0, pitch: 0, x: 1, z: 0, chanting: true, chantText: 'Fire orb' }));
    sim.step(1 / 60);
    assert.equal(sim.state().players[0].chantText, 'Fire orb');
    for (let i = 0; i < 120; i++) sim.step(1 / 60);
    assert.ok(Math.abs(sim.players[0].vel.x) < 0.1, 'stale input stops movement');
    assert.equal(sim.state().players[0].chantText, '', 'stale input clears the chant');
    for (let round = 0; round < 2; round++) {
      applyHit(sim.game, sim.players[1], { dmg: 10000, el: null, src: sim.players[0], point: sim.players[1].center() });
      sim.step(1 / 60);
      if (!round) { assert.equal(sim.phase, 'between'); for (let i = 0; i < 430; i++) sim.step(1 / 60); assert.equal(sim.players[1].hp, 600); }
    }
    assert.equal(sim.phase, 'finished'); assert.deepEqual(sim.score, [2, 0]); assert.equal(events.at(-1).finished, true);
  } finally { sim.dispose(); }
});

test('every spell form runs in the online simulation without missing browser dependencies', async () => {
  globalThis.document = canvasDocument();
  const { DuelSimulation } = await import('../online/simulation.js');
  const { finalizeSpec, localParse } = await import('../public/js/spellbook.js');
  const { SHAPE_KEYS } = await import('../public/js/elements.js');
  const oldError = console.error;
  console.error = (...args) => { throw new Error(args.map(String).join(' ')); };
  try {
    for (const shape of SHAPE_KEYS) {
      const sim = new DuelSimulation([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], collision, () => {});
      try {
        sim.game.world.heightAt = () => 0;
        sim.players[0].pos.set(0, 0, 8); sim.players[1].pos.set(0, 0, -8);
        sim.phase = 'playing';
        const spec = finalizeSpec({ ...localParse('arcane magic'), shape, element: 'arcane', text: shape, isSpell: 1, power: .5, tier: .5, size: .5, duration: .5, speed: .5, count: .5 });
        assert.equal(sim.cast(0, spec), true, shape);
        for (let i = 0; i < 240; i++) sim.step(1 / 60);
        assert.ok(sim.players.every(c => Number.isFinite(c.hp) && Number.isFinite(c.pos.x)), shape);
      } finally { sim.dispose(); }
    }
  } finally { console.error = oldError; }
});


test('chant inputs are bounded, strip control characters, and clear on release', () => {
  const input = { seq: 1, yaw: 0, pitch: 0, x: 0, z: 0, chanting: true, chantText: 'Fire\u0000 orb' };
  assert.equal(readInput(input).chantText, 'Fire orb');
  assert.equal(readInput({ ...input, chantText: 'a'.repeat(1000) }).chantText.length, 600);
  assert.equal(readInput({ ...input, chanting: false }).chantText, '');
  assert.equal(readInput({ ...input, chantText: {} }).chantText, '');
});


test('PvP normal attacks enforce the halved firing rate with and without lightning', async () => {
  globalThis.document = canvasDocument();
  const { DuelSimulation } = await import('../online/simulation.js');
  for (const lightning of [false, true]) {
    const events=[];
    const sim=new DuelSimulation([{id:'a',name:'A'},{id:'b',name:'B'}],collision,e=>events.push(e));
    try {
      sim.phase='playing';sim.players[0].enhP=()=>lightning ? 0.5 : null;
      assert.equal(sim.cast(0,null,true),true);
      const interval=lightning ? 0.36 : 0.56;
      sim.elapsed=interval-0.001;assert.equal(sim.cast(0,null,true),false);
      sim.elapsed=interval;assert.equal(sim.cast(0,null,true),true);
      assert.equal(events.filter(e=>e.type==='cast').length,2);
      assert.ok(events.filter(e=>e.type==='cast').every(e=>e.spec.basic));
    } finally { sim.dispose(); }
  }
});


test('first-to-N ends exactly at the chosen wins and draws do not advance scores', async () => {
  globalThis.document = canvasDocument();
  const { DuelSimulation } = await import('../online/simulation.js');
  for (const target of [1, 3, 10]) {
    const events = [], sim = new DuelSimulation([{id:'a',name:'A'},{id:'b',name:'B'}], collision, e => events.push(e), target);
    try {
      sim.step(3.1);
      sim.players.forEach(p => { p.alive = false; }); sim.step(1/60);
      assert.deepEqual(sim.score, [0,0]); assert.equal(sim.phase, 'between');
      for (let n=1; n<=target; n++) {
        sim.step(4.1); sim.step(3.1);
        sim.players[1].alive = false; sim.step(1/60);
        assert.deepEqual(sim.score, [n,0]);
        assert.equal(sim.phase, n === target ? 'finished' : 'between');
        assert.equal(events.at(-1).finished, n === target);
      }
    } finally { sim.dispose(); }
  }
});
