import { stepBody } from './movement.js';
import { effectiveManaCost, spendSpellMana } from './mana.js';
import './style.js'; // global art direction: must patch shader chunks before anything compiles
import * as THREE from 'three';
import { TIME } from './shaders.js';
import { bindVoiceDownload } from './voice-download.js';
import { World, SEA_Y } from './world.js';
import { FX } from './fx.js';
import { PostFX } from './postfx.js';
import { SpellSystem } from './spells.js';
import './spells-extra.js';
import { Royale, royaleGuide, royaleRecord } from './royale.js';
import { FORM_GUIDE } from './form-guide.js';
import { Combatant, ENHANCE, interruptBotOnDamage } from './combat.js';
import { MageModel, ViewModel, initViewEnv } from './characters.js';
import { loadAnimeMage } from './anime-mage.js';
import { MagicCircle } from './magicCircle.js';
import { BotBrain } from './bot.js';
import { Hud, elChip } from './hud.js';
import { Voice } from './voice.js';
import { voiceChargeFeedback } from './voice-feedback.js';
import { audio } from './audio.js';
import { t, setLang, getLang } from './i18n.js';
import { UI_LANGUAGES, VOICE_LANGUAGES, uiLanguage, recognitionLanguage, defaultRecognitionLanguage } from './languages.js';
import { bindLanguagePicker } from './language-picker.js';
import { localParse, askJev, buildSpec, buildJevSpec, boltSpec, finalizeSpec } from './spellbook.js';
import { requestCachedSpell, cachedSpellResult } from './jev-cache.js';
import { ELEMENTS, SHAPES, ELEMENT_KEYS, elName, shapeName, reactName } from './elements.js';
import { clamp, rand, TAU } from './util.js';
import { warmSpellShaders } from './warmup.js';
import { OnlineDuel } from './online.js';
import { escapeHTML } from './safe-html.js';

const $ = (id) => document.getElementById(id);
const p0EarthFree = (c) => c.enhP('earth') === null;
const hex = (n) => '#' + new THREE.Color(n).getHexString();

