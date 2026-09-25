import './style.js'; // global art direction: must patch shader chunks before anything compiles
import * as THREE from 'three';
import { TIME } from './shaders.js';
import { bindVoiceDownload } from './voice-download.js';
import { World } from './world.js';
import { FX } from './fx.js';
import { PostFX } from './postfx.js';
import { SpellSystem } from './spells.js';
import { Combatant, ENHANCE } from './combat.js';
import { MageModel, ViewModel, initViewEnv } from './characters.js';
import { MagicCircle } from './magicCircle.js';
import { BotBrain } from './bot.js';
import { Hud, elChip } from './hud.js';
import { Voice } from './voice.js';
import { voiceChargeFeedback } from './voice-feedback.js';
import { audio } from './audio.js';
import { t, setLang, getLang } from './i18n.js';
import { localParse, askJev, buildSpec, buildJevSpec, boltSpec, finalizeSpec } from './spellbook.js';
import { ELEMENTS, SHAPES, ELEMENT_KEYS, elName, shapeName, reactName } from './elements.js';
import { clamp, rand, TAU } from './util.js';
import { warmSpellShaders } from './warmup.js';

const $ = (id) => document.getElementById(id);
const p0EarthFree = (c) => c.enhP('earth') === null;
const hex = (n) => '#' + new THREE.Color(n).getHexString();

// ------------------------------------------------------------------ settings
const DEFAULTS = { ui: (navigator.language || 'en').startsWith('ja') ? 'ja' : 'en', lang: '', diff: 'normal', quality: 1, sens: 1, chantSize: 26, vol: 0.8, music: 0.175, useJev: true, spellProvider: 'jev', instantCast: false, botJev: true, botVoice: true, handsFree: false, localVoice: false, warmVoice: false, voiceDefaultsVersion: 2 };
function loadSettings() {
  let s;
  try {
    const saved = JSON.parse(localStorage.getItem('voxarcana') || '{}');
    s = { ...DEFAULTS, ...saved };
    // The previous release enabled experimental speech paths for everyone.
    // Migrate once so existing users also return to direct microphone capture.
    if (saved.voiceDefaultsVersion !== 2) { s.localVoice = false; s.warmVoice = false; s.voiceDefaultsVersion = 2; saveSettings(s); }
  } catch { s = { ...DEFAULTS }; }
  if (!s.lang) s.lang = s.ui === 'ja' ? 'ja-JP' : 'en-US';
  return s;
}
function saveSettings(s) { try { localStorage.setItem('voxarcana', JSON.stringify(s)); } catch { /* private mode */ } }

const REACTIONS = [
  ['Frozen', '#9ff0ff', 'Water + Ice: locked in ice. Heavy / earth hits cause Shatter.', '水＋氷：氷漬けにする。岩や重い攻撃で「粉砕」。'],
  ['Vaporize', '#ffc080', 'Fire + Water: ×2 damage.', '炎＋水：ダメージ2倍。'],
  ['Melt', '#ffb070', 'Fire + Ice: ×2 damage.', '炎＋氷：ダメージ2倍。'],
  ['Overload', '#ff7ab8', 'Fire + Lightning: explosion that launches.', '炎＋雷：爆発して吹き飛ばす。'],
  ['Superconduct', '#c6b8ff', 'Ice + Lightning: +40% damage taken.', '氷＋雷：被ダメージ+40%。'],
  ['Electro-Charged', '#d59bff', 'Water + Lightning: shock over time.', '水＋雷：継続感電ダメージ。'],
  ['Swirl', '#7dffd6', 'Wind spreads the aura around.', '風が元素を周囲に拡散。'],
  ['Crystallize', '#ffd46a', 'Earth grants you a shield.', '岩がシールドを生む。'],
  ['Bloom', '#a8ff7a', 'Nature + Water: exploding seeds.', '草＋水：爆発する種を生む。'],
  ['Wildfire', '#ff9a3a', 'Nature + Fire: long burn.', '草＋炎：長時間燃焼。'],
  ['Eclipse', '#fff0ff', 'Light + Darkness: ×3 true damage.', '光＋闇：3倍の貫通ダメージ。'],
  ['Toxic Blaze', '#d6ff4a', 'Poison + Fire: the gas ignites, ×2.2 and a big blast.', '毒＋炎：毒ガスが引火し2.2倍の大爆発。'],
  ['Plague', '#90ff40', 'Poison + Darkness: heavy poison that spreads.', '毒＋闇：広がる猛毒と呪い。'],
  ['Purge', '#ffffe0', 'Poison + Light: strips every buff and status.', '毒＋光：全ての強化と状態を剥がす。'],
  ['Quagmire', '#b09060', 'Water + Earth: mired, 50% slower.', '水＋岩：泥沼で50%減速。'],
  ["Winter's Judgment", '#bff4ff', 'Combo: Water → Ice → Earth.', 'コンボ：水→氷→岩。'],
  ['Worldbreaker', '#ff6040', 'Combo: Darkness → Earth → Fire.', 'コンボ：闇→岩→炎。'],
  ['Plaguebringer', '#d6ff4a', 'Combo: Poison → Wind → Fire.', 'コンボ：毒→風→炎。'],
];

