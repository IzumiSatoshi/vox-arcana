// Battle royale rules as plain data + pure functions (no rendering), so they can be unit-tested in Node.
//
// Loot works like a tiered-gear looter: every piece of equipment rolls a rarity tier (Common → Legendary), each slot holds
// one piece (two for grimoires), and a better tier always beats a worse one. Walking over a strict upgrade takes it;
// anything that is a trade-off (another element, another rune) waits for you to press the interact key. Legendary pieces
// carry a unique perk on top of their stats. The fallen drop everything they wore.

export const TIERS = [
  { id: 'common', en: 'Common', ja: 'コモン', color: 0xd4d8de },
  { id: 'uncommon', en: 'Uncommon', ja: 'アンコモン', color: 0x5ee07a },
  { id: 'rare', en: 'Rare', ja: 'レア', color: 0x3ea8ff },
  { id: 'epic', en: 'Epic', ja: 'エピック', color: 0xbd6bff },
  { id: 'legendary', en: 'Legendary', ja: 'レジェンダリー', color: 0xffa834 },
];

// equipment slots; `stat[tier]` is the slot's main number, `perk` is what only the legendary adds
export const GEAR = {
  focus: { en: 'Grimoire', ja: '魔導書', stat: [0.1, 0.18, 0.27, 0.38, 0.5], perk: ['Attuned: its element\'s Enhance blessing all match', '共鳴：その属性の強化を試合中ずっと得る'] },
  amulet: { en: 'Amulet', ja: '護符', stat: [15, 30, 45, 60, 80], regen: [0.1, 0.2, 0.3, 0.4, 0.55], perk: ['Echo: 25% chance a spell echoes at half power', '残響：25%の確率で魔法が半分の威力で再発動'] },
  mantle: { en: 'Ward Mantle', ja: '守りの外套', stat: [60, 120, 180, 240, 300], perk: ['Phoenix: rise again once with half HP', '不死鳥：一度だけHP半分で復活'] },
  boots: { en: 'Boots', ja: '靴', stat: [0.04, 0.07, 0.1, 0.13, 0.16], perk: ['Stormwalker: storm damage halved', '嵐渡り：嵐のダメージ半減'] },
  belt: { en: 'Alchemist Belt', ja: '錬金帯', stat: [3, 4, 5, 6, 7], perk: ['Distilled: potions 50% stronger', '蒸留：薬の効果+50%'] },
  rune: { en: 'Rune', ja: 'ルーン', stat: [1, 0.88, 0.76, 0.64, 0.5], perk: ['Swift: half cooldown', '迅速：再使用時間半減'] },
};
export const SLOTS = ['focus', 'amulet', 'mantle', 'boots', 'belt', 'rune'];
// active runes (key Q): seconds of cooldown at Common
export const RUNES = {
  blink: { en: 'Blink', ja: '瞬身', cd: 9, desc: ['teleport 13 m ahead', '前方13mへ瞬間移動'] },
  flight: { en: 'Flight', ja: '飛翔', cd: 24, desc: ['fly for 4 s (Space rises, Ctrl sinks)', '4秒間飛行（Spaceで上昇）'] },
  spring: { en: 'Springstep', ja: '跳躍', cd: 11, desc: ['leap high, then glide', '高く跳び、滑空する'] },
  haste: { en: 'Wolfblood', ja: '狼血', cd: 20, desc: ['run 35% faster for 6 s', '6秒間移動速度+35%'] },
  ward: { en: 'Ward', ja: '護壁', cd: 25, desc: ['instant 150 shield', '即座にシールド150'] },
};
export const RUNE_KEYS = Object.keys(RUNES);
export const POTIONS = {
  hp: { en: 'Healing Draught', ja: '回復薬', key: '1', color: 0xff4a5a, icon: '✚' },
  mana: { en: 'Mana Draught', ja: 'マナ薬', key: '2', color: 0x3a8aff, icon: '◆' },
  shield: { en: 'Aegis Draught', ja: '守護薬', key: '3', color: 0xffc83a, icon: '⛨' },
};
export const POTION_EFFECT = { hp: 220, mana: 90, shield: 140 };
export const POTION_CAP = 2; // without a belt