// ------------------------------------------------------------------ settings
const DEFAULTS = { ui: uiLanguage(navigator.language || 'en'), lang: '', diff: 'normal', lobby: 8, royaleTeams: 1, quality: 1, sens: 1, chantSize: 26, anime: true, vol: 0.8, music: 0.175, useJev: true, spellProvider: 'jev', instantCast: false, botVoice: true, handsFree: false, localVoice: false, warmVoice: true, voiceDefaultsVersion: 2 };
function loadSettings() {
  let s;
  try {
    const saved = JSON.parse(localStorage.getItem('voxarcana') || '{}');
    s = { ...DEFAULTS, ...saved };
    // Discard the retired NPC API option, including old saved opt-ins.
    delete s.botJev; delete s.botJevDefaultsVersion;
    // The previous release enabled experimental speech paths for everyone.
    // Migrate once so existing users also return to direct microphone capture.
    if (saved.voiceDefaultsVersion !== 2) { s.localVoice = false; s.voiceDefaultsVersion = 2; saveSettings(s); }
  } catch { s = { ...DEFAULTS }; }
  // These casting behaviors are fixed, including for older saved preferences.
  s.jevPauseMs = 300; s.handsFree = false; s.warmVoice = true;
  s.ui = uiLanguage(s.ui);
  s.fov = Number.isFinite(Number(s.fov)) && s.fov != null ? Math.max(50, Math.min(100, Number(s.fov))) : 78;
  s.lang = recognitionLanguage(s.lang) || recognitionLanguage(navigator.language) || defaultRecognitionLanguage(s.ui);
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
// training-ground prompts: example chants that show off the forms (rotated under the chant hint)
const TRY = {
  en: ['Fire whip, lash them!', 'Imprison him in a cage of ice', 'Summon a thunder dragon', 'Holy sword, descend upon them', 'Brand a death mark of shadow', 'Blades of wind, orbit around me',
    'Drain his life', 'Charge forward wrapped in flame', 'Raise a crystal totem', 'Create illusions of myself', 'Ultimate fireball!', 'Tidal wave', 'Poison swamp', 'Let me fly'],
  ja: ['炎の鞭よ、薙ぎ払え', '氷の牢獄に閉じ込めよ', '雷の龍よ、敵を喰らえ', '天より来たれ、聖なる大剣', '闇の刻印を刻め', '風の刃よ、我が周りを巡れ',
    '命を吸収せよ', '炎の突進', '水晶の祭壇', '影分身', '究極の火球！', '大津波', '毒の沼', '空を飛べ'],
};
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
    // coarse line-of-sight test for sound occlusion (1.2 m steps, skipping the first and last metre around each end)
    const occCache = new Map(); let occT = 0;
    audio.occluded = (a, b) => {
      const now = performance.now(); if (now - occT > 300) { occCache.clear(); occT = now; } // results live ~0.3 s, keyed on 3 m cells
      const key = `${Math.round(a.x / 3)},${Math.round(a.z / 3)},${Math.round(b.x / 3)},${Math.round(b.y / 3)},${Math.round(b.z / 3)}`;
      if (occCache.has(key)) return occCache.get(key);
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz), p = { x: 0, y: 0, z: 0 };
      let hit = false;
      for (let t = 1.5; t < L - 1.5 && !hit; t += 2) { const k = t / L; p.x = a.x + dx * k; p.y = a.y + dy * k; p.z = a.z + dz * k; hit = this.world.solid(p); }
      occCache.set(key, hit);
      return hit;
    };
    this.hud = new Hud(this);
    this.hud.buildMinimapBg(this.world);
    this.voice = new Voice();
    initViewEnv(this.renderer);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.group.visible = false;
    this.bindInput(); this.bindMenus(); this.onResize();
    this.online = new OnlineDuel(this);
    this.cacheCheckAt = performance.now() + 60000;
    this.checkJev();
    this.startAttract();
    this.clock = new THREE.Clock();
    this.loop();
    this.shaderWarmup = this.prepareSession();
  }

  async prepareSession() {
    const cacheWarmup = this.preloadSpellCache();
    this.preparing = true;
    $('loading').classList.remove('hidden');
    $('loading-retry').classList.add('hidden');
    $('loading-progress').value = 0;
    $('loading-status').textContent = t('loading.spells');
    // Prevent keyboard focus from reaching the menu behind the loading screen.
    for (const id of ['menu', 'duel-setup', 'royale-setup']) $(id).inert = true;
    try {
      // Give the browser a chance to paint the loading screen before the first shader draw.
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      this.warmupStats = await warmSpellShaders(this, {
        onProgress: (done, total) => {
          $('loading-progress').value = done / total;
          $('loading-status').textContent = `${t('loading.spells')} ${Math.floor(done / total * 100)}%`;
        },
      });
      await cacheWarmup;
      this.clock.getDelta(); // Loading time must never advance combat.
      this.preparing = false;
      for (const id of ['menu', 'duel-setup', 'royale-setup']) $(id).inert = false;
      $('loading').classList.add('hidden');
    } catch (error) {
      console.error('Session preparation failed:', error);
      $('loading-status').textContent = t('loading.failed');
      $('loading-retry').classList.remove('hidden');
      $('loading-retry').onclick = () => { this.shaderWarmup = this.prepareSession(); };
    }
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
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.03, 4000);
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
  screenFlash(color = '#fff', a = 0.5) { $('screen-flash').style.background = color; this.hud.flash = Math.max(this.hud.flash, a * (this.settings.calm ? 0.35 : 1)); }

  // ------------------------------------------------------------ Jev status
  adoptCacheVersion(version) {
    if (!version || version === this.cacheVersion || this.retiredCacheVersions?.has(version)) return false;
    this.retiredCacheVersions ||= new Set();
    if (this.cacheVersion) this.retiredCacheVersions.add(this.cacheVersion);
    this.cacheVersion = version;
    this.jevCache?.clear();
    this.spec?.map?.clear();
    if (this.spec) {
      this.spec.pending?.clear(); this.spec.lastText = ''; this.spec.retry = null;
      this.spec.latestMagic = null; this.spec.shownText = null;
    }
    return true;
  }
  async preloadSpellCache(language = this.settings.lang || 'en-US') {
    const token = this.cacheLoadToken = {};
    try {
      const response = await fetch(`/api/spell-cache?language=${encodeURIComponent(language)}`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.text();
      if (body.length > 3 * 1024 * 1024) return;
      const data = JSON.parse(body);
      if (this.cacheLoadToken !== token || !data.ok || data.language !== language || !Array.isArray(data.entries) || typeof data.version !== 'string' || this.retiredCacheVersions?.has(data.version)) return;
      this.adoptCacheVersion(data.version);
      this.jevCache ||= new Map();
      let loaded = 0;
      for (const entry of data.entries.slice(0, 1000)) {
        if (typeof entry.text !== 'string' || entry.text.length > 600 || !(entry.params?.isSpell >= 0.65)) continue;
        const key = JSON.stringify(['jev', language, entry.text.trim().toLowerCase()]);
        // Full responses already obtained this session retain their probabilities.
        if (!this.jevCache.has(key)) this.jevCache.set(key, {
          ok: true, cached: true, provider: 'jev', latency: 0, rtt: 0, cacheVersion: data.version,
          params: entry.params, model: entry.model, endpoint: entry.endpoint,
          raw: { model: entry.model, cachedSummary: true, params: entry.params },
        });
        loaded++;
      }
      while (this.jevCache.size > 5000) this.jevCache.delete(this.jevCache.keys().next().value);
      this.spellCacheStats = { language, loaded, characters: body.length, shared: data.shared, version: data.version };
    } catch { /* Preloading is optional; the server checks its cache on every request. */ }
  }
  async checkJev() {
    try {
      const s = await (await fetch('/api/status', { signal: AbortSignal.timeout(3000), cache: 'no-store' })).json();
      const knownVersion = this.cacheVersion;
      if (this.adoptCacheVersion(s.cache?.version) && knownVersion) void this.preloadSpellCache();
      this.localStatus = s.local || { phase: 'outdated', error: t('local.restart') };
      this.capabilities = s.capabilities || { localModel: true };
      document.querySelector('#set-provider option[value=local]').disabled = !this.capabilities.localModel;
      $('set-loadmodel').disabled = !this.capabilities.localModel;
      if (!this.capabilities.localModel && this.settings.spellProvider === 'local') {
        this.settings.spellProvider = 'jev'; $('set-provider').value = 'jev'; saveSettings(this.settings);
      }
      this.jevOnline = this.settings.spellProvider === 'local' ? s.local?.phase === 'ready' : !!s.jev.keyLoaded; this.jevModel = this.settings.spellProvider === 'local' ? 'Local MiniLM' : s.jev.model;
      this.jevStatusError = s.jev.errorCode ? s.jev : null;
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
    if (this.serverUp && this.jevStatusError) {
      const message = this.jevError(this.jevStatusError);
      this.hud.jev('off', message);
      $('menu-status').textContent = message;
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
  jevError(j) {
    const codes = ['rate_limit', 'upstream_rate_limit', 'upstream_unavailable', 'timeout', 'network_error', 'provider_network_error', 'service_error', 'invalid_endpoint', 'missing_credentials', 'authentication_failed', 'access_denied', 'billing_error', 'upstream_rejected', 'invalid_response'];
    const endpoint = j?.endpoint === 'direct' ? 'Jev Direct' : j?.endpoint === 'gateway' ? 'Vercel AI Gateway' : '';
    return (endpoint ? `${endpoint}: ` : '') + t(codes.includes(j?.errorCode) ? `chant.${j.errorCode}` : 'chant.jeverror');
  }
  noteJev(j) {
    if (!j) return;
    if (j.ok) { this.jevFails = 0; this.jevOnline = true; this.hud.jev('on', `${j.provider === 'local' ? 'MiniLM' : 'Jev'} · ${j.cached ? 'cached' : j.latency + 'ms'}${Number.isFinite(j.rtt) ? ` · RTT ${Math.round(j.rtt)}ms` : ''}`); }
    else { this.jevFails++; this.hud.jev('off', j.errorCode ? this.jevError(j) : t('jev.err')); if (this.jevFails >= 3) this.jevOnline = false; console.warn('Jev:', j.error); }
  }

  // ------------------------------------------------------------ combatants
  makeCombatant(opts, colors) {
    const c = new Combatant(opts);
    c.colors = colors || null;
    if (colors) {
      c.model = new MageModel(colors); this.scene.add(c.model.root);
      c.castOrigin = () => c.model.handWorld(c._ho || (c._ho = new THREE.Vector3()));
    }
    this.combatants.push(c);
    return c;
  }
  removeCombatant(c) {
    const i = this.combatants.indexOf(c); if (i >= 0) this.combatants.splice(i, 1);
    if (c.model) { this.scene.remove(c.model.root); c.model.root.traverse((m) => m.geometry?.dispose()); } // free GPU buffers (decoys come and go all match)
  }
  clearArena() {
    this.voice?.cancelChant(); this.grace = null; this.chanting = false;
    audio.chantStop();
    this.spells.clear();
    this.royale?.dispose(); this.royale = null; this.debugCam = null;
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
    const others = this.combatants.filter((c) => c !== this.player && c.alive && c.owner !== this.player);
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
    if (this.preparing) return;
    audio.init();
    this.clearArena();
    this.mode = mode;
    this.hud.clearSpellInfo?.();
    const p = this.createPlayer();
    this.spawnAt(p, Math.PI * 0.5);
    this.score = { me: 0, foe: 0 }; this.roundOver = false; this.stats = { dmg: 0 };
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
    } else if (mode === 'royale') {
      this.royale = new Royale(this); this.royale.start();
    }
    this.hud.show(true); this.hud.setEl('arcane'); this.viewModel.setElement('arcane');
    this.hud.hint(mode === 'royale' ? 'hint.royale' : 'hint.chant'); this.hud.chant('', ''); this.hud.preview(null);
    this.showScreen(null);
    // Match entry is a user gesture, so request microphone access here for both modes.
    void this.enableVoice();
    this.lock();
  }
  endToMenu() {
    this.online?.disconnect();
    document.exitPointerLock?.();
    this.startAttract();
    this.keys = {}; this.mouse.lmb = false; this.typing = false; this.backTo = null;
    $('type-box').classList.add('hidden');
    this.showScreen('menu');
    document.querySelector('#menu .mode-card')?.focus();
  }
  showScreen(id) {
    if (id === 'settings') {
      const online = this.mode === 'online' || this.backTo === 'online-lobby';
      const note = $('settings-online-note');
      note.classList.toggle('hidden', !online);
      note.textContent = getLang() === 'ja'
        ? (this.mode === 'online' ? '設定中も対戦は進行します。魔法の解釈はルームの設定が適用されます。' : 'ルームに参加したまま設定を変更できます。魔法の解釈はルームの設定が適用されます。')
        : (this.mode === 'online' ? 'The duel continues while settings are open. Spell interpretation is set by the room.' : 'You stay in your room while adjusting settings. Spell interpretation is set by the room.');
      $('settings').querySelector('[data-action="close-settings"]').textContent = this.backTo === 'online-lobby'
        ? (getLang() === 'ja' ? 'ロビーに戻る' : 'Back to lobby')
        : this.backTo === 'pause' ? (getLang() === 'ja' ? '対戦メニューに戻る' : 'Back to duel menu') : t('menu.back');
      for (const key of ['set-provider', 'set-jev', 'set-loadmodel']) $(key).disabled = online;
      $('settings').querySelector('.settings-advanced').classList.toggle('hidden', online);
      $('set-botvoice').closest('label').classList.toggle('hidden', online);
    }
    if (id === 'menu') void this.refreshVoiceDownload?.();
    for (const s of ['menu', 'settings', 'howto', 'pause', 'inventory', 'duel-setup', 'royale-setup', 'online-lobby']) $(s)?.classList.toggle('hidden', s !== id);
    this.paused = id === 'pause' || id === 'inventory' || ((id === 'settings' || id === 'howto') && this.mode !== 'menu');
    this.voice.setActive(this.mode !== 'menu' && !this.paused);
    audio.ambience?.(!this.paused);
    if (this.paused || this.mode === 'menu') {
      this.keys = {}; this.mouse.lmb = false;
      this.voice.cancelChant();
      this.pendingJevCast = null;
      this.grace = null; this.chanting = false;
      if (this.player) this.player.chanting = false;
      audio.chantStop();
    }
  }
  lock() { $('c').requestPointerLock?.()?.catch?.(() => {}); }
  openSettings(backTo = this.mode === 'menu' ? 'menu' : 'pause') {
    this.backTo = backTo;
    this.showScreen('settings');
    $('set-quality').focus();
  }
  closeSettings() {
    const target = this.backTo || (this.mode === 'menu' ? 'menu' : 'pause');
    this.backTo = null;
    this.showScreen(target);
    const screen = $(target);
    (target === 'online-lobby' ? $('online-settings') : screen?.querySelector('[data-action="settings"]'))?.focus();
  }

  // ------------------------------------------------------------ voice & casting
  async initVoice() {
    if (this.voiceInit) return; this.voiceInit = true;
    this.voice.lang = this.settings.lang; this.voice.handsFree = false;
    this.voice.preferLocal = this.settings.localVoice; this.voice.prewarm = true;
    this.voice.onText = () => {
      if (this.paused || this.mode === 'menu') return;
      // Submit directly from recognition events; rendering must not drop revisions.
      if (this.chanting) this.speculate(this.voice.chantText());
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
  requestJev(text, meta = {}) {
    const online = this.mode === 'online';
    const request = { ...meta, provider: online ? 'jev' : this.settings.spellProvider || 'jev', language: meta.language || this.voice.lang || this.settings.lang || 'en-US' };
    const fetchResult = online && !this.online.ws?.host
      ? (text, meta) => this.online.interpret(text, meta.language) : askJev;
    return requestCachedSpell(this, text, request, fetchResult);
  }
  speculate(text, force = false) {
    const S = this.spec;
    if (!S || S.closed || !text || (!this.settings.useJev && this.mode !== 'online')) return;
    const now = performance.now();
    const changed = S.desiredText !== text;
    if (changed) {
      S.desiredText = text;
      S.changedAt = now;
      S.shownText = null;
      this.hud.preview(null); this.previewCost = 0;
      this.hud.jevPending?.(text, this.mode === 'practice');
    }
    const provider = this.mode === 'online' ? 'jev' : this.settings.spellProvider || 'jev';
    const key = JSON.stringify([provider, this.voice.lang || this.settings.lang || 'en-US', provider === 'jev' ? text.trim().toLowerCase() : text.trim()]);
    this.jevCache ||= new Map();
    const current = S.map.get(text);
    const cached = current ? (changed ? cachedSpellResult(current) : current) : cachedSpellResult(this.jevCache.get(key));
    if (cached) {
      S.map.set(text, cached);
      // A guest's downloaded cache may use another language than the host's.
      // Warm the authoritative host while aiming so release can reuse it too.
      if (this.mode === 'online' && !this.online.ws?.host && (force || now - Math.max(S.changedAt ?? now, this.voice.lastSpeechAt ?? 0) >= 300)) {
        S.hostWarm ||= new Set();
        if (!S.hostWarm.has(text)) { S.hostWarm.add(text); void this.online.interpret(text, this.voice.lang || this.settings.lang || 'en-US'); }
      }
      if (S.shownText !== text) {
        S.shownText = text;
        this.noteJev(cached);
        if (cached.raw) this.hud.jevReply?.(cached.raw, text, this.mode === 'practice');
      }
      return;
    }
    if (!force && now - Math.max(S.changedAt ?? now, this.voice.lastSpeechAt ?? 0) < 300) return;
    // Deduplicate requests in flight, but do not permanently suppress failed words.
    if (text === S.lastText && (!S.retry || S.retry.text !== text || now < S.retry.at)) return;
    if (S.pending.has(text) && !(S.retry?.text === text && now >= S.retry.at)) return;
    S.retry = null;
    S.attempts ||= new Map();
    const attempt = (S.attempts.get(text) || 0) + 1;
    S.attempts.set(text, attempt);
    S.lastText = text; S.lastSend = now; S.inflight++;
    this.hud.jevPending?.(text, this.mode === 'practice');
    const order = ++S.order;
    const requestCacheVersion = this.cacheVersion;
    const promise = this.requestJev(text, { chantSeconds: this.chantT, loudness: this.voice.peak });
    S.pending.set(text, promise);
    promise.then((j) => {
      S.inflight--;
      if (j.cacheVersion && this.cacheVersion !== requestCacheVersion && j.cacheVersion !== this.cacheVersion) return;
      if (j.ok) {
        this.adoptCacheVersion(j.cacheVersion);
        this.jevCache.set(key, j);
        if (this.jevCache.size > 5000) this.jevCache.delete(this.jevCache.keys().next().value);
      }
      if (this.spec !== S || S.closed || this.paused || this.mode === 'menu') return;
      const current = text === S.desiredText;
      if (current) this.noteJev(j);
      if (!j.ok) {
        if (current) {
          // At most two retries while holding, with backoff; release still owns the final cast.
          if (j.retryable && attempt < 3) S.retry = { text, at: performance.now() + 500 * 2 ** (attempt - 1) };
          this.hud.jevFailure?.(text, this.mode === 'practice', this.jevError(j));
        }
        return;
      }
      S.map.set(text, j);
      if (current && j.raw && (!S.displayOrder || order > S.displayOrder)) {
        S.shownText = text;
        S.displayOrder = order;
        this.hud.jevReply?.(j.raw, text, this.mode === 'practice');
      }
      if (!S.latest || order > S.latest.order) S.latest = { order, text, j };
      if (j.params?.isSpell >= 0.65 && (!S.latestMagic || order > S.latestMagic.order)) S.latestMagic = { order, text, j };
      if (this.grace) this.resolveVoiceGrace();
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
    return parts.length > 0 && parts.every(p => p.final);
  }
  endChant() {
    if (!this.chanting) return;
    this.releaseAim = { yaw: this.player.yaw, pitch: this.player.pitch };
    this.chanting = false; this.player.chanting = false; audio.chantStop();
    if (!this.voice.rec) { this.voice.cancelChant(); this.hud.chant(t('chant.nomic'), 'fizzle'); return; }
    const text = this.voice.chantText();
    // Only an already prepared exact preview may bypass recognition completion.
    // Do not interpret an unfinished fragment just because the button was released.
    // Jev must receive the recognizer's final words, including audio buffered at key release.
    // stop() flushes the recognizer; onend follows its last result in normal browser operation.
    const preview = this.bestJev(text);
    const ready = (this.settings.useJev || this.mode === 'online') && preview?.ok && !preview.partial && preview.params?.isSpell >= 0.65
      && performance.now() - Math.max(this.spec?.changedAt ?? performance.now(), this.voice.lastSpeechAt ?? 0) >= 300;
    const res = this.voice.endChant({ waitForWords: !ready });
    if (ready) { this.castIncantation(res.text, res, this.bestJev(res.text)); return; }
    // Missing or incomplete words: allow delayed spell words (a new press cancels instantly).
    this.grace = { win: res.win, meta: res, until: performance.now() + 5000 };
    this.hud.chant(t('chant.recognizing'), '');
  }
  resolveVoiceGrace() {
    const g = this.grace;
    if (!g) return;
    const text = this.voice.textOf(g.win);
    const ended = g.win?.ended;
    if (!ended && !g.win?.closed && performance.now() >= g.until) {
      this.voice.finishChant(g.win); this.grace = null;
      this.hud.chant(t('chant.recognitiontimeout'), 'fizzle'); this.hud.preview(null); this.previewCost = 0;
      return; // Never turn a recognition timeout into a cast of partial words.
    }
    if (g.win?.closed || (ended && !text)) {
      this.voice.finishChant(g.win); this.grace = null;
      this.hud.chant(t('chant.silence'), 'fizzle'); this.hud.preview(null); this.previewCost = 0;
    } else if (text && ended) {
      this.speculate(text, true);
      this.grace = null; this.voice.finishChant(g.win);
      this.castIncantation(text, g.meta, this.bestJev(text));
    }
  }
  cancelPendingCast() {
    if (!this.grace && !this.pendingJevCast && !this.channel) return false;
    // Invalidate callbacks before stopping recognition: abort may emit events.
    this.grace = null; this.pendingJevCast = null; this.channel = null;
    if (this.spec) this.spec.closed = true;
    this.chanting = false; this.releaseAim = null;
    if (this.player) this.player.chanting = false;
    if (this.mouse) this.mouse.lmb = false;
    this.voice.cancelChant(); this.voice.prepareNext?.();
    audio.chantStop(); this.previewCost = 0; this.hud.preview(null);
    this.hud.chant(t('chant.cancelled'), '');
    return true;
  }
  async castIncantation(text, meta, jev) {
    meta ||= {};
    const online = this.mode === 'online', aim = online && meta.win ? this.releaseAim : undefined;
    const p = this.player; if (!p || !p.alive) return;
    if (this.spec) this.spec.closed = true;
    let spec;
    if (this.settings.useJev || online) {
      const token = this.pendingJevCast = {}, mode = this.mode;
      this.previewCost = 0; this.hud.preview(null);
      this.hud.chant(t('chant.jevwait'), '');
      const request = { ...meta, provider: this.settings.spellProvider, language: this.voice.lang || this.settings.lang };
      let j = jev?.ok && !jev.partial ? jev : await (jev?.then ? jev : this.spec?.pending?.get(text) || this.requestJev(text, request));
      // A failed speculative request is not a cached verdict. Retry transient failures for these exact words.
      if (!j.ok && j.retryable && this.pendingJevCast === token && this.player === p && p.alive && !this.paused && this.mode === mode && (this.settings.useJev || online)) {
        j = await this.requestJev(text, request);
      }
      if (this.pendingJevCast !== token || this.player !== p || !p.alive || this.paused || this.mode !== mode || this.mode === 'menu' || (!this.settings.useJev && !online)) return;
      this.pendingJevCast = null; this.noteJev(j);
      if (j.raw) this.hud.jevReply?.(j.raw, text, this.mode === 'practice');
      else if (!j.ok) this.hud.jevFailure?.(text, this.mode === 'practice', this.jevError(j));
      spec = buildJevSpec(text, j, meta);
      if (!spec) {
        this.voice.finishMetric(meta.win, 'jev-error'); this.hud.chant(this.jevError(j), 'fizzle'); audio.ui('fizzle'); return;
      }
    } else spec = buildSpec(text, localParse(text), null, meta);
    this.previewCost = 0;
    if (spec.isSpell < 0.65) { this.voice.finishMetric(meta.win, 'no-magic'); this.hud.chant('“' + text + '” ' + t('chant.nomagic'), 'fizzle'); audio.ui('fizzle'); this.hud.preview(null); return; }
    if (p.canAct()) this.voice.markCast(meta.win);
    else this.voice.finishMetric(meta.win, 'interrupted');
    if (online) this.online.cast(text, aim);
    else this.performCast(spec, true);
  }
  performCast(spec, addToGrimoire) {
    if (this.mode === 'online') { this.online.cast(spec.text); return; }
    const p = this.player;
    if (!p.canAct()) { this.hud.chant(t('chant.interrupted'), 'fizzle'); audio.ui('fizzle'); return; }
    const paidCost = effectiveManaCost(p, spec);
    if (!spendSpellMana(p, spec)) {
      this.previewCost = 0; this.hud.preview(null);
      this.hud.chant(t('feed.starved'), 'fizzle'); audio.ui('fizzle');
      return;
    }
    this.previewCost = 0;
    this.lastEl = spec.element; this.viewModel.setElement(spec.element); this.hud.setEl(spec.element);
    this.spells.cast(spec, p);
    this.viewModel.kick = 1;
    this.hud.chant('“' + spec.text + '”', '');
    this.hud.preview(null);
    this.hud.spellCard({ ...spec, cost: paidCost });
    this.onCast(p, spec);
    if (spec.tierInt >= 8) { this.slowmo = 0.35; this.screenFlash(hex(ELEMENTS[spec.element].color), 0.12); }
  }
  typedCast(text) {
    const units = /[぀-ヿ一-龯]/.test(text) ? text.length / 3 : text.trim().split(/\s+/).length;
    const dur = Math.min(3.5, 0.3 + units * 0.16);
    const ch = (this.channel = { t: 0, dur, text, typed: true, jev: null });
    this.pendingJevCast = null;
    if (this.settings.useJev || this.mode === 'online') ch.jev = this.requestJev(text, { chantSeconds: dur, loudness: 0.4 });
    audio.chantStart(this.settings.useJev ? 'arcane' : localParse(text).element);
    const pv = this.settings.useJev ? null : finalizeSpec({ ...localParse(text), text });
    this.hud.preview(pv); this.previewCost = pv ? effectiveManaCost(this.player, pv) : 0; this.hud.chant('“' + text + '”', '');
  }
  fireBolt() {
    const p = this.player;
    if (!p || !p.canAct() || this.boltCd > 0 || this.chanting) return;
    if (this.mode === 'online') { if (this.online.canPlay() && !this.paused) { this.online.send({ type: 'bolt' }); this.boltCd = p.enhP('lightning') !== null ? 0.36 : 0.56; } return; }
    const spec = boltSpec(this.lastEl);
    if (!spendSpellMana(p, spec)) return;
    this.boltCd = p.enhP('lightning') !== null ? 0.36 : 0.56;
    this.spells.cast(spec, p);
    this.viewModel.kick = 0; this.viewModel.flick = 1;
    audio.bolt(this.lastEl);
  }

  // ------------------------------------------------------------ combat hooks
  whoName(c) { return c === this.player ? `<b>${t('you')}</b>` : escapeHTML(c.name); }
  onCast(c, spec) {
    const col = hex(ELEMENTS[spec.element].color);
    if (this.royale && c !== this.player && this.player && c.pos.distanceTo(this.player.pos) > 40) return; // far-off duels stay off the feed
    this.hud.feed(t('feed.cast', { who: this.whoName(c), spell: `<b style="color:${col}">${escapeHTML(spec.name)}</b>` }) + ` <span style="opacity:.6">(${shapeName(spec.shape)} · ${t('rank')} ${escapeHTML(spec.tierInt)})</span>`);
    if (c !== this.player && this.hud.cardTimer < 3 && !spec.basic) this.hud.spellCard(spec, c.name);
  }
  onDamage(target, res, pos, el, hit) {
    target.lastHit = performance.now();
    if (hit.src === this.player && target !== this.player && this.stats) this.stats.dmg += res.dmg;
    if (res.absorbed > 1 && performance.now() - (this._shT || 0) > 120) { this._shT = performance.now(); audio.shieldHit(pos); }
    if (res.dmg < 0.5 && !res.reaction) return;
    this.hud.damage(pos, res.dmg, el, res.reaction);
    if (target === this.player) {
      if (hit.src && hit.src !== target) this.hud.hitFrom(hit.src, res.dmg);
      this.hud.hurt = Math.min(0.8, this.hud.hurt + res.dmg / 150); audio.hurt(Math.min(1, res.dmg / 120)); this.fx.addShake(Math.min(0.5, res.dmg / 200));
      if (this.chanting && res.dmg > 60 && p0EarthFree(target) && Math.random() < 0.5) { this.voice.cancelChant(); this.chanting = false; this.player.chanting = false; audio.chantStop(); this.hud.chant(t('chant.broken'), 'fizzle'); }
    }
    if (hit.src === this.player && target !== this.player) { this.hud.hitm = 1; audio.hitmarker(); if (res.dmg > 70 && !hit.dot && this.slowmo <= 0 && !this.settings.calm) this.timeScale = Math.min(this.timeScale, 0.2); } // hit-stop: heavy hits bite time for a beat
    interruptBotOnDamage(target, res);
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
  onArmorBreak(c) { if (c === this.player) { audio.shatter?.(null, 0.6); this.hud.popup(c.center().add(new THREE.Vector3(0, 1.2, 0)), t('royale.armorBreak'), 'react', '#8fd0ff'); } }
  onShield(c) { this.hud.popup(c.center().add(new THREE.Vector3(0, 1.2, 0)), t('st.shield'), 'react', '#ffd46a'); }
  onBotChant(c, text, onFinish) {
    if (this.mode === 'menu' || !this.settings.botVoice || !window.speechSynthesis) return;
    // a crowded battle royale: only the nearest chanting rival speaks, and never over another one
    if (this.royale && (!this.player || c.pos.distanceTo(this.player.pos) > 38 || speechSynthesis.speaking)) return false;
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
    if (target.decoy) { target.alive = false; return; } // an illusion: its spell pops it
    if (this.royale?.tryRevive(target)) return;
    target.alive = false; target.deaths++; if (killer && killer !== target) killer.kills++;
    if (target !== this.player) audio.elimination(target.center());
    if (killer === this.player && target !== this.player) { // kill streaks: kills chained within 12 s
      const now = performance.now(); this.streak = now - (this.streakT || 0) < 12000 ? (this.streak || 1) + 1 : 1; this.streakT = now;
      if (this.streak >= 2) { this.hud.banner(t('streak.' + Math.min(5, this.streak)), '', 1.8); audio.streak(this.streak); }
    }
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
    } else if (this.mode === 'royale') {
      this.royale?.onDeath(target, killer);
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
    $('inventory-close').addEventListener('click', () => this.toggleInventory());
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !$('settings').classList.contains('hidden')) { e.preventDefault(); this.closeSettings(); return; }
      if (this.typing) {
        if (e.code === 'Enter' && !e.isComposing) { const tx = $('type-input').value.trim(); this.closeTyping(); if (tx) this.typedCast(tx); }
        else if (e.code === 'Escape') this.closeTyping();
        return;
      }
      if (this.mode === 'menu') return;
      if (e.code === 'KeyI' && this.royale && !e.repeat) { e.preventDefault(); this.toggleInventory(); return; }
      if (e.code === 'Escape' && !$('inventory').classList.contains('hidden')) { this.toggleInventory(); return; }
      if (e.code === 'Tab' && !$('inventory').classList.contains('hidden')) { e.preventDefault(); $('inventory-close').focus(); return; }
      if (this.paused) return;
      this.keys[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'Space' && this.player?.onShip) this.royale?.jump(this.player);
      if (e.code === 'Enter' && this.royale?.over) { e.preventDefault(); this.startMode('royale'); return; } // play again
      if (e.code === 'Enter') { e.preventDefault(); this.openTyping(); }
      if (e.code === 'KeyF') this.dashPlayer();
      if (e.code === 'KeyJ') this.hud.toggleJevView();
      if (e.code === 'KeyT' && this.mode === 'practice') { const b = this.bots[0]; if (b?.brain) { b.brain.dummy = !b.brain.dummy; this.hud.banner('', t(b.brain.dummy ? 'train.calm' : 'train.fight'), 1.8); } } // the golem fights back (or not)
      if (e.code === 'KeyM') { this.hud.bigMap = !this.hud.bigMap; $('minimap-wrap').classList.toggle('big', this.hud.bigMap); } // whole-island map
      if (this.royale && this.player && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) this.royale.drink(this.player, ['hp', 'mana', 'shield'][+e.code.slice(5) - 1]);
      if (e.code === 'KeyE' && this.royale && this.player) this.royale.interact(this.player); // take / swap loot, open chests
      if (e.code === 'KeyQ' && this.royale && this.player && !this.royale.useRune(this.player) && this.player.gear?.rune) audio.ui?.('click');
      if (e.code === 'Tab') { e.preventDefault(); if (this.royale && !this.royale.over) this.royale.showResults(); }
    });
    addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Tab' && this.royale && !this.royale.over && this.player?.alive) document.getElementById('br-results')?.classList.add('hidden'); // hold Tab: standings
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.mode === 'menu' || this.paused || this.typing) return;
      if ((e.button === 0 || e.button === 2) && this.cancelPendingCast()) { e.preventDefault(); return; }
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
  toggleInventory() {
    if (!this.royale || !this.player?.alive || this.royale.over) return;
    const open = !$('inventory').classList.contains('hidden');
    if (this.paused && !open) return;
    if (open) { this.showScreen(null); this.lock(); }
    else {
      this.royale.updateInventory();
      this.showScreen('inventory');
      document.exitPointerLock?.();
      $('inventory-close').focus();
    }
  }
  openTyping() { this.typing = true; $('type-box').classList.remove('hidden'); const i = $('type-input'); i.value = ''; setTimeout(() => i.focus(), 0); this.keys = {}; }
  closeTyping() { this.typing = false; $('type-box').classList.add('hidden'); $('type-input').blur(); }
  dashPlayer() {
    if (this.mode === 'online') { if (this.online.canPlay() && !this.paused) this.online.send({ type: 'dash' }); return; }
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
    this.settings.ui = uiLanguage(ui); setLang(this.settings.ui); saveSettings(this.settings);
    document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('on', b.dataset.lang === ui));
    this.uiLanguagePicker?.setValue(this.settings.ui);
    $('set-lang-help').textContent = t('set.voice.help');
    this.refreshJevLabels();
    if (this.voiceInit) $('menu-mic-message').textContent = t('menu.mic.ready');
    $('howto-elements').innerHTML = ELEMENT_KEYS.map((k) => `<span class="chip">${elChip(k)} ${elName(k)}</span>`).join('');
    $('howto-shapes').innerHTML = Object.keys(SHAPES).map((k) => `<span class="chip form-chip" title="${FORM_GUIDE[k]?.[ui === 'ja' ? 1 : 0] || ''}">${SHAPES[k].icon} <b>${shapeName(k)}</b> <small>${FORM_GUIDE[k]?.[ui === 'ja' ? 1 : 0] || ''}</small></span>`).join('');
    const ja = ui === 'ja';
    $('howto-royale').innerHTML = royaleGuide(ja);
    $('howto-reactions').innerHTML = REACTIONS.map(([n, c, en, jp]) => `<li><b style="color:${c}">${reactName(n)}</b> ${ja ? jp : en}</li>`).join('');
    if (this.player && this.player.name && !this.settings.name) { this.player.name = t('you'); $('self-name').textContent = this.player.name; }
  }
  bindMenus() {
    const s = this.settings;
    this.uiLanguagePicker = bindLanguagePicker({
      input: $('set-ui'), toggle: $('set-ui-toggle'), list: $('ui-language-list'),
      languages: UI_LANGUAGES, value: s.ui, onSelect: ui => { this.applyLanguage(ui); void this.refreshVoiceDownload?.(); },
      invalidMessage: () => t('set.ui.invalid'),
    });
    this.voiceLanguagePicker = bindLanguagePicker({
      input: $('set-lang'), toggle: $('set-lang-toggle'), list: $('voice-language-list'),
      languages: VOICE_LANGUAGES, value: s.lang, normalizeCustom: recognitionLanguage,
      invalidMessage: () => t('set.voice.invalid'),
      onSelect: language => { s.lang = language; saveSettings(s); this.voice.setLang(language); void this.preloadSpellCache(language); void this.refreshVoiceDownload?.(); },
    });
    $('menu-enable-voice').addEventListener('click', () => { void this.enableVoice(); });
    $('menu-disable-voice').addEventListener('click', () => {
      this.voice.dispose(); this.voiceInit = false;
      $('menu-enable-voice').hidden = false; $('menu-disable-voice').hidden = true;
      $('menu-mic-badge').textContent = 'OFF'; $('menu-mic-badge').classList.remove('ready');
      $('menu-meter-fill').style.width = '0%';
      $('menu-mic-message').textContent = t('menu.mic.permission');
    });
    document.querySelectorAll('.mode-card, .btn').forEach((b) => b.addEventListener('mouseenter', () => audio.ui('hover')));
    document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
      audio.init(); audio.ui('click');
      const a = b.dataset.action;
      if (a === 'duel') { this.backTo = 'menu'; this.showScreen('duel-setup'); }
      else if (a === 'begin-duel') this.startMode('duel');
      else if (a === 'practice') this.startMode('practice');
      else if (a === 'royale') {
        this.backTo = 'menu'; this.showScreen('royale-setup');
        const r = royaleRecord(); $('royale-record').textContent = r.matches ? t('royale.record', { m: r.matches, w: r.wins, b: r.best ? '#' + r.best : '—', k: r.kills }) : t('royale.firstTime');
      }
      else if (a === 'begin-royale') this.startMode('royale');
      else if (a === 'howto') { this.backTo = this.mode === 'menu' ? 'menu' : 'pause'; this.showScreen('howto'); }
      else if (a === 'settings') this.openSettings();
      else if (a === 'close-settings') this.closeSettings();
      else if (a === 'resume') { this.showScreen(null); this.lock(); }
      else if (a === 'quit') this.endToMenu();
    }));
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { audio.ui('click'); this.showScreen(this.backTo || 'menu'); this.backTo = null; }));
    document.querySelectorAll('.lang-switch button').forEach((b) => b.addEventListener('click', () => {
      const ui = b.dataset.lang; this.applyLanguage(ui);
      s.lang = defaultRecognitionLanguage(ui); this.voiceLanguagePicker.setValue(s.lang); this.voice.setLang(s.lang); saveSettings(s);
      void this.preloadSpellCache(s.lang);
    }));
    const bind = (id, key, conv = (v) => v, prop = 'value', after) => {
      const el = $(id); el[prop] = s[key];
      el.addEventListener('change', () => { s[key] = conv(el[prop]); saveSettings(s); after?.(); });
      el.addEventListener('input', () => { s[key] = conv(el[prop]); after?.(); });
    };
    bind('set-diff', 'diff', String, 'value', () => { $('set-rdiff').value = s.diff; });
    bind('set-rdiff', 'diff', String, 'value', () => { $('set-diff').value = s.diff; });
    bind('set-lobby', 'lobby', Number);
    bind('set-teams', 'royaleTeams', Number);
    bind('set-quality', 'quality', Number, 'value', () => { $('settings-reload').textContent = t('set.reload'); });
    bind('set-chantsize', 'chantSize', Number, 'value', () => {
      document.documentElement.style.setProperty('--chant-text-size', `${s.chantSize}px`);
      $('set-chantsize-value').textContent = `${s.chantSize} px`;
    });
    $('set-chantsize-value').textContent = `${s.chantSize} px`;
    bind('set-sens', 'sens', Number);
    bind('set-fov', 'fov', Number, 'value', () => {
      $('set-fov-value').textContent = `${s.fov}°`;
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.fx.setScale(size.y, s.fov);
      this.stillKey = null;
    });
    $('set-fov-value').textContent = `${s.fov}°`;
    bind('set-anime', 'anime', Boolean, 'checked', () => { MageModel.anime = s.anime; if (s.anime) loadAnimeMage(); });
    MageModel.anime = !!s.anime; if (s.anime) loadAnimeMage();
    bind('set-calm', 'calm', Boolean, 'checked', () => { this.fx.calm = s.calm; });
    this.fx.calm = !!s.calm;
    bind('set-vol', 'vol', Number, 'value', () => audio.setVolume(s.vol));
    bind('set-music', 'music', Number, 'value', () => audio.setMusic(s.music));
    bind('set-provider', 'spellProvider', String, 'value', () => {
      this.pendingJevCast = null; this.spec = null; this.channel = null; this.previewCost = 0; this.hud.preview(null);
      this.checkJev();
    });
    $('set-loadmodel').addEventListener('click', () => this.loadLocalModel());
    bind('set-jev', 'useJev', Boolean, 'checked', () => { this.pendingJevCast = null; this.spec = null; this.previewCost = 0; this.hud.preview(null); });
    bind('set-botvoice', 'botVoice', Boolean, 'checked');
    const voiceOptions = () => {
      this.voice.preferLocal = s.localVoice; this.voice.prewarm = true;
      this.voice.cancelChant(); this.voice.prepareNext();
    };
    bind('set-localvoice', 'localVoice', Boolean, 'checked', voiceOptions);
    this.refreshVoiceDownload = bindVoiceDownload({
      button: $('set-downloadvoice'), status: $('voice-download-status'), getLanguage: () => s.lang,
      onInstalled: async (lang) => {
        this.voice.localByLanguage.set(lang, 'available'); this.voice.localFailed.delete(lang);
        if (this.voice.lang === lang) await this.voice.checkLocal();
      },
    });
    document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', this.refreshVoiceDownload));
    audio.volume = s.vol; audio.musicVolume = s.music;
    this.applyLanguage(s.ui);
  }

  // ------------------------------------------------------------ physics
  stepBody(...args) { return stepBody.apply(this, args); }

  // ------------------------------------------------------------ main loop
  updatePerformance(rendered = true) {
    const now = performance.now();
    if (document.hidden) { this.fpsSample = null; return; }
    const sample = this.fpsSample ||= { at: now, frames: 0 };
    if (rendered) sample.frames++;
    const elapsed = now - sample.at;
    if (elapsed >= 500) {
      $('performance-fps').textContent = String(Math.round(sample.frames * 1000 / elapsed));
      sample.at = now; sample.frames = 0;
    }
    const calls = this.mode === 'online' && !this.online.ws?.host ? this.online.jevCalls || 0 : askJev.calls || 0;
    if (calls !== this.displayedJevCalls) {
      $('performance-jev').textContent = String(calls);
      this.displayedJevCalls = calls;
    }
  }
  loop() {
    requestAnimationFrame(() => this.loop());
    const raw = Math.min(this.clock.getDelta(), 0.05);
    if (this.preparing) return; // Warm-up owns the renderer; no menu fights or competing frames.
    if (performance.now() >= (this.cacheCheckAt || 0) && !this.chanting && !this.grace && !this.pendingJevCast) {
      this.cacheCheckAt = performance.now() + 60000;
      void this.checkJev();
    }
    if (this.slowmo > 0) { this.slowmo -= raw; this.timeScale = 0.25; } else this.timeScale += (1 - this.timeScale) * Math.min(1, raw * 6);
    const dt = this.mode === 'online' ? raw : this.paused ? 0 : raw * this.timeScale;
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
    // music gets out of the way of your voice while chanting, dips on pause, and muffles as you near death
    const pl = this.player, hpF = pl ? pl.hp / pl.maxHp : 1;
    audio.musicMix(this.paused ? 0.45 : this.chanting ? 0.4 : 1, pl && this.mode !== 'menu' ? (!pl.alive ? 0.8 : hpF < 0.3 ? 0.35 + (0.3 - hpF) * 1.5 : 0) : 0);
    const u = this.post.uniforms, p = this.player;
    u.uCA.value = this.fx.shake * 3 + this.hud.hurt * 2 + (p?.frozen > 0 ? 1 : 0);
    this.domainT = Math.max(0, (this.domainT || 0) - raw);
    if (p?.frozen > 0) u.uTint.value.set(0.85, 0.95, 1.15); else if (p && !p.alive) u.uTint.value.set(0.7, 0.7, 0.75); else if (this.domainT <= 0) u.uTint.value.set(1, 1, 1);
    u.uSat.value = p && !p.alive ? 0.3 : 1.04;
    // a paused world is a still image: redraw it only when the post grade or the canvas size changes
    const still = dt === 0 && this.mode !== 'menu' && !this.debugCam && `${u.uCA.value}|${u.uSat.value}|${u.uTint.value.toArray()}`;
    if (still && still === this.stillKey) { this.updatePerformance(false); return; }
    this.stillKey = still;
    if (this.debugCam) { // observer view for rendering only; aim and cast origin keep using the player's camera
      const cam = this.camera, pos = cam.position.clone(), q = cam.quaternion.clone(), vm = this.viewModel.group.visible;
      cam.position.set(...this.debugCam.pos); cam.lookAt(...this.debugCam.target); this.viewModel.group.visible = false;
      this.post.render(TIME.value);
      cam.position.copy(pos); cam.quaternion.copy(q); cam.updateMatrixWorld(); this.viewModel.group.visible = vm;
    } else this.post.render(TIME.value);
    this.updatePerformance();
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
      if (p.alive && !this.typing && !this.paused && (this.mode !== 'online' || this.online.canPlay())) {
        const f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
        if (this.keys.KeyW) wish.add(f); if (this.keys.KeyS) wish.sub(f); if (this.keys.KeyD) wish.add(r); if (this.keys.KeyA) wish.sub(r);
        if (wish.lengthSq()) wish.normalize();
      }
      const sprint = this.keys.ShiftLeft && p.stamina > 1 && !this.chanting;
      if (sprint && wish.lengthSq()) p.stamina -= dt * 18;
      const speed = (sprint ? 10.5 : 7) * (this.chanting || this.channel ? 0.6 : 1);
      if (this.mode === 'online') this.online.input(dt, wish);
      const fallV = p.vel.y, wasGrounded = p.grounded;
      if (p.alive && !p.onShip && (this.mode !== 'online' || this.online.canPlay())) this.stepBody(p, dt, wish, speed, !this.paused && this.keys.Space, !this.paused && this.keys.Space, !this.paused && (this.keys.ControlLeft || this.keys.KeyC));
      else if (p.onShip) { const o = (p.deckOff ||= { x: Math.cos(p.deckA) * 4.2, z: Math.sin(p.deckA) * 4.2 }); o.x += wish.x * 4 * dt; o.z += wish.z * 4 * dt; const L = Math.hypot(o.x, o.z); if (L > 6.8) { o.x *= 6.8 / L; o.z *= 6.8 / L; } } // stroll the ferry deck
      const onStone = Math.hypot(p.pos.x, p.pos.z) < 10.5 || p.pos.y - this.world.heightAt(p.pos.x, p.pos.z) > 0.25;
      if (!wasGrounded && p.grounded && fallV < -5) audio.land(clamp(-fallV / 22), onStone);
      if (p.alive && p.hp < p.maxHp * 0.3) { this.beatT = (this.beatT || 0) - dt; if (this.beatT <= 0) { this.beatT = 0.55 + (p.hp / p.maxHp) * 1.5; audio.heartbeat(); } }
      if (this.mode !== 'online') p.updateStatus(dt, this);
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
      this.fovKick = Math.max(0, (this.fovKick || 0) - dt * 30);
      const fovT = this.settings.fov + (sprint && hs > 8 ? 6 : 0) - this.chantProgress * 4 + (this.settings.calm ? 0 : this.fovKick);
      if (Math.abs(this.camera.fov - fovT) > 0.05) { this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * 6); this.camera.updateProjectionMatrix(); }
      // aim ray incl. enemies
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      const rc = this.world.raycast(this.camera.position, dir, 90, 0.5);
      let dist = rc.dist;
      for (const o of this.combatants) {
        if (o === p || !o.alive || o.owner === p) continue;
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
        const useJev = this.settings.useJev || this.mode === 'online';
        const local = text && !useJev ? localParse(text) : null;
        this.speculate(text);
        const meta = { chantSeconds: this.chantT, loudness: this.voice.peak };
        const magic = this.settings.instantCast && this.spec?.latestMagic?.text === text ? this.spec.latestMagic : null;
        const pv = useJev ? buildJevSpec(magic?.text || text, magic?.j || this.bestJev(text), meta) : local ? buildSpec(text, local, null, meta) : null;
        this.hud.chant(text || '…', ''); this.hud.preview(pv); this.previewCost = pv ? effectiveManaCost(this.player, pv) : 0;
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
      if (this.mode === 'practice' && !this.chanting && !this.hintErr) {
        this.tryT = (this.tryT ?? 3) - dt;
        if (this.tryT <= 0) { this.tryT = 9; const list = TRY[getLang() === 'ja' ? 'ja' : 'en']; this.tryI = ((this.tryI ?? -1) + 1) % list.length; this.hud.hintHTML?.(t(this.voiceInit ? 'hint.chant' : 'hint.mic') + ' · ' + t('hint.try') + ' <b>“' + list[this.tryI] + '”</b>'); }
      }
      this.boltCd -= dt;
      if (this.mouse.lmb) this.fireBolt();
      this.viewModel.update(dt, { speed: hs, chanting: this.chanting || !!this.channel, charge: this.chantProgress, grounded: p.grounded, voiceLevel: this.chanting ? this.voice.level : 0 });
      this.viewModel.group.visible = p.alive;
      if (p.grounded && hs > 3) { this.footT -= dt; if (this.footT <= 0) { this.footT = sprint ? 0.32 : 0.45; audio.footstep(onStone, sprint, p.pos.y < SEA_Y + 0.35); } }
    }
    for (const b of this.bots) {
      const out = b.brain.update(dt);
      if (out.dash && b.stamina > 30) { b.stamina -= 30; b.vel.addScaledVector(out.dash, 15); }
      if (b.alive && !b.onShip) this.stepBody(b, dt, out.wish, out.speed || 6, out.jump, !!out.glide);
      b.updateStatus(dt, this);
    }
    for (const c of this.combatants) {
      if (!c.model) continue;
      c.model.root.position.copy(c.pos);
      c.model.root.rotation.y = c.yaw;
      const eye = this.debugCam ? this.debugCam.pos : this.camera.position; // spectating renders from the observer camera
      const camD = Array.isArray(eye) ? Math.hypot(c.pos.x - eye[0], c.pos.y - eye[1], c.pos.z - eye[2]) : c.pos.distanceTo(eye);
      c.model.lod?.(camD > 62 ? 3 : camD > 40 ? 2 : camD > 22 ? 1 : 0);
      if (c.hitFlash > 0) c.hitFlash = Math.max(0, c.hitFlash - dt * 5);
      // Physics and AI stay at full rate. Only distant cosmetic animation is sampled less often.
      c.modelDt = (c.modelDt || 0) + dt;
      const visualInterval = this.royale && camD > 40 ? (camD > 140 ? 0.2 : 1 / 15) : 0;
      if (c.modelDt < visualInterval) continue;
      const visualDt = c.modelDt; c.modelDt = 0;
      c.model.update(visualDt, { hit: c.hitFlash || 0, speed: Math.hypot(c.vel.x, c.vel.z), chanting: c.chanting, pitch: c.pitch, frozen: c.frozen > 0, shield: c.shield, shieldEl: c.shieldEl, aura: c.aura?.el });
      // afflictions burn brightest; enhancements glow softer
      const stEl = c.dots[0]?.el || Object.keys(c.enh)[0] || null;
      c.model.status(stEl, c.dots.length ? 0.9 : 0.45, visualDt);
      if (this.royale && camD > 60) continue;
      if (c.chanting && Math.random() < 0.6) this.fx.element(c.brain?.favEl || 'arcane', c.model.handWorld(new THREE.Vector3()), { count: 1, speed: 0.5, size: 0.12, life: 0.5 });
      // footfall dust when running on the ground (earthy on paths, pale on grass)
      const run = Math.hypot(c.vel.x, c.vel.z);
      if (c.grounded && run > 4 && Math.random() < dt * run * 0.9) {
        this.fx.smoke.emit({ x: c.pos.x + rand(-0.2, 0.2), y: c.pos.y + 0.08, z: c.pos.z + rand(-0.2, 0.2), vx: -c.vel.x * 0.08 + rand(-0.3, 0.3), vy: rand(0.3, 0.7), vz: -c.vel.z * 0.08 + rand(-0.3, 0.3), life: 0.8, size: 0.3, size1: 0.9, color: DUST, alpha: 0.35, drag: 2, frame: 0 });
      }
    }
    this.spells.update(dt);
    this.royale?.update(dt);
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
    const T = at ?? ({ orb: 0.3, barrage: 0.45, crescent: 0.28, funnels: 1.2, beam: 0.7, tornado: 1.3, meteor: 1.5, nova: 0.25, spikes: 0.55, wall: 0.8, barrier: 0.8, vortex: 1.2, chain: 0.12, storm: 1.8, ward: 0.6, field: 1.2, wave: 0.9, enhance: 0.8, hand: 1.0, whip: 0.3, prison: 0.6, decoy: 0.8, drain: 0.8, beast: 1.6, halo: 1.0, sword: 0.5, rush: 0.2, totem: 1.5, mark: 1.0 }[sh] ?? 0.6);
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
