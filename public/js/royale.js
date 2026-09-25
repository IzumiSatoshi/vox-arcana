// Battle royale: eight mages drop onto the island, loot relics, and fight inside a shrinking storm of wild magic.
// Items: element cores (+damage for that element), passive relics (mana regen, max HP/mana, speed, cheaper spells)
// and potions (1 heal · 2 mana · 3 shield). Bots loot, drink, and run from the storm too.
import * as THREE from 'three';
import { ELEMENTS, ELEMENT_KEYS, elName } from './elements.js';
import { energyMaterial, crystalMaterial, flowMaterial, TIME, NOISE } from './shaders.js';
import { ARENA_R, SEA_Y, MESAS } from './world.js';
import { applyHit } from './combat.js';
import { t, getLang } from './i18n.js';
import { MagicCircle } from './magicCircle.js';
import { rand, pick, clamp, TAU } from './util.js';

const hex = (n) => '#' + new THREE.Color(n).getHexString();
const PASSIVES = {
  font: { en: 'Mana Font', ja: '魔力の泉', desc: ['+40% mana regen', 'マナ回復+40%'], color: 0x5ab8ff, icon: '✦' },
  vessel: { en: 'Arcane Vessel', ja: '魔力の器', desc: ['+30 max mana', '最大マナ+30'], color: 0x8a7aff, icon: '⬢' },
  heart: { en: 'Troll Heart', ja: '巨人の心臓', desc: ['+150 max HP', '最大HP+150'], color: 0xff5a6a, icon: '♥' },
  boots: { en: 'Windstep Boots', ja: '疾風の靴', desc: ['+12% move speed', '移動速度+12%'], color: 0x6affc8, icon: '➶' },
  focus: { en: 'Sage Focus', ja: '賢者の宝珠', desc: ['-12% spell cost', '詠唱コスト-12%'], color: 0xffd46a, icon: '◈' },
  // rare: mostly found in arcane caches that fall from the sky each storm phase
  crown: { en: 'Archmage Crown', ja: '大魔導の冠', desc: ['+15% damage with every element', '全属性ダメージ+15%'], color: 0xffe066, icon: '♛', rare: true },
  phoenix: { en: 'Phoenix Feather', ja: '不死鳥の羽', desc: ['Rise again once with half HP', '一度だけHP半分で復活'], color: 0xff7a2a, icon: '❂', rare: true },
};
const COMMON_RELICS = Object.keys(PASSIVES).filter((k) => !PASSIVES[k].rare), RARE_RELICS = Object.keys(PASSIVES).filter((k) => PASSIVES[k].rare);
const POTIONS = {
  hp: { en: 'Healing Draught', ja: '回復薬', key: '1', color: 0xff4a5a, icon: '✚' },
  mana: { en: 'Mana Draught', ja: 'マナ薬', key: '2', color: 0x3a8aff, icon: '◆' },
  shield: { en: 'Aegis Draught', ja: '守護薬', key: '3', color: 0xffc83a, icon: '⛨' },
};
// storm phases: seconds waiting, seconds shrinking, target radius, damage per second outside
const PHASES = [
  { wait: 45, shrink: 25, r: 72, dps: 5 }, { wait: 30, shrink: 22, r: 46, dps: 8 }, { wait: 25, shrink: 18, r: 26, dps: 12 },
  { wait: 20, shrink: 15, r: 11, dps: 18 }, { wait: 15, shrink: 14, r: 0, dps: 28 },
];
const NAMES = ['Vel', 'Rhea', 'Morrow', 'Isolde', 'Kael', 'Nyx', 'Oren', 'Sable', 'Thane', 'Lyra', 'Corvin', 'Ember', 'Wren', 'Ash'];
const NAMES_JA = ['ヴェル', 'レア', 'モロウ', 'イゾルデ', 'カエル', 'ニクス', 'オーレン', 'セーブル', 'セイン', 'ライラ', 'コルヴィン', 'エンバー', 'レン', 'アッシュ'];
const ROBES = [[0x5a1a2a, 0xff4a6a], [0x1a4a2a, 0x7dff8a], [0x3a1a5a, 0xc07aff], [0x5a3a10, 0xffb040], [0x0a3a4a, 0x40e0ff], [0x4a4a4a, 0xf0f0f0], [0x2a1a10, 0xff7a30], [0x10204a, 0x7aa0ff]];

