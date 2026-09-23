import * as THREE from 'three';
import { getLang } from './i18n.js';

// Each element: palette + how its particles behave + naming vocabulary.
export const ELEMENTS = {
  fire: {
    name: 'Fire', nameJa: '炎', adjJa: ['紅蓮', '灼熱', '業火', '煉獄', '焔', '天焦'], glyph: '火', color: 0xff5a14, core: 0xffe7a0, dark: 0x6a1200, aura: true,
    adj: ['Ember', 'Blazing', 'Infernal', 'Crimson', 'Pyre', 'Solar'], noun: 'Flame',
    particle: { shape: 3, rise: 3.2, drag: 1.4, smoke: 0.6, spark: 0.8, grav: -2 },
  },
  ice: {
    name: 'Ice', nameJa: '氷', adjJa: ['霜', '氷河', '白銀', '氷晶', '極寒', '絶対零度'], glyph: '氷', color: 0x7fe6ff, core: 0xffffff, dark: 0x1d5aa8, aura: true,
    adj: ['Frost', 'Glacial', 'Rime', 'Crystal', 'Boreal', 'Absolute'], noun: 'Frost',
    particle: { shape: 4, rise: -0.5, drag: 1.2, smoke: 0.35, spark: 0.4, grav: 3, mist: 1 },
  },
  water: {
    name: 'Water', nameJa: '水', adjJa: ['潮', '蒼水', '深淵', '奔流', '碧', '大海'], glyph: '水', color: 0x2a8cff, core: 0xd6f4ff, dark: 0x0a2f7a, aura: true,
    adj: ['Tidal', 'Aqua', 'Abyssal', 'Torrent', 'Azure', 'Oceanic'], noun: 'Tide',
    particle: { shape: 0, rise: 0, drag: 0.6, smoke: 0.2, spark: 0.2, grav: 12 },
  },
  lightning: {
    name: 'Lightning', nameJa: '雷', adjJa: ['迅雷', '轟雷', '嵐', '雷神', '紫電', '天雷'], glyph: '雷', color: 0xa56bff, core: 0xf6eeff, dark: 0x2a0a7a, aura: true,
    adj: ['Volt', 'Thunder', 'Storm', 'Raijin', 'Plasma', 'Arc'], noun: 'Thunder',
    particle: { shape: 1, rise: 0, drag: 3, smoke: 0, spark: 2.2, grav: 0, jitter: 1 },
  },
  wind: {
    name: 'Wind', nameJa: '風', adjJa: ['疾風', '微風', '暴風', '天空', '旋風', '神風'], glyph: '風', color: 0x4dffc3, core: 0xeafff8, dark: 0x0b6a55, aura: false,
    adj: ['Gale', 'Zephyr', 'Tempest', 'Sky', 'Cyclone', 'Heavenly'], noun: 'Gale',
    particle: { shape: 6, rise: 0.5, drag: 0.8, smoke: 0.1, spark: 0.3, grav: 0, swirl: 1 },
  },
  earth: {
    name: 'Earth', nameJa: '岩', adjJa: ['石', '花崗', '巨神', '黄金', '地殻', '霊峰'], glyph: '岩', color: 0xf0a832, core: 0xfff0b8, dark: 0x5a3a12, aura: false,
    adj: ['Stone', 'Granite', 'Titan', 'Golden', 'Tectonic', 'Mountain'], noun: 'Stone',
    particle: { shape: 4, rise: 0, drag: 0.3, smoke: 0.8, spark: 0.5, grav: 16, debris: 1 },
  },
  darkness: {
    name: 'Darkness', nameJa: '闇', adjJa: ['影', '虚無', '深淵', '冥', '夜', '呪'], glyph: '闇', color: 0xc22cff, core: 0xff9af0, dark: 0x0b0014, aura: true,
    adj: ['Shadow', 'Void', 'Abyssal', 'Umbral', 'Night', 'Cursed'], noun: 'Shadow',
    particle: { shape: 0, rise: 1.2, drag: 1.5, smoke: 1.4, spark: 0.5, grav: -0.5, darkSmoke: 1 },
  },
  light: {
    name: 'Light', nameJa: '光', adjJa: ['輝', '聖', '天界', '熾天', '暁', '神聖'], glyph: '光', color: 0xffe28a, core: 0xffffff, dark: 0xa87a1a, aura: true,
    adj: ['Radiant', 'Holy', 'Celestial', 'Seraphic', 'Dawn', 'Divine'], noun: 'Radiance',
    particle: { shape: 1, rise: 1.5, drag: 1.2, smoke: 0, spark: 1.2, grav: -1 },
  },
  nature: {
    name: 'Nature', nameJa: '草', adjJa: ['翠', '茨', '開花', '森', '野生', '原初'], glyph: '草', color: 0x3fd67a, core: 0xe6ffd8, dark: 0x0f4a22, aura: true,
    adj: ['Verdant', 'Thorn', 'Bloom', 'Sylvan', 'Wild', 'Primal'], noun: 'Thorn',
    particle: { shape: 5, rise: 0.5, drag: 1.0, smoke: 0.1, spark: 0.3, grav: 2, leaves: 1 },
  },
  poison: {
    name: 'Poison', nameJa: '毒', adjJa: ['瘴気', '腐蝕', '猛毒', '疫病', '蠱毒', '死毒'], glyph: '毒', color: 0xb6f01e, core: 0xf2ffb0, dark: 0x3a0f4a, aura: true,
    adj: ['Venom', 'Toxic', 'Miasma', 'Blight', 'Plague', 'Corrosive'], noun: 'Venom',
    particle: { shape: 0, rise: 0.8, drag: 1.4, smoke: 1.2, spark: 0.1, grav: -0.3, toxic: 1 },
  },
  arcane: {
    name: 'Arcane', nameJa: '魔', adjJa: ['神秘', '星辰', '異界', '秘文', '宇宙', '霊気'], glyph: '魔', color: 0xff4fb0, core: 0xfff0fa, dark: 0x4a0a3a, aura: false,
    adj: ['Mystic', 'Astral', 'Eldritch', 'Rune', 'Cosmic', 'Aether'], noun: 'Arcana',
    particle: { shape: 7, rise: 0.3, drag: 1.2, smoke: 0, spark: 0.8, grav: 0 },
  },
};
export const ELEMENT_KEYS = Object.keys(ELEMENTS);

