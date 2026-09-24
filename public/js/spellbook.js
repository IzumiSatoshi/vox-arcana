// Incantation -> spell spec.
// 1) a fast local keyword parser (live preview while chanting + offline fallback)
// 2) Jev (via /api/spell) decides element / shape / numeric parameters from natural language
// 3) merged with voice features (loudness, chant length) into a final procedural spec
import { clamp, hashStr } from './util.js';
import { ELEMENT_KEYS, SHAPE_KEYS, spellName } from './elements.js';

const EL_WORDS = {
  fire: ['fire', 'flame', 'flami', 'blaze', 'blazing', 'burn', 'inferno', 'ember', 'magma', 'lava', 'pyro', 'heat', 'scorch', 'ignite', 'phoenix', 'solar', 'hellfire', 'fireball', '火', '炎', '焔', 'ファイア', 'フレア', 'ほのお', '燃', '焼', '灼', '紅蓮', '業火', 'マグマ', '溶岩', '不死鳥'],
  ice: [' ice', ' icy', 'frost', 'freez', 'froze', 'snow', 'glaci', 'cold', 'blizzard', 'cryo', 'hail', ' rime', '氷', '凍', '雪', '吹雪', 'アイス', 'ブリザード', 'こおり', '冷', '霜', '零度', 'フロスト'],
  water: ['water', 'aqua', 'wave', 'tide', 'ocean', 'sea ', 'torrent', 'flood', 'bubble', 'hydro', 'splash', 'river', 'tsunami', '水', '波', 'アクア', 'ウォーター', 'みず', '海', '潮', '泡', '津波', '激流'],
  lightning: ['lightning', 'thunder', 'electr', 'spark', 'volt', 'plasma', 'raijin', 'zap', 'shock', 'bolt', '雷', '電', '稲妻', 'サンダー', 'いかずち', 'ライトニング', '迅雷', '紫電'],
  wind: ['wind', ' air ', 'gale', 'gust', 'breeze', 'cyclone', 'whirlwind', 'aero', 'hurricane', 'typhoon', 'zephyr', 'sky', '風', '疾風', 'ウィンド', 'かぜ', '旋風', '空'],
  earth: ['earth', 'stone', 'rock', 'boulder', 'mountain', ' sand', 'terra', ' geo', 'quake', 'metal', ' iron', 'gaia', 'ground', 'crystal', '土', '岩', '石', '大地', 'アース', '山', '鋼', '砂', 'ストーン', 'ロック'],
  darkness: ['dark', 'shadow', 'void', 'abyss', 'curse', 'death', 'night', 'doom', 'demon', 'black', 'umbra', 'necro', 'evil', 'chaos', '闇', '影', '黒', '呪', 'ダーク', '冥', '虚無', '深淵', '死', '魔王'],
  light: [/light(?!ning)/, 'holy', 'radian', 'heaven', 'angel', 'divine', 'sacred', 'celestial', 'judgment', 'judgement', 'dawn', 'saint', 'seraph', '光', '聖', '天使', 'ホーリー', 'ひかり', '輝', '神聖', 'ライト', '審判'],
  nature: ['nature', 'vine', 'thorn', 'leaf', 'leaves', 'forest', 'flower', 'bloom', 'root', 'wood', 'tree', 'petal', 'sakura', 'verdant', '草', '木', '花', '森', '茨', '蔦', '葉', '桜', '樹'],
  poison: ['poison', 'venom', 'toxic', 'toxin', 'acid', 'miasma', 'plague', 'blight', 'corros', 'noxious', 'spore', 'rot', 'disease', '毒', '瘴気', '酸', '疫病', '腐', 'ポイズン', 'ベノム'],
  arcane: ['arcane', 'mana', 'rune', ' star', 'cosmic', 'astral', 'magic missile', 'space', ' time ', 'aether', 'ether', 'eldritch', '魔力', '星', '宇宙', 'ルーン', 'マナ', '秘術'],
};
const SHAPE_WORDS = {
  orb: ['ball', 'orb', 'sphere', 'bullet', 'shot', 'missile', 'globe', '玉', '球', '弾', 'ボール', 'ボム'],
  barrage: ['barrage', 'volley', 'arrows', 'shards', 'needles', 'spears', 'lances', 'daggers', 'gatling', 'salvo', 'bullets', 'missiles', '連射', '矢', '槍', '連弾', '千本', '百本'],
  funnels: ['funnel', 'drone', 'familiar', 'bits', 'satellite', 'wisps', 'spirits that', 'minions', 'fairies', 'orbiting', 'servants', 'ファンネル', '使い魔', '追尾', 'ビット'],
  beam: ['beam', 'laser', ' ray', 'cannon', 'breath', 'kamehameha', 'blaster', 'stream', 'ビーム', '光線', '砲', 'レーザー', 'ブレス', '波動'],
  tornado: ['tornado', 'cyclone', 'whirlwind', 'twister', 'hurricane', 'typhoon', 'maelstrom', '竜巻', 'トルネード'],
  meteor: ['meteor', 'comet', 'falling star', 'starfall', 'asteroid', 'from the sky', 'from the heavens', 'sky fall', 'hammer of', '隕石', 'メテオ', '流星', '彗星', '天より', '降り注'],
  nova: ['nova', 'explosion', 'explode', 'burst', 'shockwave', 'blast around', 'around me', 'detonate', 'supernova', 'big bang', '爆発', 'ノヴァ', '爆裂', '炸裂', 'バースト', 'エクスプロージョン'],
  spikes: ['spike', 'spire', 'pillar', 'eruption', 'erupt', 'stalagmite', 'rise from', 'geyser', 'fang', '棘', '柱', 'スパイク', '噴出', '隆起', '剣山'],
  wall: ['wall', 'barrier', 'rampart', 'bulwark', 'fortress', 'curtain', '壁', '結界', 'ウォール', '障壁', 'バリア'],
  vortex: ['vortex', 'black hole', 'singularity', 'gravity', 'whirlpool', 'pull', 'implosion', '渦', 'ブラックホール', '重力', '引き寄せ', '特異点'],
  chain: ['chain', ' arc ', 'smite', 'strike', 'thunderbolt', 'jolt', 'judgment', 'judgement', '連鎖', '落雷', '雷撃', '裁き', 'チェイン'],
  storm: ['storm', 'rain', 'blizzard', 'hail', 'downpour', 'tempest', 'shower', 'monsoon', '嵐', '雨', '吹雪', 'ストーム', 'レイン', '豪雨'],
  crescent: ['slash', 'blade', 'crescent', 'cutter', 'scythe', 'sword', 'cleave', 'edge', 'wave of', '刃', '斬', 'カッター', '三日月', 'スラッシュ', '剣'],
  ward: ['heal', ' ward', 'protect', 'bless', 'restore', 'aegis', 'shield', 'regenerat', 'cure', 'sanctuary', '癒', '守', 'ヒール', 'シールド', '回復', '盾', '護'],
  field: ['field', 'pool', 'zone', 'domain', 'ground of', 'swamp', 'mire', 'marsh', 'glyph', 'sigil', 'carpet', 'puddle', '領域', '沼', '陣', '地帯', 'フィールド'],
  wave: ['tidal wave', 'tsunami', 'avalanche', 'surge', 'wave', 'flood', 'deluge', '津波', '大波', '雪崩', 'ウェーブ'],
  enhance: ['enhance', 'empower', 'infuse', 'enchant', 'imbue', 'coat me', 'armor me', 'armament', 'awaken my', 'strengthen', 'speed up', 'haste', 'my body', '強化', '纏', 'エンチャント', '武装', '覚醒'],
  hand: [' hand', 'fist', 'gauntlet', 'arm of', 'claw', '魔手', 'ハンド', '拳', '手よ'],
  leap: ['leap', 'jump', 'launch me', 'spring', '跳躍', 'ジャンプ', '跳べ'],
  flight: ['fly', 'flight', 'levitat', 'hover', 'wings', 'float', 'soar', '飛行', '浮遊', '飛べ', '翼'],
  blink: ['teleport', 'blink', 'warp', 'phase', 'shift me', 'rift step', '転移', 'ワープ', '瞬間移動', 'テレポート'],
  construct: ['platform', 'stairs', 'staircase', 'stairway', 'bridge', 'build', 'tower', 'box', 'cube', 'pillar', 'rampart', 'fortress', '階段', '足場', '床', '橋', '箱', '塔', '城'],
};
const TRAIT_WORDS = {
  trajectory: { arc: [' lob', ' arc ', 'arcing', 'hurl', 'catapult', 'mortar', '放物'], spiral: ['spiral', 'corkscrew', 'twist', 'helix', '螺旋'], zigzag: ['zigzag', 'jagged', 'erratic', 'ジグザグ'],
    boomerang: ['boomerang', 'return', 'come back', 'ブーメラン', '戻'], orbit: ['orbit', 'circle around', 'revolv', '周回', '旋回'], serpentine: ['serpent', 'snake', 'dragon', 'wyrm', 'slither', '龍', '竜', '蛇'], homing: ['seek', 'homing', 'chase', 'hunt', 'track', 'never miss', '追尾', '追'] },
  pattern: { fan: [' fan', 'spread', 'volley', 'triple', 'five', '扇', '三連'], ring: ['all around', 'every direction', 'circle of', ' ring of', '全方位', '円'], cascade: ['stream', 'barrage', 'rapid', 'machine', 'gatling', '連射', '連続'],
    crossfire: ['crossfire', 'both sides', 'from left and right', '挟み', '十字'], rain: [' rain', 'from the sky', 'from above', 'shower', 'downpour', '降り注', '雨'], spiral: ['spiral', 'whirling', '渦巻'], swarm: ['swarm', 'flock', 'horde', 'legion', 'thousand', '群れ', '無数'] },
  payload: { split: ['split', 'shatter', 'scatter', 'fragment', 'shrapnel', 'cluster', '分裂', '炸裂', '散'], linger: ['linger', 'pool', 'burning ground', 'cloud', 'leave', 'residue', '残', '沼'], erupt: ['erupt', 'geyser', 'pillar', 'column', 'volcano', '噴', '柱'],
    chain: ['chain', 'jump to', 'arc to', 'bounce', '連鎖'], implode: ['implode', 'collapse', 'pull in', 'gravity', '収縮', '吸い込'], echo: ['echo', 'aftershock', 'again and again', 'repeat', 'resound', '残響', '余震'], crystallize: ['crystal', 'thorns grow', 'spikes grow', 'crystalliz', '結晶'] },
  morph: { lance: ['lance', 'spear', 'javelin', 'arrow', 'needle', 'bolt', '槍', '矢', '針'], shard: ['shard', 'crystal', 'fragment', 'splinter', '破片', '結晶'], disc: ['disc', 'disk', 'wheel', 'chakram', ' ring ', ' rings', ' saw', '円盤', '輪'],
    star: [' star', 'sparkle', 'twinkle', '星'], blade: ['blade', 'sword', 'saber', 'edge', '剣', '刃'], dragon: ['dragon', 'serpent', 'phoenix', 'wolf', 'beast', 'hydra', 'wyrm', '龍', '竜', '鳳凰', '狼', '獣', '蛇'],
    skull: ['skull', 'ghost', 'wraith', 'phantom', 'souls', '髑髏', '亡霊', '怨霊'], bubble: ['bubble', 'droplet', '泡', '雫'], cube: ['cube', 'block', 'prism', '立方'] },
  construct: { stairs: ['stair', 'steps', '階段'], box: ['box', 'cube', 'block', '箱'], pillar: ['pillar', 'column', 'tower', '柱', '塔'], rampart: ['rampart', 'fortress', 'wall', 'castle', '城', '壁'] },
};
const pickTrait = (t, table, def) => { let best = def, bn = 0; for (const [k, arr] of Object.entries(table)) { const n = countAny(t, arr); if (n > bn) { bn = n; best = k; } } return best; };
const ORB_WORDS = ['fireball', 'ball', ' orb', 'sphere', 'globe', '球', '玉', 'ボール'];
const EPIC = ['ultimate', 'supreme', 'ancient', 'forbidden', 'legendary', 'divine', 'eternal', 'infinite', 'almighty', 'grand', 'mega', 'giga', 'omega', 'hyper', 'world', 'gods', 'god of', 'heavens', 'cataclysm', 'apocalyp', 'annihilat', 'destroy', 'summon', 'spirit', 'gather', 'power of', 'i command', 'i invoke', 'i call', 'hear my', 'heed', 'by the', 'pact', 'covenant', 'here i', 'unleash', 'awaken', 'o great', 'lord of', 'king of', 'queen of', 'true', 'final', 'absolute', 'primordial', 'all of', '究極', '最強', '最終', '極', '奥義', '禁断', '召喚', '精霊', '神', '古の', '我が', '集え', '顕現', '終焉', '滅', '全て', '真なる', '覇', '大いなる', '今ここに', '汝'];
const DIMINUTIVE = ['little', 'tiny', 'small', 'mini', 'weak', 'baby', 'petite', 'wee', 'minor', 'lesser', '小さ', 'ちび', 'ちいさ', '弱'];
const has = (t, w) => t.includes(w);
const countAny = (t, arr) => arr.reduce((n, w) => n + ((w instanceof RegExp ? w.test(t) : t.includes(w)) ? 1 : 0), 0);

