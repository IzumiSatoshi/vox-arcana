import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createApiHandler } from '../api-handler.js';
import { buildJevSpec, buildSpec, localParse } from '../public/js/spellbook.js';
import { PROTOCOL, validName, readInput, readWinsToWin } from './protocol.js';

export async function loadCollision() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./collision-worker.js', import.meta.url), { execArgv: [] });
    worker.once('message', value => { resolve(value); void worker.terminate(); });
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error('Arena preparation failed.')); });
  });
}

export function createDuelServer({ collision, origins = ['http://localhost:8787', 'http://127.0.0.1:8787'],
  region = 'Local', interpreter = 'jev', maxRooms = 8, maxClients = 64, maxConnectionsPerIP = 8, interpret, workerFactory, httpServer, apiHandler } = {}) {
  if (!['jev', 'keywords'].includes(interpreter)) throw new Error('ONLINE_INTERPRETER must be jev or keywords');
  const rooms = new Map(), clients = new Set();
  const api = apiHandler || createApiHandler();
  const interpretSpell = interpret || (body => new Promise((resolve, reject) => {
    api({ url: '/api/spell', method: 'POST', headers: {}, body: { ...body, provider: 'jev' } },
      { writeHead() {}, end(json) { resolve(JSON.parse(json)); } }).catch(reject);
  }));
  const send = (c, data) => {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    if (c.ws.bufferedAmount > 512 * 1024) { c.ws.close(1013, 'Connection too slow'); return; }
    c.ws.send(JSON.stringify(data));
  };
  const roomView = r => ({ code: r.code, public: r.public, winsToWin: r.winsToWin, region, interpreter, phase: r.phase,
    players: r.players.map(c => ({ id: c.id, name: c.name, ready: c.ready, ping: c.ping })) });
  const broadcast = (r, data) => r.players.forEach(c => send(c, data));
  const announce = r => broadcast(r, { type: 'room', room: roomView(r) });
  function stop(r) { const worker = r.worker; r.worker = null; if (worker) void worker.terminate(); }
  function leave(c) {
    const r = c.room; if (!r) return;
    c.room = null; c.ready = false;
    stop(r); r.generation++; r.players = r.players.filter(p => p !== c);
    r.phase = 'waiting'; r.touched = Date.now(); r.players.forEach(p => { p.ready = false; });
    if (!r.players.length) rooms.delete(r.code);
    else { broadcast(r, { type: 'opponentLeft', message: 'Opponent left. The duel has ended.' }); announce(r); }
  }
  function start(r) {
    stop(r); r.phase = 'loading'; r.generation++; const generation = r.generation;
    r.players.forEach(c => { c.ready = false; }); announce(r);
    const data = { winsToWin: r.winsToWin, players: r.players.map(c => ({ id: c.id, name: c.name })), collision };
    const worker = r.worker = workerFactory ? workerFactory(data) : new Worker(new URL('./match-worker.js', import.meta.url), { workerData: data, execArgv: [] });
    let ended = false;
    const fail = () => {
      if (ended || r.worker !== worker) return; ended = true;
      stop(r); r.generation++; r.phase = 'waiting';
      broadcast(r, { type: 'matchError', error: 'The duel server stopped this match. You can ready up again.' }); announce(r);
    };
    worker.on('error', fail); worker.on('exit', fail);
    worker.on('message', event => {
      if (r.worker !== worker || r.generation !== generation) return;
      if (event.type === 'state') r.phase = event.phase;
      if (event.type === 'round') { r.phase = 'countdown'; r.round = event.round; }
      if (event.type === 'castError') { send(r.players[event.side], event); return; }
      broadcast(r, event);
      if (event.type === 'result' && event.finished) { r.phase = 'finished'; r.touched = Date.now(); stop(r); announce(r); }
    });
  }
  let spendWindow = Date.now(), spendCount = 0;
  async function message(c, m) {
    if (m.type === 'list') { send(c, { type: 'rooms', rooms: [...rooms.values()].filter(r => r.public && r.phase === 'waiting' && r.players.length === 1).map(roomView) }); return; }
    if (m.type === 'leave') { leave(c); send(c, { type: 'left' }); return; }
    if (m.type === 'create' || m.type === 'join') {
      if (c.room) throw new Error('Leave the current room first.');
      const name = validName(m.name);
      if (Date.now() - c.lastLobby < 750) throw new Error('Please wait before trying again.');
      c.lastLobby = Date.now();
      let r;
      if (m.type === 'create') {
        if (rooms.size >= maxRooms) throw new Error('All rooms are busy. Please try later.');
        const code = randomBytes(6).toString('hex').toUpperCase();
        r = { code, winsToWin: readWinsToWin(m.winsToWin), public: m.public === true, phase: 'waiting', players: [], touched: Date.now(), generation: 0 };
        rooms.set(code, r);
      } else {
        if (typeof m.code !== 'string') throw new Error('Enter a room code.');
        r = rooms.get(m.code.trim().toUpperCase());
        if (!r || r.players.length >= 2 || r.phase !== 'waiting') throw new Error('Room not found or full.');
      }
      c.name = name; c.room = r; c.ready = false; r.players.push(c); r.touched = Date.now(); announce(r); return;
    }
    const r = c.room; if (!r) throw new Error('Join a room first.');
    const side = r.players.indexOf(c);
    if (m.type === 'ready') {
      if (!['waiting', 'finished'].includes(r.phase)) return;
      c.ready = m.ready === true; announce(r);
      if (r.players.length === 2 && r.players.every(p => p.ready)) start(r);
      return;
    }
    if (m.type === 'input') { const input = readInput(m); r.worker?.postMessage({ type: 'input', side, input }); return; }
    if (!r.worker || r.phase !== 'playing') return;
    if (m.type === 'dash' || m.type === 'bolt') {
      const now = Date.now(); if (now - c.lastAction < 100) return; c.lastAction = now;
      r.worker.postMessage(m.type === 'dash' ? { type: 'dash', side } : { type: 'cast', side, basic: true }); return;
    }
    if (m.type === 'cast') {
      if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 600 || typeof m.language !== 'string' || m.language.length > 40) throw new Error('Invalid incantation.');
      if (c.casting || Date.now() - c.lastCast < 1000) throw new Error('Wait for the current spell.');
      if (Date.now() - spendWindow > 60000) { spendWindow = Date.now(); spendCount = 0; }
      if (++spendCount > 120) throw new Error('Spell service is busy. Please wait.');
      c.casting = true; c.lastCast = Date.now(); const generation = r.generation, worker = r.worker, round = r.round;
      try {
        const text = m.text.trim();
        const result = interpreter === 'jev' ? await interpretSpell({ text, language: m.language }) : null;
        if (c.room !== r || r.generation !== generation || r.worker !== worker || r.round !== round || r.phase !== 'playing') return;
        const spec = result ? buildJevSpec(text, result, {}) : buildSpec(text, localParse(text), null, {});
        if (!spec) { send(c, { type: 'castError', error: result?.error || 'Spell interpretation failed.' }); return; }
        if (spec.isSpell < 0.65) { send(c, { type: 'castError', error: 'No spell found in those words.' }); return; }
        if (result) send(c, { type: 'interpretation', result, text });
        worker.postMessage({ type: 'cast', side, spec });
      } finally { c.casting = false; }
      return;
    }
    throw new Error('Unknown message.');
  }
  const server = httpServer || http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true, protocol: PROTOCOL, region, interpreter, rooms: rooms.size } : { error: 'Not found' }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const ip = req.socket.remoteAddress;
    if (req.url !== '/duel' || !origins.includes(req.headers.origin) || clients.size >= maxClients || [...clients].filter(c => c.ip === ip).length >= maxConnectionsPerIP) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    const c = { ws, ip: req.socket.remoteAddress, id: randomBytes(12).toString('hex'), room: null, ready: false,
      ping: null, lastPong: Date.now(), window: Date.now(), count: 0, lastLobby: 0, lastAction: 0, lastCast: 0 };
    clients.add(c); send(c, { type: 'hello', id: c.id, protocol: PROTOCOL, region, interpreter });
    ws.on('message', (data, binary) => {
      if (Date.now() - c.window >= 1000) { c.window = Date.now(); c.count = 0; }
      if (++c.count > 90 || binary) { ws.close(1008, 'Message limit'); return; }
      let m; try { m = JSON.parse(data.toString()); if (!m || Array.isArray(m) || typeof m.type !== 'string') throw new Error(); }
      catch { ws.close(1008, 'Invalid message'); return; }
      void message(c, m).catch(e => send(c, { type: 'error', error: e.message || 'Request failed.' }));
    });
    ws.on('close', () => { leave(c); clients.delete(c); }); ws.on('error', () => ws.terminate());
    ws.on('pong', nonce => {
      if (c.nonce && nonce.toString() === c.nonce) {
        c.ping = Math.round(performance.now() - c.pingSent); c.lastPong = Date.now(); c.nonce = null;
        send(c, { type: 'latency', ping: c.ping, opponentPing: c.room?.players.find(p => p !== c)?.ping ?? null });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (Date.now() - c.lastPong > 12000) { c.ws.terminate(); continue; }
      if (!c.nonce && c.ws.readyState === WebSocket.OPEN) { c.nonce = randomBytes(8).toString('hex'); c.pingSent = performance.now(); c.ws.ping(c.nonce); }
    }
    for (const r of rooms.values()) if (['waiting', 'finished'].includes(r.phase) && Date.now() - r.touched > 15 * 60000) {
      for (const c of [...r.players]) { send(c, { type: 'expired' }); leave(c); }
    }
  }, 2000);
  heartbeat.unref();
  return { server, rooms, async close() {
    clearInterval(heartbeat); for (const r of rooms.values()) stop(r); for (const c of clients) c.ws.terminate();
    wss.close(); await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Preparing duel arena…');
  const collision = await loadCollision();
  const app = createDuelServer({ collision, origins: (process.env.ONLINE_ORIGINS || 'http://localhost:8787,http://127.0.0.1:8787').split(',').map(s => s.trim()),
    region: process.env.ONLINE_REGION || 'Local', interpreter: process.env.ONLINE_INTERPRETER || 'jev',
    maxConnectionsPerIP: Math.max(1, Math.min(64, Number(process.env.ONLINE_MAX_CONNECTIONS_PER_IP) || 8)),
    maxRooms: Math.max(1, Math.min(32, Number(process.env.ONLINE_MAX_ROOMS) || 8)) });
  app.server.listen(Number(process.env.PORT || 8788), '0.0.0.0', () => console.log(`Duel server ready on port ${app.server.address().port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