export const SHAPES = {
  orb: { name: 'Orb', nameJa: '球', nounsJa: ['球', '宝珠', '弾'], icon: '●', nouns: ['Orb', 'Sphere', 'Ball'] },
  barrage: { name: 'Barrage', nameJa: '連弾', nounsJa: ['連弾', '槍雨', '千本槍'], icon: '⋙', nouns: ['Barrage', 'Volley', 'Lances'] },
  funnels: { name: 'Funnels', nameJa: '追尾使い魔', nounsJa: ['使い魔', '浮遊砲', '精霊'], icon: '✧', nouns: ['Familiars', 'Funnels', 'Wisps'] },
  beam: { name: 'Beam', nameJa: '光線', nounsJa: ['光線', '砲', '極光砲'], icon: '═', nouns: ['Ray', 'Beam', 'Cannon'] },
  tornado: { name: 'Tornado', nameJa: '竜巻', nounsJa: ['旋風', '竜巻', '大渦'], icon: '𖦹', nouns: ['Cyclone', 'Tornado', 'Maelstrom'] },
  meteor: { name: 'Meteor', nameJa: '隕石', nounsJa: ['隕石', '彗星', '流星群'], icon: '☄', nouns: ['Meteor', 'Comet', 'Starfall'] },
  nova: { name: 'Nova', nameJa: '爆裂', nounsJa: ['爆裂', '炸裂', '大爆発'], icon: '✺', nouns: ['Nova', 'Burst', 'Cataclysm'] },
  spikes: { name: 'Spikes', nameJa: '棘', nounsJa: ['棘', '尖塔', '噴出'], icon: '⩘', nouns: ['Spires', 'Spikes', 'Eruption'] },
  wall: { name: 'Wall', nameJa: '障壁', nounsJa: ['壁', '城壁', '結界'], icon: '▥', nouns: ['Wall', 'Bulwark', 'Rampart'] },
  vortex: { name: 'Vortex', nameJa: '渦', nounsJa: ['渦', '特異点', '深淵'], icon: '◉', nouns: ['Vortex', 'Singularity', 'Abyss'] },
  chain: { name: 'Chain', nameJa: '連鎖', nounsJa: ['撃', '連鎖', '裁き'], icon: 'ϟ', nouns: ['Strike', 'Chain', 'Judgment'] },
  storm: { name: 'Storm', nameJa: '嵐', nounsJa: ['雨', '嵐', '大嵐'], icon: '☁', nouns: ['Rain', 'Storm', 'Tempest'] },
  crescent: { name: 'Crescent', nameJa: '斬撃', nounsJa: ['刃', '三日月', '斬'], icon: '☾', nouns: ['Cutter', 'Crescent', 'Slash'] },
  ward: { name: 'Ward', nameJa: '守護', nounsJa: ['加護', '神盾', '聖域'], icon: '⛨', nouns: ['Ward', 'Aegis', 'Sanctuary'] },
  field: { name: 'Field', nameJa: '領域', nounsJa: ['沼', '領域', '結界陣'], icon: '◎', nouns: ['Mire', 'Field', 'Domain'] },
  wave: { name: 'Wave', nameJa: '大波', nounsJa: ['波', '大波', '大海嘯'], icon: '≋', nouns: ['Surge', 'Wave', 'Tsunami'] },
  enhance: { name: 'Enhance', nameJa: '強化', nounsJa: ['纏い', '加護', '覚醒'], icon: '✚', nouns: ['Infusion', 'Mantle', 'Ascension'] },
  hand: { name: 'Hand', nameJa: '魔手', nounsJa: ['手', '魔手', '神の手'], icon: '✋', nouns: ['Hand', 'Fist', 'Titan Hand'] },
  leap: { name: 'Leap', nameJa: '跳躍', nounsJa: ['跳躍', '天翔', '天駆'], icon: '⤒', nouns: ['Leap', 'Skybound', 'Ascent'] },
  flight: { name: 'Flight', nameJa: '飛行', nounsJa: ['浮遊', '飛翔', '天翼'], icon: '✈', nouns: ['Float', 'Flight', 'Wings'] },
  blink: { name: 'Blink', nameJa: '転移', nounsJa: ['転移', '瞬歩', '次元跳躍'], icon: '⇥', nouns: ['Blink', 'Rift Step', 'Phase Shift'] },
  construct: { name: 'Construct', nameJa: '建造', nounsJa: ['足場', '階段', '城塞'], icon: '▦', nouns: ['Platform', 'Stairway', 'Fortress'] },
};
export const SELF_FORMS = ['ward', 'enhance', 'hand', 'leap', 'flight', 'blink', 'construct'];
export const UTILITY_FORMS = ['leap', 'flight', 'blink', 'construct'];
export const SHAPE_KEYS = Object.keys(SHAPES);

