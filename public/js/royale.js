// Battle royale: 4–16 mages (solo or duos) ride a sky ferry across a large island, jump, loot and fight inside a
// shrinking storm of wild magic.
// Match flow: ferry (jump with Space) → drop (landing marker) → loot → six storm phases (caches fall, rain, sudden death)
// → standings / victory lap.
// Map (world.js + lands.js): the old arena is the island's heart; roads run out to named landmarks (a castle, a village,
// a colosseum, a wizard's spire, a henge, a farm, ruins, a forest lodge) and coastal watchtowers. Chests sit inside
// buildings (wooden, iron-bound, and gilded vaults at the top of the keep and the spire); loose loot lies everywhere.
// Items (rules in royale-rules.js): tiered gear Common → Legendary: two grimoires (element damage), an amulet (mana),
// a ward mantle (armor), boots (speed), an alchemist belt (potion slots) and an active rune (Q); potions 1 · 2 · 3.
// Strict upgrades are picked up by walking over them; trade-offs wait for the interact key (E). The fallen drop it all.
// Duos: a teammate ally, no friendly fire, revive wisps.
// Bots loot (walking in through doors), open chests, drink, use runes, recover at shrines, revive and outrun the storm.
import * as THREE from 'three';
import { ELEMENTS, ELEMENT_KEYS, elName } from './elements.js';
import { energyMaterial, crystalMaterial, flowMaterial, TIME, NOISE } from './shaders.js';
import { ARENA_R, ISLAND_R, SEA_Y, MESAS, SITES, onRoad } from './world.js';
import { applyHit, ENHANCE } from './combat.js';
import { t, getLang } from './i18n.js';
import { MagicCircle } from './magicCircle.js';
import { MageModel } from './characters.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TIERS, GEAR, RUNES, POTIONS, PHASES, POTION_EFFECT, ODDS, equip, grant, replaces, autoTake, isUpgrade, carried, rollItem, runeCooldown } from './royale-rules.js';
import { itemModel, rarityMarker, chestModel, glowSprite, CHEST, icon } from './loot-art.js';
import { elIcon } from './hud.js';
import { rand, pick, clamp, TAU, roman } from './util.js';

const hex = (n) => '#' + new THREE.Color(n).getHexString();
const ja = () => getLang() === 'ja';
// named places, announced as you enter them
const MESA_NAMES = [['Sunspire Mesa', '陽塔の卓状台地'], ['Hollow Mesa', '虚ろの卓状台地'], ['Titan Mesa', '巨神の卓状台地'], ['Ember Mesa', '熾火の卓状台地'], ['Wren Rock', '鷦鷯の岩'], ['Moon Rock', '月の岩']];
const QUARTERS = [['Whispering Ruins', '囁きの遺跡'], ['Bloomfield', '花咲く野'], ['Old Arches', '古き門'], ['Mistwood', '霧の森']];
const WILDS = [['Western Heath', '西の原野'], ['Northern Wolds', '北の高地'], ['Eastern Downs', '東の丘陵'], ['Southern Moors', '南の荒野']]; // by quarter, as regionOf counts them (compass north is -z)
function regionOf(world, x, z) {
  const r = Math.hypot(x, z), h = world.heightAt(x, z);
  for (const S of SITES) if (Math.hypot(x - S.x, z - S.z) < S.R + 8) return S.name;
  if (r < 12) return ['Azure Dais', '蒼の祭壇'];
  for (let i = 0; i < MESAS.length; i++) { const m = MESAS[i]; if (Math.hypot(x - m.x, z - m.z) < m.R) return MESA_NAMES[i]; }
  if (h < SEA_Y + 1) return ['Tidewash Shore', '潮騒の浜'];
  const q = Math.floor(((Math.atan2(z, x) + Math.PI * 1.25) % TAU) / (TAU / 4)) % 4;
  if (r > 132) return onRoad(x, z, 4) ? ['The King\'s Road', '王の街道'] : WILDS[q];
  if (r > 78) return ['Outer Terrace', '外縁の段丘'];
  return QUARTERS[q];
}
const NAMES = ['Vel', 'Rhea', 'Morrow', 'Isolde', 'Kael', 'Nyx', 'Oren', 'Sable', 'Thane', 'Lyra', 'Corvin', 'Ember', 'Wren', 'Ash', 'Iris', 'Dorian'];
const NAMES_JA = ['ヴェル', 'レア', 'モロウ', 'イゾルデ', 'カエル', 'ニクス', 'オーレン', 'セーブル', 'セイン', 'ライラ', 'コルヴィン', 'エンバー', 'レン', 'アッシュ', 'アイリス', 'ドリアン'];
const ROBES = [[0x5a1a2a, 0xff4a6a], [0x1a4a2a, 0x7dff8a], [0x3a1a5a, 0xc07aff], [0x5a3a10, 0xffb040], [0x0a3a4a, 0x40e0ff], [0x4a4a4a, 0xf0f0f0], [0x2a1a10, 0xff7a30], [0x10204a, 0x7aa0ff]];
const SHIP_Y = 110;