export function localParse(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const words = text.trim().split(/\s+/).filter(Boolean).length + (/[぀-ヿ一-龯]/.test(text) ? Math.floor(text.length / 3) : 0);
  const elScores = ELEMENT_KEYS.map((k) => [k, countAny(t, EL_WORDS[k])]).sort((a, b) => b[1] - a[1]);
  const shScores = SHAPE_KEYS.map((k) => [k, countAny(t, SHAPE_WORDS[k])]).sort((a, b) => b[1] - a[1]);
  let element = elScores[0][1] > 0 ? elScores[0][0] : null;
  const element2 = elScores[1][1] > 0 && element ? elScores[1][0] : null;
  let shape = shScores[0][1] > 0 ? shScores[0][0] : null;
  // context tweaks: "fireball" -> orb, "thunderstorm" -> storm etc.
  if (has(t, 'fireball') || has(t, 'ice ball') || has(t, 'water ball')) shape = shape === 'meteor' ? 'meteor' : 'orb';
  if (!shape && element === 'lightning') shape = has(t, 'bolt') ? 'chain' : 'chain';
  const epic = countAny(t, EPIC);
  const dim = countAny(t, DIMINUTIVE);
  const exclaim = (text.match(/[!！]/g) || []).length;
  const clauses = (text.match(/[,、。;！!]/g) || []).length;
  const kw = (arr) => countAny(t, arr);
  const p = {
    element: element || 'arcane', element2: element2 !== element ? element2 : null,
    shape: shape || 'orb', explicitElement: !!element, explicitShape: !!shape,
    power: clamp(0.4 + 0.12 * epic + 0.012 * words - 0.2 * dim + 0.06 * Math.min(exclaim, 2)),
    tier: clamp(0.1 + 0.018 * words + 0.11 * epic + 0.07 * clauses - 0.1 * dim),
    speed: clamp(0.5 + 0.2 * kw(['swift', 'quick', 'rapid', 'fast', 'flash', 'instant', 'speed', 'sonic', 'blitz', '速', '疾']) - 0.2 * kw(['slow', 'lumbering', 'creeping', 'ゆっくり'])),
    size: clamp(0.4 + 0.18 * kw(['huge', 'giant', 'colossal', 'great', 'mega', 'giga', 'massive', 'titan', 'enormous', 'big', 'vast', '巨大', '大']) - 0.2 * dim),
    temperature: { fire: 0.8, ice: 0.08, water: 0.35, lightning: 0.6, wind: 0.4, earth: 0.5, darkness: 0.3, light: 0.65, nature: 0.5, poison: 0.45, arcane: 0.5 }[element || 'arcane'],
    weight: clamp((element === 'earth' ? 0.7 : 0.35) + 0.2 * kw(['heavy', 'massive', 'iron', 'crush', 'boulder', 'hammer', 'weight', 'mountain', '重']) - 0.2 * kw(['feather', 'light as', 'weightless'])),
    sharpness: clamp(0.3 + 0.2 * kw(['blade', 'spear', 'lance', 'needle', 'spike', 'razor', 'sharp', 'cutter', 'sword', 'arrow', 'fang', 'dagger', 'edge', '刃', '剣'])),
    count: clamp(0.1 + 0.25 * kw(['two', 'twin', 'pair', 'double', 'dual']) + 0.4 * kw(['three', 'triple', 'few', 'several']) + 0.6 * kw(['many', 'hundred', 'thousand', 'countless', 'myriad', 'legion', 'swarm', 'rain of', 'army', 'infinite', '無数', '千'])),
    duration: clamp(0.35 + 0.25 * kw(['lasting', 'eternal', 'endless', 'sustain', 'linger', 'forever', 'persist', 'long', '永遠'])),
    chaos: clamp(0.2 + 0.25 * kw(['wild', 'chaotic', 'unstable', 'raging', 'berserk', 'frenzy', 'rampage', 'chaos', '暴'])),
    homing: kw(['seek', 'homing', 'chase', 'chasing', 'hunt', 'guided', 'tracking', 'never miss', 'pursue', '追尾', '追']) > 0 ? 0.9 : 0.1,
    isSpell: element || shape ? 1 : words <= 4 ? 0.6 : 0.3,
  };
  p.trajectory = pickTrait(t, TRAIT_WORDS.trajectory, p.homing > 0.5 ? 'homing' : 'straight');
  p.pattern = pickTrait(t, TRAIT_WORDS.pattern, 'single');
  p.payload = pickTrait(t, TRAIT_WORDS.payload, 'explode');
  p.morph = pickTrait(t, TRAIT_WORDS.morph, 'orb');
  p.explicit = {};
  for (const k of ['trajectory', 'pattern', 'payload', 'morph', 'construct']) p.explicit[k] = Object.values(TRAIT_WORDS[k]).some((arr) => countAny(t, arr) > 0);
  if (p.morph === 'orb' && countAny(t, ORB_WORDS) > 0) p.explicit.morph = true;
  p.construct = pickTrait(t, TRAIT_WORDS.construct, 'platform');
  if (/blue flame|blue fire|white flame|white fire|蒼炎|青い炎/.test(t)) p.temperature = 0.97;
  if (/absolute zero|絶対零度/.test(t)) p.temperature = 0.0;
  if (/scorch|searing|molten|灼熱/.test(t)) p.temperature = Math.max(p.temperature, 0.9);
  if (shape === 'barrage' || shape === 'storm') p.count = Math.max(p.count, 0.55);
  if (shape === 'funnels') p.homing = 0.9;
  return p;
}