const TIERS_EN = ['', 'Cantrip', 'Novice', 'Adept', 'Expert', 'Master', 'Archmage', 'Legendary', 'Mythic', 'Divine'];
const TIERS_JA = ['', '初歩', '初級', '中級', '上級', '達人', '大魔導', '伝説', '神話', '神域'];
export const tierName = (n) => (getLang() === 'ja' ? TIERS_JA : TIERS_EN)[n];
export const elName = (el) => (getLang() === 'ja' ? ELEMENTS[el].nameJa : ELEMENTS[el].name);
export const shapeName = (sh) => (getLang() === 'ja' ? SHAPES[sh].nameJa : SHAPES[sh].name);
const TIER_PREFIX_JA = ['', '小', '', '大', '極', '真', '超', '伝説の', '神話の', '究極'];
const REACT_JA = {
  Frozen: '凍結', Vaporize: '蒸発', Melt: '溶解', Overload: '過負荷', Superconduct: '超電導', 'Electro-Charged': '感電', Wildfire: '烈火', Bloom: '開花', Quicken: '激化',
  Eclipse: '蝕', Blackflame: '黒炎', 'Solar Flare': '暁炎', Swirl: '拡散', Crystallize: '結晶化', Resonance: '共鳴', Shatter: '粉砕', Shield: 'シールド',
  'Molten Rupture': '溶岩破砕', 'Toxic Blaze': '毒炎爆発', Quagmire: '泥濘', Undertow: '深淵の引き潮', 'Purifying Tide': '浄化の潮', Contagion: '伝染',
  'Crystal Shatter': '結晶粉砕', Permafrost: '永霜', 'Prismatic Echo': '光晶反響', Frostbite: '凍傷', 'Magnetic Crush': '磁力圧壊', 'Abyssal Overload': '深淵過負荷',
  Judgment: '裁定', Neurotoxin: '神経毒', 'Gravity Prison': '重力牢', 'Hallowed Bastion': '聖なる砦', Overgrowth: '繁茂', Corrosion: '腐食', Wither: '枯死',
  Plague: '疫病', Photosynthesis: '光合成', Purge: '浄化', Blight: '枯病', Thunderhead: '雷雲', Sandstorm: '砂嵐', Singularity: '特異点', 'Aurora Step': '極光の歩み',
  Whiteout: '白嵐', Waterspout: '水竜巻', Miasma: '瘴気', 'Thermal Shock': '熱衝撃',
  "Winter's Judgment": '冬の裁き', 'Crown of the Storm': '嵐の王冠', Worldbreaker: '世界砕き', 'Cycle of Renewal': '再生の輪', Plaguebringer: '疫病の使者', 'Void Tide': '虚無の潮',
};
export const reactName = (n) => (getLang() === 'ja' ? REACT_JA[n] || n : n);
const TIER_PREFIX = ['', 'Minor', '', 'Greater', 'Grand', 'Superior', 'Arch', 'Legendary', 'Mythic', 'Ultimate'];