// rarity odds (percent per tier) for each loot source
export const ODDS = {
  floor: [52, 30, 13, 4, 1],
  chest: [28, 36, 24, 10, 2],   // wooden chests in houses and ruins
  iron: [8, 26, 36, 24, 6],     // iron-bound chests at landmarks
  vault: [0, 0, 30, 48, 22],    // gilded vaults atop the keep and the spire
  cache: [0, 0, 0, 40, 60],     // the arcane cache that falls each storm phase
};
// what an item is, by weight
const KIND_W = [['focus', 30], ['potion', 22], ['mantle', 11], ['amulet', 10], ['boots', 9], ['rune', 10], ['belt', 8]];

// storm phases: seconds waiting, seconds shrinking, target radius, damage per second outside
export const PHASES = [
  { wait: 60, shrink: 40, r: 200, dps: 4 }, { wait: 45, shrink: 30, r: 120, dps: 6 }, { wait: 35, shrink: 25, r: 66, dps: 9 },
  { wait: 25, shrink: 20, r: 32, dps: 13 }, { wait: 20, shrink: 16, r: 12, dps: 19 }, { wait: 15, shrink: 14, r: 0, dps: 28 },
];

export function rollTier(source = 'floor', r = Math.random()) {
  const w = ODDS[source] || ODDS.floor; let x = r * 100;
  for (let i = 0; i < w.length; i++) { if (x < w[i]) return i; x -= w[i]; }
  return w.findLastIndex((v) => v > 0);
}
// a random item; `els` is the element list for grimoires, `rng` a () => [0,1) source
export function rollItem(source = 'floor', els = ['fire'], rng = Math.random) {
  let x = rng() * KIND_W.reduce((n, [, w]) => n + w, 0), type = 'potion';
  for (const [k, w] of KIND_W) { if (x < w) { type = k; break; } x -= w; }
  if (source === 'vault' || source === 'cache') while (type === 'potion') type = KIND_W[Math.floor(rng() * KIND_W.length)][0]; // the best sources always hold gear
  if (type === 'potion') { const p = rng(); return { type, id: p < 0.5 ? 'hp' : p < 0.78 ? 'mana' : 'shield' }; }
  const tier = rollTier(source, rng());
  if (type === 'focus') return { type, tier, el: els[Math.floor(rng() * els.length)] };
  if (type === 'rune') return { type, tier, id: RUNE_KEYS[Math.floor(rng() * RUNE_KEYS.length)] };
  return { type, tier };
}