// ---------------------------------------------------------------- Jev bridge
export async function askJev(text, meta) {
  const t0 = performance.now();
  try {
    const r = await fetch('/api/spell', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, chantSeconds: meta.chantSeconds || 0, loudness: meta.loudness ?? 0.5 }),
      signal: AbortSignal.timeout(7000),
    });
    const j = await r.json();
    if (!j.ok) return { ok: false, error: j.error, rtt: performance.now() - t0 };
    return { ok: true, params: j.params, latency: j.latency, cached: j.cached, model: j.model, rtt: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, error: String(e.message || e), rtt: performance.now() - t0 };
  }
}

// Jev-only interpretation: neutral defaults, never keyword-derived values.
export function buildJevSpec(text, jev, meta = {}) {
  if (!jev?.ok || !jev.params || jev.partial) return null;
  const J = jev.params;
  const number = (key, fallback = 0.5) => Number.isFinite(J[key]) ? clamp(J[key]) : fallback;
  const loud = clamp(meta.loudness ?? 0.4), chant = meta.chantSeconds || 0;
  return finalizeSpec({
    text, element: ELEMENT_KEYS.includes(J.element) ? J.element : 'arcane',
    element2: ELEMENT_KEYS.includes(J.element2) && J.element2 !== J.element ? J.element2 : null,
    shape: SHAPE_KEYS.includes(J.shape) ? J.shape : 'orb',
    ...Object.fromEntries(['speed', 'size', 'temperature', 'weight', 'sharpness', 'count', 'duration', 'chaos', 'homing', 'height', 'width'].map(k => [k, number(k)])),
    power: clamp(number('power') + (loud - 0.4) * 0.15 + Math.min(chant, 8) * 0.012),
    tier: clamp(number('tier') + Math.min(chant, 10) * 0.01),
    density: Number.isFinite(J.density) ? clamp(J.density) : null,
    luminosity: Number.isFinite(J.luminosity) ? clamp(J.luminosity) : null,
    ...Object.fromEntries(['trajectory', 'pattern', 'payload', 'morph', 'construct', 'substance'].map(k => [k, J[k]])),
    isSpell: number('isSpell', 0), loudness: loud, chantSeconds: chant,
    source: 'jev', latency: jev.latency, rtt: jev.rtt, cached: !!jev.cached, partial: false,
  });
}

