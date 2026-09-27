import { randomBytes, createHash } from 'node:crypto';
import { validName, readWinsToWin } from './online/protocol.js';

const TTL = 900;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const token = () => randomBytes(24).toString('hex');
const view = room => ({ code: room.code, public: room.public, winsToWin: readWinsToWin(room.winsToWin), relayOnly: !!room.relayOnly, phase: 'waiting', region: 'P2P', interpreter: 'jev',
  players: [room.host, room.guest].filter(Boolean).map(p => ({ id: p.id, name: p.name, ready: false })) });

export class SignalStore {
  constructor(cache, { hosted = false } = {}) { this.cache = cache; this.hosted = hosted; this.local = new Map(); this.prefix = `vox:p2p:${cache.version}:`; }
  get available() { return this.cache.shared || !this.hosted; }
  async command(command) {
    const result = await this.cache.commands([command]);
    if (!result) throw error('Room storage is unavailable. Please retry shortly.', 503);
    return result[0];
  }
  async get(key) {
    if (this.cache.shared) return await this.command(['GET', this.prefix + key]);
    const row = this.local.get(key);
    if (row && row.until > Date.now()) return row.value;
    this.local.delete(key); return null;
  }
  async cas(key, previous, next) {
    if (this.cache.shared) return await this.command(['EVAL',
      "local old=redis.call('GET',KEYS[1]); if (old or '')~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1", 1,
      this.prefix + key, previous || '', next, TTL]);
    const row = this.local.get(key);
    if ((row && row.until > Date.now() ? row.value : null) !== previous) return 0;
    if (this.local.size > 2000) for (const [id, row] of this.local) if (row.until <= Date.now()) this.local.delete(id);
    if (this.local.size > 2000) throw error('Room service is full. Retry later.', 503);
    this.local.set(key, { value: next, until: Date.now() + TTL * 1000 }); return 1;
  }
  async mutate(key, fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = await this.get(key), value = fn(previous ? JSON.parse(previous) : null);
      if (await this.cas(key, previous, JSON.stringify(value))) return value;
    }
    throw error('Room changed. Please retry.', 409);
  }
  async rate(key, max, seconds = 60) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const count = await this.mutate(`rate:${key}:${bucket}`, old => (old || 0) + 1);
    if (count > max) throw error('Too many requests. Please wait before trying again.', 429);
  }
  async advertise(room) {
    if (this.cache.shared) {
      await this.command(['ZADD', this.prefix + 'public', Date.now() + TTL * 1000, room.code]);
      await this.command(['ZREMRANGEBYSCORE', this.prefix + 'public', '-inf', Date.now()]);
      await this.command(['EXPIRE', this.prefix + 'public', TTL]);
    }
  }
  async unlist(code) { if (this.cache.shared) await this.command(['ZREM', this.prefix + 'public', code]); }
  async list() {
    let rooms;
    if (this.cache.shared) {
      const codes = await this.command(['ZRANGEBYSCORE', this.prefix + 'public', Date.now(), '+inf', 'LIMIT', 0, 50]);
      rooms = codes.length ? (await this.command(['MGET', ...codes.map(code => this.prefix + 'room:' + code)])).map(raw => raw && JSON.parse(raw)) : [];
    } else rooms = [...this.local].filter(([key,row]) => key.startsWith('room:') && row.until > Date.now()).map(([,row]) => JSON.parse(row.value));
    return rooms.filter(room => room && !room.closed && room.public && !room.guest).slice(0,50).map(view);
  }
}

