import * as THREE from 'three';
import { Combatant } from './combat.js';
import { SpellSystem } from './spells.js';
import { audio } from './audio.js';
import { getLang } from './i18n.js';
import { duelAim } from './duel-aim.js';
import { P2PDuelTransport } from './p2p.js';
import { lobbyMarkup, updateConnection, renderRooms, renderRoom, invitationCode } from './online-lobby.js';

const $ = id => document.getElementById(id);
const label = (en, ja) => getLang() === 'ja' ? ja : en;
const fields = ['hp', 'maxHp', 'mana', 'maxMana', 'stamina', 'shield', 'shieldTime', 'shieldEl', 'frozen', 'stun', 'defDown', 'mud', 'weaken', 'curse', 'haste', 'flying', 'cloak', 'alive', 'grounded', 'chanting', 'chantText', 'channeling', 'enh', 'aura', 'dots'];
function apply(c, s, position = true) {
  for (const key of fields) if (s[key] != null) c[key] = structuredClone(s[key]);
  c.aura = s.aura; c.shieldEl = s.shieldEl;
  c.vel.fromArray(s.vel); c.yaw = s.yaw; c.pitch = s.pitch;
  if (position) c.pos.fromArray(s.pos);
}

export class OnlineDuel {
  constructor(game) {
    this.g = game; this.seq = 0; this.pending = new Map(); this.phase = 'waiting'; this.samples = [];
    const card = document.createElement('button'); card.className = 'mode-card'; card.type = 'button';
    card.innerHTML = '<span class="mode-icon" aria-hidden="true">◎</span><span class="mode-copy"><small>04 / PvP</small><strong></strong><span></span></span><span class="mode-arrow" aria-hidden="true">↗</span>';
    card.querySelector('strong').textContent = label('Online duel', 'オンライン対戦');
    card.querySelector('.mode-copy > span').textContent = label('Create a room or challenge another player.', 'ルームを作成して、世界のプレイヤーと対戦。');
    card.onclick = () => { if (!game.preparing) void this.open(); };
    document.querySelector('.menu-modes').append(card);
    const panel = document.createElement('div'); panel.id = 'online-lobby'; panel.className = 'screen hidden';
    panel.innerHTML = lobbyMarkup();
    document.body.append(panel);
    const badge = document.createElement('div'); badge.id = 'online-ping'; badge.className = 'hidden'; badge.setAttribute('role', 'status'); document.body.append(badge);
    for (const panel of ['host', 'join']) $('online-show-' + panel).onclick = () => this.showRoomForm(panel);
    $('online-create').onclick = () => {
      if (!$('online-public').checked && !$('online-private').checked) return;
      if (!$('online-wins').reportValidity()) return;
      this.send({ type: 'create', winsToWin: $('online-wins').valueAsNumber, name: $('online-name').value, public: $('online-public').checked, relayOnly: $('online-relay').checked });
    };
    $('online-join').onclick = () => this.send({ type: 'join', name: $('online-name').value, code: invitationCode($('online-code').value) });
    $('online-refresh').onclick = () => this.send({ type: 'list' });
    $('online-ready').onclick = () => {
      void game.enableVoice(); this.send({ type: 'ready', ready: !this.room?.players.find(p => p.id === this.id)?.ready });
    };
    $('online-copy').onclick = async () => {
      const url = new URL(location.href); url.hash = `room=${this.room.code}`;
      try { await navigator.clipboard.writeText(url.href); this.status(label('Invite link copied. Send it to your rival.', '招待リンクをコピーしました。対戦相手に送りましょう。'), 'success'); }
      catch { this.status(url.href); }
    };
    $('online-leave').onclick = () => { this.send({ type: 'leave' }); this.stopMatch(); };
    $('online-back').onclick = () => game.endToMenu();
    $('online-settings').onclick = () => {
      if (this.room?.players.find(p => p.id === this.id)?.ready) this.send({ type: 'ready', ready: false });
      game.openSettings('online-lobby');
    };
    $('online-retry').onclick = () => { this.disconnect(); void this.open(); };
    $('online-code').value = new URLSearchParams(location.hash.slice(1)).get('room') || '';
    try { $('online-name').value = localStorage.getItem('voxarcana-player-name') || 'Mage'; } catch { /* private browsing */ }
    for (const id of ['online-name', 'online-code', 'online-wins']) $(id).addEventListener('input', () => updateConnection(this));
    $('online-code').addEventListener('paste', event => {
      const code = invitationCode(event.clipboardData.getData('text'));
      if (code) { event.preventDefault(); $('online-code').value = code; updateConnection(this); }
    });
    $('online-code').addEventListener('keydown', event => { if (event.key === 'Enter' && !$('online-join').disabled) $('online-join').click(); });
    for (const id of ['online-public', 'online-private']) $(id).onchange = () => {
      updateConnection(this);
      $('online-visibility-note').textContent = $('online-public').checked
        ? label('Visible in open rooms. Anyone can join your challenge.', '公開ルーム一覧に表示され、誰でも参加できます。')
        : label('Hidden from Open rooms. Anyone with your code or invite link can join.', '公開ルーム一覧には表示されません。コードまたは招待リンクを知っている人が参加できます。');
    };
    updateConnection(this);
  }
  showRoomForm(panel) {
    for (const kind of ['host', 'join']) {
      $('online-' + kind + '-form').classList.toggle('hidden', kind !== panel);
      $('online-show-' + kind).setAttribute('aria-expanded', String(kind === panel));
    }
    if (panel === 'join') $('online-code').focus();
    else $('online-public').focus();
  }
  status(text, kind = 'info') { $('online-status').textContent = text; $('online-status').dataset.kind = kind; }
  send(message) {
    if (this.ws?.readyState !== WebSocket.OPEN || this.ws.bufferedAmount >= 65536) return;
    if (['create', 'join'].includes(message.type)) {
      if (this.lobbyBusy) return;
      this.lobbyBusy = true; this.status(''); updateConnection(this);
      try { localStorage.setItem('voxarcana-player-name', message.name); } catch { /* private browsing */ }
      clearTimeout(this.lobbyTimer);
      this.lobbyTimer = setTimeout(() => { this.lobbyBusy = false; updateConnection(this); }, 5000);
    }
    this.ws.send(JSON.stringify(message));
  }
  async open() {
    this.g.backTo = 'menu'; this.g.showScreen('online-lobby');
    if ($('online-code').value.trim() && !this.room) this.showRoomForm('join');
    if (this.ws?.readyState === WebSocket.OPEN) { this.send({ type: 'list' }); return; }
    if (this.connecting) return;
    this.connecting = true; const generation = this.connectionGeneration = (this.connectionGeneration || 0) + 1;
    this.status(''); this.ping = null; updateConnection(this); $('online-retry').classList.add('hidden');
    try {
      const ws = this.ws = new P2PDuelTransport(this.g);
      let connected = false;
      this.timeout = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 10000);
      ws.onmessage = event => {
        if (this.ws !== ws) return;
        try { this.receive(JSON.parse(event.data)); } catch (error) { console.error('Online duel:', error); }
      };
      ws.onopen = () => { connected = true; clearTimeout(this.timeout); this.connecting = false; updateConnection(this); this.send({ type: 'list' }); };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.connecting = false; this.ws = null; clearTimeout(this.timeout); this.room = null; this.lobbyBusy = false; updateConnection(this);
        this.stopMatch(); this.renderRoom(); this.g.showScreen('online-lobby');
        this.status(connected
          ? label('Disconnected. The duel has ended. Reconnect to join a new room.', '接続が切れたため対戦を終了しました。再接続してルームに参加してください。')
          : label('Online duels are unavailable right now. Try reconnecting in a moment.', '現在オンライン対戦に接続できません。少し待ってから再接続してください。'));
        $('online-retry').classList.remove('hidden');
      };
      await ws.connect();
    } catch (error) { if (this.connectionGeneration === generation) { clearTimeout(this.timeout); const failed = this.ws; this.ws = null; failed?.close(); this.connecting = false; updateConnection(this); this.status(error.message, 'error'); $('online-retry').classList.remove('hidden'); } }
  }
  receive(m) {
    if (m.type === 'jevCalls') this.jevCalls = m.calls;
    if (m.type === 'hello') { if (m.protocol !== 1) { this.status('Please refresh: incompatible game version.'); this.disconnect(); return; }
      this.id = m.id; this.region = m.region; this.interpreter = m.interpreter; this.status(''); updateConnection(this); }
    if (m.type === 'route') { this.region = `P2P · ${m.route}`; updateConnection(this); }
    if (m.type === 'latency') {
      this.ping = m.ping; this.opponentPing = m.opponentPing;
      if (Number.isFinite(m.ping)) { this.samples.push(m.ping); if (this.samples.length > 8) this.samples.shift(); }
      const jitter = this.samples.length > 1 ? Math.round(this.samples.slice(1).reduce((n, p, i) => n + Math.abs(p - this.samples[i]), 0) / (this.samples.length - 1)) : 0;
      const text = `${this.region} · ${m.ping == null ? '…' : m.ping + ' ms'} · ${label('Opponent', '相手')} ${m.opponentPing == null ? '…' : m.opponentPing + ' ms'} · ${label('Jitter', '変動')} ${jitter} ms`;
      $('online-ping').textContent = `${this.region} · ${m.ping == null ? '…' : m.ping + ' ms'}`; $('online-ping').title = text; updateConnection(this);
      if (this.room) this.renderRoom();
    }
    if (m.type === 'rooms') renderRooms(this, m.rooms);
    if (m.type === 'room') { if (this.lobbyBusy) this.status(''); this.lobbyBusy = false; clearTimeout(this.lobbyTimer); updateConnection(this); this.room = m.room; this.phase = m.room.phase; this.renderRoom(); }
    if (m.type === 'round') this.startRound(m);
    if (m.type === 'state' && this.active) {
      if (m.phase === 'playing' && this.phase === 'countdown') this.g.hud.banner(label('Duel!', '対戦開始！'), '', 0.8);
      this.phase = m.phase; this.state = m; this.lastStateAt = performance.now();
      this.pending = new Map(m.players.map(p => [p.id, p]));
      if (m.boxes) this.g.world.boxes = m.boxes;
      const side = m.players.findIndex(p => p.id === this.id);
      this.g.hud.round(`${label('Round', 'ラウンド')} ${m.round} · ${label(`First to ${this.room?.winsToWin ?? 2}`, `${this.room?.winsToWin ?? 2}本先取`)} · ${m.score[side]} – ${m.score[1 - side]}${m.phase === 'countdown' ? ' · ' + m.countdown : ''}`);
    }
    if (m.type === 'cast' && this.active) {
      const c = this.proxies.find(p => p.id === m.caster); if (!c) return;
      apply(c, m.player); this.g.spells.cast(m.spec, c);
      const actual = this.g.combatants.find(p => p.id === c.id);
      if (c.id === this.id) {
        this.g.lastEl = m.spec.element; this.g.viewModel.setElement(m.spec.element); this.g.hud.setEl(m.spec.element);
        if (m.spec.basic) { this.g.viewModel.kick = 0; this.g.viewModel.flick = 1; audio.bolt(m.spec.element); }
        else {
          this.g.viewModel.kick = 1; this.g.hud.chant('“' + m.spec.text + '”', '');
          this.g.hud.spellCard(m.spec);
        }
      }
      if (!m.spec.basic && actual) this.g.onCast(actual, m.spec);
    }
    if (m.type === 'hit' && this.active) {
      const target = this.g.combatants.find(c => c.id === m.target), source = this.g.combatants.find(c => c.id === m.source);
      if (target) this.g.onDamage(target, { dmg: m.damage, absorbed: 0, reaction: m.reaction }, new THREE.Vector3().fromArray(m.pos), m.element, { src: source });
    }
    if (m.type === 'interpretation') { this.g.noteJev(m.result); if (m.result.raw) this.g.hud.jevReply(m.result.raw, m.text, false); }
    if (m.type === 'castError' || m.type === 'error') { this.lobbyBusy = false; clearTimeout(this.lobbyTimer); updateConnection(this); this.status(m.error, 'error'); if (this.active) this.g.hud.chant(m.error, 'fizzle'); }
    if (m.type === 'result') {
      this.phase = m.finished ? 'finished' : 'between';
      const side = this.room.players.findIndex(p => p.id === this.id);
      const result = m.winner == null ? label('Draw', '引き分け') : m.winner === side ? label('Victory', '勝利') : label('Defeat', '敗北');
      this.g.hud.banner(result, `${m.score[side]} – ${m.score[1 - side]}`, 4);
      if (m.finished) { this.stopMatch(); this.g.showScreen('online-lobby'); this.status(`${result} · ${label('Ready again for a rematch.', '準備完了で再戦できます。')}`); }
    }
    if (['opponentLeft', 'matchError', 'expired'].includes(m.type)) {
      this.stopMatch(); this.g.showScreen('online-lobby');
      this.status(m.error || label('The duel ended. Ready up with another player.', '対戦を終了しました。別の相手と対戦できます。'));
      if (m.type === 'expired') { this.room = null; this.renderRoom(); }
    }
    if (m.type === 'left') { this.room = null; this.renderRoom(); this.g.showScreen('online-lobby'); this.send({ type: 'list' }); }
  }
  renderRoom() { renderRoom(this); }
  startRound(m) {
    const g = this.g;
    const settingsOpen = !$('settings').classList.contains('hidden');
    if (this.active) { g.spells.clear(); g.fx.clear(); }
    else { g.clearArena(); g.fx.clear(); g.mode = 'online'; g.stats = { dmg: 0 }; g.score = { me: 0, foe: 0 }; }
    this.active = true; this.phase = 'countdown'; this.lastStateAt = performance.now(); this.pending.clear();
    g.hud.clearSpellInfo(); g.hud.preview(null); $('feed').replaceChildren(); g.hud.chant('', '');
    g.hud.jev('on', 'P2P · Jev');
    if (!g.player) {
      const own = m.players.find(p => p.id === this.id); const player = g.createPlayer(); player.id = own.id; player.name = own.name; player.authoritative = false;
      $('self-name').textContent = own.name;
      const other = m.players.find(p => p.id !== this.id);
      g.makeCombatant({ id: other.id, name: other.name, authoritative: false }, { robe: 0x5a1a2a, trim: 0xe0b95a, accent: 0xff4a6a, hat: 0x2a0c18 });
    }
    for (const s of m.players) { const c = g.combatants.find(p => p.id === s.id); c.resetStats(); apply(c, s); if (c.model) c.model.root.visible = true; }
    // Spell effects run against separate replicas. They cannot change actual player state.
    const visual = this.visual = Object.create(g);
    visual.world = Object.assign(Object.create(g.world), { boxes: [] });
    visual.combatants = []; visual.bots = [];
    visual.onDamage = () => {}; visual.onDeath = c => { c.alive = false; };
    this.proxies = m.players.map(s => {
      const c = new Combatant({ id: s.id, name: s.name, authoritative: false, isPlayer: s.id === this.id }); apply(c, s);
      c.castOrigin = () => c.eye(new THREE.Vector3()).addScaledVector(c.forward(new THREE.Vector3()), 0.65);
      c.getAim = () => duelAim(c, visual.world, visual.combatants);
      return c;
    });
    visual.combatants = [...this.proxies]; visual.player = this.proxies.find(p => p.id === this.id);
    g.spells = visual.spells = new SpellSystem(visual);
    g.channel = null; g.grace = null; g.chanting = false; g.roundOver = false;
    g.hud.show(true);
    if (settingsOpen) g.openSettings('pause'); else g.showScreen(null);
    $('online-ping').classList.remove('hidden');
    g.hud.banner(label('Online duel', 'オンライン対戦'), label('Click the arena to capture your mouse · 3', '画面をクリックして操作開始 · 3'), 3);
  }
  canPlay() { return this.active && this.phase === 'playing' && performance.now() - this.lastStateAt < 1000; }
  input(dt, wish) {
    if (!this.active) return;
    const g = this.g, p = g.player;
    this.sendTime = (this.sendTime || 0) + dt;
    if (this.sendTime >= 1 / 30) {
      this.sendTime = 0; const enabled = !g.paused && !g.typing && this.canPlay();
      this.send({ type: 'input', seq: ++this.seq, x: enabled ? wish.x : 0, z: enabled ? wish.z : 0,
        yaw: p.yaw, pitch: p.pitch, jump: enabled && !!g.keys.Space, sprint: enabled && !!g.keys.ShiftLeft,
        descend: enabled && !!(g.keys.ControlLeft || g.keys.KeyC), chanting: enabled && p.alive && !!(g.chanting || g.channel),
        chantText: enabled && p.alive ? (g.chanting ? g.voice.chantText() : g.channel?.text || '').slice(0, 600) : '' });
    }
    for (const c of g.combatants) {
      const s = this.pending.get(c.id); if (!s) continue;
      const own = c === p, yaw = c.yaw, pitch = c.pitch;
      apply(c, s, false); if (own) { c.yaw = yaw; c.pitch = pitch; }
      const target = new THREE.Vector3().fromArray(s.pos);
      if (own && this.canPlay()) target.addScaledVector(c.vel, Math.min(0.1, (this.ping || 0) / 2000));
      if (c.pos.distanceToSquared(target) > 16 || this.phase !== 'playing') c.pos.copy(target);
      else c.pos.lerp(target, Math.min(1, dt * (own ? 8 : 16)));
      if (c.model) c.model.root.visible = c.alive;
      const proxy = this.proxies.find(v => v.id === c.id); if (proxy) apply(proxy, { ...s, pos: c.pos.toArray(), yaw: c.yaw, pitch: c.pitch });
    }
  }
  interpret(text, language) { return this.ws?.interpret(text, language) || Promise.resolve({ ok: false, error: 'Not connected.' }); }
  cast(text, aim) {
    if (!this.canPlay() || this.g.paused) return;
    this.send({ type: 'cast', text, aim: aim || { yaw: this.g.player.yaw, pitch: this.g.player.pitch }, language: this.g.voice.lang || this.g.settings.lang || 'en-US' });
    this.g.hud.chant(label('Interpreting spell…', '魔法を解釈中…'), '');
  }
  stopMatch() {
    if (!this.active) return;
    this.active = false; this.pending.clear(); this.g.clearArena(); this.g.fx.clear(); this.g.world.boxes = [];
    this.g.spells = new SpellSystem(this.g); this.g.startAttract(); this.g.channel = null;
    $('online-ping').classList.add('hidden'); document.exitPointerLock?.();
  }
  disconnect() {
    this.connectionGeneration = (this.connectionGeneration || 0) + 1;
    const ws = this.ws; this.ws = null; this.connecting = false; clearTimeout(this.timeout); ws?.close();
    this.room = null; this.lobbyBusy = false; clearTimeout(this.lobbyTimer); updateConnection(this); this.stopMatch(); this.renderRoom();
  }
}