// Merge local + Jev + voice metrics into the final procedural spec.
export function buildSpec(text, local, jev, meta = {}) {
  const J = jev && jev.ok ? jev.params : null;
  // a speculative result for an earlier part of the chant is trusted less than one for the full text
  const trust = jev?.partial ? 0.6 : 1;
  const pickNum = (k, w = 0.75) => {
    const jv = J && typeof J[k] === 'number' ? J[k] : null;
    const ww = w * trust;
    return jv === null ? local[k] : clamp(jv * ww + local[k] * (1 - ww));
  };
  let element = local.element, shape = local.shape, element2 = local.element2;
  if (J) {
    const gate = jev.partial ? 0.85 : 0.4;
    // Jev's "no clear element/form" defaults (arcane / orb) never override explicit words
    if (J.element && !(local.explicitElement && (J.element === 'arcane' || (J.elementConf < gate && J.element !== local.element)))) element = J.element;
    if (J.shape && !(local.explicitShape && (J.shape === 'orb' || (J.shapeConf < gate && J.shape !== local.shape)))) shape = J.shape;
    element2 = J.element2 || null;
  }
  if (element2 === element) element2 = null;
  const loud = clamp(meta.loudness ?? 0.4);
  const chant = meta.chantSeconds || 0;
  const spec = {
    text, element, element2, shape,
    power: clamp(pickNum('power') + (loud - 0.4) * 0.15 + Math.min(chant, 8) * 0.012),
    tier: clamp(pickNum('tier', 0.7) + Math.min(chant, 10) * 0.01),
    speed: pickNum('speed', 0.6), size: pickNum('size', 0.7), temperature: pickNum('temperature', 0.7),
    weight: pickNum('weight', 0.6), sharpness: pickNum('sharpness', 0.6), count: pickNum('count', 0.7),
    duration: pickNum('duration', 0.6), chaos: pickNum('chaos', 0.6), homing: pickNum('homing', 0.7),
    isSpell: J && typeof J.isSpell === 'number' ? Math.max(J.isSpell, local.isSpell * 0.5) : local.isSpell,
    ...Object.fromEntries(['trajectory', 'pattern', 'payload', 'morph', 'construct'].map((k) => {
      const DEF = { trajectory: 'straight', pattern: 'single', payload: 'explode', morph: 'orb', construct: 'platform' }[k];
      const jv = J?.[k];
      if (local.explicit?.[k]) return [k, local[k]]; // the caster's own words win
      return [k, jv && !(jv === DEF && local[k] !== DEF) ? jv : local[k] || DEF];
    })),
    loudness: loud, chantSeconds: chant,
    source: J ? 'jev' : 'local', latency: jev?.latency ?? null, rtt: jev?.rtt ?? null, cached: !!jev?.cached, partial: !!jev?.partial,
    jevError: jev && !jev.ok ? jev.error : null,
  };
  return finalizeSpec(spec);
}

