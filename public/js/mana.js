// Combat economy: Jev supplies spell characteristics; these rules price them.
// Voice length and loudness never enter the calculation.
export const MANA = Object.freeze({ idleRegen: 6, chantRegen: 2, boltCost: 1, maxRegenMultiplier: 2 });
const bounded = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const axis = (s, k) => Number.isFinite(s[k]) ? bounded(s[k], 0, 1) : 0.5;
const FORM_COST = {
  orb: 0.64, barrage: 0.8, funnels: 0.75, beam: 0.9, chain: 1.32,
  prison: 1.13, barrier: 0.5, wall: 0.6, ward: 0.65,
  blink: 0.45, leap: 0.4, flight: 0.6, construct: 0.55, enhance: 0.7, hand: 0.8,
  nova: 0.7, whip: 0.65, halo: 0.7, rush: 0.65,
};
const REPEATED = new Set(['barrage', 'funnels', 'chain', 'storm', 'totem', 'halo']);
const LASTING = new Set(['beam', 'funnels', 'storm', 'field', 'vortex', 'prison', 'barrier', 'wall', 'ward', 'enhance', 'flight', 'totem', 'halo', 'hand', 'beast', 'drain']);

export function baseManaCost(spec) {
  if (spec.basic) return MANA.boltCost;
  const mag = 0.25 + axis(spec, 'power') * 0.55 + axis(spec, 'tier') * 0.45;
  let utility = 1 + (axis(spec, 'size') - 0.5) * 0.18;
  if (REPEATED.has(spec.shape)) utility += (axis(spec, 'count') - 0.5) * 0.35;
  if (LASTING.has(spec.shape)) utility += (axis(spec, 'duration') - 0.5) * 0.3;
  if (spec.element2 && spec.element2 !== spec.element) utility += 0.15;
  if (spec.trajectory === 'homing' || axis(spec, 'homing') > 0.6) utility += 0.12;
  if (spec.payload && !['explode', 'none'].includes(spec.payload)) utility += 0.12;
  // Every single cast remains affordable from a fresh 120-mana pool.
  return bounded(Math.round((8 + 70 * mag ** 1.5) * (FORM_COST[spec.shape] ?? 1) * utility), 8, 110);
}

export function effectiveManaCost(caster, spec) {
  if (spec.basic) return MANA.boltCost;
  return Math.max(1, Math.round(spec.cost * (caster.costMult?.() ?? 1)));
}

export function spendMana(caster, amount) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid mana expenditure');
  if (!Number.isFinite(caster.mana) || caster.mana + 1e-9 < amount) return false;
  caster.mana = Math.max(0, caster.mana - amount);
  caster.manaSpent = (caster.manaSpent || 0) + amount;
  return true;
}

export function spendSpellMana(caster, spec) { return spendMana(caster, effectiveManaCost(caster, spec)); }

export function manaRegenRate(caster) {
  const light = caster.enhP?.('light');
  const bonus = light == null ? 1 : 1.2 + 0.4 * light;
  const mult = bounded((caster.manaRegen ?? 1) * bonus, 0, MANA.maxRegenMultiplier);
  return (caster.chanting ? MANA.chantRegen : MANA.idleRegen) * mult;
}

export function funnelUpkeep(spec) { return 2 + 2 * axis(spec, 'count'); }