// Colours adjusted by temperature (e.g. white-blue "stellar" fire, violet freezing water).
export function paletteFor(el, temperature = 0.5) {
  const E = ELEMENTS[el] || ELEMENTS.arcane;
  const color = new THREE.Color(E.color), core = new THREE.Color(E.core), dark = new THREE.Color(E.dark);
  if (el === 'fire') {
    if (temperature > 0.85) { color.lerp(new THREE.Color(0x4aa8ff), (temperature - 0.85) / 0.15); core.lerp(new THREE.Color(0xffffff), 0.6); }
    else if (temperature < 0.55) color.lerp(new THREE.Color(0xd8200a), 0.5);
  } else if (el === 'ice' && temperature < 0.08) {
    color.lerp(new THREE.Color(0xb6a8ff), 0.5);
  } else if (el === 'water' && temperature > 0.75) {
    color.lerp(new THREE.Color(0xe0f4ff), 0.4); // boiling steam
  } else if (el === 'lightning' && temperature > 0.8) {
    color.lerp(new THREE.Color(0x7ec8ff), 0.5);
  }
  return { color, core, dark };
}

// Human-readable spell name from its parameters.
function spellNameJa(spec) {
  const E = ELEMENTS[spec.element], S = SHAPES[spec.shape];
  const pre = TIER_PREFIX_JA[spec.tierInt];
  const noun = spec.shape === 'construct' ? { platform: '足場', stairs: '階段', box: '方塊', pillar: '尖塔', rampart: '城壁' }[spec.construct] || '足場' : S.nounsJa[Math.min(S.nounsJa.length - 1, Math.floor(spec.power * S.nounsJa.length))];
  let core;
  if (spec.shape === 'orb' && spec.element === 'fire') core = '火球';
  else if (spec.shape === 'chain' && spec.element === 'lightning') core = '連鎖雷撃';
  else { const adj = E.adjJa[Math.min(E.adjJa.length - 1, Math.floor((spec.power * 0.6 + spec.tier * 0.4) * E.adjJa.length))]; core = adj + 'の' + noun; }
  if (spec.element2) core = ELEMENTS[spec.element2].nameJa + '・' + core;
  return (pre ? pre + (pre.endsWith('の') ? '' : '・') : '') + core;
}
const MORPH_EN = { lance: 'Lance', shard: 'Shard', disc: 'Chakram', star: 'Star', blade: 'Blade', skull: 'Skull', bubble: 'Bubble', cube: 'Monolith' };
const BEAST = { fire: 'Phoenix', water: 'Leviathan', ice: 'Wyrm', lightning: 'Raiju', wind: 'Griffin', earth: 'Behemoth', darkness: 'Wraith Serpent', light: 'Seraph', nature: 'Hydra', poison: 'Basilisk', arcane: 'Astral Dragon' };
const PAT_EN = { fan: 'Fan of ', ring: 'Ring of ', cascade: 'Barrage of ', crossfire: 'Crossfire of ', rain: 'Rain of ', spiral: 'Spiral of ', swarm: 'Swarm of ' };
const TRAJ_EN = { arc: 'Arcing ', spiral: 'Spiraling ', zigzag: 'Jagged ', boomerang: 'Returning ', orbit: 'Orbiting ', serpentine: 'Serpentine ', homing: 'Seeking ' };
const PAY_EN = { split: ' Cluster', linger: ' Mire', erupt: ' Geyser', chain: ' Chain', implode: ' Collapse', echo: ' Echo', crystallize: ' Bloom' };
const MORPH_JA = { orb: '球', lance: '槍', shard: '晶片', disc: '円盤', star: '星', blade: '刃', dragon: '龍', skull: '髑髏', bubble: '泡', cube: '方塊' };
const PAT_JA = { fan: '扇', ring: '環', cascade: '連弾', crossfire: '十字砲火', rain: '雨', spiral: '螺旋陣', swarm: '群' };
const TRAJ_JA = { arc: '放物', spiral: '螺旋', zigzag: '雷走', boomerang: '回帰', orbit: '周回', serpentine: '蛇行', homing: '追尾' };
const PAY_JA = { split: '・分裂', linger: '・残留', erupt: '・噴出', chain: '・連鎖', implode: '・崩縮', echo: '・残響', crystallize: '・結晶' };
function missileName(spec, ja) {
  const E = ELEMENTS[spec.element], t = spec.tierInt, many = spec.pattern && spec.pattern !== 'single';
  const adjIdx = Math.min(5, Math.floor((spec.power * 0.6 + spec.tier * 0.4) * 6));
  if (ja) {
    const pre = TIER_PREFIX_JA[t];
    const body = (TRAJ_JA[spec.trajectory] || '') + E.adjJa[adjIdx] + 'の' + (spec.morph === 'orb' && spec.element === 'fire' ? '火球' : MORPH_JA[spec.morph] || '球') + (PAT_JA[spec.pattern] ? '・' + PAT_JA[spec.pattern] : '') + (PAY_JA[spec.payload] || '');
    return (pre ? pre + (pre.endsWith('の') ? '' : '・') : '') + (spec.element2 ? ELEMENTS[spec.element2].nameJa + '・' : '') + body;
  }
  const pre = TIER_PREFIX[t];
  let noun = spec.morph === 'dragon' ? BEAST[spec.element] : MORPH_EN[spec.morph] || (spec.element === 'fire' ? 'Fireball' : 'Orb');
  if (many && !noun.endsWith('s')) noun += noun.endsWith('x') ? 'es' : 's';
  const adj = spec.morph === 'orb' && spec.element === 'fire' ? '' : E.adj[adjIdx] + ' ';
  const body = (PAT_EN[spec.pattern] || '') + (many ? '' : TRAJ_EN[spec.trajectory] || '') + adj + noun + (PAY_EN[spec.payload] || '');
  return `${pre ? (pre === 'Arch' ? 'Arch-' : pre + ' ') : ''}${spec.element2 ? ELEMENTS[spec.element2].adj[0] + '-' : ''}${body}`.replace('Arch- ', 'Arch-');
}
export function spellName(spec) {
  if ((spec.shape === 'orb' || spec.shape === 'barrage') && !spec.basic && (spec.morph && spec.morph !== 'orb' || (spec.pattern && spec.pattern !== 'single') || (spec.trajectory && spec.trajectory !== 'straight') || (spec.payload && spec.payload !== 'explode'))) return missileName(spec, getLang() === 'ja');
  if (getLang() === 'ja') return spellNameJa(spec);
  const E = ELEMENTS[spec.element], S = SHAPES[spec.shape];
  const t = spec.tierInt;
  const pre = TIER_PREFIX[t];
  const noun = spec.shape === 'construct' ? { platform: 'Platform', stairs: 'Stairway', box: 'Monolith', pillar: 'Spire', rampart: 'Rampart' }[spec.construct] || 'Platform' : S.nouns[Math.min(S.nouns.length - 1, Math.floor(spec.power * S.nouns.length))];
  let core;
  if (spec.shape === 'orb' && spec.element === 'fire') core = 'Fireball';
  else if (spec.shape === 'chain' && spec.element === 'lightning') core = 'Chain Lightning';
  else if (spec.shape === 'meteor' && spec.element === 'fire') core = 'Meteor';
  else {
    const adj = E.adj[Math.min(E.adj.length - 1, Math.floor((spec.power * 0.6 + spec.tier * 0.4) * E.adj.length))];
    core = `${adj} ${noun}`;
  }
  if (spec.element2) core = `${ELEMENTS[spec.element2].adj[0]}-${core}`;
  return `${pre ? (pre === 'Arch' ? 'Arch-' : pre + ' ') : ''}${core}`.replace('Arch- ', 'Arch-');
}