export function finalizeSpec(spec) {
  spec.tierInt = 1 + Math.round(spec.tier * 8);
  spec.mag = 0.25 + spec.power * 0.55 + spec.tier * 0.45; // 0.25 .. 1.25
  // Power grade: 0 minor · 1 standard · 2 greater · 3 ultimate. Each grade unlocks new procedural layers, not just size.
  spec.level = spec.basic ? 0 : spec.tierInt >= 8 || spec.mag >= 1.05 ? 3 : spec.tierInt >= 6 || spec.mag >= 0.85 ? 2 : spec.tierInt >= 4 || spec.mag >= 0.6 ? 1 : 0;
  spec.dmgMult = (0.35 + 2.2 * Math.pow(spec.mag, 2.2)) * [0.85, 1, 1.12, 1.3][spec.level];
  spec.cost = Math.round(8 + 70 * Math.pow(spec.mag, 1.5));
  spec.seed = spec.seed ?? hashStr(spec.text + ':' + spec.element + spec.shape);
  spec.trajectory ||= 'straight'; spec.pattern ||= 'single'; spec.payload ||= 'explode'; spec.morph ||= 'orb'; spec.construct ||= 'platform';
  if (spec.homing > 0.6 && spec.trajectory === 'straight') spec.trajectory = 'homing';
  if (['leap', 'flight', 'blink', 'construct', 'enhance', 'hand', 'ward'].includes(spec.shape)) spec.cost = Math.round(spec.cost * 0.7);
  spec.name = spellName(spec);
  return spec;
}