// a fresh loadout for the drop: a Common grimoire of a random element and one healing draught
export function equip(c, el = null) {
  c.inv = { hp: 1, mana: 0, shield: 0 }; c.gear = { focus: [], amulet: null, mantle: null, boots: null, belt: null, rune: null };
  c.attuned = {}; c.relics = {}; c.runeCd = 0;
  c.maxHp = 600; c.hp = 600; c.maxMana = 120; c.mana = 120; c.armor = 0; c.maxArmor = 0;
  if (el) c.gear.focus.push({ type: 'focus', tier: 0, el });
  recompute(c);
}
// derived stats from what is worn (called after any change)
export function recompute(c) {
  const G = c.gear, t = (s) => G[s] ? G[s].tier : -1;
  c.affinity = {};
  for (const f of G.focus) c.affinity[f.el] = Math.max(c.affinity[f.el] || 0, GEAR.focus.stat[f.tier]);
  const oldMana = c.maxMana;
  c.maxMana = 120 + (t('amulet') >= 0 ? GEAR.amulet.stat[t('amulet')] : 0); if (c.mana > c.maxMana) c.mana = c.maxMana; else if (c.maxMana > oldMana) c.mana += c.maxMana - oldMana;
  c.manaRegen = 1 + (t('amulet') >= 0 ? GEAR.amulet.regen[t('amulet')] : 0);
  c.echo = t('amulet') === 4 ? 0.25 : 0;
  c.maxArmor = t('mantle') >= 0 ? GEAR.mantle.stat[t('mantle')] : 0; c.armor = Math.min(c.armor || 0, c.maxArmor);
  c.speedMult = 1 + (t('boots') >= 0 ? GEAR.boots.stat[t('boots')] : 0);
  c.stormRes = t('boots') === 4 ? 0.5 : 0;
  c.potionCap = t('belt') >= 0 ? GEAR.belt.stat[t('belt')] : POTION_CAP;
  c.potionMult = t('belt') === 4 ? 1.5 : 1;
  c.runeMult = t('rune') >= 0 ? GEAR.rune.stat[t('rune')] : 1;
  c.costBonus = 1; c.allDmg = 1;
  for (const k of Object.keys(c.inv)) c.inv[k] = Math.min(c.inv[k], c.potionCap);
}
export const itemScore = (it) => (it ? it.tier + 1 : 0);
// what picking this up would replace: null (free slot or potion), an item, or false (not wanted at all)
export function replaces(c, it) {
  if (it.type === 'potion') return (c.inv[it.id] || 0) < c.potionCap ? null : false;
  if (it.type === 'focus') {
    const F = c.gear.focus, same = F.find((f) => f.el === it.el);
    if (same) return it.tier > same.tier ? same : false;
    if (F.length < 2) return null;
    return F[0].tier <= F[1].tier ? F[0] : F[1];
  }
  return c.gear[it.type] || null;
}
// a strict upgrade is taken just by walking over it; anything else needs the interact key
export function autoTake(c, it) {
  const r = replaces(c, it);
  if (r === false) return false;
  if (r === null) return true;
  if (it.type === 'focus') return r.el === it.el && it.tier > r.tier;
  if (it.type === 'rune') return r.id === it.id && it.tier > r.tier;
  return it.tier > r.tier;
}
// would a mage rather have this than what it replaces (used by bots and the pick-up prompt)
export function isUpgrade(c, it) { const r = replaces(c, it); return r !== false && (r === null || itemScore(it) > itemScore(r)); }
// put an item on; returns the piece it displaced (to drop on the ground) or null
export function grant(c, it) {
  if (it.type === 'potion') { c.inv[it.id] = Math.min(c.potionCap, (c.inv[it.id] || 0) + 1); return null; }
  const out = replaces(c, it) || null;
  if (it.type === 'focus') {
    if (out) c.gear.focus.splice(c.gear.focus.indexOf(out), 1);
    c.gear.focus.push({ ...it });
  } else c.gear[it.type] = { ...it };
  if (it.type === 'mantle') { const had = c.maxArmor; recompute(c); c.armor = Math.min(c.maxArmor, (c.armor || 0) + Math.max(0, c.maxArmor - had)); } // new armor arrives charged
  else recompute(c);
  if (it.type === 'mantle' && it.tier === 4 && !(out && out.tier === 4)) c.relics.phoenix = 1;
  return out;
}
// everything a mage carries, as loose items (dropped on death)
export function carried(c) {
  const out = [...(c.gear?.focus || [])];
  for (const s of SLOTS) if (s !== 'focus' && c.gear?.[s]) out.push(c.gear[s]);
  for (const [id, n] of Object.entries(c.inv || {})) for (let i = 0; i < n; i++) out.push({ type: 'potion', id });
  return out;
}
export function runeCooldown(c) { const r = c.gear?.rune; return r ? RUNES[r.id].cd * c.runeMult : 0; }
// storm damage per second for a phase index; the last (final) storm keeps climbing with time spent in it
export function stormDps(phase, finalSeconds = 0) {
  if (phase >= PHASES.length) return PHASES[PHASES.length - 1].dps + finalSeconds * 2.5;
  return phase ? PHASES[phase - 1].dps : 3;
}
// total seconds from the drop until the last circle has closed
export const STORM_SECONDS = PHASES.reduce((n, p) => n + p.wait + p.shrink, 0);