// ------------------------------------------------------------ storm wall shader: a curtain of wild violet magic
const stormMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: TIME, uCol: { value: new THREE.Color(0xa040ff) }, uHi: { value: new THREE.Color(0xffb8ff) } },
  vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
  fragmentShader: NOISE + /* glsl */ `
    uniform float uTime; uniform vec3 uCol,uHi; varying vec2 vUv; varying vec3 vW;
    void main(){
      float a=vUv.x*6.2832*18.0;
      float n=fbm3(vec3(vUv.x*60.0, vUv.y*6.0-uTime*0.6, uTime*0.15))*0.5+0.5;
      float streak=smoothstep(0.55,0.95,fbm3(vec3(vUv.x*140.0, vUv.y*1.5+uTime*0.9, 3.0))*0.5+0.5);
      float low=1.0-smoothstep(0.1,0.55,vUv.y);
      float band=exp(-pow((vUv.y-0.135)/0.035,2.0)); // a seething glow where the wall meets the ground (the wall starts 20 m below it)
      float bolt=smoothstep(0.93,0.99,fbm3(vec3(vUv.x*90.0, uTime*2.0, 7.0))*0.5+0.5)*low; // flickering veins of charge
      vec3 c=mix(uCol*0.55, uCol, n); c=mix(c, uHi, clamp(streak*0.7+low*0.25+band*0.8+bolt,0.0,1.0));
      float al=(0.22+0.33*n+0.45*streak+bolt)*(0.4+0.6*low)*smoothstep(1.0,0.6,vUv.y)+band*0.55;
      gl_FragColor=vec4(c, al);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

// ------------------------------------------------------------ loot meshes (shared geometry + per-kind materials)
const BOTTLE = (() => { const pts = [[0, 0], [0.2, 0.02], [0.26, 0.12], [0.26, 0.3], [0.2, 0.42], [0.08, 0.5], [0.08, 0.62], [0.11, 0.66], [0, 0.68]].map(([r, y]) => new THREE.Vector2(r, y)); const g = new THREE.LatheGeometry(pts, 20); g.translate(0, -0.34, 0); return g; })();
const GEM = new THREE.OctahedronGeometry(0.44, 0);
const RELIC = new THREE.IcosahedronGeometry(0.4, 0);
const BEAM = (() => { const g = new THREE.CylinderGeometry(0.12, 0.3, 1, 12, 1, true); g.translate(0, 0.5, 0); return g; })();
const RING = (() => { const g = new THREE.RingGeometry(0.55, 0.75, 40); g.rotateX(-Math.PI / 2); return g; })();

// How-to page list of every relic and potion (name · effect)
export function royaleGuide(ja) {
  const core = ja ? ['元素の核', '対応する属性の魔法ダメージ+20%（重複可）'] : ['Element Core', '+20% damage for that element (stacks)'];
  const rows = [[core[0], core[1], 0xffc444], ...Object.values(PASSIVES).map((p) => [p[ja ? 'ja' : 'en'] + (p.rare ? ' ★' : ''), p.desc[ja ? 1 : 0], p.color]),
    ...Object.values(POTIONS).map((p) => ['[' + p.key + '] ' + p[ja ? 'ja' : 'en'], ja ? { '1': 'HP+220', '2': 'マナ+90', '3': 'シールド+160' }[p.key] : { '1': '+220 HP', '2': '+90 mana', '3': '+160 shield' }[p.key], p.color])];
  return rows.map(([n, d, c]) => '<li><b style="color:' + hex(c) + '">' + n + '</b> ' + d + '</li>').join('');
}

export class Royale {
  constructor(game) {
    this.g = game; this.items = []; this.mats = new Map(); this.t = 0; this.over = false;
    this.zone = { cx: 0, cz: 0, r: ARENA_R + 12, fromX: 0, fromZ: 0, fromR: ARENA_R + 12, nx: 0, nz: 0, nr: PHASES[0].r, phase: 0, state: 'wait', st: 0, dps: 3 };
    this.pickNext();
    const wall = (this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 160, 1, true), stormMat()));
    wall.geometry.translate(0, 0.5, 0); wall.renderOrder = 5; wall.frustumCulled = false; game.scene.add(wall);
    const nextRing = (this.nextRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 160), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })));
    nextRing.rotation.x = -Math.PI / 2; nextRing.renderOrder = 5; game.scene.add(nextRing);
    this.tick = 0; this.hudT = 0; this.placements = [];
    this.howl = game.audio.loop('darkness', new THREE.Vector3(), 0, null, { spin: 0.9 });
  }
  // ------------------------------------------------------------ setup
  start() {
    const g = this.g, p = g.player, ja = getLang() === 'ja';
    const names = [...(ja ? NAMES_JA : NAMES)].sort(() => Math.random() - 0.5);
    // the rival difficulty setting shifts the lobby's mix
    const diffs = { easy: ['easy', 'easy', 'easy', 'normal', 'easy', 'normal', 'easy'], normal: ['easy', 'normal', 'normal', 'normal', 'hard', 'normal', 'easy'], hard: ['normal', 'hard', 'hard', 'normal', 'hard', 'hard', 'normal'] }[g.settings.diff] || ['normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal'];
    const rivals = Math.max(3, Math.min(11, (g.settings.lobby || 8) - 1));
    for (let i = 0; i < rivals; i++) {
      const [robe, accent] = ROBES[i % ROBES.length];
      const b = g.createBot(names[i % names.length] + (i >= names.length ? ' II' : ''), diffs[i % diffs.length], false, { robe, trim: 0xe0b95a, accent, hat: new THREE.Color(robe).multiplyScalar(0.6).getHex() });
      b.brain.sight = 55; b.brain.royale = this;
    }
    // everyone boards a floating sky-island that ferries them across the map; each mage picks the moment to jump
    const all = [p, ...g.bots];
    this.buildShip();
    all.forEach((c, i) => {
      c.resetStats(); this.equip(c);
      c.onShip = true; c.deckA = (i / all.length) * TAU; c.vel.set(0, 0, 0); c.grounded = true; c.pitch = -0.25;
      if (c.brain) { const la = rand(0, TAU), lr = rand(10, 90); c.brain.dropTo = new THREE.Vector3(Math.cos(la) * lr, 0, Math.sin(la) * lr); c.brain.jumpAt = this.closestT(c.brain.dropTo) + rand(-0.08, 0.04); }
      if (c.model) c.model.root.visible = true;
    });
    p.yaw = Math.atan2(-this.ship.dir.x, -this.ship.dir.z);
    this.placeOnShip();
    this.spawnLoot(48);
    document.getElementById('br-inv')?.classList.remove('hidden');
    g.hud.banner(t('ban.royale'), t('royale.jumpHint'), 4);
    g.hud.hint?.('hint.royale');
    this.updateHud(true);
  }
  // ------------------------------------------------------------ the sky ferry
  buildShip() {
    const g = this.g, a0 = rand(0, TAU), off = rand(-25, 25);
    const dir = new THREE.Vector3(-Math.cos(a0), 0, -Math.sin(a0)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const from = dir.clone().multiplyScalar(-135).addScaledVector(side, off).setY(88), to = dir.clone().multiplyScalar(135).addScaledVector(side, off).setY(88);
    const grp = new THREE.Group();
    const rockG = new THREE.DodecahedronGeometry(1, 1), rp = rockG.attributes.position;
    for (let i = 0; i < rp.count; i++) { const y = rp.getY(i); rp.setY(i, y > 0 ? 0.25 : y * (1.6 + Math.random() * 0.3)); } // flat top, long hanging root
    rockG.computeVertexNormals();
    const rock = new THREE.Mesh(rockG, new THREE.MeshStandardMaterial({ color: 0x8a7866, roughness: 0.95 })); rock.scale.set(8.5, 5, 8.5); grp.add(rock);
    const turf = new THREE.Mesh(new THREE.CylinderGeometry(8.3, 8.6, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x6aa84a, roughness: 0.9 })); turf.position.y = 1.35; grp.add(turf);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.22, 8, 64), energyMaterial({ color: 0xffc444, core: 0xffffff, intensity: 1.6, noiseAmp: 0.05, opacity: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.y = -1; grp.add(ring);
    const cm = crystalMaterial({ color: new THREE.Color(0xbfe8ff), glow: new THREE.Color(0x6fd8ff), emissive: 1.6, crack: 0.2 });
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + 0.3, c = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), cm); c.scale.set(0.8, 2.2, 0.8); c.position.set(Math.cos(a) * 7.4, 2.6, Math.sin(a) * 7.4); c.rotation.z = Math.cos(a) * 0.2; grp.add(c); }
    const mc = new MagicCircle({ seed: 7, tier: 7, color: new THREE.Color(0xffc444), radius: 10, intensity: 1.6 }); mc.group.rotation.x = Math.PI / 2; mc.group.position.y = -3.2; mc.target = 1; grp.add(mc.group);
    grp.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.scene.add(grp);
    this.ship = { grp, mc, ring, from, to, dir, t: 0, len: from.distanceTo(to), speed: 20, pos: from.clone(), active: true };
  }
  // path parameter (0..1) where the ferry passes closest to a point
  closestT(p) { const S = this.ship, ab = S.to.clone().sub(S.from).setY(0); return clamp(p.clone().sub(S.from).setY(0).dot(ab) / ab.lengthSq()); }
  placeOnShip() {
    const S = this.ship;
    for (const c of this.g.combatants) {
      if (!c.onShip) continue;
      c.pos.set(S.pos.x + Math.cos(c.deckA) * 4.2, S.pos.y + 1.62, S.pos.z + Math.sin(c.deckA) * 4.2); c.vel.set(0, 0, 0); c.grounded = true;
      if (c.brain) c.yaw = Math.atan2(-S.dir.x, -S.dir.z);
    }
  }
  jump(c) {
    if (!c.onShip) return;
    const S = this.ship, g = this.g;
    c.onShip = false; c.dropping = true; c.grounded = false;
    c.vel.copy(S.dir).multiplyScalar(S.speed * 0.5).setY(4);
    g.fx.ring(c.pos.clone(), new THREE.Color(0xffc444), 3, 0.4); g.fx.shockwave(c.center(), 4, 0.8, 0.3);
    if (c === g.player) { g.audio.whoosh(1); g.hud.banner('', t('ban.royale2'), 2.5); }
  }
  updateShip(dt) {
    const S = this.ship; if (!S) return;
    S.t += dt; const k = (S.t * S.speed) / S.len;
    S.pos.lerpVectors(S.from, S.to, Math.min(1.25, k)); S.pos.y = 88 + Math.sin(S.t * 0.8) * 0.4;
    S.grp.position.copy(S.pos); S.grp.rotation.y += dt * 0.05; S.ring.rotation.z += dt * 0.6; S.mc.update(dt);
    // bots leave when the ferry passes over where they want to land; everyone is out by the end of the line
    for (const c of this.g.combatants) if (c.onShip && ((c.brain && k >= c.brain.jumpAt) || k >= 1)) this.jump(c);
    this.placeOnShip();
    if (Math.random() < 0.5) this.g.fx.glow.emit({ x: S.pos.x + rand(-8, 8), y: S.pos.y - 2, z: S.pos.z + rand(-8, 8), vy: -3, life: 1, size: 0.3, size1: 0.05, color: new THREE.Color(0xffd070), alpha: 1, drag: 0.2, frame: 1 });
    if (k > 1.2) { this.g.scene.remove(S.grp); S.mc.dispose(); S.grp.traverse((m) => { m.geometry?.dispose(); }); this.ship = null; }
  }
  boarding() { return this.g.combatants.some((c) => c.onShip); }
  equip(c) {
    c.inv = { hp: 1, mana: 0, shield: 0 }; c.affinity = {}; c.relics = {};
    c.manaRegen = 1; c.speedMult = 1; c.costBonus = 1; c.maxHp = 600; c.maxMana = 120; c.hp = 600; c.mana = 120;
  }
  // ------------------------------------------------------------ loot
  randomSpot() {
    const W = this.g.world;
    for (let k = 0; k < 40; k++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * (ARENA_R - 8), x = Math.cos(a) * r, z = Math.sin(a) * r, h = W.heightAt(x, z);
      if (h < SEA_Y + 1.2 || W.normalAt(x, z).y < 0.85 || W.onRamp?.(x, z)) continue;
      const p = new THREE.Vector3(x, W.groundAt(x, z, h + 3), z), q = p.clone(); q.y += 1; W.collideBody(q, 0.9);
      if (Math.hypot(q.x - p.x, q.z - p.z) > 0.01 || W.solid(q)) continue; // not inside ruins, trees or rocks
      return p;
    }
    return new THREE.Vector3(rand(-20, 20), 0.5, rand(-20, 20));
  }
  randomKind() {
    const r = Math.random();
    if (r < 0.4) return { type: 'core', el: pick(ELEMENT_KEYS) };
    if (r < 0.63) return { type: 'relic', id: pick(COMMON_RELICS) };
    if (r < 0.66) return { type: 'relic', id: pick(RARE_RELICS) };
    return { type: 'potion', id: Math.random() < 0.5 ? 'hp' : Math.random() < 0.55 ? 'mana' : 'shield' };
  }
  colorOf(k) { return k.type === 'core' ? ELEMENTS[k.el].color : k.type === 'relic' ? PASSIVES[k.id].color : POTIONS[k.id].color; }
  mat(key, make) { if (!this.mats.has(key)) this.mats.set(key, make()); return this.mats.get(key); }
  spawnLoot(n) {
    for (let i = 0; i < n; i++) this.dropItem(this.randomSpot(), this.randomKind());
    // high ground pays: every mesa top holds a relic and one more find
    for (const m of MESAS) for (let k = 0; k < 2; k++) {
      const a = rand(0, TAU), d = rand(0, m.R * 0.45), x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      this.dropItem(new THREE.Vector3(x, this.g.world.groundAt(x, z, 50), z), k ? this.randomKind() : { type: 'relic', id: pick(COMMON_RELICS) });
    }
  }
  dropItem(pos, kind, pop = false) {
    const g = this.g, col = this.colorOf(kind), key = kind.type + (kind.el || kind.id);
    const grp = new THREE.Group();
    let body;
    if (kind.type === 'core') body = new THREE.Mesh(GEM, this.mat(key, () => crystalMaterial({ color: new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.25), glow: new THREE.Color(col), emissive: 1.6, crack: 0.2 })));
    else if (kind.type === 'relic') body = new THREE.Mesh(RELIC, this.mat(key, () => crystalMaterial({ color: new THREE.Color(0xf0d892), glow: new THREE.Color(col), emissive: 1.3, crack: 0.5 })));
    else {
      body = new THREE.Group();
      const glass = new THREE.Mesh(BOTTLE, this.mat('glass', () => new THREE.MeshStandardMaterial({ color: 0xdff4ff, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false })));
      const liquid = new THREE.Mesh(BOTTLE, this.mat(key, () => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8, roughness: 0.3 }))); liquid.scale.set(0.82, 0.7, 0.82); liquid.position.y = -0.06;
      const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.1, 10), this.mat('cork', () => new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.9 }))); cork.position.y = 0.36; cork.userData.ownGeo = true;
      body.add(liquid, glass, cork); body.scale.setScalar(1.9);
    }
    grp.add(body);
    const halo = new THREE.Mesh(RING, this.mat('ring' + key, () => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })));
    const beam = new THREE.Mesh(BEAM, this.mat('beam' + key, () => flowMaterial({ color: new THREE.Color(col), core: 0xffffff, intensity: 1.4, scroll: -1.5, stripes: 2, opacity: 0.55 })));
    beam.scale.set(1, kind.type === 'relic' ? 16 : 10, 1);
    g.scene.add(grp, halo, beam);
    const it = { kind, grp, body, halo, beam, pos: pos.clone(), vel: pop ? new THREE.Vector3(rand(-4, 4), rand(5, 8), rand(-4, 4)) : null, seed: Math.random() * 10, age: 0 };
    this.items.push(it);
    return it;
  }
  removeItem(it) { const s = this.g.scene; s.remove(it.grp, it.halo, it.beam); it.grp.traverse((m) => m.userData.ownGeo && m.geometry.dispose()); this.items.splice(this.items.indexOf(it), 1); }
  nearestItem(pos, maxD = 40) { let best = null, bd = maxD; for (const it of this.items) { const d = it.pos.distanceTo(pos); if (d < bd && this.inZone(it.pos, -4)) { bd = d; best = it; } } return best; }
  itemName(k) { const ja = getLang() === 'ja'; return k.type === 'core' ? (ja ? `${elName(k.el)}の核` : `${ELEMENTS[k.el].name} Core`) : k.type === 'relic' ? PASSIVES[k.id][ja ? 'ja' : 'en'] : POTIONS[k.id][ja ? 'ja' : 'en']; }
  itemDesc(k) {
    const ja = getLang() === 'ja';
    if (k.type === 'core') return ja ? `${elName(k.el)}魔法のダメージ+20%` : `+20% ${ELEMENTS[k.el].name.toLowerCase()} spell damage`;
    if (k.type === 'relic') return PASSIVES[k.id].desc[ja ? 1 : 0];
    return ja ? `[${POTIONS[k.id].key}] で使用` : `press ${POTIONS[k.id].key} to drink`;
  }
  grant(c, k) {
    if (k.type === 'core') c.affinity[k.el] = Math.min(0.8, (c.affinity[k.el] || 0) + 0.2);
    else if (k.type === 'relic') {
      c.relics[k.id] = (c.relics[k.id] || 0) + 1;
      if (k.id === 'font') c.manaRegen += 0.4;
      if (k.id === 'vessel') { c.maxMana += 30; c.mana += 30; }
      if (k.id === 'heart') { c.maxHp += 150; c.hp += 150; }
      if (k.id === 'boots') c.speedMult += 0.12;
      if (k.id === 'focus') c.costBonus *= 0.88;
      if (k.id === 'crown') c.allDmg = (c.allDmg || 1) + 0.15;
    } else c.inv[k.id] = Math.min(5, (c.inv[k.id] || 0) + 1);
  }
  pickup(c, it) {
    const g = this.g, col = this.colorOf(it.kind);
    this.grant(c, it.kind);
    g.fx.ring(it.pos.clone().setY(it.pos.y + 0.1), new THREE.Color(col), 2.5, 0.4);
    for (let i = 0; i < 14; i++) g.fx.glow.emit({ x: it.pos.x, y: it.pos.y + 1, z: it.pos.z, vx: rand(-2, 2), vy: rand(1, 5), vz: rand(-2, 2), life: rand(0.4, 0.8), size: 0.18, size1: 0.02, color: new THREE.Color(col), alpha: 1, drag: 1.5, frame: 1 });
    if (c === g.player) {
      g.audio.pickup?.(it.kind.type);
      g.hud.feed(`<b style="color:${hex(col)}">${this.itemName(it.kind)}</b> <span style="opacity:.75">${this.itemDesc(it.kind)}</span>`);
      g.hud.popup?.(it.pos.clone().setY(it.pos.y + 1.6), this.itemName(it.kind), 'react', hex(col));
      this.updateHud(true);
    }
    this.removeItem(it);
  }
  // potions: 1 heal · 2 mana · 3 shield
  drink(c, id) {
    const g = this.g;
    if (!c.alive || !(c.inv?.[id] > 0)) return false;
    c.inv[id]--;
    if (id === 'hp') { const n = 220; c.heal(n); g.onHeal?.(c, n); }
    if (id === 'mana') c.mana = Math.min(c.maxMana, c.mana + 90);
    if (id === 'shield') { c.addShield(160, 20, 'light'); g.onShield?.(c); }
    const col = new THREE.Color(POTIONS[id].color);
    g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), col, 3.5, 0.5);
    for (let i = 0; i < 18; i++) { const a = rand(0, TAU); g.fx.glow.emit({ x: c.pos.x + Math.cos(a) * 0.7, y: c.pos.y + rand(0, 0.4), z: c.pos.z + Math.sin(a) * 0.7, vy: rand(2, 4.5), life: 0.9, size: 0.2, size1: 0.03, color: col, alpha: 1, drag: 0.6, frame: 1 }); }
    g.audio.drink?.(id, c === g.player ? null : c.pos);
    if (c === g.player) this.updateHud(true);
    return true;
  }
  // ------------------------------------------------------------ storm
  pickNext() {
    const Z = this.zone, P = PHASES[Z.phase];
    const room = Math.max(0, Z.r - P.r) * 0.85, a = rand(0, TAU), d = Math.sqrt(Math.random()) * room;
    let nx = Z.cx + Math.cos(a) * d, nz = Z.cz + Math.sin(a) * d;
    const lim = ARENA_R - P.r - 4; const L = Math.hypot(nx, nz); if (L > lim && L > 0) { nx *= Math.max(0, lim) / L; nz *= Math.max(0, lim) / L; }
    Object.assign(Z, { nx, nz, nr: P.r, dps: Z.phase ? PHASES[Z.phase - 1].dps : 3 });
  }
  inZone(p, margin = 0) { const Z = this.zone; return Math.hypot(p.x - Z.cx, p.z - Z.cz) < Z.r + margin; }
  updateZone(dt) {
    const Z = this.zone; if (!this.boarding()) Z.st += dt;
    const P = PHASES[Math.min(Z.phase, PHASES.length - 1)];
    if (Z.state === 'wait' && !Z.cached && Z.st >= P.wait * 0.35 && Z.phase < 4) { Z.cached = true; this.dropCache(); }
    if (Z.state === 'wait' && Z.st >= P.wait) { Z.cached = false; Z.state = 'shrink'; Z.st = 0; Object.assign(Z, { fromX: Z.cx, fromZ: Z.cz, fromR: Z.r }); this.g.hud.banner('', t('royale.closing'), 2.5); this.g.audio.stormWarn?.(); }
    else if (Z.state === 'shrink') {
      const k = clamp(Z.st / P.shrink), e = k * k * (3 - 2 * k);
      Z.cx = Z.fromX + (Z.nx - Z.fromX) * e; Z.cz = Z.fromZ + (Z.nz - Z.fromZ) * e; Z.r = Z.fromR + (Z.nr - Z.fromR) * e; Z.dps = P.dps;
      if (k >= 1) { Z.phase++; Z.st = 0; Z.state = Z.phase < PHASES.length ? 'wait' : 'final'; if (Z.phase < PHASES.length) this.pickNext(); }
    }
    if (Z.state === 'final') Z.dps += dt * 2.5; // sudden death: the last storm keeps getting hungrier
    this.wall.position.set(Z.cx, -20, Z.cz); this.wall.scale.set(Math.max(0.5, Z.r), 160, Math.max(0.5, Z.r));
    this.nextRing.visible = Z.state !== 'final';
    this.nextRing.position.set(Z.nx, this.g.world.heightAt(Z.nx, Z.nz) + 0.4, Z.nz); this.nextRing.scale.setScalar(Math.max(0.5, Z.nr));
    // the storm burns anyone outside it (damage grows every phase)
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.5;
      for (const c of this.g.combatants) {
        if (!c.alive || c.decoy || this.inZone(c.pos)) continue;
        applyHit(this.g, c, { dmg: Z.dps * 0.5, el: null, src: null, point: c.center(), dot: true, dotEl: 'darkness' });
        this.g.fx.element('darkness', c.center(), { count: 3, speed: 1, size: 0.3 });
      }
    }
    const p = this.g.player, out = p && p.alive && !this.inZone(p.pos);
    this.boltT = (this.boltT || 0) - dt;
    if (p && this.boltT <= 0 && Z.r > 3) {
      this.boltT = rand(0.6, 1.8);
      const a0 = Math.atan2(p.pos.z - Z.cz, p.pos.x - Z.cx) + rand(-0.6, 0.6), bx = Z.cx + Math.cos(a0) * Z.r, bz = Z.cz + Math.sin(a0) * Z.r;
      if (Math.hypot(bx - p.pos.x, bz - p.pos.z) < 90) {
        const gy = this.g.world.heightAt(bx, bz);
        this.g.fx.bolt(new THREE.Vector3(bx + rand(-3, 3), gy + rand(30, 55), bz + rand(-3, 3)), new THREE.Vector3(bx, gy, bz), new THREE.Color(0xc070ff), { width: 0.25, dur: 0.25, jag: 0.25, branches: 3 });
        this.g.fx.lights.request(new THREE.Vector3(bx, gy + 5, bz), new THREE.Color(0xb060ff), 600, 40);
        if (Math.random() < 0.5) this.g.audio.impact('lightning', 0.45, new THREE.Vector3(bx, gy + 3, bz));
      }
    }
    if (p) { // the wall howls from its nearest point; loud when you are close to (or inside) it
      const dx = p.pos.x - Z.cx, dz = p.pos.z - Z.cz, d = Math.hypot(dx, dz) || 1, edge = Math.abs(d - Z.r);
      this.howl.set(new THREE.Vector3(Z.cx + dx / d * Z.r, p.pos.y + 2, Z.cz + dz / d * Z.r), clamp(1 - edge / 30) * 0.7 + (out ? 0.3 : 0));
    }
    document.body.classList.toggle('storm-out', !!out);
    if (out && Math.random() < dt * 2) this.g.fx.bolt(p.pos.clone().add(new THREE.Vector3(rand(-15, 15), 20, rand(-15, 15))), p.pos.clone().add(new THREE.Vector3(rand(-15, 15), 0, rand(-15, 15))), new THREE.Color(0xc070ff), { width: 0.2, dur: 0.2, branches: 2 });
  }
  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g;
    this.t += dt;
    this.updateShip(dt);
    if (!this.over) this.updateZone(dt);
    this.updateFalling(dt);
    // drop phase: slow magical descent with strong air control; a burst on landing
    for (const c of g.combatants) {
      if (!c.dropping) continue;
      if (c.grounded || c.pos.y - g.world.heightAt(c.pos.x, c.pos.z) < 0.3) {
        c.dropping = false;
        g.fx.shockwave(c.center(), 6, 1, 0.4); g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), new THREE.Color(0xf0d592), 6, 0.5);
        for (let i = 0; i < 10; i++) g.fx.puff(c.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0.2, rand(-1, 1))), { color: new THREE.Color(0xcdbb96), size: 1, life: 1.2, alpha: 0.6, rise: 0.6 });
        g.audio.impact('earth', 0.35, c.pos);
      } else if (Math.random() < 0.4) g.fx.glow.emit({ x: c.pos.x + rand(-0.4, 0.4), y: c.pos.y + 1.8, z: c.pos.z + rand(-0.4, 0.4), vy: 6, life: 0.4, size: 0.15, size1: 0.02, color: new THREE.Color(0xfff0c0), alpha: 1, drag: 0.5, frame: 1 });
    }
    // loot: bob, spin, beams; auto pickup
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.age += dt;
      if (it.vel) { it.vel.y -= 18 * dt; it.pos.addScaledVector(it.vel, dt); const gy = g.world.groundAt(it.pos.x, it.pos.z, it.pos.y + 1); if (it.pos.y <= gy) { it.pos.y = gy; it.vel = null; } }
      const bob = 1.15 + Math.sin(this.t * 2 + it.seed) * 0.15;
      it.grp.position.set(it.pos.x, it.pos.y + bob, it.pos.z); it.body.rotation.y += dt * 1.6; it.body.rotation.x = Math.sin(this.t + it.seed) * 0.2;
      it.halo.position.set(it.pos.x, it.pos.y + 0.06, it.pos.z); it.halo.scale.setScalar(1 + Math.sin(this.t * 3 + it.seed) * 0.08);
      it.beam.position.set(it.pos.x, it.pos.y, it.pos.z);
      if (it.age < 0.6) continue;
      for (const c of g.combatants) {
        if (!c.alive || c.decoy || !c.inv || c.dropping) continue;
        if (Math.hypot(c.pos.x - it.pos.x, c.pos.z - it.pos.z) < 1.7 && Math.abs(c.pos.y - it.pos.y) < 2.5) { this.pickup(c, it); break; }
      }
    }
    // bots drink when hurt / dry
    for (const b of g.bots) {
      if (!b.alive || !b.inv) continue;
      b.potT = (b.potT || rand(0, 1)) - dt; if (b.potT > 0) continue; b.potT = 1;
      if (b.hp < b.maxHp * 0.4 && this.drink(b, 'hp')) continue;
      if (b.mana < 30 && this.drink(b, 'mana')) continue;
      if (b.hp < b.maxHp * 0.6 && b.shield <= 0) this.drink(b, 'shield');
    }
    // spectate: once the player is out, follow whoever is still fighting
    const p = g.player;
    if (p && !p.alive && this.deadT !== undefined) {
      this.deadT += dt;
      if (g.mouse.lmb && !this._lmb) this.nextSpectate(); this._lmb = g.mouse.lmb;
      if (this.deadT > 2.5) {
        let s = this.spec; if (!s?.alive) s = this.spec = this.alive().sort((a, b) => b.kills - a.kills)[0];
        if (s) { // over the shoulder, pulled in so walls and trees never block the view
          const f = s.forward(new THREE.Vector3()).setY(0).normalize(), head = s.pos.clone().setY(s.pos.y + 1.8), want = f.clone().multiplyScalar(-7).setY(2.4), L = want.length();
          const rc = g.world.raycast(head, want.clone().normalize(), L, 0.4), d = rc.hit ? Math.max(1.2, rc.dist - 0.6) : L;
          const cp = head.clone().addScaledVector(want.normalize(), d); this.camP = this.camP ? this.camP.lerp(cp, clamp(dt * 5)) : cp;
          g.debugCam = { pos: this.camP.toArray(), target: [s.pos.x, s.pos.y + 1.4, s.pos.z] };
        }
      }
    }
    this.hudT -= dt; if (this.hudT <= 0) this.updateHud();
  }
  alive() { return this.g.combatants.filter((c) => c.alive && !c.decoy); }
  // an arcane cache: a meteor of crystal that falls inside the next circle and bursts into a rare relic + loot
  dropCache() {
    const g = this.g, Z = this.zone, a = rand(0, TAU), d = Math.sqrt(Math.random()) * Math.max(4, Z.nr * 0.7);
    const x = Z.nx + Math.cos(a) * d, z = Z.nz + Math.sin(a) * d, gy = g.world.groundAt(x, z, 200);
    const mesh = new THREE.Mesh(GEM, this.mat('cache', () => crystalMaterial({ color: new THREE.Color(0xfff0c0), glow: new THREE.Color(0xffc040), emissive: 2.2, crack: 0.5 })));
    mesh.scale.set(2.2, 3.2, 2.2); mesh.position.set(x, gy + 90, z); g.scene.add(mesh);
    const beam = new THREE.Mesh(BEAM, this.mat('cachebeam', () => flowMaterial({ color: new THREE.Color(0xffc040), core: 0xffffff, intensity: 1.1, scroll: -3, stripes: 3, opacity: 0.35 })));
    beam.scale.set(1.6, 90, 1.6); beam.position.set(x, gy, z); g.scene.add(beam);
    this.falling = this.falling || []; this.falling.push({ mesh, beam, x, z, gy, vy: 18 });
    g.hud.banner('', t('royale.cache'), 2.5); g.hud.feed('<b style="color:#ffd46a">✦ ' + t('royale.cache') + '</b>'); g.audio.swordFall?.(null, 1);
    this.cacheMark = { x, z };
  }
  updateFalling(dt) {
    const g = this.g;
    for (let i = (this.falling || []).length - 1; i >= 0; i--) {
      const F = this.falling[i]; F.vy += 30 * dt; F.mesh.position.y -= F.vy * dt; F.mesh.rotation.y += dt * 3;
      g.fx.glow.emit({ x: F.x + rand(-0.8, 0.8), y: F.mesh.position.y + 2, z: F.z + rand(-0.8, 0.8), vy: 8, life: 0.6, size: 0.6, size1: 0.1, color: new THREE.Color(0xffd070), alpha: 1, drag: 0.5, frame: 1 });
      g.fx.lights.request(F.mesh.position, new THREE.Color(0xffc040), 300, 30);
      if (F.mesh.position.y <= F.gy + 1) {
        const p = new THREE.Vector3(F.x, F.gy + 0.5, F.z);
        g.fx.explosion('light', p, 4, 1, null, {}); g.fx.shockwave(p, 14, 1.6, 0.6); g.fx.ring(p, new THREE.Color(0xffd46a), 12, 0.8); g.fx.addShake(0.4, p);
        g.audio.impact('earth', 1, p); g.audio.impact('light', 0.7, p);
        for (const c of g.combatants) if (c.alive && c.distTo(p) < 4) applyHit(g, c, { dmg: 60, el: null, src: null, point: c.center(), knock: c.pos.clone().sub(p).setY(0).setLength(10).setY(6) });
        this.dropItem(p, { type: 'relic', id: pick(RARE_RELICS) }, true);
        for (let k = 0; k < 3; k++) this.dropItem(p, this.randomKind(), true);
        g.scene.remove(F.mesh, F.beam); this.falling.splice(i, 1); this.cacheMark = null;
      }
    }
  }
  // Phoenix Feather: cheat death once
  tryRevive(c) {
    if (this.over || !(c.relics?.phoenix > 0)) return false;
    c.relics.phoenix--; c.hp = c.maxHp * 0.5; c.addShield(120, 4, 'fire'); c.dots.length = 0; c.frozen = 0; c.stun = 0;
    const g = this.g, p = c.center();
    g.fx.explosion('fire', p, 3.5, 1, null, { noDecal: true }); g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), new THREE.Color(0xff7a2a), 8, 0.7); g.fx.shockwave(p, 10, 1.4, 0.5);
    for (let i = 0; i < 40; i++) g.fx.flame(p.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1.5), rand(-1, 1))), { color: new THREE.Color(0xff8a2a), size: rand(0.4, 0.9), life: 1, rise: 4 });
    g.audio.roar?.('fire', 0.8, c.pos); g.hud.feed('<b style="color:#ff7a2a">❂ ' + t('royale.revive', { who: c === g.player ? t('you') : c.name }) + '</b>');
    if (c === g.player) { g.screenFlash?.('#ff9a4a', 0.4); this.updateHud(true); }
    return true;
  }
  onDeath(target, killer) {
    if (target.decoy || this.over) return;
    const g = this.g, left = this.alive().length; // target already flagged dead
    target.place = left + 1; target.killedBy = killer && killer !== target ? killer.name : null;
    // the fallen drop their potions and a relic
    const at = target.pos.clone();
    for (const [id, n] of Object.entries(target.inv || {})) for (let i = 0; i < n; i++) this.dropItem(at, { type: 'potion', id }, true);
    this.dropItem(at, this.randomKind(), true);
    if (target === g.player) {
      this.deadT = 0;
      g.hud.banner(`#${target.place}`, (killer && killer !== target ? t('royale.elim', { who: killer.name }) : t('royale.elimStorm')) + ' · ⚔ ' + target.kills + ' · ' + Math.round(g.stats?.dmg || 0) + ' ' + t('damage'), 6);
      g.audio.ui('defeat');
    } else if (killer === g.player) g.hud.popup?.(target.center().add(new THREE.Vector3(0, 1.5, 0)), t('royale.kill'), 'react', '#ffd46a');
    if (left <= 1) this.finish(this.alive()[0]);
    else if (target === g.player) setTimeout(() => { if (g.royale === this && !this.over) this.showResults(); }, 3000);
    this.updateHud(true);
  }
  // standings: survivors first, then the fallen by placement
  showResults() {
    const g = this.g, box = document.getElementById('br-results'); if (!box) return;
    const mages = g.combatants.filter((c) => !c.decoy && c.inv).sort((a, b) => (a.alive ? 0 : a.place || 99) - (b.alive ? 0 : b.place || 99) || b.kills - a.kills);
    const rows = mages.map((c) => '<tr class="' + (c === g.player ? 'me' : '') + (c.alive ? ' alive' : '') + '"><td>' + (c.alive ? (this.over ? '♛' : '•') : '#' + c.place) + '</td><td>' + (c === g.player ? t('you') : c.name) + '</td><td>⚔ ' + c.kills + '</td><td class="by">' + (c.alive ? t(this.over ? 'royale.winner' : 'royale.alive') : c.killedBy ? '← ' + c.killedBy : t('royale.storm')) + '</td></tr>').join('');
    box.innerHTML = '<div class="brr-head">' + t('royale.standings') + '</div><table>' + rows + '</table><div class="brr-foot">' + (this.over ? t('royale.back') : t('royale.spectate')) + '</div>';
    box.classList.remove('hidden');
  }
  nextSpectate() { const a = this.alive(); if (!a.length) return; const i = a.indexOf(this.spec); this.spec = a[(i + 1) % a.length]; }
  finish(winner) {
    if (this.over) return;
    this.over = true;
    const g = this.g, won = winner === g.player;
    g.slowmo = 1.2;
    g.hud.banner(t(won ? 'royale.win' : 'royale.lose'), won ? t('royale.win2', { k: g.player.kills, d: Math.round(g.stats?.dmg || 0) }) : t('royale.lose2', { who: winner?.name || '—' }), 6);
    g.audio.ui(won ? 'victory' : 'defeat');
    setTimeout(() => { if (g.royale === this) this.showResults(); }, 2500);
    if (won) for (let i = 0; i < 6; i++) setTimeout(() => { if (g.player) g.fx.explosion(pick(ELEMENT_KEYS), g.player.center().add(new THREE.Vector3(rand(-6, 6), rand(4, 9), rand(-6, 6))), 2, 0.6); }, i * 350);
    setTimeout(() => { if (g.royale === this) g.endToMenu(); }, 9000);
  }
  updateHud(force = false) {
    const g = this.g, p = g.player; this.hudT = 0.25;
    if (!p) return;
    const Z = this.zone, P = PHASES[Math.min(Z.phase, PHASES.length - 1)];
    const left = Z.state === 'wait' ? Math.ceil(P.wait - Z.st) : Z.state === 'shrink' ? Math.ceil(P.shrink - Z.st) : 0;
    const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const zoneTxt = Z.state === 'wait' ? t('royale.zoneWait', { t: mm }) : Z.state === 'shrink' ? t('royale.zoneShrink', { t: mm }) : t('royale.zoneFinal');
    g.hud.round(`✦ ${this.alive().length} ${t('royale.alive')} · ⚔ ${p.kills} · ${zoneTxt}`);
    const box = document.getElementById('br-inv'); if (!box) return;
    const key = JSON.stringify([p.inv, p.affinity, p.relics]);
    if (!force && key === this._invKey) return; this._invKey = key;
    const pots = Object.entries(POTIONS).map(([id, P2]) => `<div class="br-pot${p.inv?.[id] ? '' : ' empty'}" style="--c:${hex(P2.color)}"><kbd>${P2.key}</kbd><span>${P2.icon}</span><b>${p.inv?.[id] || 0}</b></div>`).join('');
    const cores = Object.entries(p.affinity || {}).map(([el, v]) => `<span class="br-chip" style="--c:${hex(ELEMENTS[el].color)}">${ELEMENTS[el].glyph} +${Math.round(v * 100)}%</span>`).join('');
    const relics = Object.entries(p.relics || {}).map(([id, n]) => `<span class="br-chip" style="--c:${hex(PASSIVES[id].color)}" title="${PASSIVES[id].desc[0]}">${PASSIVES[id].icon}${n > 1 ? '×' + n : ''}</span>`).join('');
    box.innerHTML = `<div class="br-pots">${pots}</div><div class="br-chips">${cores}${relics}</div>`;
  }
  // minimap overlay: current storm edge + next circle (hud.drawMinimap calls this inside its rotated frame)
  drawMinimap(g2, p, scale) {
    const Z = this.zone;
    g2.save();
    g2.fillStyle = 'rgba(150,60,255,0.28)'; g2.beginPath(); g2.rect(-400, -400, 800, 800); g2.arc((Z.cx - p.pos.x) * scale, (Z.cz - p.pos.z) * scale, Z.r * scale, 0, TAU, true); g2.fill();
    g2.strokeStyle = 'rgba(210,140,255,0.95)'; g2.lineWidth = 2; g2.beginPath(); g2.arc((Z.cx - p.pos.x) * scale, (Z.cz - p.pos.z) * scale, Z.r * scale, 0, TAU); g2.stroke();
    if (Z.state !== 'final') { g2.strokeStyle = 'rgba(255,255,255,0.85)'; g2.setLineDash([4, 4]); g2.beginPath(); g2.arc((Z.nx - p.pos.x) * scale, (Z.nz - p.pos.z) * scale, Z.nr * scale, 0, TAU); g2.stroke(); g2.setLineDash([]); }
    const zx = (Z.nx - p.pos.x) * scale, zy = (Z.nz - p.pos.z) * scale, zl = Math.hypot(zx, zy);
    if (zl > 78) { const ux = zx / zl, uy = zy / zl; g2.save(); g2.translate(ux * 74, uy * 74); g2.rotate(Math.atan2(uy, ux)); g2.fillStyle = '#fff'; g2.shadowColor = '#a040ff'; g2.shadowBlur = 8; g2.beginPath(); g2.moveTo(9, 0); g2.lineTo(-6, -6); g2.lineTo(-3, 0); g2.lineTo(-6, 6); g2.closePath(); g2.fill(); g2.restore(); }
    if (this.cacheMark) { const x = (this.cacheMark.x - p.pos.x) * scale, y = (this.cacheMark.z - p.pos.z) * scale, l = Math.hypot(x, y), k = l > 80 ? 80 / l : 1; g2.fillStyle = '#ffd46a'; g2.shadowColor = '#ffb000'; g2.shadowBlur = 10; g2.beginPath(); g2.arc(x * k, y * k, 5, 0, TAU); g2.fill(); g2.shadowBlur = 0; }
    for (const it of this.items) { const x = (it.pos.x - p.pos.x) * scale, y = (it.pos.z - p.pos.z) * scale; if (x * x + y * y > 8100) continue; g2.fillStyle = hex(this.colorOf(it.kind)); g2.beginPath(); g2.arc(x, y, 2.2, 0, TAU); g2.fill(); }
    g2.restore();
  }
  // bot helper: where to walk when nobody is in sight
  roamTarget(c) {
    const Z = this.zone;
    if (c.dropping && c.brain?.dropTo) return c.brain.dropTo;
    const dz = Math.hypot(c.pos.x - Z.nx, c.pos.z - Z.nz);
    if (!this.inZone(c.pos, -6) || (Z.state === 'shrink' && dz > Z.nr - 4)) return new THREE.Vector3(Z.nx, 0, Z.nz);
    const it = this.nearestItem(c.pos, 45); if (it) return it.pos;
    return new THREE.Vector3(Z.nx, 0, Z.nz);
  }
  dispose() {
    const s = this.g.scene;
    for (const it of [...this.items]) this.removeItem(it);
    for (const F of this.falling || []) s.remove(F.mesh, F.beam);
    if (this.ship) { s.remove(this.ship.grp); this.ship.mc.dispose(); }
    for (const c of this.g.combatants) c.onShip = false;
    this.howl?.stop();
    s.remove(this.wall, this.nextRing); this.wall.geometry.dispose(); this.wall.material.dispose(); this.nextRing.geometry.dispose(); this.nextRing.material.dispose();
    for (const m of this.mats.values()) m.dispose();
    document.body.classList.remove('storm-out'); document.getElementById('br-inv')?.classList.add('hidden'); document.getElementById('br-results')?.classList.add('hidden');
    if (this.g.debugCam && this.deadT !== undefined) this.g.debugCam = null;
  }
}