export function createP2PSignaling(cache, { hosted = false, fetcher = (...args) => fetch(...args) } = {}) {
  const store = new SignalStore(cache, { hosted });
  const turnConfigured = () => !!(process.env.TURN_KEY_ID && process.env.TURN_KEY_API_TOKEN);
  const member = (room, supplied) => {
    if (!room || room.closed) throw error('Room has expired or closed.', 404);
    const player = [room.host, room.guest].find(p => p && p.token === supplied);
    if (!player) throw error('Room access denied.', 403);
    return player;
  };
  return {
    status: () => ({ available: store.available, shared: cache.shared, turnConfigured: turnConfigured(), version: cache.version }),
    async act(body) {
      if (!store.available) throw error('Connect Redis in Vercel Storage to enable online rooms.', 503);
      const action = body.action;
      if (action === 'list') return { rooms: await store.list() };
      if (action === 'create') {
        let winsToWin;
        try { winsToWin = readWinsToWin(body.winsToWin); } catch (e) { throw error(e.message); }
        if (typeof body.public !== 'boolean') throw error('Choose Public or Private before creating a room.', 400);
        if (body.relayOnly !== undefined && typeof body.relayOnly !== 'boolean') throw error('Invalid relay selection.');
        if (body.relayOnly && !turnConfigured()) throw error('IP-hidden rooms require TURN relay setup on this site.', 503);
        await store.rate('creates', 60);
        const name = validName(body.name), code = randomBytes(6).toString('hex').toUpperCase();
        const host = { id: randomBytes(12).toString('hex'), token: token(), name };
        const room = await store.mutate('room:' + code, old => { if (old) throw error('Please create another room.', 409); return { code, host, winsToWin, public: body.public === true, relayOnly: body.relayOnly === true }; });
        if (room.public) await store.advertise(room);
        return { room: view(room), id: host.id, token: host.token, host: true };
      }
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!/^[A-F0-9]{12}$/.test(code)) throw error('Invalid room code.');
      const key = 'room:' + code;
      if (action === 'join') {
        await store.rate('joins', 180);
        const name = validName(body.name), guest = { id: randomBytes(12).toString('hex'), token: token(), name };
        const room = await store.mutate(key, old => {
          if (!old || old.closed || old.guest) throw error('Room not found or full.', 404);
          old.guest = guest; return old;
        });
        await store.unlist(code);
        return { room: view(room), id: guest.id, token: guest.token, host: false };
      }
      if (typeof body.token !== 'string' || !/^[a-f0-9]{48}$/.test(body.token)) throw error('Room access denied.', 403);
      const room = JSON.parse(await store.get(key) || 'null'), player = member(room, body.token);
      if (action === 'poll') return { room: view(room), description: player === room.host ? room.answer : room.offer };
      if (action === 'signal') {
        const description = body.description, type = player === room.host ? 'offer' : 'answer';
        if (description?.type !== type || typeof description.sdp !== 'string' || description.sdp.length > 24000) throw error('Invalid connection description.');
        await store.mutate(key, current => { member(current, body.token); if (current[type] && current[type].sdp !== description.sdp) throw error('Connection is already negotiated.', 409); current[type] = { type, sdp: description.sdp }; return current; });
        return {};
      }
      if (action === 'leave') {
        await store.mutate(key, current => { member(current, body.token); current.closed = true; return current; }); await store.unlist(code); return {};
      }
      if (action === 'ice') {
        if (player.ice) return player.ice;
        await store.rate('ice:' + createHash('sha256').update(body.token).digest('hex'), 2, 3600);
        let iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
        if (turnConfigured()) {
          try {
            const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(process.env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
              method: 'POST', headers: { Authorization: `Bearer ${process.env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw new Error('TURN unavailable');
            const result = await response.json();
            const servers = Array.isArray(result.iceServers) ? result.iceServers : [result.iceServers];
            if (!servers.some(server => [server?.urls].flat().some(url => typeof url === 'string' && /^turns?:/.test(url)))) throw new Error('Invalid TURN response');
            iceServers = servers;
          } catch { throw error('TURN credentials could not be generated. Please retry.', 503); }
        }
        if (room.relayOnly && !turnConfigured()) throw error('This room requires TURN relay. Direct fallback is disabled.', 503);
        const ice = { iceServers, turnConfigured: turnConfigured(), relayOnly: !!room.relayOnly };
        await store.mutate(key, current => { member(current, body.token).ice = ice; return current; });
        return ice;
      }
      throw error('Unknown room operation.');
    },
  };
}