// Scale a spec down when the caster can't afford it (mana-starved casting).
export function weakenSpec(spec, factor) {
  const s = { ...spec };
  s.power *= factor; s.tier *= Math.sqrt(factor); s.size *= 0.5 + 0.5 * factor;
  s.weakened = true;
  return finalizeSpec(s);
}

// Quick spec for the left-click mana bolt.
export function boltSpec(element) {
  return finalizeSpec({
    text: 'mana bolt', element, element2: null, shape: 'orb', power: 0.1, tier: 0.0, speed: 0.75, size: 0.1,
    temperature: element === 'ice' ? 0.1 : 0.6, weight: 0.1, sharpness: 0.5, count: 0, duration: 0, chaos: 0.1, homing: 0.15,
    isSpell: 1, source: 'basic', basic: true,
  });
}

// ---------------------------------------------------------------- incantation generator (for the AI rival)
const OPEN = {
  fire: ['Flames of the ancient forge, answer me', 'Spirit of the phoenix, lend me your wings', 'By the burning heart of the volcano'],
  ice: ['Winds of the frozen north, obey', 'By the eternal glacier', 'Queen of winter, lend me your breath'],
  water: ['Tides of the endless ocean, rise', 'By the depths of the abyssal sea', 'Spirits of the river, hear my call'],
  lightning: ['Heavens, split open', 'Thunder god, I invoke your wrath', 'By the storm that never sleeps'],
  wind: ['Sky spirits, gather', 'By the breath of the four winds', 'O tempest, answer my voice'],
  earth: ['Mountains, awaken', 'By the bones of the world', 'Titan of stone, lend me your strength'],
  darkness: ['Abyss, open your eyes', 'By the pact sealed in shadow', 'Night eternal, devour the light'],
  light: ['Holy light of the heavens', 'By the judgment of the seraphim', 'Dawn, pierce the darkness'],
  nature: ['Ancient forest, awaken', 'By the roots of the world tree', 'Thorns of the wild, rise'],
  arcane: ['By the runes of the first mage', 'Stars, align at my command', 'Aether, bend to my will'],
  poison: ['Plague of the drowned kingdom', 'Venom of the thousand serpents', 'Miasma of the rotting marsh'],
};
const CORE = {
  orb: ['{E}ball', '{E} orb', 'sphere of {e}'], barrage: ['{E} lances, a hundred strong', 'volley of {e} arrows', 'rain of {e} shards'],
  funnels: ['{E} familiars, hunt my foe', 'seeking {e} wisps', '{E} funnels'], beam: ['{E} cannon', '{E} ray', 'beam of pure {e}'],
  tornado: ['{E} tornado', 'cyclone of {e}', '{E} maelstrom'], meteor: ['{E} meteor', 'falling star of {e}', 'comet of {e}'],
  nova: ['{E} nova', 'explosion of {e}', '{E} burst'], spikes: ['{E} spikes', 'pillars of {e}, rise', '{E} spire eruption'],
  wall: ['{E} wall', 'barrier of {e}'], vortex: ['{E} vortex', 'black hole of {e}'], chain: ['{E} strike', 'chain of {e}', 'smite with {e}'],
  storm: ['{E} storm', '{E} rain', 'tempest of {e}'], crescent: ['{E} cutter', 'crescent of {e}', '{E} blade slash'],
  ward: ['{E} ward, protect me', 'blessing of {e}', 'heal me, {e}'],
  field: ['{E} field', 'pool of {e}', '{E} domain'], wave: ['{E} tidal wave', 'wave of {e}'], enhance: ['{E}, infuse my body', 'empower me with {e}'], hand: ['{E} hand, strike for me', 'fist of {e}'],
};
const WORD = { fire: 'fire', ice: 'ice', water: 'water', lightning: 'thunder', wind: 'wind', earth: 'stone', darkness: 'shadow', light: 'light', nature: 'thorn', poison: 'venom', arcane: 'arcane' };
const CLOSE = ['Unleash!', 'Now, burn it all!', 'Here I cast the ultimate spell!', 'Obliterate!', 'Let it end!'];

