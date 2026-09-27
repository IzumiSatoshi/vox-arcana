import { checkPeerTree, validateHostMessage } from './peer-validation.js';
import { askJev, buildJevSpec } from './spellbook.js';
import { requestCachedSpell, spellCacheKey, cachedSpellResult } from './jev-cache.js';
import { readInput } from './generated/p2p-protocol.js';

const peerResult = result => JSON.stringify(result).length <= 48000 ? result : { ...result, raw: undefined };

// A message transport matching the lobby's existing interface. Only room setup
// uses HTTP; match traffic and the host's simulation stay in the two browsers.
export class P2PDuelTransport {
  constructor(game) {
    this.g = game; this.readyState = 0; this.generation = 0; this.requests = new Map(); this.requestId = 0;
    this.pendingSpells = new Map(); this.pollFailures = 0; this.casting = [false, false]; this.lastCast = [0, 0]; this.lastAction = [0, 0];
  }
  get bufferedAmount() { return this.reliable?.bufferedAmount || 0; }
  emit(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  async api(action, extra = {}, credentials = this.credentials) {
    const response = await fetch('/api/p2p', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, ...extra, action }), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || 'Room request failed.');
    return result;
  }
  async connect() {
    if (typeof RTCPeerConnection !== 'function') throw new Error('Online duels require a browser with WebRTC support.');
    const response = await fetch('/api/p2p', { signal: AbortSignal.timeout(10000) });
    const status = await response.json();
    if (!response.ok || !status.available) throw new Error('Connect Redis in Vercel Storage to enable online rooms.');
    if (this.readyState === 3) return;
    this.readyState = 1; this.onopen?.();
    this.emit({ type: 'hello', protocol: 1, region: 'P2P', interpreter: 'jev' });
  }
  send(raw) {
    const message = JSON.parse(raw);
    void this.command(message).catch(error => this.emit({ type: 'error', error: error.message }));
  }
  async command(m) {
    if (m.type === 'list') { this.emit({ type: 'rooms', ...(await this.api('list')) }); return; }
    if (m.type === 'leave') { this.leave(); this.emit({ type: 'left' }); return; }
    if (m.type === 'create' || m.type === 'join') {
      if (this.credentials || this.joining) throw new Error('Leave your current room first.');
      this.joining = true; const generation = this.generation;
      try {
        const result = await this.api(m.type, m);
        if (generation !== this.generation) { void this.api('leave', {}, { code: result.room.code, token: result.token }).catch(() => {}); return; }
        this.credentials = { code: result.room.code, token: result.token }; this.host = result.host;
        this.id = result.id; this.room = result.room; this.room.phase = 'connecting'; this.startedAt = Date.now();
        this.emit({ type: 'hello', protocol: 1, id: this.id, region: 'P2P', interpreter: 'jev' }); this.announce();
        await this.setup(generation);
      } catch (error) { if (generation === this.generation) { this.leave(); this.emit({ type: 'left' }); } throw error; }
      finally { this.joining = false; }
      return;
    }
    if (!this.connected) throw new Error('Still connecting to your opponent.');
    if (this.host) await this.action(0, m); else this.peer(m, m.type === 'input');
  }
  peer(message, fast = false) {
    const channel = fast ? this.fast : this.reliable;
    if (channel?.readyState !== 'open') return;
    if (channel.bufferedAmount > (fast ? 65536 : 262144)) {
      if (!fast) this.fail('Connection is too slow. Please create a new room.');
      return;
    }
    channel.send(JSON.stringify(message));
  }
  announce() { if (this.room) { this.emit({ type: 'room', room: this.room }); if (this.host && this.connected) this.peer({ type: 'room', room: this.room }); } }
  broadcast(message, fast = false) { this.emit(message); this.peer(message, fast); }
  async setup(generation) {
    const ice = await this.api('ice');
    if (generation !== this.generation) return;
    const iceServers = ice.iceServers.map(server => ({ ...server, urls: [server.urls].flat().filter(url => !/:53(?:\?|$)/.test(url)) })).filter(server => server.urls.length);
    this.relayOnly = ice.relayOnly === true;
    const pc = this.pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: this.relayOnly ? 'relay' : 'all' });
    this.turnConfigured = ice.turnConfigured;
    const attach = channel => {
      if (!['reliable', 'state'].includes(channel.label) || this[channel.label === 'state' ? 'fast' : 'reliable']) { channel.close(); return; }
      this[channel.label === 'state' ? 'fast' : 'reliable'] = channel;
      channel.onopen = () => {
        if (generation !== this.generation || this.connected || this.reliable?.readyState !== 'open' || this.fast?.readyState !== 'open') return;
        this.connected = true; clearTimeout(this.pollTimer); clearTimeout(this.connectTimer);
        this.lastPeer = performance.now();
        // The host may connect before its next HTTP poll discovers the guest.
        this.peer({ type: 'connected', id: this.id });
        if (this.host && this.room.players.length === 2) { this.room.phase = 'waiting'; this.announce(); }
        this.heartbeat = setInterval(() => {
          if (performance.now() - this.lastPeer > 12000) { this.fail('Opponent disconnected. The duel has ended.'); return; }
          this.peer({ type: 'ping', at: performance.now() }); void this.route(pc);
          if (this.host) this.peer({ type: 'jevCalls', calls: askJev.calls || 0 });
        }, 2000);
      };
      channel.onmessage = event => {
        if (generation !== this.generation || typeof event.data !== 'string') return;
        if (event.data.length > 65536) { this.fail('Peer message too large.'); return; }
        const now = performance.now();
        if (!this.rateAt || now - this.rateAt > 1000) { this.rateAt = now; this.rateCount = 0; this.rateBytes = 0; }
        this.rateBytes += event.data.length;
        if (++this.rateCount > 150 || this.rateBytes > 512000) { this.fail('Peer message limit exceeded.'); return; }
        this.lastPeer = now;
        try { this.receive(JSON.parse(event.data), channel.label); } catch { this.fail('Invalid peer message.'); }
      };
      channel.onclose = () => { if (generation === this.generation) this.fail('Opponent disconnected. The duel has ended.'); };
    };
    pc.ondatachannel = event => attach(event.channel);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && generation === this.generation) this.fail('Peer connection failed. Check the TURN setup and try again.'); };
    this.connectTimer = setTimeout(() => this.fail(ice.turnConfigured ? 'Connection timed out. Please create a new room.' : 'Connection timed out. This network may need TURN relay configured on the site.'), 15 * 60000);
    if (this.host) {
      attach(pc.createDataChannel('reliable'));
      attach(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
      await pc.setLocalDescription(await pc.createOffer()); await this.publish(pc, generation);
    }
    if (generation === this.generation) void this.poll(generation);
  }
  async publish(pc, generation) {
    if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', change);
        // An unreachable alternate TURN port must not discard usable candidates.
        if (/a=candidate:/.test(pc.localDescription?.sdp || '')) resolve();
        else reject(new Error('Connection setup timed out. Please retry.'));
      }, 12000);
      const change = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', change); resolve(); } };
      pc.addEventListener('icegatheringstatechange', change); change();
    });
    if (generation === this.generation) await this.api('signal', { description: pc.localDescription.toJSON() });
  }
  async poll(generation) {
    try {
      const result = await this.api('poll');
      if (generation !== this.generation) return;
      if (!this.connected) { this.room = result.room; this.room.phase = 'connecting'; this.announce(); }
      else if (this.host && this.room.players.length < 2) { this.room = result.room; this.room.phase = 'waiting'; this.announce(); }
      if (result.description && !this.pc.remoteDescription) {
        clearTimeout(this.connectTimer);
        this.connectTimer = setTimeout(() => this.fail(this.turnConfigured ? 'Connection timed out. Please create a new room.' : 'Connection timed out. This network may need TURN relay configured on the site.'), 45000);
        await this.pc.setRemoteDescription(result.description);
        if (!this.host) { await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.publish(this.pc, generation); }
      }
      this.pollFailures = 0;
    } catch (error) {
      if (generation !== this.generation) return;
      if (++this.pollFailures >= 3 || /expired|closed/.test(error.message)) { this.fail(error.message); return; }
    }
    if (generation === this.generation && !this.connected) this.pollTimer = setTimeout(() => void this.poll(generation), 1500);
  }
  receive(m, channel) {
    checkPeerTree(m);
    if (m.type === 'ping') { this.peer({ type: 'pong', at: m.at }); return; }
    if (m.type === 'pong') { const ping = Math.max(0, Math.round(performance.now() - m.at)); if (Number.isFinite(ping)) this.emit({ type: 'latency', ping, opponentPing: ping }); return; }
    if (m.type === 'leave') { this.fail('Opponent left. The duel has ended.'); return; }
    if (m.type === 'connected') return;
    if (this.host) { if (channel === 'state' && m.type !== 'input') return; void this.action(1, m).catch(error => this.peer({ type: 'castError', error: error.message })); }
    else {
      m = validateHostMessage(m);
      if (['cast','round'].includes(m.type)) {
        const now = performance.now(); this.effectTimes ||= [];
        this.effectTimes = this.effectTimes.filter(t => now - t < 10000);
        if (this.effectTimes.length >= 60) throw new Error('Peer effect limit exceeded');
        this.effectTimes.push(now);
      }
      if (m.type === 'spellResult') { const request = this.requests.get(m.requestId); if (request) { clearTimeout(request.timer); request.resolve(m.result); this.requests.delete(m.requestId); } return; }
      if (!['room','round','state','cast','hit','interpretation','castError','result','matchError','jevCalls'].includes(m.type)) return;
      if (m.type === 'room') { m.room.relayOnly = this.relayOnly; this.room = m.room; }
      // Unordered snapshots must never rewind the displayed simulation.
      if (m.type === 'round') { this.lastStateTime = -1; this.matchId = m.matchId; this.round = m.round; }
      if (m.type === 'state') { if (m.matchId !== this.matchId || m.round < this.round || m.time <= (this.lastStateTime ?? -1)) return; this.lastStateTime = m.time; }
      this.emit(m);
    }
  }
  async route(pc) {
    try {
      const stats = await pc.getStats(); let route = 'Direct';
      for (const report of stats.values()) if (report.type === 'transport' && report.selectedCandidatePairId) {
        const pair = stats.get(report.selectedCandidatePairId);
        if (stats.get(pair?.localCandidateId)?.candidateType === 'relay' || stats.get(pair?.remoteCandidateId)?.candidateType === 'relay') route = 'Relay';
      }
      if (pc === this.pc) this.emit({ type: 'route', route });
    } catch { /* stats can disappear during teardown */ }
  }
  interpret(text, language) {
    if (!this.connected) return Promise.resolve({ ok: false, error: 'Opponent is not connected.' });
    if (this.host) return this.spell(0, text, language);
    const requestId = ++this.requestId;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.requests.delete(requestId); resolve({ ok: false, error: 'Spell request timed out.' }); }, 10000);
      this.requests.set(requestId, { resolve, timer }); this.peer({ type: 'preview', text, language, requestId });
    });
  }
  spell(side, text, language, urgent = false) {
    if (typeof text !== 'string' || !text.trim() || text.length > 600 || typeof language !== 'string' || language.length > 40) return Promise.resolve({ ok: false, error: 'Invalid incantation.' });
    const key = spellCacheKey(text, { language });
    const cached = this.g.jevCache?.get(key);
    if (cached) return Promise.resolve(cachedSpellResult(cached));
    if (this.pendingSpells.has(key)) return this.pendingSpells.get(key);
    this.spellAt ||= [0, 0]; this.spellBusy ||= [0, 0];
    if (this.spellBusy[side] >= (urgent ? 3 : 2) || (!urgent && performance.now() - this.spellAt[side] < 250)) return Promise.resolve({ ok: false, error: 'Please wait for the current spell.', retryable: true });
    this.spellAt[side] = performance.now(); this.spellBusy[side]++;
    const pending = requestCachedSpell(this.g, text, { language, provider: 'jev' }, askJev)
      .finally(() => { this.spellBusy[side]--; this.pendingSpells.delete(key); });
    this.pendingSpells.set(key, pending); return pending;
  }
  async action(side, m) {
    if (m.type === 'ready') {
      if (!['waiting','finished'].includes(this.room.phase)) return;
      this.room.players[side].ready = m.ready === true; this.announce();
      if (this.room.players.length === 2 && this.room.players.every(p => p.ready)) this.start();
      return;
    }
    if (m.type === 'preview') {
      if (!Number.isSafeInteger(m.requestId)) return;
      const generation = this.generation, result = await this.spell(side, m.text, m.language);
      if (generation === this.generation) this.peer({ type: 'spellResult', requestId: m.requestId, result: peerResult(result) });
      return;
    }
    if (m.type === 'input') { this.worker?.postMessage({ type: 'input', side, input: readInput(m) }); return; }
    if (!this.worker || this.room.phase !== 'playing') return;
    if (m.type === 'dash' || m.type === 'bolt') {
      if (performance.now() - this.lastAction[side] < 100) return; this.lastAction[side] = performance.now();
      this.worker.postMessage(m.type === 'dash' ? { type: 'dash', side } : { type: 'cast', side, basic: true }); return;
    }
    if (m.type !== 'cast') return;
    if (this.casting[side] || performance.now() - this.lastCast[side] < 1000) throw new Error('Wait for the current spell.');
    this.casting[side] = true; this.lastCast[side] = performance.now();
    const worker = this.worker, round = this.round, generation = this.generation;
    const aim = m.aim && Number.isFinite(m.aim.yaw) && Number.isFinite(m.aim.pitch) ? { yaw: m.aim.yaw, pitch: Math.max(-1.5, Math.min(1.5, m.aim.pitch)) } : undefined;
    try {
      const result = await this.spell(side, m.text, m.language, true);
      if (this.worker !== worker || generation !== this.generation || round !== this.round || this.room.phase !== 'playing') return;
      const spec = buildJevSpec(m.text, result, {});
      if (!spec || spec.isSpell < 0.65) throw new Error(result.error || 'No spell found in those words.');
      const interpretation = { type: 'interpretation', text: m.text, result: { ...result, raw: undefined } };
      if (side === 0) this.emit(interpretation); else this.peer(interpretation);
      worker.postMessage({ type: 'cast', side, spec, aim });
    } finally { this.casting[side] = false; }
  }
  start() {
    if (Date.now() - this.startedAt > 40 * 60000) { this.fail('Please create a new room to renew the relay connection.'); return; }
    this.matchId = crypto.randomUUID();
    this.worker?.terminate(); this.room.phase = 'starting'; this.announce();
    const worker = this.worker = new Worker(new URL('./generated/p2p-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => this.fail('The host simulation stopped. Please create a new room.');
    worker.onmessage = ({ data: m }) => {
      if (this.worker !== worker) return;
      if (m.type === 'matchError') { this.peer(m); this.fail(m.error); return; }
      if (m.type === 'round') this.round = m.round;
      if (m.type === 'state') this.room.phase = m.phase;
      this.broadcast({ ...m, matchId: this.matchId }, m.type === 'state');
      if (m.type === 'result' && m.finished) {
        worker.terminate(); this.worker = null; this.room.phase = 'finished'; this.room.players.forEach(p => { p.ready = false; }); this.announce();
      }
    };
    const { obstacles, solids, bound } = this.g.world;
    worker.postMessage({ type: 'init', winsToWin: this.room.winsToWin, players: this.room.players.map(p => ({ id: p.id, name: p.name })), collision: { obstacles, solids, bound } });
  }
  leave() {
    const credentials = this.credentials;
    this.peer({ type: 'leave' }); this.generation++; this.credentials = null; this.connected = false;
    clearTimeout(this.pollTimer); clearTimeout(this.connectTimer); clearInterval(this.heartbeat);
    this.worker?.terminate(); this.worker = null; this.pc?.close(); this.pc = null; this.reliable = this.fast = null; this.room = null;
    this.pollFailures = 0;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.resolve({ ok: false, error: 'Room closed.' }); } this.requests.clear();
    if (credentials) void this.api('leave', {}, credentials).catch(() => {});
  }
  fail(error) { this.leave(); this.emit({ type: 'expired', error }); }
  close() { this.leave(); this.readyState = 3; this.onclose?.(); }
}