// ------------------------------------------------------------ storm wall shader: a curtain of wild violet magic
const stormMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: TIME, uCol: { value: new THREE.Color(0xa040ff) }, uHi: { value: new THREE.Color(0xffb8ff) } },
  vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
  fragmentShader: NOISE + /* glsl */ `
    uniform float uTime; uniform vec3 uCol,uHi; varying vec2 vUv; varying vec3 vW;
    void main(){
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
const GEM = new THREE.OctahedronGeometry(0.44, 0);
const BEAM = (() => { const g = new THREE.CylinderGeometry(0.12, 0.3, 1, 12, 1, true); g.translate(0, 0.5, 0); return g; })();
const RING = (() => { const g = new THREE.RingGeometry(0.55, 0.75, 40); g.rotateX(-Math.PI / 2); return g; })();

// ------------------------------------------------------------ item text
const tierName = (k) => TIERS[k.tier ?? 0][ja() ? 'ja' : 'en'];
export function itemName(k) {
  const J = ja();
  if (k.type === 'potion') return POTIONS[k.id][J ? 'ja' : 'en'];
  if (k.type === 'focus') return J ? `${elName(k.el)}の魔導書` : `${ELEMENTS[k.el].name} Grimoire`;
  if (k.type === 'rune') return J ? `${RUNES[k.id].ja}のルーン` : `${RUNES[k.id].en} Rune`;
  return GEAR[k.type][J ? 'ja' : 'en'];
}
export function itemStat(k) {
  const J = ja(), T = k.tier ?? 0, G = GEAR[k.type];
  let s;
  if (k.type === 'potion') return J ? `[${POTIONS[k.id].key}] で使用` : `press ${POTIONS[k.id].key} to drink`;
  if (k.type === 'focus') s = J ? `${elName(k.el)}ダメージ+${Math.round(G.stat[T] * 100)}%` : `+${Math.round(G.stat[T] * 100)}% ${ELEMENTS[k.el].name.toLowerCase()} damage`;
  if (k.type === 'amulet') s = J ? `最大マナ+${G.stat[T]} · マナ回復+${Math.round(G.regen[T] * 100)}%` : `+${G.stat[T]} max mana · +${Math.round(G.regen[T] * 100)}% mana regen`;
  if (k.type === 'mantle') s = J ? `アーマー ${G.stat[T]}` : `${G.stat[T]} armor`;
  if (k.type === 'boots') s = J ? `移動速度+${Math.round(G.stat[T] * 100)}%` : `+${Math.round(G.stat[T] * 100)}% move speed`;
  if (k.type === 'belt') s = J ? `薬を各${G.stat[T]}個まで所持` : `carry ${G.stat[T]} of each potion`;
  if (k.type === 'rune') s = `${RUNES[k.id].desc[J ? 1 : 0]} · ${Math.round(RUNES[k.id].cd * G.stat[T])}s`;
  if (T === 4) s += ' · ★ ' + G.perk[J ? 1 : 0];
  return s;
}
const itemColor = (k) => (k.type === 'potion' ? POTIONS[k.id].color : TIERS[k.tier].color);

// How-to page: the tiers, the slots and the potions
export function royaleGuide(J) {
  const L = J ? 1 : 0, rows = [];
  rows.push([TIERS.map((q) => `<span style="color:${hex(q.color)}">${q[J ? 'ja' : 'en']}</span>`).join(' › '), J ? '装備はすべてこの5段階。上位の装備は歩くだけで拾い、判断が要るものは <b>E</b> で交換' : 'every piece of gear rolls one of five tiers; walk over a strict upgrade to take it, press <b>E</b> to swap anything else', 0xffffff]);
  rows.push([GEAR.focus[J ? 'ja' : 'en'] + ' ×2', J ? 'その属性の魔法ダメージ +10〜50%' : '+10–50% damage with its element (you carry two)', 0xbd6bff]);
  rows.push([GEAR.amulet[J ? 'ja' : 'en'], J ? '最大マナとマナ回復' : 'max mana and mana regen', 0x3ea8ff]);
  rows.push([GEAR.mantle[J ? 'ja' : 'en'], J ? 'HPの前に削れるアーマー（守護薬で回復）' : 'armor that soaks damage before HP (Aegis Draughts refill it)', 0x5ee07a]);
  rows.push([GEAR.boots[J ? 'ja' : 'en'], J ? '移動速度' : 'move speed', 0xd4d8de]);
  rows.push([GEAR.belt[J ? 'ja' : 'en'], J ? '薬の所持数' : 'how many potions you can carry', 0xffa834]);
  rows.push([GEAR.rune[J ? 'ja' : 'en'] + ' [Q]', Object.values(RUNES).map((r) => r[J ? 'ja' : 'en']).join(' · '), 0x9fd8ff]);
  rows.push([J ? 'レジェンダリー' : 'Legendary', Object.values(GEAR).map((g) => g.perk[L].split(':')[0].split('：')[0]).join(' · '), 0xffa834]);
  rows.push(...Object.values(POTIONS).map((p) => ['[' + p.key + '] ' + p[J ? 'ja' : 'en'], J ? { '1': 'HP+220', '2': 'マナ+90', '3': 'アーマー+140（無ければシールド）' }[p.key] : { '1': '+220 HP', '2': '+90 mana', '3': '+140 armor (a shield without a mantle)' }[p.key], p.color]));
  rows.push([J ? '宝箱' : 'Chests', J ? '<b>E</b>で開ける。木箱 < 鉄の宝箱 < 城と塔の頂の秘宝の櫃' : 'press <b>E</b> to open: wooden < iron-bound < the vaults atop the keep and the spire', 0xc8a46a]);
  rows.push([J ? 'マナの祠' : 'Mana Shrine', J ? '石の環の中でマナと体力が回復（地図の青い丸）' : 'stand in the stone circle to restore mana and health (blue rings on the map)', 0x6fd8ff]);
  return rows.map(([n, d, c]) => '<li><b style="color:' + hex(c) + '">' + n + '</b> ' + d + '</li>').join('');
}

// lifetime record (per browser): matches, wins, best placement, eliminations
export function royaleRecord() { try { return { matches: 0, wins: 0, best: 0, kills: 0, ...JSON.parse(localStorage.getItem('voxarcana-royale') || '{}') }; } catch { return { matches: 0, wins: 0, best: 0, kills: 0 }; } }
function saveRecord(place, kills, won) {
  const r = royaleRecord(); r.matches++; r.kills += kills; if (won) r.wins++; if (place && (!r.best || place < r.best)) r.best = place;
  try { localStorage.setItem('voxarcana-royale', JSON.stringify(r)); } catch { /* private mode */ }
}

export class Royale {
  constructor(game) {
    this.g = game; this.items = []; this.chests = []; this.mats = new Map(); this.t = 0; this.over = false;
    this.zone = { cx: 0, cz: 0, r: ISLAND_R + 12, fromX: 0, fromZ: 0, fromR: ISLAND_R + 12, nx: 0, nz: 0, nr: PHASES[0].r, phase: 0, state: 'wait', st: 0, dps: 3 };
    this.pickNext();
    const wall = (this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 200, 1, true), stormMat()));
    wall.geometry.translate(0, 0.5, 0); wall.renderOrder = 5; wall.frustumCulled = false; game.scene.add(wall);
    const nextRing = (this.nextRing = new THREE.Mesh(new THREE.RingGeometry(0.99, 1, 200), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })));
    nextRing.rotation.x = -Math.PI / 2; nextRing.renderOrder = 5; game.scene.add(nextRing);
    this.tick = 0; this.hudT = 0; this.placements = [];
    this.howl = game.audio.loop('darkness', new THREE.Vector3(), 0, null, { spin: 0.9 });
    this.windSnd = game.audio.loop('wind', null, 0, null, { spin: 0.5 });
    this.shrineSnd = game.audio.loop('light', new THREE.Vector3(), 0);
    this.rainSnd = game.audio.loop('water', null, 0);
    // where you will land: a ring on the ground under you while you fall
    this.landMark = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 40), new THREE.MeshBasicMaterial({ color: 0xffd46a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    this.landMark.rotation.x = -Math.PI / 2; this.landMark.renderOrder = 6; this.landMark.visible = false; game.scene.add(this.landMark);
  }
  // ------------------------------------------------------------ setup
  start() {
    const g = this.g, p = g.player, J = ja();
    g.world.bound = ISLAND_R;
    const names = [...(J ? NAMES_JA : NAMES)].sort(() => Math.random() - 0.5);
    // the rival difficulty setting shifts the lobby's mix
    const diffs = { easy: ['easy', 'easy', 'easy', 'normal', 'easy', 'normal', 'easy'], normal: ['easy', 'normal', 'normal', 'normal', 'hard', 'normal', 'easy'], hard: ['normal', 'hard', 'hard', 'normal', 'hard', 'hard', 'normal'] }[g.settings.diff] || ['normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal'];
    const rivals = Math.max(3, Math.min(15, (g.settings.lobby || 8) - 1));
    this.duos = g.settings.royaleTeams === 2;
    if (this.duos) p.team = 1;
    for (let i = 0; i < rivals; i++) {
      // duos: the first bot is your ally (team 1, your colours); the rest pair up and share a robe
      const team = this.duos ? 1 + Math.ceil(i / 2) : 0, [robe, accent] = this.duos && team === 1 ? [0x1f2f6a, 0x6fd8ff] : ROBES[(this.duos ? team : i) % ROBES.length];
      const b = g.createBot(names[i % names.length] + (i >= names.length ? ' II' : ''), diffs[i % diffs.length], false, { robe, trim: 0xe0b95a, accent, hat: new THREE.Color(robe).multiplyScalar(0.6).getHex() });
      b.brain.sight = rand(42, 70); b.brain.lootFirst = rand(40, 100); b.brain.royale = this; b.team = team; // personalities: sharp-eyed brawlers to patient looters
      if (team === 1) b.ally = p;
    }
    // everyone boards a floating sky-island that ferries them across the map; each mage picks the moment to jump
    const all = [p, ...g.bots];
    this.buildShip();
    all.forEach((c, i) => {
      c.resetStats(); equip(c, pick(ELEMENT_KEYS));
      c.onShip = true; c.deckA = (i / all.length) * TAU; c.vel.set(0, 0, 0); c.grounded = true; c.pitch = -0.25;
      if (c.brain) { c.brain.dropTo = this.pickDrop(); c.brain.jumpAt = this.closestT(c.brain.dropTo) - 0.03 + rand(-0.04, 0.02); }
      if (c.model) c.model.root.visible = true;
    });
    p.yaw = Math.atan2(-this.ship.dir.x, -this.ship.dir.z);
    this.placeOnShip();
    this.spawnLoot();
    this.buildShrines();
    document.getElementById('br-inv')?.classList.remove('hidden');
    g.hud.banner(t('ban.royale'), t('royale.jumpHint'), 4);
    g.hud.hint?.('hint.royale');
    this.updateHud(true);
  }
  // where a bot wants to land: usually a landmark near the ferry's line, sometimes open country
  pickDrop() {
    const S = this.ship, near = SITES.filter((q) => !q.water && this.lineDist(q) < 170);
    if (near.length && Math.random() < 0.72) { const q = pick(near), a = rand(0, TAU), d = rand(0, q.R * 0.6); return new THREE.Vector3(q.x + Math.cos(a) * d, 0, q.z + Math.sin(a) * d); }
    const k = rand(0.1, 0.9), side = new THREE.Vector3(-S.dir.z, 0, S.dir.x), p = S.from.clone().lerp(S.to, k).addScaledVector(side, rand(-80, 80)).setY(0);
    if (p.length() > ISLAND_R - 25) p.setLength(ISLAND_R - 25);
    return p;
  }
  lineDist(q) { const S = this.ship, a = S.from.clone().setY(0), b = S.to.clone().setY(0), p = new THREE.Vector3(q.x, 0, q.z), ab = b.clone().sub(a), k = clamp(p.clone().sub(a).dot(ab) / ab.lengthSq()); return a.addScaledVector(ab, k).distanceTo(p); }
  // ------------------------------------------------------------ the sky ferry
  buildShip() {
    const g = this.g, a0 = rand(0, TAU), off = rand(-90, 90), L = ISLAND_R + 40;
    const dir = new THREE.Vector3(-Math.cos(a0), 0, -Math.sin(a0)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const from = dir.clone().multiplyScalar(-L).addScaledVector(side, off).setY(SHIP_Y), to = dir.clone().multiplyScalar(L).addScaledVector(side, off).setY(SHIP_Y);
    const grp = new THREE.Group();
    const rockG = new THREE.DodecahedronGeometry(1, 1), rp = rockG.attributes.position;
    for (let i = 0; i < rp.count; i++) { const y = rp.getY(i); rp.setY(i, y > 0 ? 0.25 : y * (1.6 + Math.random() * 0.3)); } // flat top, long hanging root
    rockG.computeVertexNormals();
    const rock = new THREE.Mesh(rockG, new THREE.MeshStandardMaterial({ color: 0x8a7866, roughness: 0.95 })); rock.scale.set(8.5, 5, 8.5); grp.add(rock);
    const turf = new THREE.Mesh(new THREE.CylinderGeometry(8.3, 8.6, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x6aa84a, roughness: 0.9 })); turf.position.y = 1.35; grp.add(turf);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.22, 8, 64), energyMaterial({ color: 0xffc444, core: 0xffffff, intensity: 1.6, noiseAmp: 0.05, opacity: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.y = -1; grp.add(ring);
    const cm = crystalMaterial({ color: new THREE.Color(0xbfe8ff), glow: new THREE.Color(0x6fd8ff), emissive: 1.6, crack: 0.2 });
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + 0.3, c = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), cm); c.scale.set(0.8, 2.2, 0.8); c.position.set(Math.cos(a) * 7.4, 2.6, Math.sin(a) * 7.4); c.rotation.z = Math.cos(a) * 0.2; grp.add(c); }
    // a floating waystone as the mast, and rock roots hanging beneath the island
    const mast = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), cm); mast.scale.set(0.9, 3.4, 0.9); mast.position.y = 5.2; grp.add(mast); this.mast = mast;
    const rockM = rock.material;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.5, r = rand(2, 5.5), st = new THREE.Mesh(new THREE.ConeGeometry(rand(0.8, 1.6), rand(3, 6), 6), rockM); st.rotation.x = Math.PI; st.position.set(Math.cos(a) * r * 0.6, -8.5 - rand(0, 2), Math.sin(a) * r * 0.6); grp.add(st); }
    const vineM = new THREE.MeshStandardMaterial({ color: 0x4a8a3a, roughness: 0.9 });
    for (let k = 0; k < 10; k++) { const a = rand(0, TAU), v = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.03, rand(2, 4.5), 4), vineM); v.position.set(Math.cos(a) * 8.2, -0.4 - v.geometry.parameters.height / 2, Math.sin(a) * 8.2); grp.add(v); }
    const mc = new MagicCircle({ seed: 7, tier: 7, color: new THREE.Color(0xffc444), radius: 10, intensity: 1.6 }); mc.group.rotation.x = Math.PI / 2; mc.group.position.y = -3.2; mc.target = 1; grp.add(mc.group);
    grp.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.scene.add(grp);
    this.ship = { grp, mc, ring, from, to, dir, t: 0, len: from.distanceTo(to), speed: 26, pos: from.clone(), active: true };
  }
  // path parameter (0..1) where the ferry passes closest to a point
  closestT(p) { const S = this.ship, ab = S.to.clone().sub(S.from).setY(0); return clamp(p.clone().sub(S.from).setY(0).dot(ab) / ab.lengthSq()); }
  placeOnShip() {
    const S = this.ship;
    for (const c of this.g.combatants) {
      if (!c.onShip) continue;
      const ox = c.deckOff ? c.deckOff.x : Math.cos(c.deckA) * 4.2, oz = c.deckOff ? c.deckOff.z : Math.sin(c.deckA) * 4.2;
      c.pos.set(S.pos.x + ox, S.pos.y + 1.62, S.pos.z + oz); c.vel.set(0, 0, 0); c.grounded = true;
      if (c.brain) c.yaw = Math.atan2(-S.dir.x, -S.dir.z);
    }
  }
  jump(c) {
    if (!c.onShip) return;
    const S = this.ship, g = this.g;
    c.onShip = false; c.dropping = true; c.grounded = false;
    c.vel.copy(S.dir).multiplyScalar(S.speed * 0.5).setY(4);
    g.fx.ring(c.pos.clone(), new THREE.Color(0xffc444), 3, 0.4); g.fx.shockwave(c.center(), 4, 0.8, 0.3);
    if (c === g.player) {
      g.audio.whoosh(1); g.hud.banner('', t('ban.royale2'), 2.5);
      for (const b of g.bots) if (b.ally === c && b.onShip) { b.brain.jumpAt = 0; b.brain.dropTo = c.pos.clone().addScaledVector(S.dir, 30).setY(0); } // your ally follows you off
    }
  }
  updateShip(dt) {
    const S = this.ship; if (!S) return;
    S.t += dt; const k = (S.t * S.speed) / S.len;
    S.pos.lerpVectors(S.from, S.to, Math.min(1.25, k)); S.pos.y = SHIP_Y + Math.sin(S.t * 0.8) * 0.4;
    S.grp.position.copy(S.pos); S.grp.rotation.y += dt * 0.05; S.ring.rotation.z += dt * 0.6; S.mc.update(dt);
    if (this.mast) { this.mast.rotation.y += dt * 0.8; this.mast.position.y = 5.2 + Math.sin(S.t * 1.6) * 0.3; }
    // bots leave when the ferry passes over where they want to land; everyone is out by the end of the line
    if (k > 0.8 && !S.warned && this.g.player?.onShip) { S.warned = true; this.g.hud.banner('', t('royale.jumpSoon'), 2); this.g.audio.tick?.(null, 3); }
    for (const c of this.g.combatants) if (c.onShip && ((c.brain && k >= c.brain.jumpAt) || k >= 1)) this.jump(c);
    this.placeOnShip();
    if (Math.random() < 0.5) this.g.fx.glow.emit({ x: S.pos.x + rand(-8, 8), y: S.pos.y - 2, z: S.pos.z + rand(-8, 8), vy: -3, life: 1, size: 0.3, size1: 0.05, color: new THREE.Color(0xffd070), alpha: 1, drag: 0.2, frame: 1 });
    if (k > 1.2) { this.g.scene.remove(S.grp); S.mc.dispose(); S.grp.traverse((m) => { m.geometry?.dispose(); }); this.ship = null; }
  }
  boarding() { return this.g.combatants.some((c) => c.onShip); }
  // ------------------------------------------------------------ loot
  randomSpot(maxR = ISLAND_R - 10) {
    const W = this.g.world;
    for (let k = 0; k < 60; k++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * maxR, x = Math.cos(a) * r, z = Math.sin(a) * r, h = W.heightAt(x, z);
      if (h < SEA_Y + 1.2 || W.normalAt(x, z).y < 0.85 || W.onRamp?.(x, z)) continue;
      const p = new THREE.Vector3(x, W.groundAt(x, z, h + 3), z), q = p.clone(); q.y += 1; W.collideBody(q, 0.9);
      if (Math.hypot(q.x - p.x, q.z - p.z) > 0.01 || W.solid(q)) continue; // not inside ruins, trees or rocks
      return p;
    }
    return new THREE.Vector3(rand(-20, 20), 0.5, rand(-20, 20));
  }
  spawnLoot() {
    const W = this.g.world;
    for (const s of W.lootSpots) {
      if (s.kind === 'chest') this.addChest(s);
      else { const p = new THREE.Vector3(s.x, W.groundAt(s.x, s.z, s.y + 0.5), s.z); this.dropItem(p, rollItem(ODDS[s.tier] ? s.tier : 'floor', ELEMENT_KEYS)); }
    }
    for (let i = 0; i < 70; i++) this.dropItem(this.randomSpot(), rollItem('floor', ELEMENT_KEYS)); // loose loot everywhere
    for (let i = 0; i < 16; i++) this.dropItem(this.randomSpot(ARENA_R - 10), rollItem('floor', ELEMENT_KEYS)); // the old arena keeps a share
    // high ground pays: every mesa top holds a find
    for (const m of MESAS) { const a = rand(0, TAU), d = rand(0, m.R * 0.45), x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d; this.dropItem(new THREE.Vector3(x, W.groundAt(x, z, 50), z), rollItem('chest', ELEMENT_KEYS)); }
  }
  addChest(s) {
    const { group, lid } = chestModel(s.tier);
    group.position.set(s.x, s.y, s.z); group.rotation.y = s.yaw; this.g.scene.add(group);
    const glow = new THREE.Mesh(RING, this.mat('chestRing' + s.tier, () => new THREE.MeshBasicMaterial({ color: CHEST[s.tier].glow, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })));
    glow.position.set(s.x, s.y + 0.04, s.z); glow.scale.setScalar(s.tier === 'vault' ? 1.9 : 1.3); this.g.scene.add(glow);
    this.chests.push({ spot: s, tier: s.tier, group, lid, glow, pos: new THREE.Vector3(s.x, s.y, s.z), open: false, t: 0, seed: Math.random() * 10 });
  }
  openChest(ch, c) {
    if (ch.open) return;
    ch.open = true; ch.t = 0; ch.by = c;
    const g = this.g, n = ch.tier === 'vault' ? 4 : ch.tier === 'iron' ? 3 : 2, src = ch.tier === 'vault' ? 'vault' : ch.tier === 'iron' ? 'iron' : 'chest';
    const out = new THREE.Vector3(Math.sin(ch.spot.yaw), 0, Math.cos(ch.spot.yaw)), at = ch.pos.clone().addScaledVector(out, 0.5).setY(ch.pos.y + 0.6);
    const loot = [...Array(n)].map(() => rollItem(src, ELEMENT_KEYS));
    if (ch.tier === 'vault' && !loot.some((q) => q.tier === 4)) { loot[0] = rollItem('cache', ELEMENT_KEYS); loot[0].tier = 4; } // a vault always holds a Legendary
    if (ch.tier === 'chest' && Math.random() < 0.7) loot.push({ type: 'potion', id: pick(['hp', 'hp', 'mana', 'shield']) });
    loot.forEach((k, i) => { const it = this.dropItem(at.clone(), k, true); const a = ch.spot.yaw + (i - (loot.length - 1) / 2) * 0.55; it.vel.set(Math.sin(a) * rand(2.2, 3.2), rand(5, 6.5), Math.cos(a) * rand(2.2, 3.2)); });
    const col = new THREE.Color(CHEST[ch.tier].glow);
    g.fx.ring(ch.pos.clone().setY(ch.pos.y + 0.1), col, 3, 0.5); g.fx.starburst?.(at, col, 3, 8, 0.25);
    for (let i = 0; i < 26; i++) g.fx.glow.emit({ x: at.x, y: at.y, z: at.z, vx: rand(-2, 2), vy: rand(2, 6), vz: rand(-2, 2), life: rand(0.5, 1), size: 0.2, size1: 0.02, color: col, alpha: 1, drag: 1.2, frame: 1 });
    g.fx.lights.request(at, col, 220, 8);
    if (c === g.player) g.audio.pickup?.(ch.tier === 'vault' ? 'relic' : 'core'); g.audio.shimmer?.(ch.pos);
    if (ch.tier === 'vault' && c === g.player) g.hud.banner('', t('royale.vault'), 2);
  }
  mat(key, make) { if (!this.mats.has(key)) this.mats.set(key, make()); return this.mats.get(key); }
  dropItem(pos, kind, pop = false) {
    const g = this.g, col = itemColor(kind);
    const grp = new THREE.Group(), body = itemModel(kind, col);
    body.scale.multiplyScalar(kind.type === 'potion' ? 1 : 1.2); body.rotation.order = 'YXZ'; // yaw toward the viewer, then the model's own tilt
    grp.add(glowSprite(kind.type === 'potion' ? 0 : kind.tier, col), body);
    const { ring, beam } = rarityMarker(kind.type === 'potion' ? 0 : kind.tier, col);
    if (kind.type === 'potion') ring.scale.setScalar(0.7);
    g.scene.add(grp, ring); if (beam) g.scene.add(beam);
    const it = { kind, grp, body, halo: ring, beam, pos: pos.clone(), vel: pop ? new THREE.Vector3(rand(-4, 4), rand(5, 8), rand(-4, 4)) : null, seed: Math.random() * 10, age: 0, col: new THREE.Color(col) };
    this.items.push(it);
    return it;
  }
  removeItem(it) { const s = this.g.scene; s.remove(it.grp, it.halo); if (it.beam) s.remove(it.beam); const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); }
  // bots: the nearest loot worth walking to (a chest, or an item they would actually want), reachable from the ground
  nearestLoot(c, maxD = 70) {
    const W = this.g.world; let best = null, bd = maxD;
    for (const it of this.items) {
      if (it.age < 1 || !isUpgrade(c, it.kind) || it.pos.y > W.heightAt(it.pos.x, it.pos.z) + 1.4 || !this.inZone(it.pos, -4)) continue;
      const d = it.pos.distanceTo(c.pos) - (it.kind.tier || 0) * 4; if (d < bd) { bd = d; best = it; }
    }
    for (const ch of this.chests) {
      if (ch.open || ch.spot.y > W.heightAt(ch.pos.x, ch.pos.z) + 1.4 || !this.inZone(ch.pos, -4)) continue;
      const d = ch.pos.distanceTo(c.pos) - 6; if (d < bd) { bd = d; best = ch; }
    }
    return best;
  }
  // bot/prompt helper: the nearest item within reach of a mage
  reachable(c, maxD = 2.3) {
    let best = null, bd = maxD;
    for (const it of this.items) { if (it.age < 0.5 || it.vel) continue; const d = Math.hypot(c.pos.x - it.pos.x, c.pos.z - it.pos.z); if (d < bd && Math.abs(c.pos.y - it.pos.y) < 2.2) { bd = d; best = it; } }
    return best;
  }
  // take an item (auto or by key): whatever it replaces drops at the mage's feet
  pickup(c, it) {
    const g = this.g, k = it.kind, col = it.col;
    const out = grant(c, k);
    if (out) {
      const d = this.dropItem(c.pos.clone().setY(c.pos.y + 0.8), out, true); d.vel.set(rand(-2, 2), 4, rand(-2, 2)); d.noAuto = c; d.noAutoT = 2.5;
      if (out.type === 'focus' && out.tier === 4 && !c.gear.focus.some((f) => f.tier === 4 && f.el === out.el)) { delete c.enh[out.el]; delete c.attuned[out.el]; } // the legendary blessing leaves with its book
      if (out.type === 'mantle' && out.tier === 4 && !(k.tier === 4)) c.relics.phoenix = 0;
    }
    // a Legendary grimoire attunes you: that element's Enhance blessing for the rest of the match
    if (k.type === 'focus' && k.tier === 4 && !c.attuned[k.el]) {
      c.attuned[k.el] = true; c.enh[k.el] = { t: 1e9, p: 0.6, dur: 1e9 }; if (k.el === 'ice') c.addShield(90, 1e9, 'ice');
      g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), new THREE.Color(ELEMENTS[k.el].color), 7, 0.7); g.fx.shockwave(c.center(), 6, 1, 0.4);
      if (c === g.player) { g.hud.banner(t('royale.attuned', { el: elName(k.el).toUpperCase() }), ja() ? ENHANCE[k.el].ja : ENHANCE[k.el].name, 2.5); g.audio.streak?.(3); }
    }
    g.fx.ring(it.pos.clone().setY(it.pos.y + 0.1), col, 2.5, 0.4);
    for (let i = 0; i < 14; i++) g.fx.glow.emit({ x: it.pos.x, y: it.pos.y + 1, z: it.pos.z, vx: rand(-2, 2), vy: rand(1, 5), vz: rand(-2, 2), life: rand(0.4, 0.8), size: 0.18, size1: 0.02, color: col, alpha: 1, drag: 1.5, frame: 1 });
    if (c === g.player) {
      g.audio.pickup?.(k.type === 'potion' ? 'potion' : k.tier >= 3 ? 'relic' : 'core');
      this.toast(k, out);
      if (k.tier >= 3) g.fx.shockwave(c.center(), 3, 0.6, 0.25);
      this.updateHud(true);
    }
    // the item flies into its new owner: marker and beam vanish now, the body follows the mage for a moment
    g.scene.remove(it.halo); if (it.beam) g.scene.remove(it.beam);
    this.items.splice(this.items.indexOf(it), 1); (this.flyers ||= []).push({ it, c, t: 0 });
  }
  // a loot card sliding in on the right (tier stripe, name, what it does, what it replaced)
  toast(k, out) {
    const box = document.getElementById('br-toasts'); if (!box) return;
    const el = document.createElement('div'), col = hex(itemColor(k));
    el.className = 'br-toast t' + (k.tier ?? 0); el.style.setProperty('--c', col);
    const ico = k.type === 'potion' ? `<span class="pot">${POTIONS[k.id].icon}</span>` : k.type === 'focus' ? `<span class="foc" style="color:${hex(ELEMENTS[k.el].color)}">${elIcon(k.el, 22)}</span>` : icon(k.type);
    el.innerHTML = `<div class="ti">${ico}</div><div class="tx">${k.type === 'potion' ? '' : `<small>${tierName(k)}</small>`}<b>${itemName(k)}</b><span>${itemStat(k)}</span>${out ? `<em>⇄ ${tierName(out)} ${itemName(out)}</em>` : ''}</div>`;
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 3600); setTimeout(() => el.remove(), 4200);
  }
  // potions: 1 heal · 2 mana · 3 armor (a shield when no mantle is worn)
  drink(c, id) {
    const g = this.g;
    if (!c.alive || !(c.inv?.[id] > 0)) return false;
    c.inv[id]--;
    const k = c.potionMult || 1;
    if (id === 'hp') { const n = POTION_EFFECT.hp * k; c.heal(n); g.onHeal?.(c, n); }
    if (id === 'mana') c.mana = Math.min(c.maxMana, c.mana + POTION_EFFECT.mana * k);
    if (id === 'shield') { if (c.maxArmor > 0) c.armor = Math.min(c.maxArmor, c.armor + POTION_EFFECT.shield * k); else c.addShield(POTION_EFFECT.shield * k, 20, 'light'); g.onShield?.(c); }
    const col = new THREE.Color(POTIONS[id].color);
    g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), col, 3.5, 0.5);
    for (let i = 0; i < 18; i++) { const a = rand(0, TAU); g.fx.glow.emit({ x: c.pos.x + Math.cos(a) * 0.7, y: c.pos.y + rand(0, 0.4), z: c.pos.z + Math.sin(a) * 0.7, vy: rand(2, 4.5), life: 0.9, size: 0.2, size1: 0.03, color: col, alpha: 1, drag: 0.6, frame: 1 }); }
    g.audio.drink?.(id, c === g.player ? null : c.pos);
    if (c === g.player) this.updateHud(true);
    return true;
  }
  // ------------------------------------------------------------ runes (Q)
  useRune(c, dir = null) {
    const r = c.gear?.rune, g = this.g;
    if (!r || !c.canAct() || c.runeCd > 0 || c.dropping) return false;
    c.runeCd = runeCooldown(c);
    const col = new THREE.Color(TIERS[r.tier].color), f = dir ? dir.clone().setY(0).normalize() : c.forward(new THREE.Vector3()).setY(0).normalize();
    if (r.id === 'blink') {
      const eye = c.eye(new THREE.Vector3()), hit = g.world.raycast(eye, f, 13, 0.4), d = hit.hit ? Math.max(0, hit.dist - 0.8) : 13;
      g.fx.explosion('arcane', c.center(), 1.2, 0.3, null, { noDecal: true });
      c.pos.x += f.x * d; c.pos.z += f.z * d; c.pos.y = Math.max(c.pos.y, g.world.groundAt(c.pos.x, c.pos.z, c.pos.y + 1.5)); c.vel.set(f.x * 4, 0, f.z * 4);
      g.world.collideBody(c.pos);
      g.fx.explosion('arcane', c.center(), 1.4, 0.35, null, { noDecal: true }); g.audio.whoosh(0.8);
    } else if (r.id === 'flight') { c.flying = 4; c.vel.y = Math.max(c.vel.y, 7); g.fx.element('wind', c.center(), { count: 20, speed: 4, size: 0.4 }); g.audio.whoosh(0.9); }
    else if (r.id === 'spring') { c.vel.y = 16; c.vel.x += f.x * 7; c.vel.z += f.z * 7; c.grounded = false; g.fx.shockwave(c.pos.clone().setY(c.pos.y + 0.2), 4, 0.6, 0.3); g.audio.impact('earth', 0.4, c.pos); }
    else if (r.id === 'haste') { c.haste = 6; g.fx.element('wind', c.center(), { count: 24, speed: 5, size: 0.35 }); g.audio.whoosh(0.7); }
    else if (r.id === 'ward') { c.addShield(150, 6, 'light'); g.onShield?.(c); }
    g.fx.ring(c.pos.clone().setY(c.pos.y + 0.15), col, 3, 0.4);
    return true;
  }
  // ------------------------------------------------------------ storm
  pickNext() {
    const Z = this.zone, P = PHASES[Z.phase];
    // the circle favours land: retry until the centre is on the island and not in the sea
    let nx = Z.cx, nz = Z.cz;
    for (let k = 0; k < 12; k++) {
      const room = Math.max(0, Z.r - P.r) * 0.85, a = rand(0, TAU), d = Math.sqrt(Math.random()) * room;
      nx = Z.cx + Math.cos(a) * d; nz = Z.cz + Math.sin(a) * d;
      const lim = ISLAND_R - P.r * 0.6 - 10, L = Math.hypot(nx, nz); if (L > lim && L > 0) { nx *= Math.max(0, lim) / L; nz *= Math.max(0, lim) / L; }
      if (this.g.world.heightAt(nx, nz) > SEA_Y + 1.5) break;
    }
    Object.assign(Z, { nx, nz, nr: P.r, dps: Z.phase ? PHASES[Z.phase - 1].dps : 3 });
  }
  inZone(p, margin = 0) { const Z = this.zone; return Math.hypot(p.x - Z.cx, p.z - Z.cz) < Z.r + margin; }
  updateZone(dt) {
    const Z = this.zone; if (!this.boarding()) Z.st += dt;
    const P = PHASES[Math.min(Z.phase, PHASES.length - 1)];
    if (Z.state === 'wait' && !Z.cached && Z.st >= P.wait * 0.35 && Z.phase < PHASES.length - 1) { Z.cached = true; this.dropCache(); }
    if (Z.state === 'wait' && Z.st >= P.wait) { Z.cached = false; Z.state = 'shrink'; Z.st = 0; Object.assign(Z, { fromX: Z.cx, fromZ: Z.cz, fromR: Z.r }); this.g.hud.banner('', t('royale.closing'), 2.5); this.g.audio.stormWarn?.(); }
    else if (Z.state === 'shrink') {
      const k = clamp(Z.st / P.shrink), e = k * k * (3 - 2 * k);
      Z.cx = Z.fromX + (Z.nx - Z.fromX) * e; Z.cz = Z.fromZ + (Z.nz - Z.fromZ) * e; Z.r = Z.fromR + (Z.nr - Z.fromR) * e; Z.dps = P.dps;
      if (k >= 1) { Z.phase++; Z.st = 0; Z.state = Z.phase < PHASES.length ? 'wait' : 'final'; if (Z.phase < PHASES.length) this.pickNext(); else { this.g.hud.banner(t('royale.sudden'), t('royale.sudden2'), 3); this.g.audio.stormWarn?.(); } }
    }
    if (Z.state === 'final') Z.dps += dt * 2.5; // sudden death: the last storm keeps getting hungrier
    this.wall.position.set(Z.cx, -20, Z.cz); this.wall.scale.set(Math.max(0.5, Z.r), 180, Math.max(0.5, Z.r));
    const pl0 = this.g.player; this.nextRing.visible = Z.state !== 'final' && !!(pl0?.onShip || pl0?.dropping); // a flat ring only reads from above; on the ground it floats through hills (the minimap shows it)
    this.nextRing.position.set(Z.nx, this.g.world.heightAt(Z.nx, Z.nz) + 0.4, Z.nz); this.nextRing.scale.setScalar(Math.max(0.5, Z.nr));
    // the storm burns anyone outside it (damage grows every phase); armor does not stop it
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.5;
      for (const c of this.g.combatants) {
        if (!c.alive || c.decoy || this.inZone(c.pos)) continue;
        applyHit(this.g, c, { dmg: Z.dps * 0.5 * (1 - (c.stormRes || 0)), el: null, src: null, point: c.center(), dot: true, dotEl: 'darkness', storm: true });
        this.g.fx.element('darkness', c.center(), { count: 3, speed: 1, size: 0.3 });
      }
    }
    const p = this.g.player, out = p && p.alive && !this.inZone(p.pos);
    this.boltT = (this.boltT || 0) - dt;
    if (p && this.boltT <= 0 && Z.r > 3) {
      this.boltT = rand(0.6, 1.8);
      const a0 = Math.atan2(p.pos.z - Z.cz, p.pos.x - Z.cx) + rand(-0.6, 0.6) * Math.min(1, 90 / Z.r), bx = Z.cx + Math.cos(a0) * Z.r, bz = Z.cz + Math.sin(a0) * Z.r;
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
    this.g.audio.sfxMuffle?.(out ? 0.55 : 0);
    if (out && Math.random() < dt * 2) this.g.fx.bolt(p.pos.clone().add(new THREE.Vector3(rand(-15, 15), 20, rand(-15, 15))), p.pos.clone().add(new THREE.Vector3(rand(-15, 15), 0, rand(-15, 15))), new THREE.Color(0xc070ff), { width: 0.2, dur: 0.2, branches: 2 });
  }
  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g;
    this.t += dt;
    this.updateShip(dt);
    const pl = g.player;
    if (pl) { const lm = this.landMark, on = pl.dropping && pl.alive; lm.visible = on; if (on) { const gy = g.world.groundAt(pl.pos.x, pl.pos.z, pl.pos.y); lm.position.set(pl.pos.x, gy + 0.15, pl.pos.z); lm.scale.setScalar(1 + (pl.pos.y - gy) * 0.06 + Math.sin(this.t * 6) * 0.08); } }
    this.windSnd?.set(null, pl?.onShip ? 0.25 : pl?.dropping ? clamp(-pl.vel.y / 22) * 0.9 : 0);
    if (!this.over) this.updateZone(dt);
    this.updateFalling(dt);
    this.updateShrines(dt);
    this.updateWisps(dt);
    for (let i = (this.flyers || []).length - 1; i >= 0; i--) {
      const F = this.flyers[i]; F.t += dt; const k = Math.min(1, F.t / 0.3);
      F.it.grp.position.lerp(F.c.center(), Math.min(1, dt * 14)); F.it.grp.scale.setScalar(Math.max(0.01, 1 - k)); F.it.body.rotation.y += dt * 12;
      if (k >= 1) { this.g.scene.remove(F.it.grp); this.flyers.splice(i, 1); }
    }
    // drop phase: slow magical descent with strong air control; a burst on landing
    for (const c of g.combatants) {
      if (c.runeCd > 0) c.runeCd -= dt;
      if (!c.dropping) continue;
      if (c.grounded || c.pos.y - g.world.groundAt(c.pos.x, c.pos.z, c.pos.y) < 0.3) {
        c.dropping = false;
        g.fx.shockwave(c.center(), 6, 1, 0.4); g.fx.ring(c.pos.clone().setY(c.pos.y + 0.2), new THREE.Color(0xf0d592), 6, 0.5);
        for (let i = 0; i < 10; i++) g.fx.puff(c.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0.2, rand(-1, 1))), { color: new THREE.Color(0xcdbb96), size: 1, life: 1.2, alpha: 0.6, rise: 0.6 });
        g.audio.impact('earth', 0.35, c.pos);
      } else if (Math.random() < 0.4) g.fx.glow.emit({ x: c.pos.x + rand(-0.4, 0.4), y: c.pos.y + 1.8, z: c.pos.z + rand(-0.4, 0.4), vy: 6, life: 0.4, size: 0.15, size1: 0.02, color: new THREE.Color(0xfff0c0), alpha: 1, drag: 0.5, frame: 1 });
    }
    // loot: bob, turn toward the viewer, markers; distance culling; auto pickup of strict upgrades
    const cam = g.debugCam ? { x: g.debugCam.pos[0], y: g.debugCam.pos[1], z: g.debugCam.pos[2] } : g.camera.position;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.age += dt; if (it.noAutoT > 0) it.noAutoT -= dt;
      if (it.vel) { it.vel.y -= 18 * dt; it.pos.addScaledVector(it.vel, dt); it.vel.multiplyScalar(1 - dt * 0.6); const gy = g.world.groundAt(it.pos.x, it.pos.z, it.pos.y + 0.5); if (it.pos.y <= gy) { it.pos.y = gy; it.vel = null; } }
      const d2 = (it.pos.x - cam.x) ** 2 + (it.pos.z - cam.z) ** 2, near = d2 < 95 * 95, mid = d2 < 150 * 150;
      it.grp.visible = near; it.halo.visible = mid; if (it.beam) it.beam.visible = d2 < 280 * 280;
      if (near) {
        const bob = 1.1 + Math.sin(this.t * 2 + it.seed) * 0.12;
        it.grp.position.set(it.pos.x, it.pos.y + bob, it.pos.z); it.body.rotation.y = Math.atan2(cam.x - it.pos.x, cam.z - it.pos.z) + Math.sin(this.t * 0.9 + it.seed) * 0.55;
        for (const ch of it.body.children) { if (ch.userData.spin) ch.rotation.y += dt * ch.userData.spin; if (ch.userData.orbit) ch.rotation.set(Math.sin(this.t * 1.3 + it.seed) * 0.6, this.t * 1.7, 0); }
        const k = it.kind.tier || 0;
        if (d2 < 35 * 35 && Math.random() < dt * (2.4 + k * 1.8)) { const a = rand(0, TAU); g.fx.glow.emit({ x: it.pos.x + Math.cos(a) * 0.5, y: it.pos.y + 0.5, z: it.pos.z + Math.sin(a) * 0.5, vy: rand(0.6, 1.4 + k * 0.4), life: rand(0.8, 1.4), size: 0.1 + k * 0.03, size1: 0.02, color: it.col, alpha: 1, drag: 0.3, frame: 1 }); } // motes only read at close range
        if (d2 < 35 * 35 && k >= 4 && Math.random() < dt * 18) g.fx.lights.request?.(it.grp.position, it.col, 90, 6);
      }
      if (mid) { it.halo.position.set(it.pos.x, it.pos.y + 0.06, it.pos.z); it.halo.rotation.y = this.t * 0.5 + it.seed; it.halo.scale.setScalar((it.kind.type === 'potion' ? 0.7 : 1) * (1 + Math.sin(this.t * 3 + it.seed) * 0.06)); }
      if (it.beam) it.beam.position.set(it.pos.x, it.pos.y, it.pos.z);
      if (it.age < 0.6 || it.vel) continue;
      for (const c of g.combatants) {
        if (!c.alive || c.decoy || !c.inv || c.dropping || (it.noAuto === c && it.noAutoT > 0)) continue;
        if ((c.pos.x - it.pos.x) ** 2 + (c.pos.z - it.pos.z) ** 2 > 1.7 ** 2 || Math.abs(c.pos.y - it.pos.y) > 2.5) continue;
        if (autoTake(c, it.kind) || (c.brain && isUpgrade(c, it.kind))) { this.pickup(c, it); break; }
      }
    }
    // chests: lids swing open, glow fades; bots open the one they are standing at
    for (const ch of this.chests) {
      const d2 = (ch.pos.x - cam.x) ** 2 + (ch.pos.z - cam.z) ** 2; ch.group.visible = d2 < 120 * 120; ch.glow.visible = !ch.open && d2 < 120 * 120;
      if (ch.open && ch.t < 1) { ch.t += dt; ch.lid.rotation.x = -1.9 * (1 - Math.pow(1 - clamp(ch.t / 0.45), 3)); }
      else if (!ch.open && ch.group.visible) { ch.glow.scale.setScalar((ch.tier === 'vault' ? 1.9 : 1.3) * (1 + Math.sin(this.t * 2.5 + ch.seed) * 0.08)); if (Math.random() < 0.05) g.fx.glow.emit({ x: ch.pos.x + rand(-0.4, 0.4), y: ch.pos.y + 0.6, z: ch.pos.z + rand(-0.3, 0.3), vy: rand(0.4, 1), life: 1.2, size: 0.1, size1: 0.02, color: new THREE.Color(CHEST[ch.tier].glow), alpha: 1, drag: 0.3, frame: 1 }); }
    }
    this.updateBots(dt);
    // spectate: once the player is out, follow whoever is still fighting
    const p = g.player;
    if (p && !p.alive && this.deadT !== undefined) {
      this.deadT += dt;
      if (g.mouse.lmb && !this._lmb) this.nextSpectate(); this._lmb = g.mouse.lmb;
      if (this.deadT > 2.5) {
        let s = this.spec; if (!s?.alive) s = this.spec = this.alive().sort((a, b) => b.kills - a.kills)[0];
        const lab = document.getElementById('br-spec'); if (lab) { lab.textContent = s ? '◉ ' + s.name + ' · ⚔ ' + s.kills : ''; lab.classList.toggle('hidden', !s || this.over); }
        if (s) { // over the shoulder, pulled in so walls and trees never block the view
          const f = s.forward(new THREE.Vector3()).setY(0).normalize(), head = s.pos.clone().setY(s.pos.y + 1.8), want = f.clone().multiplyScalar(-7).setY(2.4), L = want.length();
          const rc = g.world.raycast(head, want.clone().normalize(), L, 0.4), d = rc.hit ? Math.max(1.2, rc.dist - 0.6) : L;
          const cp = head.clone().addScaledVector(want.normalize(), d); this.camP = this.camP ? this.camP.lerp(cp, clamp(dt * 5)) : cp;
          g.debugCam = { pos: this.camP.toArray(), target: [s.pos.x, s.pos.y + 1.4, s.pos.z] };
        }
      }
    }
    if (this.victory) {
      const V = this.victory; V.t += dt; const a = V.t * 0.45, r = 6 + Math.min(4, V.t * 0.8), p2 = g.player;
      g.debugCam = { pos: [V.at.x + Math.cos(a) * r, V.at.y + 2.2 + V.t * 0.25, V.at.z + Math.sin(a) * r], target: [V.at.x, V.at.y + 1.3, V.at.z] };
      p2.yaw = Math.atan2(p2.pos.x - g.debugCam.pos[0], p2.pos.z - g.debugCam.pos[2]) + Math.sin(V.t * 2) * 0.3; p2.chanting = V.t % 3 < 1.5; // turn toward the lens, staff raised
    }
    this.updateLook(p);
    // announce the place you walk into
    if (p?.alive && !p.onShip && !p.dropping) {
      const reg = regionOf(g.world, p.pos.x, p.pos.z)[ja() ? 1 : 0];
      if (reg !== this.region) { this.region = reg; const el = document.getElementById('br-region'); if (el) { el.textContent = reg; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); } }
    }
    const mt = g.audio.musicTrack; if (mt) { const want = !this.over && this.alive().length <= 3 ? 1.07 : 1; if (mt.playbackRate !== want) { mt.preservesPitch = true; mt.playbackRate = want; } } // the last few: the music presses on
    // the late storm brings rain: streaks around the camera and a hiss that grows with the phase
    const rain = this.over ? 0 : clamp((this.zone.phase - 2.5) / 2.5);
    this.rainSnd?.set(null, rain * 0.35);
    if (rain > 0) { const cp = g.camera.position, n = Math.round(rain * 22 * g.fx.quality); for (let k = 0; k < n; k++) { const x = cp.x + rand(-18, 18), z = cp.z + rand(-18, 18); g.fx.sparks.emit(x, cp.y + rand(4, 14), z, -2, -34, -1, 0.5, new THREE.Color(0xc8d8f0), 0, 0.12); } }
    this.hudT -= dt; if (this.hudT <= 0) this.updateHud();
    else if (pl?.gear?.rune) this.updateRuneCd(pl);
  }
  // the item or chest in front of you: its card, what it would replace, and the interact key when in reach
  updateLook(p) {
    const g = this.g, lookEl = document.getElementById('br-look'); if (!lookEl) return;
    let best = null, bd = 0.985, reach = false;
    if (p?.alive && !p.onShip && !this.victory) {
      const cp = g.camera.position, dir = g.camera.getWorldDirection(new THREE.Vector3());
      const consider = (o, at, maxL) => { const v = at.clone().sub(cp), L = v.length(); if (L > maxL) return; const d = v.divideScalar(L).dot(dir) + (L < 3 ? 0.012 : 0); if (d > bd) { bd = d; best = o; } };
      for (const it of this.items) if (it.grp.visible && !it.vel) consider(it, it.grp.position, 14);
      for (const ch of this.chests) if (!ch.open && ch.group.visible) consider(ch, ch.pos.clone().setY(ch.pos.y + 0.5), 14);
      // nothing under the crosshair but something at your feet: offer that
      if (!best) { const r = this.reachable(p, 2.2); if (r) best = r; else { const ch = this.chests.find((q) => !q.open && q.pos.distanceTo(p.pos) < 2.4); if (ch) best = ch; } }
      if (best) reach = Math.hypot(best.pos.x - p.pos.x, best.pos.z - p.pos.z) < (best.lid ? 2.8 : 2.6) && Math.abs(best.pos.y - p.pos.y) < 2.4;
    }
    this.target = reach ? best : null;
    const key = best ? (best.lid ? 'c' + this.chests.indexOf(best) : 'i' + this.items.indexOf(best)) + reach + JSON.stringify(p?.gear) : '';
    if (key === this._lookKey) return; this._lookKey = key;
    if (!best) { lookEl.classList.remove('show'); return; }
    let h;
    if (best.lid) { const C = CHEST[best.tier]; h = `<b style="color:${hex(C.glow)}">${C[ja() ? 'ja' : 'en']}</b>${reach ? `<i><kbd>E</kbd> ${t('royale.open')}</i>` : ''}`; }
    else {
      const k = best.kind, col = hex(itemColor(k)), rep = replaces(p, k);
      h = `${k.type === 'potion' ? '' : `<small style="color:${col}">${tierName(k)}</small>`}<b style="color:${col}">${itemName(k)}</b><span>${itemStat(k)}</span>`;
      if (rep === false) h += `<i class="dim">${t(k.type === 'potion' ? 'royale.full' : 'royale.worse')}</i>`;
      else if (rep) h += `<i class="${isUpgrade(p, k) ? 'up' : ''}">${reach ? '<kbd>E</kbd> ' : ''}${t('royale.swap')} <b style="color:${hex(TIERS[rep.tier].color)}">${tierName(rep)} ${itemName(rep)}</b></i>`;
      else if (reach) h += `<i><kbd>E</kbd> ${t('royale.take')}</i>`;
    }
    lookEl.innerHTML = h; lookEl.classList.add('show');
  }
  // the interact key: take/swap the item you look at, or open the chest
  interact(c = this.g.player) {
    const o = this.target; if (!o || !c?.alive) return false;
    if (o.lid) { this.openChest(o, c); this._lookKey = null; return true; }
    if (!this.items.includes(o) || replaces(c, o.kind) === false) return false;
    this.pickup(c, o); this._lookKey = null; return true;
  }
  // ------------------------------------------------------------ bots: drink, runes, chests
  updateBots(dt) {
    const g = this.g;
    for (const b of g.bots) {
      if (!b.alive || !b.inv || b.onShip) continue;
      b.potT = (b.potT ?? rand(0, 1)) - dt;
      if (b.potT <= 0) {
        b.potT = 1;
        if (b.hp < b.maxHp * 0.4 && this.drink(b, 'hp')) continue;
        if (b.mana < 30 && this.drink(b, 'mana')) continue;
        if (b.maxArmor > 0 && b.armor < b.maxArmor * 0.4 && this.drink(b, 'shield')) continue;
        if (!b.maxArmor && b.hp < b.maxHp * 0.6 && b.shield <= 0) this.drink(b, 'shield');
      }
      // runes: blink / haste / spring toward safety or a far target, ward when hurt under fire
      const R = b.gear.rune;
      if (R && b.runeCd <= 0 && !b.dropping && b.canAct()) {
        const hurt = performance.now() - (b.lastHit || 0) < 1500, out = !this.inZone(b.pos, -2), dest = b.brain.navTo;
        if (R.id === 'ward' && hurt && b.hp < b.maxHp * 0.6) this.useRune(b);
        else if ((R.id === 'blink' || R.id === 'haste' || R.id === 'spring') && (out || (hurt && b.hp < b.maxHp * 0.35) || (dest && dest.distanceTo(b.pos) > 45 && Math.random() < dt * 0.3))) this.useRune(b, dest ? dest.clone().sub(b.pos) : new THREE.Vector3(this.zone.nx - b.pos.x, 0, this.zone.nz - b.pos.z));
        else if (R.id === 'flight' && out && Math.random() < dt) this.useRune(b);
      }
      // open the chest you walked up to
      const ch = b.brain.lootT?.lid ? b.brain.lootT : null;
      if (ch && !ch.open && ch.pos.distanceTo(b.pos) < 2.3) { b.chestT = (b.chestT || 0) + dt; if (b.chestT > 0.7) { this.openChest(ch, b); b.chestT = 0; b.brain.lootT = null; } }
    }
  }
  updateRuneCd(p) {
    const el = document.getElementById('br-rune-cd'); if (!el) return;
    const cd = runeCooldown(p), k = cd > 0 && p.runeCd > 0 ? clamp(p.runeCd / cd) : 0;
    el.style.setProperty('--k', k.toFixed(3)); el.parentElement?.classList.toggle('ready', k <= 0);
  }
  alive() { return this.g.combatants.filter((c) => c.alive && !c.decoy); }
  // teams still standing (solo: every mage is its own team)
  teamsLeft() { return new Set(this.alive().map((c) => c.team || c.id)).size; }
  // an arcane cache: a meteor of crystal that falls inside the next circle and bursts into Epic/Legendary gear
  dropCache() {
    const g = this.g, Z = this.zone;
    let x = Z.nx, z = Z.nz;
    for (let k = 0; k < 10; k++) { const a = rand(0, TAU), d = Math.sqrt(Math.random()) * Math.max(4, Z.nr * 0.7); x = Z.nx + Math.cos(a) * d; z = Z.nz + Math.sin(a) * d; if (g.world.heightAt(x, z) > SEA_Y + 1) break; }
    const gy = g.world.groundAt(x, z, 400);
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
        const L = rollItem('cache', ELEMENT_KEYS); L.tier = 4; this.dropItem(p, L, true);
        for (let k = 0; k < 3; k++) this.dropItem(p, rollItem('cache', ELEMENT_KEYS), true);
        g.scene.remove(F.mesh, F.beam); this.falling.splice(i, 1); this.cacheMark = null;
      }
    }
  }
  // Phoenix (the Legendary mantle's perk): cheat death once
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
    const g = this.g, left = this.alive().length, teams = this.teamsLeft(); // target already flagged dead
    target.place = (this.duos ? teams : left) + 1; target.killedBy = killer && killer !== target ? killer.name : null;
    const at = target.pos.clone(); at.y = g.world.groundAt(at.x, at.z, at.y + 1);
    // duos: the fallen leave a soul wisp their teammate can stand beside to revive them
    if (this.duos && target.team && this.alive().some((c) => c.team === target.team)) this.addWisp(target);
    // the fallen drop everything they carried (a loot pile that pays for the fight)
    const pile = carried(target), n = pile.length;
    pile.forEach((k, i) => { const it = this.dropItem(at.clone().setY(at.y + 0.8), k, true), a = (i / Math.max(1, n)) * TAU; it.vel.set(Math.cos(a) * rand(1.5, 3), rand(4.5, 6.5), Math.sin(a) * rand(1.5, 3)); });
    if (!this.duos || !target.team) { target.gear = { focus: [], amulet: null, mantle: null, boots: null, belt: null, rune: null }; target.inv = { hp: 0, mana: 0, shield: 0 }; }
    else { target.inv = { hp: 0, mana: 0, shield: 0 }; } // duos keep their gear for a revive; potions spill
    if (target === g.player) {
      this.deadT = 0; const mate = g.bots.find((b) => b.ally === target && b.alive); this.spec = mate || (killer?.alive && killer !== target ? killer : null); // watch your ally, else whoever got you
      if (mate) g.hud.banner(t('royale.down'), t('royale.waitRevive', { who: mate.name }), 5); else g.hud.banner(`#${target.place}`, (killer && killer !== target ? t('royale.elim', { who: killer.name }) : t('royale.elimStorm')) + ' · ⚔ ' + target.kills + ' · ' + Math.round(g.stats?.dmg || 0) + ' ' + t('damage'), 6);
      g.audio.ui('defeat');
    } else if (killer === g.player) g.hud.popup?.(target.center().add(new THREE.Vector3(0, 1.5, 0)), t('royale.kill'), 'react', '#ffd46a');
    if (teams <= 1) this.finish(this.alive().find((c) => c === g.player) || this.alive().find((c) => c.team && c.team === g.player?.team) || this.alive()[0]);
    else if (target === g.player) { if (!this.duos) this.record(target.place, false); setTimeout(() => { if (g.royale === this && !this.over) this.showResults(); }, 3000); }
    this.updateHud(true);
  }
  addWisp(c) {
    const g = this.g, pos = c.pos.clone(); pos.y = g.world.groundAt(pos.x, pos.z, pos.y + 1);
    const orb = new THREE.Mesh(GEM, this.mat('wisp', () => energyMaterial({ color: new THREE.Color(0x7fd0ff), core: 0xffffff, intensity: 2, noiseAmp: 0.2, opacity: 0.9 })));
    const ring = new THREE.Mesh(RING, this.mat('wispRing', () => new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })));
    ring.scale.setScalar(3.2); g.scene.add(orb, ring);
    (this.wisps ||= []).push({ c, pos, t: 30, prog: 0, orb, ring });
  }
  updateWisps(dt) {
    const g = this.g;
    for (let i = (this.wisps || []).length - 1; i >= 0; i--) {
      const W = this.wisps[i]; W.t -= dt;
      W.orb.position.set(W.pos.x, W.pos.y + 1.2 + Math.sin(this.t * 3) * 0.15, W.pos.z); W.orb.rotation.y += dt * 2; W.ring.position.set(W.pos.x, W.pos.y + 0.08, W.pos.z);
      const helper = g.combatants.find((o) => o.alive && !o.decoy && o.team === W.c.team && o !== W.c && Math.hypot(o.pos.x - W.pos.x, o.pos.z - W.pos.z) < 2.6);
      W.prog = helper ? W.prog + dt : Math.max(0, W.prog - dt * 0.5);
      W.ring.material.opacity = 0.4 + 0.5 * (W.prog / 4);
      if (helper && Math.random() < 0.5) g.fx.glow.emit({ x: W.pos.x + rand(-1, 1), y: W.pos.y + 0.2, z: W.pos.z + rand(-1, 1), vy: 3, life: 0.8, size: 0.16, size1: 0.03, color: new THREE.Color(0x9fe8ff), alpha: 1, drag: 0.4, frame: 1 });
      if (helper === g.player || W.c === g.player) { const lk = document.getElementById('br-look'); if (lk && helper) { lk.innerHTML = '<b style="color:#7fd0ff">' + t('royale.reviving', { who: W.c === g.player ? t('you') : W.c.name }) + ' ' + Math.round((W.prog / 4) * 100) + '%</b>'; lk.classList.add('show'); this._lookKey = null; } }
      const done = W.prog >= 4;
      if (done) this.revive(W.c, W.pos);
      if (done || W.t <= 0 || this.over || !this.alive().some((o) => o.team === W.c.team)) { g.scene.remove(W.orb, W.ring); this.wisps.splice(i, 1); }
    }
  }
  revive(c, pos) {
    const g = this.g;
    c.alive = true; c.hp = c.maxHp * 0.3; c.dots.length = 0; c.frozen = 0; c.stun = 0; c.pos.copy(pos); c.vel.set(0, 0, 0); c.place = null; c.killedBy = null;
    if (c.model) c.model.root.visible = true;
    g.fx.ring(pos.clone().setY(pos.y + 0.2), new THREE.Color(0x7fd0ff), 6, 0.6); g.fx.shockwave(c.center(), 7, 1, 0.4); g.audio.pickup?.('relic');
    g.hud.feed('<b style="color:#7fd0ff">✚ ' + t('royale.revived', { who: c === g.player ? t('you') : c.name }) + '</b>');
    if (c === g.player) { this.deadT = undefined; this.spec = null; g.debugCam = null; document.getElementById('br-results')?.classList.add('hidden'); document.getElementById('br-spec')?.classList.add('hidden'); g.hud.banner('', t('royale.revived', { who: t('you') }), 2); }
    this.updateHud(true);
  }
  // standings: survivors first, then the fallen by placement
  showResults() {
    const g = this.g, box = document.getElementById('br-results'); if (!box) return;
    const mages = g.combatants.filter((c) => !c.decoy && c.inv).sort((a, b) => (a.alive ? 0 : a.place || 99) - (b.alive ? 0 : b.place || 99) || b.kills - a.kills);
    const rows = mages.map((c) => '<tr class="' + (c === g.player ? 'me' : '') + (c.alive ? ' alive' : '') + '"><td>' + (c.alive ? (this.over ? '♛' : '•') : '#' + c.place) + '</td><td>' + (c === g.player ? t('you') : c.name) + '</td><td>⚔ ' + c.kills + '</td><td class="by">' + (c.alive ? t(this.over ? 'royale.winner' : 'royale.alive') : c.killedBy ? '← ' + c.killedBy : t('royale.storm')) + '</td></tr>').join('');
    box.innerHTML = '<div class="brr-head">' + t('royale.standings') + '</div><table>' + rows + '</table><div class="brr-foot">' + (this.over ? t('royale.again') : g.player?.alive ? t('royale.tabHint') : t('royale.spectate')) + '</div>';
    box.classList.remove('hidden');
  }
  nextSpectate() { const a = this.alive(); if (!a.length) return; const i = a.indexOf(this.spec); this.spec = a[(i + 1) % a.length]; }
  record(place, won) { if (this.recorded || !this.g.player) return; this.recorded = true; saveRecord(place, this.g.player.kills, won); }
  finish(winner) {
    if (this.over) return;
    this.over = true;
    const g = this.g, won = winner === g.player || (!!winner?.team && winner.team === g.player?.team);
    this.record(won ? 1 : g.player?.place || 2, won);
    g.slowmo = 1.2;
    g.hud.banner(t(won ? 'royale.win' : 'royale.lose'), won ? t('royale.win2', { k: g.player.kills, d: Math.round(g.stats?.dmg || 0) }) : t('royale.lose2', { who: winner?.name || '—' }), 6);
    g.audio.ui(won ? 'victory' : 'defeat');
    setTimeout(() => { if (g.royale === this) this.showResults(); }, 2500);
    if (won) {
      // the champion steps out of first person: a body appears and the camera circles it under fireworks
      const p = g.player;
      if (!p.model) { p.model = new MageModel({ robe: 0x1f2f6a, trim: 0xe0b95a, accent: 0x6fd8ff, hat: 0x141a3a }); p.model.setElement?.(g.lastEl || 'arcane'); g.scene.add(p.model.root); }
      this.victory = { t: 0, at: p.pos.clone() };
      g.viewModel.group.visible = false;
      for (let i = 0; i < 14; i++) setTimeout(() => {
        if (g.royale !== this || !g.player) return;
        const c = g.player.center().add(new THREE.Vector3(rand(-9, 9), rand(7, 14), rand(-9, 9))), el = pick(ELEMENT_KEYS);
        g.fx.explosion(el, c, 2.2, 0.7, null, { noDecal: true }); g.fx.starburst(c, new THREE.Color(ELEMENTS[el].color), 5, 10, 0.3); g.audio.impact(el, 0.5, c);
      }, 300 + i * 420);
    }
    setTimeout(() => { if (g.royale === this) g.endToMenu(); }, 20000);
  }
  // HUD: the equipment bar (tiered slots), potions, rune cooldown, ally panel, round line
  updateInventory() {
    const p = this.g.player, G = p.gear || {}, L = ja() ? 'ja' : 'en';
    const slots = [['focus', G.focus?.[0]], ['focus', G.focus?.[1]], ...['amulet', 'mantle', 'boots', 'belt', 'rune'].map(type => [type, G[type]])];
    document.getElementById('inventory-gear').innerHTML = slots.map(([type, it], i) =>
      `<article class="inventory-slot"${it ? ` style="--c:${hex(itemColor(it))}"` : ''}><small>${GEAR[type][L]}${type === 'focus' ? ' ' + (i + 1) : ''}${type === 'rune' ? ' · Q' : ''}</small><strong>${it ? itemName(it) : t('inv.empty')}</strong><span>${it ? tierName(it) + ' · ' + itemStat(it) : '—'}</span></article>`
    ).join('');
    document.getElementById('inventory-potions').innerHTML = Object.entries(POTIONS).map(([id, P]) =>
      `<article class="inventory-slot" style="--c:${hex(P.color)}"><small>${P.key} · ${P[L]}</small><strong>${p.inv?.[id] || 0} / ${p.potionCap}</strong><span>${itemStat({ type: 'potion', id })}</span></article>`
    ).join('');
  }
  updateHud(force = false) {
    const g = this.g, p = g.player; this.hudT = 0.25;
    const top = this.alive().sort((x, y) => y.kills - x.kills)[0]; this.leader = top && top.kills >= 2 ? top : null; // the kill leader wears a crown
    if (!p) return;
    const Z = this.zone, P = PHASES[Math.min(Z.phase, PHASES.length - 1)];
    const left = Z.state === 'wait' ? Math.ceil(P.wait - Z.st) : Z.state === 'shrink' ? Math.ceil(P.shrink - Z.st) : 0;
    const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const zoneTxt = Z.state === 'wait' ? t('royale.zoneWait', { t: mm }) : Z.state === 'shrink' ? t('royale.zoneShrink', { t: mm }) : t('royale.zoneFinal');
    g.hud.round(`✦ ${this.duos ? this.teamsLeft() + ' ' + t('royale.teams') : this.alive().length + ' ' + t('royale.alive')} · ⚔ ${p.kills} · ${zoneTxt}`);
    const ap = document.getElementById('ally-panel');
    if (ap) {
      const mate = this.duos && g.bots.find((b) => b.ally === p);
      ap.classList.toggle('hidden', !mate);
      if (mate) { const w = this.wisps?.find((q) => q.c === mate); ap.innerHTML = '<span class="an">◆ ' + mate.name + '</span>' + (mate.alive ? '<span class="ab"><i style="width:' + Math.round(clamp(mate.hp / mate.maxHp) * 100) + '%"></i></span>' : '<span class="ad">' + t('royale.down') + (w ? ' · ' + Math.ceil(w.t) + 's' : '') + '</span>'); }
    }
    const box = document.getElementById('br-inv'); if (!box) return;
    const key = JSON.stringify([p.inv, p.gear, p.potionCap, getLang()]);
    if (!force && key === this._invKey) { this.updateRuneCd(p); return; } this._invKey = key;
    const G = p.gear || {};
    const slot = (it, type, extra = '') => {
      if (!it) return `<div class="br-slot empty" title="${GEAR[type].en}">${icon(type)}${extra}</div>`;
      const col = hex(TIERS[it.tier].color), el = it.type === 'focus' ? `<span class="el" style="color:${hex(ELEMENTS[it.el].color)}">${elIcon(it.el, 15)}</span>` : '';
      return `<div class="br-slot t${it.tier}" style="--c:${col}">${it.type === 'focus' ? `<span class="foc" style="color:${hex(ELEMENTS[it.el].color)}">${elIcon(it.el, 24)}</span>` : icon(type)}${el}<span class="tn">${roman(it.tier + 1)}</span>${extra}</div>`;
    };
    const f = G.focus || [];
    const rune = G.rune ? slot(G.rune, 'rune', `<kbd>Q</kbd><span class="cd" id="br-rune-cd"></span>`) : slot(null, 'rune', '<kbd>Q</kbd>');
    const pots = Object.entries(POTIONS).map(([id, P2]) => `<div class="br-pot${p.inv?.[id] ? '' : ' empty'}" style="--c:${hex(P2.color)}"><kbd>${P2.key}</kbd><span>${P2.icon}</span><b>${p.inv?.[id] || 0}<small>/${p.potionCap}</small></b></div>`).join('');
    box.innerHTML = `<span class="inventory-hint">I · ${t('inv.title')}</span><div class="br-gear">${slot(f[0], 'focus')}${slot(f[1], 'focus')}<i class="sep"></i>${slot(G.amulet, 'amulet')}${slot(G.mantle, 'mantle')}${slot(G.boots, 'boots')}${slot(G.belt, 'belt')}<i class="sep"></i>${rune}</div><div class="br-pots">${pots}</div>`;
    this.updateRuneCd(p);
  }
  // minimap overlay: current storm edge + next circle (hud.drawMinimap calls this inside its rotated frame)
  drawMinimap(g2, p, scale) {
    const Z = this.zone, R2 = (95 / scale) ** 2;
    g2.save();
    g2.fillStyle = 'rgba(150,60,255,0.28)'; g2.beginPath(); g2.rect(-400, -400, 800, 800); g2.arc((Z.cx - p.pos.x) * scale, (Z.cz - p.pos.z) * scale, Z.r * scale, 0, TAU, true); g2.fill();
    g2.strokeStyle = 'rgba(210,140,255,0.95)'; g2.lineWidth = 2; g2.beginPath(); g2.arc((Z.cx - p.pos.x) * scale, (Z.cz - p.pos.z) * scale, Z.r * scale, 0, TAU); g2.stroke();
    if (this.ship) { const S = this.ship; g2.strokeStyle = 'rgba(255,212,106,0.9)'; g2.lineWidth = 2; g2.setLineDash([6, 5]); g2.beginPath(); g2.moveTo((S.pos.x - p.pos.x) * scale, (S.pos.z - p.pos.z) * scale); g2.lineTo((S.to.x - p.pos.x) * scale, (S.to.z - p.pos.z) * scale); g2.stroke(); g2.setLineDash([]); g2.fillStyle = '#ffd46a'; g2.beginPath(); g2.arc((S.pos.x - p.pos.x) * scale, (S.pos.z - p.pos.z) * scale, 5, 0, TAU); g2.fill(); g2.strokeStyle = 'rgba(210,140,255,0.95)'; }
    if (Z.state !== 'final') { g2.strokeStyle = 'rgba(255,255,255,0.85)'; g2.setLineDash([4, 4]); g2.beginPath(); g2.arc((Z.nx - p.pos.x) * scale, (Z.nz - p.pos.z) * scale, Z.nr * scale, 0, TAU); g2.stroke(); g2.setLineDash([]); }
    const zx = (Z.nx - p.pos.x) * scale, zy = (Z.nz - p.pos.z) * scale, zl = Math.hypot(zx, zy);
    if (zl > 78) { const ux = zx / zl, uy = zy / zl; g2.save(); g2.translate(ux * 74, uy * 74); g2.rotate(Math.atan2(uy, ux)); g2.fillStyle = '#fff'; g2.shadowColor = '#a040ff'; g2.shadowBlur = 8; g2.beginPath(); g2.moveTo(9, 0); g2.lineTo(-6, -6); g2.lineTo(-3, 0); g2.lineTo(-6, 6); g2.closePath(); g2.fill(); g2.restore(); }
    if (this.cacheMark) { const x = (this.cacheMark.x - p.pos.x) * scale, y = (this.cacheMark.z - p.pos.z) * scale, l = Math.hypot(x, y), k = l > 80 ? 80 / l : 1; g2.fillStyle = '#ffd46a'; g2.shadowColor = '#ffb000'; g2.shadowBlur = 10; g2.beginPath(); g2.arc(x * k, y * k, 5, 0, TAU); g2.fill(); g2.shadowBlur = 0; }
    for (const S of this.shrines || []) { const x = (S.pos.x - p.pos.x) * scale, y = (S.pos.z - p.pos.z) * scale; if (x * x + y * y > 8100) continue; g2.strokeStyle = '#9fe8ff'; g2.lineWidth = 2; g2.beginPath(); g2.arc(x, y, 5, 0, TAU); g2.stroke(); }
    if (scale > 1) { // close up: loot dots (rarer = bigger) and unopened chests
      for (const it of this.items) { const dx = it.pos.x - p.pos.x, dz = it.pos.z - p.pos.z; if (dx * dx + dz * dz > R2) continue; g2.fillStyle = hex(itemColor(it.kind)); g2.beginPath(); g2.arc(dx * scale, dz * scale, 1.6 + (it.kind.tier || 0) * 0.5, 0, TAU); g2.fill(); }
      for (const ch of this.chests) { if (ch.open) continue; const dx = ch.pos.x - p.pos.x, dz = ch.pos.z - p.pos.z; if (dx * dx + dz * dz > R2) continue; g2.fillStyle = hex(CHEST[ch.tier].glow); g2.fillRect(dx * scale - 2.5, dz * scale - 2, 5, 4); }
    }
    g2.restore();
  }
  // bot helper: where to walk when nobody is in sight (through a door waypoint when the loot is indoors)
  roamTarget(c) {
    const Z = this.zone, B = c.brain;
    if (c.dropping && B?.dropTo) return B.dropTo;
    const wisp = this.wisps?.find((w) => w.c.team && w.c.team === c.team && w.c !== c && this.inZone(w.pos, -2)); if (wisp) return wisp.pos; // go revive your teammate
    const dz = Math.hypot(c.pos.x - Z.nx, c.pos.z - Z.nz);
    if (!this.inZone(c.pos, -6) || (Z.state === 'shrink' && dz > Z.nr - 4)) { B.lootT = null; return new THREE.Vector3(Z.nx, 0, Z.nz); }
    if (c.mana < c.maxMana * 0.35 || c.hp < c.maxHp * 0.5) { const sh = this.nearestShrine(c.pos, 60); if (sh) return sh.pos; } // go recover at a shrine
    // keep the current loot target a while (re-plan every few seconds or when it is gone)
    const gone = B.lootT && (B.lootT.lid ? B.lootT.open : !this.items.includes(B.lootT));
    if (!B.lootT || gone || this.t > (B.lootReT || 0)) { const nt = this.nearestLoot(c); if (nt !== B.lootT) B.viaI = 0; B.lootT = nt; B.lootReT = this.t + 4; }
    const L = B.lootT;
    if (L) {
      const via = L.lid ? L.spot.via : null;
      if (via?.length) { // walk the waypoints in order, skipping ahead once past one
        while (B.viaI < via.length && Math.hypot(via[B.viaI].x - c.pos.x, via[B.viaI].z - c.pos.z) < 1.6) B.viaI++;
        const far = Math.hypot(L.pos.x - c.pos.x, L.pos.z - c.pos.z) > 3.5;
        if (far && B.viaI < via.length) return (B.navTo = via[B.viaI]);
      }
      return (B.navTo = L.pos);
    }
    return (B.navTo = new THREE.Vector3(Z.nx, 0, Z.nz));
  }
  // ------------------------------------------------------------ mana shrines: contested circles that restore mana and health
  buildShrines() {
    const g = this.g; this.shrines = [];
    const W = g.world, plan = [...[0, 1, 2, 3].map((k) => [(k / 4) * TAU + Math.PI / 4, 30, 62]), ...[0, 1, 2, 3, 4, 5].map((k) => [(k / 6) * TAU + 0.26, 150, 290])];
    for (const [a0, r0, r1] of plan) {
      let pos = null;
      for (let tries = 0; tries < 40 && !pos; tries++) {
        const a = a0 + rand(-0.3, 0.3), r = rand(r0, r1), x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (MESAS.some((m) => Math.hypot(x - m.x, z - m.z) < m.R + 5) || SITES.some((s) => Math.hypot(x - s.x, z - s.z) < s.R + 10) || W.normalAt(x, z).y < 0.9 || W.heightAt(x, z) < SEA_Y + 1.5) continue;
        const q = new THREE.Vector3(x, W.heightAt(x, z) + 1, z); W.collideBody(q, 3); if (Math.hypot(q.x - x, q.z - z) > 0.01) continue;
        pos = new THREE.Vector3(x, W.heightAt(x, z), z);
      }
      if (!pos) continue;
      const grp = new THREE.Group(); grp.position.copy(pos);
      const mc = new MagicCircle({ seed: 40 + this.shrines.length, tier: 5, color: new THREE.Color(0x6fd8ff), radius: 4.2, intensity: 1.2 }); mc.group.rotation.x = -Math.PI / 2; mc.group.position.y = 0.1; mc.target = 1; mc.spin = 0.3; grp.add(mc.group);
      const stoneM = this.mat('shrineStone', () => new THREE.MeshStandardMaterial({ color: 0xc8bca0, roughness: 0.85 }));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, h = 2.2 + (i % 2) * 0.8, st = new THREE.Mesh(new RoundedBoxGeometry(0.75, h, 0.55, 2, 0.12), stoneM); st.position.set(Math.cos(a) * 4.6, h / 2 - 0.15, Math.sin(a) * 4.6); st.rotation.set(rand(-0.06, 0.06), -a + rand(-0.15, 0.15), rand(-0.08, 0.08)); st.castShadow = true; grp.add(st); }
      const cry = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), this.mat('shrineCry', () => crystalMaterial({ color: new THREE.Color(0xcff4ff), glow: new THREE.Color(0x6fd8ff), emissive: 1.8, crack: 0.2 }))); cry.scale.set(1, 2, 1); cry.position.y = 2.6; grp.add(cry);
      const beam = new THREE.Mesh(BEAM, this.mat('shrineBeam', () => flowMaterial({ color: new THREE.Color(0x6fd8ff), core: 0xffffff, intensity: 1, scroll: -1.2, stripes: 2, opacity: 0.3 }))); beam.scale.set(3, 18, 3); grp.add(beam);
      g.scene.add(grp);
      this.shrines.push({ pos, grp, mc, cry, R: 4.2, busy: 0 });
    }
  }
  nearestShrine(p, maxD) { let best = null, bd = maxD; for (const s of this.shrines || []) { const d = s.pos.distanceTo(p); if (d < bd && this.inZone(s.pos, -3)) { bd = d; best = s; } } return best; }
  updateShrines(dt) {
    const g = this.g, pl = g.player, near = pl && this.nearestShrine(pl.pos, 30);
    this.shrineSnd?.set(near ? near.pos.clone().setY(near.pos.y + 2.5) : null, near ? clamp(1 - near.pos.distanceTo(pl.pos) / 30) * 0.3 : 0); // a soft hum draws you in
    const cam = g.debugCam ? { x: g.debugCam.pos[0], z: g.debugCam.pos[2] } : g.camera.position;
    for (const S of this.shrines || []) {
      const vis = (S.pos.x - cam.x) ** 2 + (S.pos.z - cam.z) ** 2 < 260 * 260; S.grp.visible = vis;
      if (vis) { S.mc.update(dt); S.cry.rotation.y += dt * 1.2; S.cry.position.y = 2.6 + Math.sin(this.t * 1.5 + S.pos.x) * 0.2; }
      let n = 0, mine = 0, foes = 0; const me = g.player;
      for (const c of g.combatants) {
        if (!c.alive || c.decoy || !c.inv || Math.hypot(c.pos.x - S.pos.x, c.pos.z - S.pos.z) > S.R || Math.abs(c.pos.y - S.pos.y) > 3) continue;
        n++; if (c === me || (me?.team && c.team === me.team)) mine++; else foes++; c.mana = Math.min(c.maxMana, c.mana + dt * 22); c.heal(dt * 7);
        if (Math.random() < 0.3) g.fx.glow.emit({ x: c.pos.x + rand(-0.4, 0.4), y: c.pos.y + 0.2, z: c.pos.z + rand(-0.4, 0.4), vy: rand(2, 3.5), life: 0.8, size: 0.14, size1: 0.02, color: new THREE.Color(0x9fe8ff), alpha: 1, drag: 0.4, frame: 1 });
      }
      if (n && !S.busy && g.player && Math.hypot(g.player.pos.x - S.pos.x, g.player.pos.z - S.pos.z) < S.R) { g.audio.shimmer?.(S.pos); g.hud.feed('<b style="color:#9fe8ff">✦ ' + t('royale.shrine') + '</b>'); }
      S.busy = n;
      // who holds it: blue (you / your team), red (rivals), violet (contested), calm cyan (empty)
      if (vis) { S.mc.setColor?.(mine && foes ? 0xc070ff : mine ? 0x4aa8ff : foes ? 0xff5a4a : 0x6fd8ff, 1.2); g.fx.lights.request?.(S.cry.position.clone().add(S.pos), new THREE.Color(0x6fd8ff), n ? 160 : 60, 10); }
    }
  }
  dispose() {
    const s = this.g.scene;
    this.g.world.bound = ARENA_R;
    for (const S of this.shrines || []) { s.remove(S.grp); S.mc.dispose(); S.grp.traverse((m) => m.geometry?.dispose()); }
    for (const it of [...this.items]) this.removeItem(it);
    for (const ch of this.chests) s.remove(ch.group, ch.glow);
    for (const F of this.flyers || []) s.remove(F.it.grp);
    for (const F of this.falling || []) s.remove(F.mesh, F.beam);
    for (const W of this.wisps || []) s.remove(W.orb, W.ring);
    if (this.ship) { s.remove(this.ship.grp); this.ship.mc.dispose(); this.ship.grp.traverse((m) => m.geometry?.dispose()); }
    for (const c of this.g.combatants) c.onShip = false;
    this.howl?.stop(); this.windSnd?.stop(); this.shrineSnd?.stop(); this.rainSnd?.stop();
    s.remove(this.wall, this.nextRing, this.landMark); this.landMark.geometry.dispose(); this.landMark.material.dispose(); this.wall.geometry.dispose(); this.wall.material.dispose(); this.nextRing.geometry.dispose(); this.nextRing.material.dispose();
    for (const m of this.mats.values()) m.dispose();
    document.body.classList.remove('storm-out'); this.g.audio.sfxMuffle?.(0); if (this.g.audio.musicTrack) this.g.audio.musicTrack.playbackRate = 1;
    for (const id of ['br-inv', 'br-results', 'br-spec', 'ally-panel']) document.getElementById(id)?.classList.add('hidden');
    document.getElementById('br-look')?.classList.remove('show'); const tb = document.getElementById('br-toasts'); if (tb) tb.innerHTML = '';
    if (this.g.debugCam && (this.deadT !== undefined || this.victory)) this.g.debugCam = null;
  }
}