const OPEN_JA = {
  fire: ['古の焔よ、我が声に応えよ', '不死鳥の魂よ、その翼を貸せ', '燃え盛る火山の心臓よ'],
  ice: ['北の果ての凍てつく風よ、従え', '永久の氷河よ', '冬の女王よ、その吐息を我に'],
  water: ['果てなき大海の潮よ、満ちよ', '深淵の海よ', '川の精霊よ、我が呼び声を聞け'],
  lightning: ['天よ、裂けよ', '雷神よ、汝の怒りを我に', '眠らぬ嵐の名において'],
  wind: ['天空の精霊よ、集え', '四方の風の息吹よ', '嵐よ、我が声に応えよ'],
  earth: ['山々よ、目覚めよ', '世界の骨よ', '岩の巨神よ、力を貸せ'],
  darkness: ['深淵よ、その眼を開け', '影に結ばれし契約により', '永遠の夜よ、光を喰らえ'],
  light: ['天の聖なる光よ', '熾天使の裁きにより', '暁よ、闇を貫け'],
  nature: ['古の森よ、目覚めよ', '世界樹の根よ', '野生の茨よ、立ち上がれ'],
  arcane: ['始まりの魔導師のルーンにより', '星々よ、我が命に従い並べ', '霊気よ、我が意志に屈せよ'],
  poison: ['滅びし国の疫病よ', '千の蛇の猛毒よ', '腐れ沼の瘴気よ'],
};
const CORE_JA = {
  orb: ['{E}の球', '{E}弾'], barrage: ['{E}の槍、百連', '{E}の矢の雨'], funnels: ['{E}の使い魔よ、敵を狩れ', '追尾する{E}の精霊'],
  beam: ['{E}の光線', '{E}の砲撃'], tornado: ['{E}の竜巻', '{E}の大旋風'], meteor: ['{E}の隕石', '天より降れ、{E}の星'],
  nova: ['{E}の大爆発', '{E}爆裂'], spikes: ['大地より出でよ、{E}の棘', '{E}の柱'], wall: ['{E}の壁', '{E}の結界'],
  vortex: ['{E}の渦', '{E}のブラックホール'], chain: ['{E}の連鎖撃', '{E}の裁き'], storm: ['{E}の嵐', '{E}の雨'],
  crescent: ['{E}の刃', '{E}の三日月斬り'], ward: ['{E}の加護を我に', '{E}よ、我を癒せ'],
  field: ['{E}の領域', '{E}の沼'], wave: ['{E}の大波', '{E}の津波'], enhance: ['{E}よ、我が身に宿れ', '{E}の強化'], hand: ['{E}の魔手よ、敵を討て', '{E}の拳'],
};
const WORD_JA = { fire: '炎', ice: '氷', water: '水', lightning: '雷', wind: '風', earth: '岩', darkness: '闇', light: '光', nature: '茨', poison: '毒', arcane: '魔' };
const CLOSE_JA = ['放て！', '全てを焼き尽くせ！', '今ここに究極魔法を放つ！', '消し飛べ！', '終わりだ！'];

