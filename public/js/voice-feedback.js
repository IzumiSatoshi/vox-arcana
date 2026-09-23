import { clamp } from './util.js';

// Wall-clock attack/release envelope: identical response at different frame rates.
export function smoothVoiceLevel(current, target, dt) {
  const seconds = target > current ? 0.025 : 0.12;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / seconds));
}

export function voiceChargeFeedback(level, chanting) {
  const energy = chanting ? clamp(level) : 0;
  return { scale: 1 + energy * 0.38, glow: energy * 1.8, spin: energy * 5, particleRate: 14 + energy * 46 };
}
