import { TRAITS } from '../spell-ontology.js';
export const TRAIT_VALUES = Object.fromEntries(Object.entries(TRAITS).map(([key, value]) => [key, Object.keys(value.criteria)]));
export const PROTOCOL = 1;
export const MAX_WINS = 10;
export function readWinsToWin(value = 2) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_WINS) throw new Error(`Choose a whole number of wins from 1 to ${MAX_WINS}.`);
  return value;
}
export const STATE_FIELDS = ['hp', 'maxHp', 'mana', 'maxMana', 'stamina', 'shield', 'shieldTime', 'shieldEl', 'frozen', 'stun', 'defDown', 'mud', 'weaken', 'curse', 'haste', 'flying', 'cloak', 'alive', 'grounded', 'chanting', 'chantText', 'channeling', 'enh', 'aura'];

export function validName(value) {
  if (typeof value !== 'string') throw new Error('Enter a player name.');
  const name = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  if (!name || name.length > 24) throw new Error('Names must contain 1–24 characters.');
  return name;
}

export function readInput(value) {
  if (!value || !Number.isSafeInteger(value.seq) || value.seq < 0 || !Number.isFinite(value.yaw) || !Number.isFinite(value.pitch)) throw new Error('Invalid movement input.');
  if (!Number.isFinite(value.x) || !Number.isFinite(value.z) || Math.abs(value.x) > 1 || Math.abs(value.z) > 1) throw new Error('Invalid movement input.');
  const length = Math.max(1, Math.hypot(value.x, value.z));
  return { seq: value.seq, yaw: value.yaw % (Math.PI * 2), pitch: Math.max(-1.5, Math.min(1.5, value.pitch)),
    x: value.x / length, z: value.z / length, jump: value.jump === true, sprint: value.sprint === true,
    descend: value.descend === true, chanting: value.chanting === true,
    chantText: value.chanting === true && typeof value.chantText === 'string'
      ? value.chantText.slice(0, 600).replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '' };
}

export function snapshot(c) {
  return { id: c.id, name: c.name, pos: c.pos.toArray(), vel: c.vel.toArray(), yaw: c.yaw, pitch: c.pitch,
    dots: c.dots.map(d => ({ el: d.el, t: d.t, dps: d.dps, acc: d.acc })),
    ...Object.fromEntries(STATE_FIELDS.map(key => [key, c[key] ?? null])) };
}