export function generateIncantation(rng, grand, element, shape, lang = 'en') {
  if (lang === 'ja') {
    let core = CORE_JA[shape][Math.floor(rng() * CORE_JA[shape].length)].replace('{E}', WORD_JA[element]);
    if (['orb', 'barrage', 'meteor'].includes(shape) && rng() < 0.7) {
      const PRE = ['追尾する', '螺旋を描く', '双つの', '降り注ぐ', '周回する', '龍の如き', '戻り来る'];
      const SUF = ['、砕けて散れ', '、毒の沼を残せ', '、柱となり噴き上がれ', '、三度響け', '、結晶を咲かせよ', '、全てを吸い込め'];
      if (rng() < 0.6) core = PRE[Math.floor(rng() * PRE.length)] + core;
      if (rng() < 0.7) core += SUF[Math.floor(rng() * SUF.length)];
    }
    const parts = [];
    if (grand > 0.35) parts.push(OPEN_JA[element][Math.floor(rng() * 3)] + '、');
    if (grand > 0.7) parts.push(OPEN_JA[element][Math.floor(rng() * 3)] + '、');
    parts.push(core + (grand > 0.55 ? '、' + CLOSE_JA[Math.floor(rng() * CLOSE_JA.length)] : '！'));
    return parts.join('');
  }
  const e = WORD[element];
  const cap = e[0].toUpperCase() + e.slice(1);
  let core = CORE[shape][Math.floor(rng() * CORE[shape].length)].replace('{E}', cap).replace('{e}', e);
  if (['orb', 'barrage', 'meteor'].includes(shape) && rng() < 0.7) {
    const PRE = ['seeking ', 'spiraling ', 'twin ', 'a storm of ', 'orbiting ', 'serpentine ', 'boomerang ', 'crossfire of '];
    const SUF = [' that splits into shards', ' that lingers as a pool', ' that erupts as a pillar', ' that echoes thrice', ' that grows crystals', ' that implodes', ' shaped like a dragon', ' like a spinning disc', ' like a lance', ' of skulls'];
    if (rng() < 0.6) core = PRE[Math.floor(rng() * PRE.length)] + core;
    if (rng() < 0.7) core += SUF[Math.floor(rng() * SUF.length)];
  }
  const parts = [];
  if (grand > 0.35) parts.push(OPEN[element][Math.floor(rng() * 3)] + ',');
  if (grand > 0.7) parts.push(OPEN[element][Math.floor(rng() * 3)] + ',');
  parts.push(grand > 0.35 ? core : core + '!');
  if (grand > 0.55) parts.push('— ' + CLOSE[Math.floor(rng() * CLOSE.length)]);
  return parts.join(' ').replace(/,,/g, ',');
}