// ------------------------------------------------------------ reactions
// Every element pair (auras are primed by one spell, triggered by the next). Effects are data interpreted by combat.js:
// burn/poison: damage-over-time seconds · fracture: vulnerability · mud: 50% slow · weaken: outgoing ×0.8 · stun/freeze: lock ·
// pull: drag toward the hit · knock: launch · spread: aura splash · heal/mana/shield/haste: caster benefits · purge: strip statuses ·
// blast: bonus explosion radius · smite: sky strike · steam: vision cloud · bloom: seed mines · bolts: arcing lightning
const R = (name, color, mult, effects = {}, fx = null) => ({ name, color, mult, effects, fx });
const PAIRS = {
  'fire+water': R('Vaporize', '#ffc080', 1.8, { steam: 1, weaken: 5 }),
  'fire+ice': R('Melt', '#ffb070', 1.9, { stun: 0.5 }),
  'fire+wind': R('Wildfire', '#ff8a3a', 1.35, { burn: 6, spread: 'fire', knock: 5 }),
  'fire+lightning': R('Overload', '#ff7ab8', 1.4, { blast: 4.5, knock: 9 }),
  'earth+fire': R('Molten Rupture', '#ff6a2a', 1.6, { burn: 6, fracture: 6, blast: 3 }),
  'darkness+fire': R('Blackflame', '#ff4a8a', 1.6, { burn: 8, curse: 6 }),
  'fire+light': R('Solar Flare', '#fff2a0', 1.5, { heal: 25, blind: 1 }),
  'fire+nature': R('Wildfire', '#ff9a3a', 1.25, { burn: 8 }),
  'fire+poison': R('Toxic Blaze', '#d6ff4a', 2.2, { blast: 5.5, burn: 4, knock: 8 }),
  'fire+arcane': null,
  'ice+water': R('Frozen', '#9ff0ff', 1.0, { freeze: 2.4 }),
  'lightning+water': R('Electro-Charged', '#d59bff', 1.25, { shock: 4.5, bolts: 4 }),
  'earth+water': R('Quagmire', '#b09060', 1.2, { mud: 6 }),
  'darkness+water': R('Undertow', '#6a4aff', 1.45, { pull: 1, curse: 6 }),
  'light+water': R('Purifying Tide', '#a8f0ff', 1.15, { heal: 35, mana: 20 }),
  'nature+water': R('Bloom', '#a8ff7a', 1.2, { bloom: 3 }),
  'poison+water': R('Contagion', '#9aff6a', 1.3, { poison: 8, spread: 'poison' }),
  'ice+lightning': R('Superconduct', '#c6b8ff', 1.3, { fracture: 8, stun: 0.4 }),
  'earth+ice': R('Crystal Shatter', '#bff4ff', 2.0, { fracture: 5, blast: 2.5 }),
  'darkness+ice': R('Permafrost', '#9a8aff', 1.4, { freeze: 3.2, curse: 5 }),
  'ice+light': R('Prismatic Echo', '#e8f8ff', 1.4, { mana: 25, bolts: 5 }),
  'ice+poison': R('Frostbite', '#c8ffe8', 1.35, { mud: 5, poison: 5 }),
  'ice+wind': R('Whiteout', '#e0fbff', 1.35, { freeze: 1.6, spread: 'ice' }),
  'ice+nature': R('Frostbite', '#c8ffe8', 1.25, { mud: 4 }),
  'lightning+wind': R('Thunderhead', '#b8a0ff', 1.45, { stun: 0.8, smite: 1 }),
  'earth+lightning': R('Magnetic Crush', '#d0a0ff', 1.5, { pull: 1.5, fracture: 7 }),
  'darkness+lightning': R('Abyssal Overload', '#a040ff', 1.7, { weaken: 6, blast: 3.5 }),
  'light+lightning': R('Judgment', '#fff6c0', 1.8, { smite: 2, mana: 8 }),
  'lightning+nature': R('Quicken', '#9dffb0', 1.45, { bolts: 3 }),
  'lightning+poison': R('Neurotoxin', '#e0ff60', 1.3, { stun: 1.2, poison: 5 }),
  'earth+wind': R('Sandstorm', '#e8c888', 1.3, { weaken: 6, fracture: 5, spread: 'earth' }),
  'darkness+earth': R('Gravity Prison', '#8a60c0', 1.4, { mud: 7, curse: 6, pull: 0.8 }),
  'earth+light': R('Hallowed Bastion', '#ffe8a0', 1.2, { shield: 90 }),
  'earth+nature': R('Overgrowth', '#6adc5a', 1.3, { stun: 1.4, poison: 3 }),
  'earth+poison': R('Corrosion', '#c0e040', 1.35, { fracture: 10 }),
  'darkness+light': R('Eclipse', '#fff0ff', 3.0, { purge: 1, blast: 5, trueDmg: 1 }),
  'darkness+wind': R('Singularity', '#9a50ff', 1.5, { pull: 3, curse: 6 }),
  'darkness+nature': R('Wither', '#8a6a4a', 1.35, { weaken: 7, poison: 5 }),
  'darkness+poison': R('Plague', '#90ff40', 1.5, { poison: 10, curse: 8, spread: 'poison' }),
  'light+nature': R('Photosynthesis', '#caff9a', 1.1, { heal: 45 }),
  'light+poison': R('Purge', '#ffffe0', 1.7, { purge: 1 }),
  'light+wind': R('Aurora Step', '#b0fff0', 1.3, { haste: 6, mana: 10 }),
  'nature+poison': R('Blight', '#a0c030', 1.4, { poison: 10, weaken: 6 }),
  'nature+wind': R('Swirl', '#7dffd6', 1.3, { spread: 'nature', knock: 6 }),
  'poison+wind': R('Miasma', '#c8ff50', 1.4, { spread: 'poison', poison: 6 }),
  'water+wind': R('Waterspout', '#80d8ff', 1.35, { pull: 1, knock: 10 }),
};
// Three-spell sequences on the same target (from one caster) trigger a finisher.
export const COMBOS = [
  { name: "Winter's Judgment", seq: ['water', 'ice', 'earth'], bonus: 1.3, color: '#bff4ff', effects: { fracture: 10, blast: 4 } },
  { name: 'Crown of the Storm', seq: ['fire', 'wind', 'lightning'], bonus: 1.2, color: '#ffb0ff', effects: { weaken: 10, smite: 3 } },
  { name: 'Worldbreaker', seq: ['darkness', 'earth', 'fire'], bonus: 1.4, color: '#ff6040', effects: { burn: 10, blast: 6, knock: 12 } },
  { name: 'Cycle of Renewal', seq: ['light', 'water', 'wind'], bonus: 0.5, color: '#c0ffe0', effects: { heal: 80, mana: 40, haste: 8 } },
  { name: 'Plaguebringer', seq: ['poison', 'wind', 'fire'], bonus: 1.5, color: '#d6ff4a', effects: { poison: 12, blast: 6 } },
  { name: 'Void Tide', seq: ['water', 'darkness', 'lightning'], bonus: 1.3, color: '#8a60ff', effects: { pull: 2, shock: 6 } },
];
export function reactionFor(aura, inc) {
  if (!aura || !inc || aura === inc) return null;
  if (inc === 'arcane') return R('Resonance', '#ff8fd0', 1.4, {}, null);
  const key = [aura, inc].sort().join('+');
  const r = PAIRS[key];
  if (!r) return null;
  const out = { ...r, effects: { ...r.effects }, aura, inc };
  // directional amplifiers (Genshin-style): the stronger direction hits harder
  if (key === 'fire+water') out.mult = inc === 'water' ? 2.0 : 1.5;
  if (key === 'fire+ice') out.mult = inc === 'fire' ? 2.0 : 1.5;
  return out;
}
