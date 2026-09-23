import * as THREE from 'three';
import { TIME } from './shaders.js';
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
import { Net } from './net.js';
import { audio } from './audio.js';
import { t, setLang, getLang } from './i18n.js';
import { localParse, askJev, buildSpec, weakenSpec, boltSpec, finalizeSpec } from './spellbook.js';
import { ELEMENTS, SHAPES, ELEMENT_KEYS, elName, shapeName, reactName } from './elements.js';
import { clamp, rand, TAU } from './util.js';

const $ = (id) => document.getElementById(id);
const p0EarthFree = (c) => c.enhP('earth') === null;
const hex = (n) => '#' + new THREE.Color(n).getHexString();

// ------------------------------------------------------------------ settings
const DEFAULTS = { ui: (navigator.language || 'en').startsWith('ja') ? 'ja' : 'en', lang: '', diff: 'normal', quality: 1, sens: 1, vol: 0.8, music: 0.35, useJev: true, botJev: true, botVoice: true, handsFree: false, name: '' };
function loadSettings() {
  let s; try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('voxarcana') || '{}') }; } catch { s = { ...DEFAULTS }; }
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

class Game {
  constructor() {
    this.settings = loadSettings();
    setLang(this.settings.ui);
    this.mode = 'menu';
    this.combatants = []; this.bots = []; this.remotes = new Map();
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
    this.net = new Net();
    initViewEnv(this.renderer);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.group.visible = false;
    this.bindInput(); this.bindMenus(); this.onResize();
    this.checkJev();
    this.startAttract();
    this.clock = new THREE.Clock();
    $('loading').classList.add('hidden');
    this.loop();
  }

