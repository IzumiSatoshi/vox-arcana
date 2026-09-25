// Battle royale rules as plain data + pure functions (no rendering), so they can be unit-tested in Node.
export const PASSIVES = {
  font: { en: 'Mana Font', ja: '魔力の泉', desc: ['+40% mana regen', 'マナ回復+40%'], color: 0x5ab8ff, icon: '✦' },
  vessel: { en: 'Arcane Vessel', ja: '魔力の器', desc: ['+30 max mana', '最大マナ+30'], color: 0x8a7aff, icon: '⬢' },
  heart: { en: 'Troll Heart', ja: '巨人の心臓', desc: ['+150 max HP', '最大HP+150'], color: 0xff5a6a, icon: '♥' },
  boots: { en: 'Windstep Boots', ja: '疾風の靴', desc: ['+12% move speed', '移動速度+12%'], color: 0x6affc8, icon: '➶' },
  focus: { en: 'Sage Focus', ja: '賢者の宝珠', desc: ['-12% spell cost', '詠唱コスト-12%'], color: 0xffd46a, icon: '◈' },
  // rare: mostly found in arcane caches that fall from the sky each storm phase
  crown: { en: 'Archmage Crown', ja: '大魔導の冠', desc: ['+15% damage with every element', '全属性ダメージ+15%'], color: 0xffe066, icon: '♛', rare: true },
  phoenix: { en: 'Phoenix Feather', ja: '不死鳥の羽', desc: ['Rise again once with half HP', '一度だけHP半分で復活'], color: 0xff7a2a, icon: '❂', rare: true },
};
export const COMMON_RELICS = Object.keys(PASSIVES).filter((k) => !PASSIVES[k].rare);
export const RARE_RELICS = Object.keys(PASSIVES).filter((k) => PASSIVES[k].rare);
export const POTIONS = {
  hp: { en: 'Healing Draught', ja: '回復薬', key: '1', color: 0xff4a5a, icon: '✚' },
  mana: { en: 'Mana Draught', ja: 'マナ薬', key: '2', color: 0x3a8aff, icon: '◆' },
  shield: { en: 'Aegis Draught', ja: '守護薬', key: '3', color: 0xffc83a, icon: '⛨' },
};
// storm phases: seconds waiting, seconds shrinking, target radius, damage per second outside
export const PHASES = [
  { wait: 45, shrink: 25, r: 72, dps: 5 }, { wait: 30, shrink: 22, r: 46, dps: 8 }, { wait: 25, shrink: 18, r: 26, dps: 12 },
  { wait: 20, shrink: 15, r: 11, dps: 18 }, { wait: 15, shrink: 14, r: 0, dps: 28 },
];
export const CORE_BONUS = 0.2, CORE_CAP = 0.8, POTION_CAP = 5;
export const POTION_EFFECT = { hp: 220, mana: 90, shield: 160 };

// a fresh loadout for the drop
export function equip(c) {
  c.inv = { hp: 1, mana: 0, shield: 0 }; c.affinity = {}; c.relics = {};
  c.manaRegen = 1; c.speedMult = 1; c.costBonus = 1; c.allDmg = 1;
  c.maxHp = 600; c.maxMana = 120; c.hp = 600; c.mana = 120;
}
// apply one picked-up item; kinds are { type: 'core', el } | { type: 'relic', id } | { type: 'potion', id }
export function grant(c, k) {
  if (k.type === 'core') c.affinity[k.el] = Math.min(CORE_CAP, (c.affinity[k.el] || 0) + CORE_BONUS);
  else if (k.type === 'relic') {
    c.relics[k.id] = (c.relics[k.id] || 0) + 1;
    if (k.id === 'font') c.manaRegen += 0.4;
    if (k.id === 'vessel') { c.maxMana += 30; c.mana += 30; }
    if (k.id === 'heart') { c.maxHp += 150; c.hp += 150; }
    if (k.id === 'boots') c.speedMult += 0.12;
    if (k.id === 'focus') c.costBonus *= 0.88;
    if (k.id === 'crown') c.allDmg = (c.allDmg || 1) + 0.15;
  } else c.inv[k.id] = Math.min(POTION_CAP, (c.inv[k.id] || 0) + 1);
}
// storm damage per second for a phase index; the last (final) storm keeps climbing with time spent in it
export function stormDps(phase, finalSeconds = 0) {
  if (phase >= PHASES.length) return PHASES[PHASES.length - 1].dps + finalSeconds * 2.5;
  return phase ? PHASES[phase - 1].dps : 3;
}
// total seconds from the drop until the last circle has closed
export const STORM_SECONDS = PHASES.reduce((n, p) => n + p.wait + p.shrink, 0);
