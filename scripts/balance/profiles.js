import { ELEMENT_KEYS, SHAPE_KEYS } from '../../public/js/elements.js';
import { mulberry32 } from '../../public/js/util.js';

export const DEFAULT_PROFILES = ['native:normal', 'native:hard', 'bolts', 'form:orb', 'form:chain', 'form:beam'];
export { ELEMENT_KEYS, SHAPE_KEYS };

export function validateProfile(profile) {
  const [kind, value, extra] = profile.split(':');
  const valid = !extra && (kind === 'native' && ['easy', 'normal', 'hard'].includes(value)
    || kind === 'bolts' && !value || kind === 'form' && SHAPE_KEYS.includes(value)
    || kind === 'element' && ELEMENT_KEYS.includes(value) || kind === 'tactic' && ['guard', 'adaptive'].includes(value) || profile === 'combo:freeze-shatter');
  if (!valid) throw new Error(`Unknown profile: ${profile}`);
}

// Controlled fixtures use the same finalized-spec builder as completed Jev
// replies, but are synthetic inputs, never claimed to be actual model outputs.
export function configureBrain(brain, profile, { seed, power, tier, chantSeconds }) {
  validateProfile(profile);
  brain.rng = mulberry32(seed);
  if (profile.startsWith('native:')) return;
  brain.tactical = profile.startsWith('tactic:') ? profile.split(':')[1] : false;
  if (profile === 'bolts') { brain.castCd = Infinity; brain.favEl = 'arcane'; return; }
  const [kind, value] = profile.split(':');
  let turn = 0;
  brain.startChant = function () {
    let element = kind === 'element' ? value : 'arcane';
    let shape = kind === 'form' ? value : kind === 'tactic' ? 'chain' : 'orb';
    if (kind === 'combo') element = ['water', 'ice', 'earth'][turn % 3];
    turn++;
    if (this.tacticChoice) { shape = this.tacticChoice.shape; element = this.tacticChoice.element; }
    this.tacticCasting = shape;
    this.favEl = element;
    this.forceAim = this.tacticChoice?.point || null;
    const text = `Simulation ${element} ${shape}`;
    this.chant = { text, words: text.split(' '), joiner: ' ', t: 0, dur: chantSeconds,
      voicePending: false, meta: { chantSeconds },
      jev: { ok: true, params: { element, shape, power, tier, isSpell: 1,
        speed: 0.5, size: 0.5, temperature: 0.5, weight: 0.5, sharpness: 0.5,
        count: 0.5, duration: 0.5, chaos: 0.5, homing: 0.5, height: 0.5, width: 0.5,
        trajectory: 'straight', pattern: 'single', payload: 'explode', morph: 'orb' } } };
    this.useJev = false;
    this.c.chanting = true;
    this.c.chantText = '';
  };
}