const DUST = new THREE.Color(0xcdbb96);
class Game {
  constructor() {
    this.settings = loadSettings();
    setLang(this.settings.ui);
    this.settings.chantSize = Math.max(20, Math.min(80, Number(this.settings.chantSize) || 26));
    document.documentElement.style.setProperty('--chant-text-size', `${this.settings.chantSize}px`);
    this.mode = 'menu';
    this.combatants = []; this.bots = [];
    this.keys = {}; this.mouse = { dx: 0, dy: 0, lmb: false };
    this.chanting = false; this.chantT = 0; this.chantProgress = 0;
    this.timeScale = 1; this.slowmo = 0; this.jevOnline = false; this.jevFails = 0;
    this.lastEl = 'arcane'; this.boltCd = 0; this.footT = 0; this.channel = null; this.grace = null;
    this.firstPerson = true;
    this.initRenderer();
    this.world = new World(this.scene, this.settings.quality);
    this.fx = new FX(this.scene, this.camera, this.world);
    this.fx.quality = this.settings.quality > 0 ? 1 : 0.55;
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.fx.distortScene, this.settings.quality);
    this.spells = new SpellSystem(this);
    this.audio = audio;
    this.hud = new Hud(this);
    this.hud.buildMinimapBg(this.world);
    this.voice = new Voice();
    initViewEnv(this.renderer);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.group.visible = false;
    this.bindInput(); this.bindMenus(); this.onResize();
    this.checkJev();
    this.startAttract();
    this.clock = new THREE.Clock();
    $('loading').classList.add('hidden');
    this.loop();
    this.shaderWarmup = warmSpellShaders(this); // compiles every spell shader in the background while the menu is up
  }

  // ------------------------------------------------------------ rendering
  initRenderer() {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality > 1 ? 1.5 : this.settings.quality > 0 ? 1.25 : 1));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0; // hue-preserving: keeps the anime palette clean where ACES skews and greys saturated colours
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Spells build fresh materials per cast and dispose them at the end; when the last user of a shader program is
    // disposed, three.js deletes the program and the next cast recompiles it (a 100-500 ms hitch). Leave the first
    // material of each program undisposed so the compiled program stays cached: one small material per shader.
    const pinned = new Set(), dispose = THREE.Material.prototype.dispose;
    THREE.Material.prototype.dispose = function () {
      const key = r.properties.get(this).currentProgram?.cacheKey;
      if (key && !pinned.has(key)) { pinned.add(key); return; }
      dispose.call(this);
    };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.03, 4000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    addEventListener('resize', () => this.onResize());
  }
  onResize() {
    // a hidden/minimised tab reports 0×0: keep a sane size instead of zero-size (incomplete) render targets
    const w = innerWidth || this.lastW || 1280, h = innerHeight || this.lastH || 720; this.lastW = w; this.lastH = h;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, !!innerWidth); this.post?.setSize(w, h); this.stillKey = null;
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.fx.setScale(v.y, this.camera.fov);
  }
  screenFlash(color = '#fff', a = 0.5) { $('screen-flash').style.background = color; this.hud.flash = Math.max(this.hud.flash, a); }

  // ------------------------------------------------------------ Jev status
  async checkJev() {
    try {
      const s = await (await fetch('/api/status')).json();
      this.localStatus = s.local || { phase: 'outdated', error: t('local.restart') };
      this.capabilities = s.capabilities || { localModel: true };
      document.querySelector('#set-provider option[value=local]').disabled = !this.capabilities.localModel;
      $('set-loadmodel').disabled = !this.capabilities.localModel;
      if (!this.capabilities.localModel && this.settings.spellProvider === 'local') {
        this.settings.spellProvider = 'jev'; $('set-provider').value = 'jev'; saveSettings(this.settings);
      }
      this.jevOnline = this.settings.spellProvider === 'local' ? s.local?.phase === 'ready' : !!s.jev.keyLoaded; this.jevModel = this.settings.spellProvider === 'local' ? 'Local MiniLM' : s.jev.model;
      this.serverUp = true;
    } catch { this.jevOnline = false; this.serverUp = false; }
    this.refreshJevLabels();
  }
  refreshJevLabels() {
    if (this.capabilities?.localModel === false) $('local-model-status').textContent = t('local.disabled');
    if (this.settings.spellProvider === 'local') {
      const status = this.serverUp === false ? 'offline' : this.localStatus?.phase || 'unloaded';
      const label = `Local MiniLM · ${status}`;
      this.hud.jev(this.jevOnline ? 'on' : 'off', label);
      $('menu-status').textContent = label;
      $('local-model-status').textContent = this.serverUp === false ? t('jev.offline') : this.localStatus?.error || t(`local.${status}`);
      return;
    }
    this.hud.jev(this.jevOnline ? 'on' : 'off', t(this.serverUp === false ? 'jev.offline' : this.jevOnline ? 'jev.ready' : 'jev.nokey'));
    $('menu-status').innerHTML = this.serverUp === false ? t('menu.noserver') : this.jevOnline ? `${t('menu.jevok')} · <span style="opacity:.7">${this.jevModel}</span>` : t('menu.nokey');
  }
  async loadLocalModel() {
    const button = $('set-loadmodel');
    if (button.disabled) return;
    button.disabled = true;
    $('local-model-status').textContent = t('local.loading');
    let error = null;
    try {
      const response = await fetch('/api/local/load', { method: 'POST' });
      if (response.status === 404) throw new Error(t('local.restart'));
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(t('local.restart'));
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    } catch (e) { error = e.message; }
    finally {
      await this.checkJev();
      button.disabled = false;
      // Status refresh must not erase the error that explains a failed load.
      $('local-model-status').textContent = error || this.localStatus?.error || t(`local.${this.localStatus?.phase || 'unloaded'}`);
    }
  }
  noteJev(j) {
    if (!j) return;
    if (j.ok) { this.jevFails = 0; this.jevOnline = true; this.hud.jev('on', `${j.provider === 'local' ? 'MiniLM' : 'Jev'} · ${j.cached ? 'cached' : j.latency + 'ms'}`); }
    else { this.jevFails++; this.hud.jev('off', t('jev.err')); if (this.jevFails >= 3) this.jevOnline = false; console.warn('Jev:', j.error); }
  }

  // ------------------------------------------------------------ combatants
  makeCombatant(opts, colors) {
    const c = new Combatant(opts);
    if (colors) {
      c.model = new MageModel(colors); this.scene.add(c.model.root);
      c.castOrigin = () => c.model.handWorld(c._ho || (c._ho = new THREE.Vector3()));
    }
    this.combatants.push(c);
    return c;
  }
  removeCombatant(c) {
    const i = this.combatants.indexOf(c); if (i >= 0) this.combatants.splice(i, 1);
    if (c.model) this.scene.remove(c.model.root);
  }
  clearArena() {
    this.voice?.cancelChant(); this.grace = null; this.chanting = false;
    audio.chantStop();
    this.spells.clear();
    for (const c of [...this.combatants]) this.removeCombatant(c);
    this.bots = []; this.player = null;
    speechSynthesis?.cancel();
  }
  spawnAt(c, angle, r = 26) {
    c.pos.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    c.pos.y = this.world.heightAt(c.pos.x, c.pos.z) + 0.1;
    c.yaw = Math.atan2(c.pos.x, c.pos.z);
    c.pitch = 0; c.resetStats();
    if (c.model) c.model.root.visible = true;
  }
  createPlayer() {
    const p = (this.player = this.makeCombatant({ id: 'me', name: t('you'), isPlayer: true }));
    p.castOrigin = () => this.viewModel.tipWorld(p._ho || (p._ho = new THREE.Vector3()));
    this.playerAim = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), point: new THREE.Vector3() };
    p.getAim = () => this.playerAim;
    $('self-name').textContent = p.name;
    this.viewModel.group.visible = true;
    return p;
  }
  createBot(name, diff, dummy = false, colors = { robe: 0x5a1a2a, trim: 0xe0b95a, accent: 0xff4a6a, hat: 0x2a0c18 }) {
    const b = this.makeCombatant({ id: 'bot' + this.bots.length, name }, colors);
    b.brain = new BotBrain(this, b, diff, dummy);
    this.bots.push(b);
    return b;
  }
  focusEnemy() {
    if (!this.player) return null;
    const others = this.combatants.filter((c) => c !== this.player && c.alive);
    if (!others.length) return null;
    const f = this.camera.getWorldDirection(new THREE.Vector3());
    let best = null, bs = -Infinity;
    for (const o of others) { const d = o.center().sub(this.camera.position); const s = d.normalize().dot(f) * 2 - d.length() * 0.01; if (s > bs) { bs = s; best = o; } }
    return best;
  }

  // ------------------------------------------------------------ modes
  startAttract() {
    this.clearArena();
    this.mode = 'menu';
    const a = this.createBot('Vel', 'normal', false, { robe: 0x1f2f6a, trim: 0xe0b95a, accent: 0x6fd8ff, hat: 0x141a3a });
    const b = this.createBot('Rhea', 'normal', false);
    this.spawnAt(a, 0.3, 16); this.spawnAt(b, 0.3 + Math.PI, 16);
    this.viewModel.group.visible = false;
    this.hud.show(false);
  }
  startMode(mode) {
    audio.init();
    this.clearArena();
    this.mode = mode;
    this.hud.clearSpellInfo?.();
    const p = this.createPlayer();
    this.spawnAt(p, Math.PI * 0.5);
    this.score = { me: 0, foe: 0 }; this.roundOver = false;
    if (mode === 'duel') {
      const d = this.settings.diff;
      const b = this.createBot(t(d === 'hard' ? 'bot.hard' : d === 'easy' ? 'bot.easy' : 'bot.rival'), d);
      this.spawnAt(b, Math.PI * 1.5);
      this.hud.round(t('round', { n: 1, a: 0, b: 0 }));
      this.hud.banner(t('ban.duel'), t('ban.duel2'), 2.5);
    } else if (mode === 'practice') {
      const d = this.createBot(t('bot.golem'), 'easy', true, { robe: 0x5a5a4a, trim: 0xb8a67e, accent: 0x7dffc8, hat: 0x3a3a30 });
      this.spawnAt(d, Math.PI * 1.5, 14);
      this.hud.round(t('round.train'));
      this.hud.banner(t('ban.train'), t('ban.train2'), 2.5);
    }
    this.hud.show(true); this.hud.setEl('arcane'); this.viewModel.setElement('arcane');
    this.hud.hint('hint.chant'); this.hud.chant('', ''); this.hud.preview(null);
    this.showScreen(null);
    // Match entry is a user gesture, so request microphone access here for both modes.
    void this.enableVoice();
    this.lock();
  }
  endToMenu() {
    document.exitPointerLock?.();
    this.startAttract();
    this.keys = {}; this.mouse.lmb = false; this.typing = false; this.backTo = null;
    $('type-box').classList.add('hidden');
    this.showScreen('menu');
    document.querySelector('#menu .mode-card')?.focus();
  }
  showScreen(id) {
    if (id === 'menu') void this.refreshVoiceDownload?.();
    for (const s of ['menu', 'settings', 'howto', 'pause', 'duel-setup']) $(s).classList.toggle('hidden', s !== id);
    this.paused = id === 'pause' || ((id === 'settings' || id === 'howto') && this.mode !== 'menu');
    this.voice.setActive(this.mode !== 'menu' && !this.paused);
    if (this.paused || this.mode === 'menu') {
      this.pendingJevCast = null;
      this.grace = null; this.chanting = false;
      if (this.player) this.player.chanting = false;
      audio.chantStop();
    }
  }
  lock() { $('c').requestPointerLock?.()?.catch?.(() => {}); }

  // ------------------------------------------------------------ voice & casting
  async initVoice() {
    if (this.voiceInit) return; this.voiceInit = true;
    this.voice.lang = this.settings.lang; this.voice.handsFree = this.settings.handsFree;
    this.voice.preferLocal = this.settings.localVoice; this.voice.prewarm = this.settings.warmVoice;
    this.voice.onText = () => {
      if (this.paused || this.mode === 'menu') return;
      // Submit directly from recognition events; rendering must not drop revisions.
      if (this.chanting || this.grace) this.speculate(this.voice.chantText() || this.voice.textOf(this.grace?.win));
      if (this.grace) this.resolveVoiceGrace();
    };
    this.voice.onStatus = (s) => {
      if (s === 'mic-denied' || s.startsWith('error:')) $('menu-mic-message').textContent = t('menu.mic.failed');
      this.hud.micState(s === 'listening' || s === 'ready');
      if (s === 'listening' && this.hintErr) { this.hintErr = false; this.hud.hint('hint.chant'); }
      if (s === 'unsupported') this.hud.hint('hint.noSR');
      else if (s === 'mic-denied' || s === 'error:not-allowed' || s === 'error:audio-capture') this.hud.hint('hint.mic');
      else if (s.startsWith('error:network')) { this.hud.hint('hint.net'); this.hintErr = true; }
    };
    this.voice.onAuto = (text) => {
      if (this.mode === 'menu' || this.paused || this.chanting || this.channel || (!this.settings.useJev && localParse(text).isSpell < 1)) return;
      void this.castIncantation(text, { chantSeconds: text.length / 12, loudness: this.voice.level }, null);
    };
    this.voice.setActive(this.mode !== 'menu' && !this.paused);
    await this.voice.init(audio.ctx);
  }
  enableVoice() {
    if (this.voiceEnablePromise) return this.voiceEnablePromise;
    const button = $('menu-enable-voice');
    button.disabled = true;
    this.voiceEnablePromise = (async () => {
      let ready = false;
      try {
        audio.init();
        await this.initVoice();
        ready = !!this.voice.supported && !!this.voice.stream?.getAudioTracks().some(track => track.readyState === 'live');
      } catch { /* Permission denial and unavailable devices use the typed casting fallback. */ }
      if (!ready) {
        this.voice.dispose(); this.voiceInit = false;
        if (this.mode !== 'menu') this.hud.hint(this.voice.supported ? 'hint.mic' : 'hint.noSR');
      }
      button.hidden = ready; $('menu-disable-voice').hidden = !ready;
      $('menu-mic-badge').textContent = ready ? 'ON' : 'OFF';
      $('menu-mic-badge').classList.toggle('ready', ready);
      $('menu-mic-message').textContent = t(ready ? 'menu.mic.ready' : 'menu.mic.failed');
      return ready;
    })().finally(() => { button.disabled = false; this.voiceEnablePromise = null; });
    return this.voiceEnablePromise;
  }
  beginChant() {
    const p = this.player;
    if (!p || !p.canAct() || this.chanting || this.channel || this.paused) return;
    this.pendingJevCast = null;
    this.grace = null; // a new chant always wins over a pending empty one
    this.chanting = true; this.chantT = 0; p.chanting = true;
    this.spec = { map: new Map(), pending: new Map(), latest: null, latestMagic: null, order: 0, lastText: '', lastSend: 0, inflight: 0 };
    this.voice.beginChant();
    this.chantParticles = 0;
    audio.chantStart(this.lastEl);
    this.hud.chant('', ''); this.hud.preview(null);
  }
  // speculative Jev: interpret the chant while it is still being spoken
  speculate(text) {
    const S = this.spec;
    if (!S || S.closed || !text || !this.settings.useJev) return;
    const now = performance.now();
    if (text === S.lastText) return;
    if (!this.settings.instantCast && (now - S.lastSend < 160 || S.inflight >= 3)) return;
    S.lastText = text; S.lastSend = now; S.inflight++;
    const order = ++S.order;
    const promise = askJev(text, { provider: this.settings.spellProvider, language: this.voice.lang || this.settings.lang, chantSeconds: this.chantT, loudness: this.voice.peak });
    S.pending.set(text, promise);
    promise.then((j) => {
      S.inflight--;
      if (this.spec !== S || S.closed || this.paused || this.mode === 'menu') return;
      this.noteJev(j);
      if (!j.ok) return;
      S.map.set(text, j);
      if (j.raw && (!S.displayOrder || order > S.displayOrder)) {
        S.displayOrder = order;
        this.hud.jevReply?.(j.raw, text, this.mode === 'practice');
      }
      if (!S.latest || order > S.latest.order) S.latest = { order, text, j };
      if (j.params?.isSpell >= 0.65 && (!S.latestMagic || order > S.latestMagic.order)) S.latestMagic = { order, text, j };
      if (this.grace && this.settings.instantCast) this.resolveVoiceGrace();
    });
  }
  bestJev(text) {
    const S = this.spec; if (!S) return null;
    if (S.map.has(text)) return S.map.get(text);
    return null; // Never apply an interpretation of different words.
  }
  readyToInterpret(text, win) {
    if (!text) return false;
    if (!this.settings.useJev) return localParse(text).isSpell >= 0.65;
    const parts = win?.chunks?.flat().filter(p => p.text) || [];
    const j = this.bestJev(text);
    return (j?.ok && j.params?.isSpell >= 0.65) || (parts.length > 0 && parts.every(p => p.final));
  }
  endChant() {
    if (!this.chanting) return;
    this.chanting = false; this.player.chanting = false; audio.chantStop();
    if (!this.voice.rec) { this.voice.cancelChant(); this.hud.chant(t('chant.nomic'), 'fizzle'); return; }
    const text = this.voice.chantText();
    this.speculate(text);
    const magic = this.settings.useJev && this.settings.instantCast && this.spec?.latestMagic;
    if (magic) {
      const res = this.voice.endChant(); this.voice.finishChant(res.win); this.spec.closed = true;
      void this.castIncantation(magic.text, res, magic.j); return;
    }
    const ready = this.readyToInterpret(text, this.voice.win);
    const res = this.voice.endChant({ waitForWords: !ready });
    if (ready) { this.castIncantation(res.text, res, this.bestJev(res.text)); return; }
    // Missing or incomplete words: allow delayed spell words (a new press cancels instantly).
    this.grace = { win: res.win, meta: res, until: performance.now() + 1800 };
  }
  resolveVoiceGrace() {
    const g = this.grace;
    if (!g) return;
    const magic = this.settings.useJev && this.settings.instantCast && this.spec?.latestMagic;
    if (magic && !g.win?.closed) {
      this.grace = null; this.voice.finishChant(g.win); this.spec.closed = true;
      void this.castIncantation(magic.text, g.meta, magic.j); return;
    }
    const text = this.voice.textOf(g.win);
    const ended = g.win?.ended || performance.now() > g.until;
    if (g.win?.closed || (ended && !text)) {
      this.voice.finishChant(g.win); this.grace = null;
      this.hud.chant(t('chant.silence'), 'fizzle'); this.hud.preview(null); this.previewCost = 0;
    } else if (text && (this.readyToInterpret(text, g.win) || ended)) {
      this.grace = null; this.voice.finishChant(g.win);
      this.castIncantation(text, g.meta, this.bestJev(text));
    }
  }
  async castIncantation(text, meta, jev) {
    const p = this.player; if (!p || !p.alive) return;
    if (this.spec) this.spec.closed = true;
    let spec;
    if (this.settings.useJev) {
      const token = this.pendingJevCast = {}, mode = this.mode;
      this.previewCost = 0; this.hud.preview(null);
      this.hud.chant(t('chant.jevwait'), '');
      const j = jev?.ok && !jev.partial ? jev : await (jev?.then ? jev : this.spec?.pending?.get(text) || askJev(text, { ...meta, provider: this.settings.spellProvider, language: this.voice.lang || this.settings.lang }));
      if (this.pendingJevCast !== token || this.player !== p || !p.alive || this.paused || this.mode !== mode || this.mode === 'menu' || !this.settings.useJev) return;
      this.pendingJevCast = null; this.noteJev(j);
      if (j.raw) this.hud.jevReply?.(j.raw, text, this.mode === 'practice');
      spec = buildJevSpec(text, j, meta);
      if (!spec) {
        this.voice.finishMetric(meta.win, 'jev-error'); this.hud.chant(t('chant.jeverror'), 'fizzle'); audio.ui('fizzle'); return;
      }
    } else spec = buildSpec(text, localParse(text), null, meta);
    this.previewCost = 0;
    if (spec.isSpell < 0.65) { this.voice.finishMetric(meta.win, 'no-magic'); this.hud.chant('“' + text + '” ' + t('chant.nomagic'), 'fizzle'); audio.ui('fizzle'); this.hud.preview(null); return; }
    if (p.canAct()) this.voice.markCast(meta.win);
    else this.voice.finishMetric(meta.win, 'interrupted');
    this.performCast(spec, true);
  }
  performCast(spec, addToGrimoire) {
    const p = this.player;
    if (!p.canAct()) { this.hud.chant(t('chant.interrupted'), 'fizzle'); audio.ui('fizzle'); return; }
    spec = { ...spec, cost: Math.round(spec.cost * p.costMult()) };
    if (p.mana < spec.cost) {
      this.previewCost = 0; this.hud.preview(null);
      this.hud.chant(t('feed.starved'), 'fizzle'); audio.ui('fizzle');
      return;
    } else p.mana -= spec.cost;
    this.previewCost = 0;
    this.lastEl = spec.element; this.viewModel.setElement(spec.element); this.hud.setEl(spec.element);
    this.spells.cast(spec, p);
    this.viewModel.kick = 1;
    this.hud.chant('“' + spec.text + '”', '');
    this.hud.preview(null);
    this.hud.spellCard(spec);
    this.onCast(p, spec);
    if (spec.tierInt >= 8) { this.slowmo = 0.35; this.screenFlash(hex(ELEMENTS[spec.element].color), 0.12); }
  }
  typedCast(text) {
    const units = /[぀-ヿ一-龯]/.test(text) ? text.length / 3 : text.trim().split(/\s+/).length;
    const dur = Math.min(3.5, 0.3 + units * 0.16);
    const ch = (this.channel = { t: 0, dur, text, typed: true, jev: null });
    this.pendingJevCast = null;
    if (this.settings.useJev) ch.jev = askJev(text, { provider: this.settings.spellProvider, language: this.voice.lang || this.settings.lang, chantSeconds: dur, loudness: 0.4 });
    audio.chantStart(this.settings.useJev ? 'arcane' : localParse(text).element);
    const pv = this.settings.useJev ? null : finalizeSpec({ ...localParse(text), text });
    this.hud.preview(pv); this.previewCost = pv?.cost || 0; this.hud.chant('“' + text + '”', '');
  }
  fireBolt() {
    const p = this.player;
    if (!p || !p.canAct() || this.boltCd > 0 || p.mana < 3 || this.chanting) return;
    this.boltCd = p.enhP('lightning') !== null ? 0.18 : 0.28; p.mana -= 3;
    const spec = boltSpec(this.lastEl);
    this.spells.cast(spec, p);
    this.viewModel.flick = 1;
    audio.cast(this.lastEl, 0.1, null);
  }

  // ------------------------------------------------------------ combat hooks
  whoName(c) { return c === this.player ? `<b>${t('you')}</b>` : c.name; }
  onCast(c, spec) {
    const col = hex(ELEMENTS[spec.element].color);
    this.hud.feed(t('feed.cast', { who: this.whoName(c), spell: `<b style="color:${col}">${spec.name}</b>` }) + ` <span style="opacity:.6">(${shapeName(spec.shape)} · ${t('rank')} ${spec.tierInt})</span>`);
    if (c !== this.player && this.hud.cardTimer < 3 && !spec.basic) this.hud.spellCard(spec, c.name);
  }
  onDamage(target, res, pos, el, hit) {
    if (res.dmg < 0.5 && !res.reaction) return;
    this.hud.damage(pos, res.dmg, el, res.reaction);
    if (target === this.player) {
      this.hud.hurt = Math.min(0.8, this.hud.hurt + res.dmg / 150); audio.hurt(); this.fx.addShake(Math.min(0.5, res.dmg / 200));
      if (this.chanting && res.dmg > 60 && p0EarthFree(target) && Math.random() < 0.5) { this.voice.cancelChant(); this.chanting = false; this.player.chanting = false; audio.chantStop(); this.hud.chant(t('chant.broken'), 'fizzle'); }
    }
    if (hit.src === this.player && target !== this.player) { this.hud.hitm = 1; audio.hitmarker(); }
    if (target.brain?.chant && res.dmg > 70 && Math.random() < 0.4) target.brain.cancelChant();
  }
  // Ultimate domain: sky, sunlight, fog and grade shift to the element for a few seconds; a colossal sigil opens overhead.
  domain(el, pal, pos) {
    const W = this.world, fx = this.fx;
    W.skyU.uDomCol.value.copy(pal.color);
    const sky = new MagicCircle({ seed: 99, tier: 9, color: pal.color, radius: 42, intensity: 1.4 });
    sky.group.rotation.x = Math.PI / 2; sky.group.position.set(pos.x, pos.y + 45, pos.z); sky.spin = 0.25; this.scene.add(sky.group);
    const base = (W.base ||= { fog: this.scene.fog.color.clone(), sun: W.sun.intensity, hemi: W.hemi.intensity }); // first call, so overlapping domains can't bake in a tint
    const fog0 = base.fog, sun0 = base.sun, hemi0 = base.hemi;
    let t = 0; const life = 3.2;
    this.domainT = life;
    fx.add((dt) => {
      t += dt; const k = Math.min(1, t / 0.4) * Math.max(0, 1 - Math.max(0, t - life + 1) / 1);
      W.skyU.uDom.value = k;
      W.sun.intensity = sun0 * (1 - 0.6 * k); W.hemi.intensity = hemi0 * (1 - 0.3 * k);
      this.scene.fog.color.copy(fog0).lerp(pal.color.clone().multiplyScalar(0.35), k * 0.7); this.scene.background.copy(this.scene.fog.color);
      this.post.uniforms.uTint.value.set(1 + (pal.color.r - 0.5) * 0.25 * k, 1 + (pal.color.g - 0.5) * 0.25 * k, 1 + (pal.color.b - 0.5) * 0.25 * k);
      sky.target = k; sky.update(dt);
      for (let i = 0; i < 6; i++) { const a = Math.random() * TAU, d = 10 + Math.random() * 50; fx.glow.emit({ x: pos.x + Math.cos(a) * d, y: this.world.heightAt(pos.x + Math.cos(a) * d, pos.z + Math.sin(a) * d), z: pos.z + Math.sin(a) * d, vy: 8 + Math.random() * 10, life: 2, size: 0.3, size1: 0.05, color: pal.core, alpha: k, drag: 0.1, frame: 1 }); }
      if (t > life) { W.skyU.uDom.value = 0; W.sun.intensity = sun0; W.hemi.intensity = hemi0; this.scene.fog.color.copy(fog0); this.scene.background.copy(fog0); sky.dispose(); return false; }
      return true;
    });
  }
  onCombo(target, combo) {
    this.hud.banner(reactName(combo.name), '', 1.6);
    this.hud.feed(`<b style="color:${combo.color}">✦ ${reactName(combo.name)}</b>`);
    audio.ui('victory');
  }
  onEnhance(c, els, dur) {
    if (c !== this.player) return;
    this.hud.feed(els.map((e) => `<b style="color:${hex(ELEMENTS[e].color)}">${getLang() === 'ja' ? ENHANCE[e].ja : ENHANCE[e].name}</b>`).join(' + ') + ` · ${Math.round(dur)}s`);
  }
  chantAura(dt, pv, el) {
    const A = (this.aura ||= { lvl: -1, circles: [], k: 0 });
    const lvl = pv ? pv.level : -1, p = this.player;
    if (lvl !== A.lvl) {
      if (lvl > A.lvl && lvl >= 2) { audio.ui('weave'); this.fx.shockwave(p.center(), 4 + lvl * 2, 0.8, 0.4); if (lvl === 3) { this.screenFlash('#ffffff', 0.15); audio.cast('light', 1, p.pos); } }
      A.circles.forEach((c) => c.dispose()); A.circles = [];
      if (lvl >= 1) for (let i = 0; i < lvl; i++) {
        const mc = new MagicCircle({ seed: 5 + i * 11, tier: pv.tierInt, color: ELEMENTS[el].color, radius: 1.1 + i * 0.9 + (lvl === 3 ? 0.8 : 0), intensity: 1.3 });
        mc.group.rotation.x = -Math.PI / 2; mc.spin = (i % 2 ? -1 : 1) * (0.6 + i * 0.3); this.scene.add(mc.group); A.circles.push(mc);
      }
      A.lvl = lvl;
    }
    A.circles.forEach((mc, i) => {
      mc.target = pv ? 0.9 : 0; mc.update(dt);
      mc.group.position.set(p.pos.x, p.pos.y + 0.08 + i * 0.04, p.pos.z);
      if (el) mc.setColor(ELEMENTS[el].color, 1.3);
    });
    if (pv && lvl >= 2) {
      const col = new THREE.Color(ELEMENTS[el].color);
      for (let i = 0; i < lvl * 2; i++) { const a = Math.random() * TAU, d = 1 + Math.random() * (lvl * 1.2); this.fx.glow.emit({ x: p.pos.x + Math.cos(a) * d, y: p.pos.y + 0.1, z: p.pos.z + Math.sin(a) * d, vy: 1.5 + lvl, life: 1.2, size: 0.12, color: col, alpha: 0.9, drag: 0.2, frame: 1 }); }
      if (lvl === 3) this.fx.addShake(0.01);
    }
    document.body.classList.toggle('overcharge', !!pv && lvl === 3);
  }
  onVisualHit(target, hit) { if (hit.src === this.player) this.hud.hitm = 0.6; }
  onHeal(c, n) { if (n > 1) this.hud.popup(c.center().add(new THREE.Vector3(0, 1, 0)), '+' + Math.round(n), 'heal', '#9dff9a'); }
  onShield(c) { this.hud.popup(c.center().add(new THREE.Vector3(0, 1.2, 0)), t('st.shield'), 'react', '#ffd46a'); }
  onBotChant(c, text, onFinish) {
    if (this.mode === 'menu' || !this.settings.botVoice || !window.speechSynthesis) return;
    const ja = getLang() === 'ja';
    const u = new SpeechSynthesisUtterance(text);
    u.lang = ja ? 'ja-JP' : 'en-US'; u.pitch = ja ? 0.8 : 0.6; u.rate = ja ? 1.1 : 1.05; u.volume = 0.9 * this.settings.vol;
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(ja ? 'ja' : 'en'));
    const pref = ja ? vs.find((v) => /Google|Ichiro|Keita/i.test(v.name)) || vs[0] : vs.find((v) => /Google UK English Male|Daniel|David|Mark/i.test(v.name)) || vs[0];
    if (pref) u.voice = pref;
    // Keep the bot charging until playback ends, including time in the speech queue.
    u.onend = u.onerror = () => { onFinish?.(); };
    try {
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      return true;
    } catch {
      onFinish?.();
      return false;
    }
  }
  onBotChantCancel() { if (this.mode !== 'menu') window.speechSynthesis?.cancel(); }
  onDeath(target, killer) {
    if (!target.alive) return;
    target.alive = false; target.deaths++; if (killer && killer !== target) killer.kills++;
    target.chanting = false;
    const c = target.center();
    this.fx.explosion('arcane', c, 3, 1, null, {});
    if (target.model) target.model.root.visible = false;
    for (let i = 0; i < 60; i++) this.fx.glow.emit({ x: c.x, y: c.y, z: c.z, vx: rand(-3, 3), vy: rand(1, 7), vz: rand(-3, 3), life: rand(1, 2.5), size: 0.3, color: new THREE.Color(0xffe6a0), alpha: 1, drag: 1, grav: -1, frame: 1 });
    this.hud.feed(`<span style="color:#ff9a8a">${t('feed.fell', { who: target === this.player ? t('you') : target.name })}${killer && killer !== target ? t('feed.to', { who: killer === this.player ? t('you') : killer.name }) : ''}</span>`);
    if (target === this.player && this.chanting) { this.chanting = false; audio.chantStop(); this.voice.cancelChant(); }
    if (this.mode === 'duel' && !this.roundOver) {
      this.roundOver = true; this.slowmo = 1.2;
      const won = target !== this.player;
      won ? this.score.me++ : this.score.foe++;
      const matchOver = this.score.me >= 2 || this.score.foe >= 2;
      audio.ui(won ? 'victory' : 'defeat');
      this.hud.banner(t(won ? (matchOver ? 'ban.win' : 'ban.rwin') : matchOver ? 'ban.lose' : 'ban.rlose'), `${this.score.me} – ${this.score.foe}`, 4);
      setTimeout(() => {
        if (this.mode !== 'duel') return;
        if (matchOver) { this.hud.banner(t(won ? 'ban.win' : 'ban.lose'), t('ban.next'), 4); this.score = { me: 0, foe: 0 }; }
        this.spells.clear();
        this.spawnAt(this.player, Math.PI * 0.5); this.bots.forEach((b) => this.spawnAt(b, Math.PI * 1.5));
        this.roundOver = false;
        this.hud.round(t('round', { n: this.score.me + this.score.foe + 1, a: this.score.me, b: this.score.foe }));
      }, 4500);
    } else if (this.mode === 'practice' && target !== this.player) {
      setTimeout(() => { if (this.mode === 'practice' && this.combatants.includes(target)) this.spawnAt(target, rand(0, TAU), 14); }, 2000);
    } else if (this.mode === 'practice' && target === this.player) {
      setTimeout(() => this.player && this.spawnAt(this.player, Math.PI * 0.5), 2500);
    } else if (this.mode === 'menu') {
      setTimeout(() => { if (this.mode === 'menu' && this.combatants.includes(target)) this.spawnAt(target, rand(0, TAU), 16); }, 2500);
    }
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const canvas = $('c');
    addEventListener('keydown', (e) => {
      if (this.typing) {
        if (e.code === 'Enter' && !e.isComposing) { const tx = $('type-input').value.trim(); this.closeTyping(); if (tx) this.typedCast(tx); }
        else if (e.code === 'Escape') this.closeTyping();
        return;
      }
      if (this.mode === 'menu') return;
      this.keys[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'KeyF' || e.code === 'KeyV') this.beginChant();
      if (e.code === 'Enter') { e.preventDefault(); this.openTyping(); }
      if (e.code === 'KeyE') this.dashPlayer();
      if (e.code === 'KeyJ') this.hud.toggleJevView();
      if (e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'KeyF' || e.code === 'KeyV') this.endChant();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.mode === 'menu') return;
      if (document.pointerLockElement !== canvas) { this.lock(); return; }
      if (e.button === 0) this.mouse.lmb = true;
      if (e.button === 2) this.beginChant();
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.lmb = false; if (e.button === 2) this.endChant(); });
    addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { if (this.mode !== 'menu' && this.hud.scrollJev(e.deltaY * (e.deltaMode === 1 ? 18 : 1))) e.preventDefault(); }, { passive: false });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.mode !== 'menu' && !this.typing && !this.paused) {
        if (this.chanting) this.endChant();
        this.showScreen('pause');
      }
    });
  }
  openTyping() { this.typing = true; $('type-box').classList.remove('hidden'); const i = $('type-input'); i.value = ''; setTimeout(() => i.focus(), 0); this.keys = {}; }
  closeTyping() { this.typing = false; $('type-box').classList.add('hidden'); $('type-input').blur(); }
  dashPlayer() {
    const p = this.player; if (!p || !p.canAct() || p.stamina < 30) return;
    p.stamina -= 30;
    const f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const d = new THREE.Vector3();
    if (this.keys.KeyW) d.add(f); if (this.keys.KeyS) d.sub(f); if (this.keys.KeyD) d.add(r); if (this.keys.KeyA) d.sub(r);
    if (!d.lengthSq()) d.copy(f);
    p.vel.addScaledVector(d.normalize(), 17); p.vel.y = Math.max(p.vel.y, 2);
    audio.whoosh(0.6);
    this.fx.element(this.lastEl, p.center(), { count: 14, speed: 3, size: 0.3 });
  }
  applyLanguage(ui) {
    this.settings.ui = ui; setLang(ui); saveSettings(this.settings);
    document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('on', b.dataset.lang === ui));
    $('set-ui').value = ui;
    this.refreshJevLabels();
    if (this.voiceInit) $('menu-mic-message').textContent = t('menu.mic.ready');
    $('howto-elements').innerHTML = ELEMENT_KEYS.map((k) => `<span class="chip">${elChip(k)} ${elName(k)}</span>`).join('');
    $('howto-shapes').innerHTML = Object.keys(SHAPES).map((k) => `<span class="chip">${SHAPES[k].icon} ${shapeName(k)}</span>`).join('');
    const ja = ui === 'ja';
    $('howto-reactions').innerHTML = REACTIONS.map(([n, c, en, jp]) => `<li><b style="color:${c}">${reactName(n)}</b> ${ja ? jp : en}</li>`).join('');
    if (this.player && this.player.name && !this.settings.name) { this.player.name = t('you'); $('self-name').textContent = this.player.name; }
  }
  bindMenus() {
    const s = this.settings;
    $('menu-enable-voice').addEventListener('click', () => { void this.enableVoice(); });
    $('menu-disable-voice').addEventListener('click', () => {
      this.voice.dispose(); this.voiceInit = false;
      $('menu-enable-voice').hidden = false; $('menu-disable-voice').hidden = true;
      $('menu-mic-badge').textContent = 'OFF'; $('menu-mic-badge').classList.remove('ready');
      $('menu-meter-fill').style.width = '0%';
      $('menu-mic-message').textContent = t('menu.mic.permission');
    });
    document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
      audio.init(); audio.ui('click');
      const a = b.dataset.action;
      if (a === 'duel') { this.backTo = 'menu'; this.showScreen('duel-setup'); }
      else if (a === 'begin-duel') this.startMode('duel');
      else if (a === 'practice') this.startMode('practice');
      else if (a === 'howto') { this.backTo = this.mode === 'menu' ? 'menu' : 'pause'; this.showScreen('howto'); }
      else if (a === 'settings') { this.backTo = this.mode === 'menu' ? 'menu' : 'pause'; this.showScreen('settings'); }
      else if (a === 'resume') { this.showScreen(null); this.lock(); }
      else if (a === 'quit') this.endToMenu();
    }));
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { audio.ui('click'); this.showScreen(this.backTo || 'menu'); this.backTo = null; }));
    document.querySelectorAll('.lang-switch button').forEach((b) => b.addEventListener('click', () => {
      const ui = b.dataset.lang; this.applyLanguage(ui);
      s.lang = ui === 'ja' ? 'ja-JP' : 'en-US'; $('set-lang').value = s.lang; this.voice.setLang(s.lang); saveSettings(s);
    }));
    const bind = (id, key, conv = (v) => v, prop = 'value', after) => {
      const el = $(id); el[prop] = s[key];
      el.addEventListener('change', () => { s[key] = conv(el[prop]); saveSettings(s); after?.(); });
      el.addEventListener('input', () => { s[key] = conv(el[prop]); after?.(); });
    };
    bind('set-ui', 'ui', String, 'value', () => this.applyLanguage(s.ui));
    bind('set-lang', 'lang', String, 'value', () => this.voice.setLang(s.lang));
    bind('set-diff', 'diff');
    bind('set-quality', 'quality', Number, 'value', () => { $('settings-reload').textContent = t('set.reload'); });
    bind('set-chantsize', 'chantSize', Number, 'value', () => {
      document.documentElement.style.setProperty('--chant-text-size', `${s.chantSize}px`);
      $('set-chantsize-value').textContent = `${s.chantSize} px`;
    });
    $('set-chantsize-value').textContent = `${s.chantSize} px`;
    bind('set-sens', 'sens', Number);
    bind('set-vol', 'vol', Number, 'value', () => audio.setVolume(s.vol));
    bind('set-music', 'music', Number, 'value', () => audio.setMusic(s.music));
    bind('set-provider', 'spellProvider', String, 'value', () => {
      this.pendingJevCast = null; this.spec = null; this.channel = null; this.previewCost = 0; this.hud.preview(null);
      this.checkJev();
    });
    $('set-loadmodel').addEventListener('click', () => this.loadLocalModel());
    bind('set-jev', 'useJev', Boolean, 'checked', () => { this.pendingJevCast = null; this.spec = null; this.previewCost = 0; this.hud.preview(null); });
    bind('set-instantcast', 'instantCast', Boolean, 'checked');
    bind('set-botjev', 'botJev', Boolean, 'checked');
    bind('set-botvoice', 'botVoice', Boolean, 'checked');
    bind('set-handsfree', 'handsFree', Boolean, 'checked', () => (this.voice.handsFree = s.handsFree));
    const voiceOptions = () => {
      this.voice.preferLocal = s.localVoice; this.voice.prewarm = s.warmVoice;
      this.voice.cancelChant(); this.voice.prepareNext();
    };
    bind('set-localvoice', 'localVoice', Boolean, 'checked', voiceOptions);
    bind('set-warmvoice', 'warmVoice', Boolean, 'checked', voiceOptions);
    this.refreshVoiceDownload = bindVoiceDownload({
      button: $('set-downloadvoice'), status: $('voice-download-status'), getLanguage: () => s.lang,
      onInstalled: async (lang) => {
        this.voice.localByLanguage.set(lang, 'available'); this.voice.localFailed.delete(lang);
        if (this.voice.lang === lang) await this.voice.checkLocal();
      },
    });
    for (const id of ['set-lang', 'set-ui']) $(id).addEventListener('change', this.refreshVoiceDownload);
    document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', this.refreshVoiceDownload));
    audio.volume = s.vol; audio.musicVolume = s.music;
    this.applyLanguage(s.ui);
  }

  // ------------------------------------------------------------ physics
  stepBody(c, dt, wish, speed, jump, glide, descend = false) {
    const mm = c.moveMult() * (c.haste > 0 ? 1.35 : 1) * (c.channeling ? 0.5 : 1);
    const fly = c.flying > 0;
    const k = Math.min(1, (c.grounded || fly ? 11 : 2.5) * dt);
    c.vel.x += (wish.x * speed * mm * (fly ? 1.3 : 1) - c.vel.x) * k;
    c.vel.z += (wish.z * speed * mm * (fly ? 1.3 : 1) - c.vel.z) * k;
    if (fly) { const vy = jump ? 7 : descend ? -7 : 0; c.vel.y += (vy - c.vel.y) * Math.min(1, dt * 5); if (c.pos.y > 40) c.vel.y = Math.min(c.vel.y, 0); }
    else {
      c.vel.y -= 24 * dt;
      if (glide && c.vel.y < -2.2) c.vel.y = -2.2;
      if (jump && c.grounded && c.canAct()) { c.vel.y = 8.5; c.grounded = false; }
    }
    const prevY = c.pos.y, prevX = c.pos.x, prevZ = c.pos.z;
    c.pos.addScaledVector(c.vel, dt);
    // cliffs: terrain more than a step above the feet blocks the move; slide along the face on whichever axis stays free
    if (!fly) {
      // blocked if the ground ahead is a tall step, or a cliff-steep rise the feet would end up inside (a jump that
      // clears the lip still lands on top)
      const H = (x, z) => this.world.heightAt(x, z), h0 = H(prevX, prevZ), top = Math.max(prevY, c.pos.y) + 0.7;
      const bad = (x, z) => { const h = H(x, z); return h > top || (h - h0 > Math.hypot(x - prevX, z - prevZ) * 1.25 + 0.01 && h > c.pos.y - 0.05); };
      if (bad(c.pos.x, c.pos.z)) {
        if (!bad(c.pos.x, prevZ)) { c.pos.z = prevZ; c.vel.z = 0; }
        else if (!bad(prevX, c.pos.z)) { c.pos.x = prevX; c.vel.x = 0; }
        else { c.pos.x = prevX; c.pos.z = prevZ; c.vel.x = c.vel.z = 0; }
      }
    }
    const gy = this.world.groundAt(c.pos.x, c.pos.z, Math.max(prevY, c.pos.y));
    if (c.pos.y <= gy) { c.pos.y = gy; if (c.vel.y < 0) c.vel.y = 0; c.grounded = true; }
    else c.grounded = c.pos.y - gy < 0.08 && c.vel.y <= 0;
    // cliff faces can't be stood on (or jumped up in hops): slide off them
    if (c.grounded && !fly && c.pos.y - this.world.heightAt(c.pos.x, c.pos.z) < 0.1) {
      const n = this.world.normalAt(c.pos.x, c.pos.z);
      if (n.y < 0.66) { c.vel.x += n.x * 60 * dt; c.vel.z += n.z * 60 * dt; c.grounded = false; }
    }
    // bump the head on the underside of a construct
    for (const b of this.world.boxes) if (c.vel.y > 0 && this.world.inBox(b, { x: c.pos.x, y: c.pos.y + 1.8, z: c.pos.z }, 0.2) && prevY + 1.8 <= b.y - b.hy + 0.05) { c.pos.y = b.y - b.hy - 1.81; c.vel.y = 0; }
    this.world.collideBody(c.pos);
    if (c.haste > 0) c.haste -= dt;
  }

  // ------------------------------------------------------------ main loop
  loop() {
    requestAnimationFrame(() => this.loop());
    const raw = Math.min(this.clock.getDelta(), 0.05);
    if (this.slowmo > 0) { this.slowmo -= raw; this.timeScale = 0.25; } else this.timeScale += (1 - this.timeScale) * Math.min(1, raw * 6);
    const dt = this.paused ? 0 : raw * this.timeScale;
    TIME.value += dt;
    this.voice.update(raw);
    if (this.mode !== 'menu' && !this.paused) {
      const listening = this.chanting || (this.voice.handsFree && this.voice.running);
      this.hud.drawWave(raw, listening ? 'listen' : this.voice.analyser ? 'idle' : 'off');
    }
    $('menu-meter-fill').style.width = `${Math.round(this.voice.level * 100)}%`; // Sample before animating; speech feedback uses real time, including slow motion.
    if (this.mode === 'menu') this.updateMenuCam(raw);
    if (dt > 0) this.tick(dt, raw);
    audio.updateListener(this.camera);
    const u = this.post.uniforms, p = this.player;
    u.uCA.value = this.fx.shake * 3 + this.hud.hurt * 2 + (p?.frozen > 0 ? 1 : 0);
    this.domainT = Math.max(0, (this.domainT || 0) - raw);
    if (p?.frozen > 0) u.uTint.value.set(0.85, 0.95, 1.15); else if (p && !p.alive) u.uTint.value.set(0.7, 0.7, 0.75); else if (this.domainT <= 0) u.uTint.value.set(1, 1, 1);
    u.uSat.value = p && !p.alive ? 0.3 : 1.04;
    // a paused world is a still image: redraw it only when the post grade or the canvas size changes
    const still = dt === 0 && this.mode !== 'menu' && !this.debugCam && `${u.uCA.value}|${u.uSat.value}|${u.uTint.value.toArray()}`;
    if (still && still === this.stillKey) return;
    this.stillKey = still;
    if (this.debugCam) { // observer view for rendering only; aim and cast origin keep using the player's camera
      const cam = this.camera, pos = cam.position.clone(), q = cam.quaternion.clone(), vm = this.viewModel.group.visible;
      cam.position.set(...this.debugCam.pos); cam.lookAt(...this.debugCam.target); this.viewModel.group.visible = false;
      this.post.render(TIME.value);
      cam.position.copy(pos); cam.quaternion.copy(q); cam.updateMatrixWorld(); this.viewModel.group.visible = vm;
    } else this.post.render(TIME.value);
  }
  updateMenuCam() {
    const tt = (performance.now() / 1000) * 0.05;
    this.camera.position.set(Math.cos(tt) * 27, 6.5 + Math.sin(tt * 2) * 1.2, Math.sin(tt) * 27); // inside the column ring (r 32-36), outside the arches (r 22)
    this.camera.lookAt(0, 3, 0);
  }
  tick(dt, raw) {
    const p = this.player;
    if (p) {
      const sens = 0.0022 * this.settings.sens;
      p.yaw -= this.mouse.dx * sens; p.pitch = clamp(p.pitch - this.mouse.dy * sens, -1.5, 1.5);
      this.mouse.dx = this.mouse.dy = 0;
      const wish = new THREE.Vector3();
      if (p.alive && !this.typing) {
        const f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
        if (this.keys.KeyW) wish.add(f); if (this.keys.KeyS) wish.sub(f); if (this.keys.KeyD) wish.add(r); if (this.keys.KeyA) wish.sub(r);
        if (wish.lengthSq()) wish.normalize();
      }
      const sprint = this.keys.ShiftLeft && p.stamina > 1 && !this.chanting;
      if (sprint && wish.lengthSq()) p.stamina -= dt * 18;
      const speed = (sprint ? 10.5 : 7) * (this.chanting || this.channel ? 0.6 : 1);
      if (p.alive) this.stepBody(p, dt, wish, speed, this.keys.Space, this.keys.Space, this.keys.ControlLeft || this.keys.KeyC);
      p.updateStatus(dt, this);
      // camera + subtle head bob / strafe roll
      const eye = p.eye(new THREE.Vector3());
      const hs = Math.hypot(p.vel.x, p.vel.z);
      this.headBob = (this.headBob || 0) + dt * hs * 1.35;
      this.camera.position.copy(eye);
      if (p.grounded) this.camera.position.y += Math.abs(Math.sin(this.headBob)) * 0.035 * Math.min(1, hs / 7);
      if (!p.alive) this.camera.position.y -= 1.1;
      const side = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)).dot(p.vel);
      this.roll = (this.roll || 0) + ((-side * 0.004) - (this.roll || 0)) * Math.min(1, dt * 6);
      const sh = this.fx.shake * this.fx.shake;
      this.camera.rotation.set(p.pitch + (Math.random() - 0.5) * sh * 0.08, p.yaw + (Math.random() - 0.5) * sh * 0.08, this.roll + (Math.random() - 0.5) * sh * 0.05 + (p.alive ? 0 : 0.4));
      const fovT = 78 + (sprint && hs > 8 ? 6 : 0) - this.chantProgress * 4;
      if (Math.abs(this.camera.fov - fovT) > 0.05) { this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * 6); this.camera.updateProjectionMatrix(); }
      // aim ray incl. enemies
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      const rc = this.world.raycast(this.camera.position, dir, 90, 0.5);
      let dist = rc.dist;
      for (const o of this.combatants) {
        if (o === p || !o.alive) continue;
        const c = o.center(); const along = c.clone().sub(this.camera.position).dot(dir);
        if (along < 0 || along > dist) continue;
        const closest = this.camera.position.clone().addScaledVector(dir, along);
        if (Math.hypot(closest.x - c.x, closest.z - c.z) < 0.6 && Math.abs(closest.y - c.y) < 0.95) dist = along;
      }
      this.playerAim.origin.copy(this.camera.position); this.playerAim.dir.copy(dir);
      this.playerAim.point.copy(this.camera.position).addScaledVector(dir, dist);
        // The chant stays open until release; elapsed time only raises the wand's visual and audio energy.
      if (this.chanting) {
        this.chantT += dt;
        const text = this.voice.chantText();
        const local = text && !this.settings.useJev ? localParse(text) : null;
        this.speculate(text);
        const meta = { chantSeconds: this.chantT, loudness: this.voice.peak };
        const magic = this.settings.instantCast ? this.spec?.latestMagic : null;
        const pv = this.settings.useJev ? buildJevSpec(magic?.text || text, magic?.j || this.bestJev(text), meta) : local ? buildSpec(text, local, null, meta) : null;
        this.hud.chant(text || '…', ''); this.hud.preview(pv); this.previewCost = pv?.cost || 0;
        const el = pv?.element || this.lastEl;
        this.hud.setEl(el); this.viewModel.setElement(el); this.viewModel.setTier(pv ? pv.tierInt : 1);
        this.chantAura(dt, pv, el);
        this.chantProgress = clamp(this.chantT / 7);
        audio.chantUpdate(this.chantProgress, el);
        const tip = this.viewModel.tipWorld(new THREE.Vector3());
        const response = voiceChargeFeedback(this.voice.level, true);
        this.chantParticles = (this.chantParticles || 0) + raw * response.particleRate;
        const motes = Math.floor(this.chantParticles); this.chantParticles -= motes;
        if (motes) this.fx.element(el, tip, { count: motes, speed: 0.35 + this.voice.level * 0.55, size: (0.035 + this.chantProgress * 0.06) * response.scale, life: 0.35 });
        this.fx.attractors.push({ x: tip.x, y: tip.y, z: tip.z, r2: 1, k: 6, swirl: 2 });
        if (!p.canAct()) { this.voice.cancelChant(); this.chanting = false; p.chanting = false; audio.chantStop(); this.hud.chant(t('chant.broken'), 'fizzle'); }
      } else if (this.channel) {
        const ch = this.channel; ch.t += dt;
        this.chantProgress = clamp(ch.t / ch.dur);
        if (!p.canAct()) { this.channel = null; audio.chantStop(); this.hud.chant(t('chant.interrupted'), 'fizzle'); }
        else if (ch.t >= ch.dur) {
          this.channel = null; audio.chantStop();
          this.castIncantation(ch.text, { chantSeconds: ch.dur, loudness: 0.4 }, ch.jev);
        }
      } else { this.chantProgress = Math.max(0, this.chantProgress - dt * 4); this.viewModel.setTier(0); this.chantAura(dt, null, null); }
      if (this.grace) this.resolveVoiceGrace();
      this.boltCd -= dt;
      if (this.mouse.lmb) this.fireBolt();
      this.viewModel.update(dt, { speed: hs, chanting: this.chanting || !!this.channel, charge: this.chantProgress, grounded: p.grounded, voiceLevel: this.chanting ? this.voice.level : 0 });
      this.viewModel.group.visible = p.alive;
      if (p.grounded && hs > 3) { this.footT -= dt; if (this.footT <= 0) { this.footT = sprint ? 0.32 : 0.45; audio.footstep(); } }
    }
    for (const b of this.bots) {
      const out = b.brain.update(dt);
      if (out.dash && b.stamina > 30) { b.stamina -= 30; b.vel.addScaledVector(out.dash, 15); }
      if (b.alive) this.stepBody(b, dt, out.wish, out.speed || 6, out.jump, false);
      b.updateStatus(dt, this);
    }
    for (const c of this.combatants) {
      if (!c.model) continue;
      c.model.root.position.copy(c.pos);
      c.model.root.rotation.y = c.yaw;
      if (c.hitFlash > 0) c.hitFlash = Math.max(0, c.hitFlash - dt * 5);
      c.model.update(dt, { hit: c.hitFlash || 0, speed: Math.hypot(c.vel.x, c.vel.z), chanting: c.chanting, pitch: c.pitch, frozen: c.frozen > 0, shield: c.shield, shieldEl: c.shieldEl, aura: c.aura?.el });
      // afflictions burn brightest; enhancements glow softer
      const stEl = c.dots[0]?.el || Object.keys(c.enh)[0] || null;
      c.model.status(stEl, c.dots.length ? 0.9 : 0.45, dt);
      if (c.chanting && Math.random() < 0.6) this.fx.element(c.brain?.favEl || 'arcane', c.model.handWorld(new THREE.Vector3()), { count: 1, speed: 0.5, size: 0.12, life: 0.5 });
      // footfall dust when running on the ground (earthy on paths, pale on grass)
      const run = Math.hypot(c.vel.x, c.vel.z);
      if (c.grounded && run > 4 && Math.random() < dt * run * 0.9) {
        this.fx.smoke.emit({ x: c.pos.x + rand(-0.2, 0.2), y: c.pos.y + 0.08, z: c.pos.z + rand(-0.2, 0.2), vx: -c.vel.x * 0.08 + rand(-0.3, 0.3), vy: rand(0.3, 0.7), vz: -c.vel.z * 0.08 + rand(-0.3, 0.3), life: 0.8, size: 0.3, size1: 0.9, color: DUST, alpha: 0.35, drag: 2, frame: 0 });
      }
    }
    this.spells.update(dt);
    this.fx.update(dt);
    this.world.update(dt, this.fx, this.camera, this.combatants);
    this.hud.update(raw, this.camera);
  }
}