  // ------------------------------------------------------------ rendering
  initRenderer() {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality > 0 ? 1.25 : 1));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.03, 4000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    addEventListener('resize', () => this.onResize());
  }
  onResize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight); this.post?.setSize(innerWidth, innerHeight);
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.fx.setScale(v.y, this.camera.fov);
  }
  screenFlash(color = '#fff', a = 0.5) { $('screen-flash').style.background = color; this.hud.flash = Math.max(this.hud.flash, a); }

  // ------------------------------------------------------------ Jev status
  async checkJev() {
    try {
      const s = await (await fetch('/api/status')).json();
      this.jevOnline = !!s.jev.keyLoaded; this.jevModel = s.jev.model;
      this.serverUp = true;
    } catch { this.jevOnline = false; this.serverUp = false; }
    this.refreshJevLabels();
  }
  refreshJevLabels() {
    this.hud.jev(this.jevOnline ? 'on' : 'off', t(this.serverUp === false ? 'jev.offline' : this.jevOnline ? 'jev.ready' : 'jev.nokey'));
    $('menu-status').innerHTML = this.serverUp === false ? t('menu.noserver') : this.jevOnline ? `${t('menu.jevok')} · <span style="opacity:.7">${this.jevModel}</span>` : t('menu.nokey');
  }
  noteJev(j) {
    if (!j) return;
    if (j.ok) { this.jevFails = 0; this.jevOnline = true; this.hud.jev('on', `Jev · ${j.cached ? 'cached' : j.latency + 'ms'}`); }
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
    this.spells.clear();
    for (const c of [...this.combatants]) this.removeCombatant(c);
    this.bots = []; this.remotes.clear(); this.player = null;
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
    const p = (this.player = this.makeCombatant({ id: 'me', name: this.settings.name || t('you'), isPlayer: true }));
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
    audio.init(); this.initVoice();
    this.clearArena();
    this.mode = mode;
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
    } else if (mode === 'online') {
      this.hud.round(t('round.online', { room: this.netRoom }));
      this.spawnAt(p, rand(0, TAU), rand(10, 40));
    }
    this.hud.show(true); this.hud.setEl('arcane'); this.viewModel.setElement('arcane');
    this.hud.scoreboard(mode === 'online' ? [] : null);
    this.hud.hint('hint.chant'); this.hud.chant('', ''); this.hud.preview(null);
    this.showScreen(null);
    this.lock();
  }
  endToMenu() {
    if (this.mode === 'online') this.net.close();
    document.exitPointerLock?.();
    this.startAttract();
    this.showScreen('menu');
  }
  showScreen(id) {
    for (const s of ['menu', 'online', 'settings', 'howto', 'pause']) $(s).classList.toggle('hidden', s !== id);
    this.paused = id === 'pause' || ((id === 'settings' || id === 'howto') && this.mode !== 'menu');
  }
  lock() { $('c').requestPointerLock?.()?.catch?.(() => {}); }

  // ------------------------------------------------------------ voice & casting
  async initVoice() {
    if (this.voiceInit) return; this.voiceInit = true;
    this.voice.lang = this.settings.lang; this.voice.handsFree = this.settings.handsFree;
    this.voice.onStatus = (s) => {
      this.hud.micState(s === 'listening');
      if (s === 'listening' && this.hintErr) { this.hintErr = false; this.hud.hint('hint.chant'); }
      if (s === 'unsupported') this.hud.hint('hint.noSR');
      else if (s === 'mic-denied') this.hud.hint('hint.mic');
      else if (s.startsWith('error:network')) { this.hud.hint('hint.net'); this.hintErr = true; }
    };
    this.voice.onAuto = async (text) => {
      if (this.mode === 'menu' || this.chanting || localParse(text).isSpell < 1) return;
      const meta = { chantSeconds: text.length / 12, loudness: this.voice.level };
      const j = this.settings.useJev && this.jevOnline ? await askJev(text, meta) : null;
      this.castIncantation(text, meta, j);
    };
    await this.voice.init(audio.ctx);
  }
  beginChant() {
    const p = this.player;
    if (!p || !p.canAct() || this.chanting || this.channel || this.paused) return;
    this.grace = null; // a new chant always wins over a pending empty one
    this.chanting = true; this.chantT = 0; p.chanting = true;
    this.spec = { map: new Map(), latest: null, order: 0, lastText: '', lastSend: 0, inflight: 0 };
    this.voice.beginChant();
    audio.chantStart(this.lastEl);
    this.hud.chant('', ''); this.hud.preview(null);
  }
  // speculative Jev: interpret the chant while it is still being spoken
  speculate(text) {
    const S = this.spec;
    if (!S || !text || !this.settings.useJev || !this.jevOnline) return;
    const now = performance.now();
    if (text === S.lastText || now - S.lastSend < 160 || S.inflight >= 3) return;
    S.lastText = text; S.lastSend = now; S.inflight++;
    const order = ++S.order;
    askJev(text, { chantSeconds: this.chantT, loudness: this.voice.peak }).then((j) => {
      S.inflight--;
      this.noteJev(j);
      if (!j.ok) return;
      S.map.set(text, j);
      if (!S.latest || order > S.latest.order) S.latest = { order, text, j };
    });
  }
  bestJev(text) {
    const S = this.spec; if (!S) return null;
    if (S.map.has(text)) return S.map.get(text);
    return S.latest ? { ...S.latest.j, partial: true } : null;
  }
  endChant() {
    if (!this.chanting) return;
    this.chanting = false; this.player.chanting = false; audio.chantStop();
    if (!this.voice.rec) { this.hud.chant(t('chant.nomic'), 'fizzle'); return; }
    const res = this.voice.endChant();
    if (res.text) { this.castIncantation(res.text, res, this.bestJev(res.text)); return; }
    // nothing recognised yet: allow a short grace for late recognition (a new press cancels it instantly)
    this.grace = { win: res.win, meta: res, until: performance.now() + 700 };
  }
  castIncantation(text, meta, jev) {
    const p = this.player; if (!p || !p.alive) return;
    const local = localParse(text);
    const spec = buildSpec(text, local, jev, meta);
    this.previewCost = 0;
    if (spec.isSpell < 0.65) { this.hud.chant('“' + text + '” ' + t('chant.nomagic'), 'fizzle'); audio.ui('fizzle'); this.hud.preview(null); return; }
    this.performCast(spec, true);
  }
  performCast(spec, addToGrimoire) {
    const p = this.player;
    if (!p.canAct()) { this.hud.chant(t('chant.interrupted'), 'fizzle'); audio.ui('fizzle'); return; }
    spec = { ...spec, cost: Math.round(spec.cost * p.costMult()) };
    if (p.mana < spec.cost) {
      const f = Math.max(0.25, p.mana / spec.cost);
      spec = weakenSpec(spec, f); p.mana = 0;
      this.hud.feed(`<span style="color:#ff9a8a">${t('feed.starved')}</span>`);
    } else p.mana -= spec.cost;
    this.previewCost = 0;
    this.lastEl = spec.element; this.viewModel.setElement(spec.element); this.hud.setEl(spec.element);
    this.spells.cast(spec, p);
    this.viewModel.kick = 1;
    this.hud.chant('“' + spec.text + '”', '');
    this.hud.preview(null);
    this.hud.spellCard(spec);
    this.onCast(p, spec);
    if (spec.tierInt >= 8 && this.mode !== 'online') { this.slowmo = 0.35; this.screenFlash(hex(ELEMENTS[spec.element].color), 0.12); }
    if (this.mode === 'online') { const a = this.playerAim; this.net.send({ t: 'cast', spec: { ...spec, jevError: undefined }, d: a.dir.toArray(), p: a.point.toArray() }); }
  }
  typedCast(text) {
    const units = /[぀-ヿ一-龯]/.test(text) ? text.length / 3 : text.trim().split(/\s+/).length;
    const dur = Math.min(3.5, 0.3 + units * 0.16);
    const ch = (this.channel = { t: 0, dur, text, typed: true, jev: null });
    if (this.settings.useJev && this.jevOnline) askJev(text, { chantSeconds: dur, loudness: 0.4 }).then((j) => { this.noteJev(j); if (j.ok) ch.jev = j; });
    audio.chantStart(localParse(text).element);
    const pv = finalizeSpec({ ...localParse(text), text }); this.hud.preview(pv); this.previewCost = pv.cost; this.hud.chant('“' + text + '”', '');
  }
  fireBolt() {
    const p = this.player;
    if (!p || !p.canAct() || this.boltCd > 0 || p.mana < 3 || this.chanting) return;
    this.boltCd = p.enhP('lightning') !== null ? 0.18 : 0.28; p.mana -= 3;
    const spec = boltSpec(this.lastEl);
    this.spells.cast(spec, p);
    this.viewModel.flick = 1;
    audio.cast(this.lastEl, 0.1, null);
    if (this.mode === 'online') this.net.send({ t: 'cast', spec, d: this.playerAim.dir.toArray(), p: this.playerAim.point.toArray() });
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
      if (this.mode === 'online' && hit.src && hit.src.remoteId) this.net.send({ t: 'dmg', by: hit.src.remoteId, amount: res.dmg, el, rx: res.reaction ? { name: res.reaction.name, color: res.reaction.color } : null, pt: pos.toArray() });
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
    const fog0 = new THREE.Color(0xb4cde6), sun0 = 3.1, hemi0 = 1.15;
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
  onBotChant(c, text) {
    if (this.mode === 'menu' || !this.settings.botVoice || !window.speechSynthesis) return;
    const ja = getLang() === 'ja';
    const u = new SpeechSynthesisUtterance(text);
    u.lang = ja ? 'ja-JP' : 'en-US'; u.pitch = ja ? 0.8 : 0.6; u.rate = ja ? 1.1 : 1.05; u.volume = 0.9 * this.settings.vol;
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(ja ? 'ja' : 'en'));
    const pref = ja ? vs.find((v) => /Google|Ichiro|Keita/i.test(v.name)) || vs[0] : vs.find((v) => /Google UK English Male|Daniel|David|Mark/i.test(v.name)) || vs[0];
    if (pref) u.voice = pref;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  onBotChantCancel() { if (this.mode !== 'menu') speechSynthesis?.cancel(); }
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
    } else if (this.mode === 'online' && target === this.player) {
      this.net.send({ t: 'dead', by: killer?.remoteId ?? null });
      setTimeout(() => { if (this.mode === 'online' && this.player) this.spawnAt(this.player, rand(0, TAU), rand(10, 45)); }, 3000);
    } else if (this.mode === 'menu') {
      setTimeout(() => { if (this.mode === 'menu' && this.combatants.includes(target)) this.spawnAt(target, rand(0, TAU), 16); }, 2500);
    }
  }

  // ------------------------------------------------------------ online
  async joinOnline(name, room) {
    this.netRoom = room; this.settings.name = name;
    $('net-msg').textContent = '…';
    const n = this.net;
    n.on('join', (m) => { this.addRemote(m.from, m.name); this.hud.feed(t('feed.enter', { who: `<b>${m.name}</b>` })); });
    n.on('leave', (m) => { const r = this.remotes.get(m.from); if (r) { this.hud.feed(t('feed.left', { who: `<b>${r.name}</b>` })); this.removeCombatant(r); this.remotes.delete(m.from); } });
    n.on('state', (m) => { const r = this.remotes.get(m.from) || this.addRemote(m.from, m.name || 'Mage'); this.applyRemoteState(r, m); });
    n.on('cast', (m) => {
      const r = this.remotes.get(m.from); if (!r || !r.alive) return;
      r.aimDir.fromArray(m.d); r.aimPoint.fromArray(m.p); r.aimHold = 0.6;
      r.model?.setElement(m.spec.element);
      this.spells.cast(m.spec, r); if (!m.spec.basic) this.onCast(r, m.spec);
      if (r.model) r.model.castAnim = 1;
    });
    n.on('dmg', (m) => {
      const victim = this.remotes.get(m.from); if (!victim) return;
      this.hud.damage(new THREE.Vector3().fromArray(m.pt), m.amount, m.el, m.rx);
      if (m.by === n.id) { this.hud.hitm = 1; audio.hitmarker(); }
    });
    n.on('dead', (m) => {
      const v = this.remotes.get(m.from); if (!v) return;
      v.alive = false; v.deaths++; if (v.model) v.model.root.visible = false;
      const killer = m.by === n.id ? this.player : this.remotes.get(m.by);
      if (killer) killer.kills++;
      this.fx.explosion('arcane', v.center(), 3, 1);
      this.hud.feed(`<span style="color:#ff9a8a">${t('feed.fell', { who: v.name })}${killer ? t('feed.to', { who: killer === this.player ? t('you') : killer.name }) : ''}</span>`);
      if (killer === this.player) audio.ui('victory');
    });
    n.on('close', () => { if (this.mode === 'online') { this.hud.banner(t('ban.dc'), '', 3); setTimeout(() => this.endToMenu(), 2000); } });
    try {
      const w = await n.connect(room, name);
      this.startMode('online');
      for (const p of w.peers) this.addRemote(p.id, p.name);
      this.hud.feed(t('feed.joined', { room: `<b>${room}</b>`, n: w.peers.length }));
    } catch (e) { $('net-msg').textContent = '✕ ' + e.message; }
  }
  addRemote(id, name) {
    if (this.remotes.has(id)) return this.remotes.get(id);
    const hue = (id * 0.23) % 1;
    const r = this.makeCombatant({ id: 'r' + id, name, authoritative: false }, { robe: new THREE.Color().setHSL(hue, 0.5, 0.22).getHex(), trim: 0xe0b95a, accent: new THREE.Color().setHSL(hue, 0.9, 0.6).getHex(), hat: new THREE.Color().setHSL(hue, 0.4, 0.12).getHex() });
    r.remoteId = id; r.target = new THREE.Vector3(); r.aimDir = new THREE.Vector3(0, 0, -1); r.aimPoint = new THREE.Vector3(); r.aimHold = 0;
    r.getAim = () => ({ origin: r.eye(new THREE.Vector3()), dir: r.aimDir, point: r.aimPoint });
    r.alive = false; if (r.model) r.model.root.visible = false;
    this.remotes.set(id, r);
    return r;
  }
  applyRemoteState(r, m) {
    r.name = m.name || r.name;
    r.target.fromArray(m.p); r.vel.fromArray(m.v);
    if (!r.alive && m.alive) { r.pos.copy(r.target); if (r.model) r.model.root.visible = true; }
    r.alive = m.alive; r.yaw = m.yaw; r.pitch = m.pitch; r.hp = m.hp; r.shield = m.sh; r.frozen = m.fr; r.chanting = m.ch; r.chantText = m.ct || '';
    r.aura = m.au ? { el: m.au, t: 1 } : null; r.kills = m.k; r.deaths = m.dd;
    if (r.aimHold <= 0) {
      r.aimDir.set(-Math.sin(r.yaw) * Math.cos(r.pitch), Math.sin(r.pitch), -Math.cos(r.yaw) * Math.cos(r.pitch));
      r.aimPoint.copy(this.world.raycast(r.eye(new THREE.Vector3()), r.aimDir, 80, 1).point);
    }
  }
  sendState(dt) {
    this.netT = (this.netT || 0) - dt;
    if (this.netT > 0 || !this.player) return;
    this.netT = 1 / 20;
    const p = this.player;
    this.net.send({ t: 'state', name: p.name, p: p.pos.toArray(), v: p.vel.toArray(), yaw: p.yaw, pitch: p.pitch, hp: Math.round(p.hp), sh: Math.round(p.shield), fr: p.frozen, ch: this.chanting, ct: this.chanting ? this.voice.chantText().slice(-120) : '', au: p.aura?.el || null, alive: p.alive, k: p.kills, dd: p.deaths });
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
    $('howto-elements').innerHTML = ELEMENT_KEYS.map((k) => `<span class="chip">${elChip(k)} ${elName(k)}</span>`).join('');
    $('howto-shapes').innerHTML = Object.keys(SHAPES).map((k) => `<span class="chip">${SHAPES[k].icon} ${shapeName(k)}</span>`).join('');
    const ja = ui === 'ja';
    $('howto-reactions').innerHTML = REACTIONS.map(([n, c, en, jp]) => `<li><b style="color:${c}">${reactName(n)}</b> ${ja ? jp : en}</li>`).join('');
    if (this.player && this.player.name && !this.settings.name) { this.player.name = t('you'); $('self-name').textContent = this.player.name; }
  }
  bindMenus() {
    const s = this.settings;
    document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
      audio.init(); audio.ui('click');
      const a = b.dataset.action;
      if (a === 'duel') this.startMode('duel');
      else if (a === 'practice') this.startMode('practice');
      else if (a === 'online') { $('net-name').value = s.name || 'Mage' + Math.floor(Math.random() * 900 + 100); this.showScreen('online'); }
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
    $('net-join').addEventListener('click', () => { s.name = $('net-name').value.trim() || 'Mage'; saveSettings(s); this.joinOnline(s.name, $('net-room').value.trim() || 'arena'); });
    const bind = (id, key, conv = (v) => v, prop = 'value', after) => {
      const el = $(id); el[prop] = s[key];
      el.addEventListener('change', () => { s[key] = conv(el[prop]); saveSettings(s); after?.(); });
      el.addEventListener('input', () => { s[key] = conv(el[prop]); after?.(); });
    };
    bind('set-ui', 'ui', String, 'value', () => { this.applyLanguage(s.ui); s.lang = s.ui === 'ja' ? 'ja-JP' : 'en-US'; $('set-lang').value = s.lang; this.voice.setLang(s.lang); saveSettings(s); });
    bind('set-lang', 'lang', String, 'value', () => this.voice.setLang(s.lang));
    bind('set-diff', 'diff');
    bind('set-quality', 'quality', Number, 'value', () => { $('menu-status').textContent = '↻ reload'; });
    bind('set-sens', 'sens', Number);
    bind('set-vol', 'vol', Number, 'value', () => audio.setVolume(s.vol));
    bind('set-music', 'music', Number, 'value', () => audio.setMusic(s.music));
    bind('set-jev', 'useJev', Boolean, 'checked');
    bind('set-botjev', 'botJev', Boolean, 'checked');
    bind('set-botvoice', 'botVoice', Boolean, 'checked');
    bind('set-handsfree', 'handsFree', Boolean, 'checked', () => (this.voice.handsFree = s.handsFree));
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
    const prevY = c.pos.y;
    c.pos.addScaledVector(c.vel, dt);
    const gy = this.world.groundAt(c.pos.x, c.pos.z, Math.max(prevY, c.pos.y));
    if (c.pos.y <= gy) { c.pos.y = gy; if (c.vel.y < 0) c.vel.y = 0; c.grounded = true; }
    else c.grounded = c.pos.y - gy < 0.08 && c.vel.y <= 0;
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
    const dt = this.paused && this.mode !== 'online' ? 0 : raw * this.timeScale;
    TIME.value += dt;
    if (this.mode === 'menu') this.updateMenuCam(raw);
    if (dt > 0) this.tick(dt, raw);
    this.voice.update();
    audio.updateListener(this.camera);
    const u = this.post.uniforms, p = this.player;
    u.uCA.value = 0.25 + this.fx.shake * 3 + this.hud.hurt * 2 + (p?.frozen > 0 ? 1 : 0);
    this.domainT = Math.max(0, (this.domainT || 0) - raw);
    if (p?.frozen > 0) u.uTint.value.set(0.85, 0.95, 1.15); else if (p && !p.alive) u.uTint.value.set(0.7, 0.7, 0.75); else if (this.domainT <= 0) u.uTint.value.set(1, 1, 1);
    u.uSat.value = p && !p.alive ? 0.3 : 1.12;
    this.post.render(TIME.value);
  }
  updateMenuCam() {
    const tt = (performance.now() / 1000) * 0.05;
    this.camera.position.set(Math.cos(tt) * 34, 7 + Math.sin(tt * 2) * 1.5, Math.sin(tt) * 34);
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
      // chant: live transcript, local preview, speculative Jev, charging orb between the gauntlets
      if (this.chanting) {
        this.chantT += dt;
        const text = this.voice.chantText();
        const local = text ? localParse(text) : null;
        this.speculate(text);
        const pv = local ? buildSpec(text, local, this.bestJev(text), { chantSeconds: this.chantT, loudness: this.voice.peak }) : null;
        this.hud.chant(text || '…', ''); this.hud.preview(pv); this.previewCost = pv?.cost || 0;
        const el = pv?.element || this.lastEl;
        this.hud.setEl(el); this.viewModel.setElement(el); this.viewModel.setTier(pv ? pv.tierInt : 1);
        this.chantAura(dt, pv, el);
        this.chantProgress = clamp(this.chantT / 7);
        audio.chantUpdate(this.chantProgress, el);
        const tip = this.viewModel.tipWorld(new THREE.Vector3());
        if (Math.random() < 0.7) this.fx.element(el, tip, { count: 1, speed: 0.35, size: 0.035 + this.chantProgress * 0.06, life: 0.35 });
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
      if (this.grace) {
        const text = this.voice.textOf(this.grace.win);
        if (text) { const g = this.grace; this.grace = null; this.castIncantation(text, g.meta, this.bestJev(text)); }
        else if (performance.now() > this.grace.until) { this.grace = null; this.hud.chant(t('chant.silence'), 'fizzle'); this.hud.preview(null); this.previewCost = 0; }
      }
      this.boltCd -= dt;
      if (this.mouse.lmb) this.fireBolt();
      this.viewModel.update(dt, { speed: hs, chanting: this.chanting || !!this.channel, charge: this.chantProgress, grounded: p.grounded });
      this.viewModel.group.visible = p.alive;
      if (p.grounded && hs > 3) { this.footT -= dt; if (this.footT <= 0) { this.footT = sprint ? 0.32 : 0.45; audio.footstep(); } }
      if (this.mode === 'online') this.sendState(raw);
    }
    for (const b of this.bots) {
      const out = b.brain.update(dt);
      if (out.dash && b.stamina > 30) { b.stamina -= 30; b.vel.addScaledVector(out.dash, 15); }
      if (b.alive) this.stepBody(b, dt, out.wish, out.speed || 6, out.jump, false);
      b.updateStatus(dt, this);
    }
    for (const r of this.remotes.values()) {
      if (r.aimHold > 0) r.aimHold -= dt;
      if (r.target) { r.target.addScaledVector(r.vel, dt); r.pos.lerp(r.target, Math.min(1, dt * 12)); }
      r.updateStatus(dt, this);
    }
    for (const c of this.combatants) {
      if (!c.model) continue;
      c.model.root.position.copy(c.pos);
      c.model.root.rotation.y = c.yaw;
      c.model.update(dt, { speed: Math.hypot(c.vel.x, c.vel.z), chanting: c.chanting, pitch: c.pitch, frozen: c.frozen > 0, shield: c.shield, aura: c.aura?.el });
      if (c.chanting && Math.random() < 0.6) this.fx.element(c.brain?.favEl || 'arcane', c.model.handWorld(new THREE.Vector3()), { count: 1, speed: 0.5, size: 0.12, life: 0.5 });
    }
    this.spells.update(dt);
    this.fx.update(dt);
    this.world.update(dt, this.fx, this.camera);
    this.hud.update(raw, this.camera);
    if (this.mode === 'online' && p) this.hud.scoreboard([p, ...this.remotes.values()].map((c) => ({ name: c === p ? p.name : c.name, kills: c.kills, deaths: c.deaths })));
  }
}

window.game = new Game();
// debug helper: VA.test('meteor', 'fire', {power:1}) casts a hand-made spec from the player
window.VA = {
  finalizeSpec, localParse, buildSpec,
  test(shape, element = 'fire', o = {}) {
    const g = window.game, p = g.player; if (!p) return;
    const spec = finalizeSpec({ text: `${element} ${shape}`, element, element2: o.element2 || null, shape, power: 0.6, tier: 0.5, speed: 0.5, size: 0.5, temperature: 0.6, weight: 0.4, sharpness: 0.5, count: 0.4, duration: 0.5, chaos: 0.3, homing: 0.2, isSpell: 1, source: 'local', ...o });
    p.mana = p.maxMana; g.performCast(spec, false); return spec.name;
  },
  face(target) { const g = window.game, p = g.player, tt = target || g.bots[0]; p.yaw = Math.atan2(p.pos.x - tt.pos.x, p.pos.z - tt.pos.z); p.pitch = 0; },
};