window.game = new Game();
// debug helper: VA.test('meteor', 'fire', {power:1}) casts a hand-made spec from the player
window.VA = {
  voiceStats() { const stats = window.game.voice.diagnostics(); console.table(stats.recent); return stats; },
  finalizeSpec, localParse, buildSpec,
  test(shape, element = 'fire', o = {}) {
    const g = window.game, p = g.player; if (!p) return;
    const spec = finalizeSpec({ text: `${element} ${shape}`, element, element2: o.element2 || null, shape, power: 0.6, tier: 0.5, speed: 0.5, size: 0.5, temperature: localParse(element).temperature, weight: 0.4, sharpness: 0.5, count: 0.4, duration: 0.5, chaos: 0.3, homing: 0.2, isSpell: 1, source: 'local', ...o });
    p.mana = p.maxMana; g.performCast(spec, false); return spec.name;
  },
  // cast an incantation through the local parser (optionally overriding spec fields): VA.chant('大地の地熱トルネード')
  chant(text, o = {}) {
    const g = window.game, p = g.player; if (!p) return;
    const spec = finalizeSpec({ ...buildSpec(text, localParse(text), null, { loudness: 0.6, chantSeconds: 2 }), ...o });
    p.mana = p.maxMana; g.performCast(spec, false); return spec;
  },
  // observer camera that tracks the newest active spell: VA.follow([dx, dy, dz, lookUp])
  follow(off = [0, 4, 13, 1.5]) {
    const g = window.game; cancelAnimationFrame(this._follow); let last = null;
    const f = () => { const s = g.spells.active.at(-1), c = s?.pos || s?.center; if (c) last = c.clone(); if (last) g.debugCam = { pos: [last.x + off[0], last.y + off[1], last.z + off[2]], target: [last.x, last.y + off[3], last.z] }; this._follow = requestAnimationFrame(f); };
    f();
  },
  // deterministic stepping (works even when the tab is hidden and rAF is paused): VA.step(0.5)
  step(sec, dt = 1 / 60) { const g = window.game; g.paused = true; for (let t = 0; t < sec - 1e-6; t += dt) { TIME.value += dt; g.tick(dt, dt); } g.post.render(TIME.value); },
  // VFX gallery: stage an empty field, cast, step to a representative moment, frame the spell. VA.gallery('天高く立ち昇る炎のトルネード')
  // or VA.gallery({ shape: 'wave', element: 'water' }, { at: 0.9, view: 'side' }). Returns the spec for inspection.
  gallery(what, { at = null, view = null, zoom = 1 } = {}) {
    const g = window.game, p = g.player; if (!p) return 'start practice first';
    g.paused = false; g.spells.clear(); g.fx.clear(); g.debugCam = null; g.slowmo = 0; g.timeScale = 1;
    for (const b of g.bots) { b.pos.set(0, g.world.heightAt(0, -12), -12); b.vel.set(0, 0, 0); b.hp = b.maxHp; if (b.brain) b.brain.dummy = true; }
    const sh0 = typeof what === 'string' ? localParse(what).shape : what.shape;
    p.pos.set(0, g.world.heightAt(0, 12) + 0.05, 12); p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = ['orb', 'barrage', 'crescent', 'funnels', 'beam', 'chain'].includes(sh0) ? 0.01 : -0.12; p.mana = p.maxMana;
    for (const id of ['hud', 'spell-card']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
    this.step(0.2);
    const spec = typeof what === 'string' ? this.chant(what) : this.test(what.shape, what.element, what) && null;
    const S = spec || g.spells.active.at(-1)?.spec, sh = S?.shape;
    const T = at ?? ({ orb: 0.3, barrage: 0.45, crescent: 0.28, funnels: 1.2, beam: 0.7, tornado: 1.3, meteor: 1.5, nova: 0.25, spikes: 0.55, wall: 0.8, barrier: 0.8, vortex: 1.2, chain: 0.12, storm: 1.8, ward: 0.6, field: 1.2, wave: 0.9, enhance: 0.8, hand: 1.0 }[sh] ?? 0.6);
    this.step(T);
    // frame: the newest spell's focus point (moving volumes, projectiles or the caster for self forms)
    const sp = g.spells.active.at(-1);
    const pts = sp ? [...(sp.missiles || []).filter((m) => m.launched).map((m) => m.pos), ...(sp.projectiles || []).map((q) => q.pos), ...(sp.blades || []).map((b) => b.pos)] : [];
    const f = pts.length ? pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length) : (sp?.pos || sp?.center || p.pos).clone();
    const size = Math.max(2, (sp?.H || 0) * 0.75, (sp?.R || 0) * 1.6, (sp?.W || 0) * 0.8, sp?.len ? sp.len * 0.35 : 0, sp?.w ? sp.w * 6 : 0) * zoom;
    const v = view ?? (['orb', 'barrage', 'crescent', 'beam', 'chain', 'spikes', 'funnels'].includes(sh) ? 'side' : 'front');
    const up = sh === 'tornado' || sh === 'wall' || sh === 'barrier' || sh === 'wave' ? size * 0.45 : sh === 'storm' ? size * 0.9 : 1;
    const d = size * 1.25 + 4;
    const off = v === 'side' ? [d * 1.1, d * 0.2 + 1, -1] : v === 'top' ? [0.01, d * 1.6, d * 0.3] : [d * 0.55, d * 0.22 + 0.5, -d];
    if (sh === 'beam' || sh === 'chain') { f.set(0, 1.6, 0); off.splice(0, 3, 17, 3, 2); }
    this.cam([f.x + off[0], f.y + off[1], f.z + off[2]], [f.x, f.y + up, f.z]);
    g.post.render(TIME.value);
    return S && { name: S.name, shape: S.shape, element: S.element, substance: S.substance, h: +S.height.toFixed(2), w: +S.width.toFixed(2) };
  },
  // contact sheet: one form across every element in a labelled 4×3 grid (VA.sheet('wave')); VA.sheet() removes it
  sheet(shape, opts = {}) {
    document.getElementById('va-sheet')?.remove();
    if (!shape) return;
    const g = window.game, src = g.renderer.domElement, cv = document.createElement('canvas');
    cv.id = 'va-sheet'; cv.width = 1280; cv.height = 720; Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: 99999, background: '#000' });
    const c = cv.getContext('2d'), W = 320, H = 240, errs = [];
    ELEMENT_KEYS.forEach((el, i) => {
      const oe = console.error; console.error = (e) => errs.push(el + ': ' + String(e?.message || e));
      try { this.gallery({ shape, element: el, ...(opts.o || {}) }, opts); } catch (e) { errs.push(el + ': ' + e.message); }
      console.error = oe;
      const cam = g.camera, keep = [cam.position.clone(), cam.quaternion.clone()];
      if (g.debugCam) { cam.position.set(...g.debugCam.pos); cam.lookAt(...g.debugCam.target); g.viewModel.group.visible = false; }
      g.post.render(TIME.value);
      const x = (i % 4) * W, y = Math.floor(i / 4) * H, sw = src.width, sh = src.height, ch = sw * H / W;
      c.drawImage(src, 0, (sh - ch) / 2, sw, ch, x, y, W, H);
      cam.position.copy(keep[0]); cam.quaternion.copy(keep[1]); cam.updateMatrixWorld();
      c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x, y, W, 22); c.fillStyle = '#fff'; c.font = '15px sans-serif'; c.fillText(shape + ' · ' + el, x + 6, y + 16);
    });
    if (errs.length) { c.fillStyle = '#f66'; c.font = '14px monospace'; errs.slice(0, 6).forEach((e, k) => c.fillText(e.slice(0, 80), 970, 500 + k * 18)); }
    document.body.appendChild(cv);
    return errs;
  },
  // debug observer camera: VA.cam([x,y,z],[tx,ty,tz]) · VA.cam() restores the player view
  cam(pos, target = [0, 2, 0]) { cancelAnimationFrame(this._follow); const g = window.game; g.debugCam = pos ? { pos, target } : null; g.viewModel.group.visible = !pos && !!g.player; },
  face(target) { const g = window.game, p = g.player, tt = target || g.bots[0]; p.yaw = Math.atan2(p.pos.x - tt.pos.x, p.pos.z - tt.pos.z); p.pitch = 0; },
};
