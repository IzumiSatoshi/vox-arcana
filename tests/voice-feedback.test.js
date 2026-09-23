import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothVoiceLevel, voiceChargeFeedback } from '../public/js/voice-feedback.js';
test('voice response is consistent at 30, 60, and 144 fps', () => {
  const levels = [30, 60, 144].map(fps => { let v = 0; for (let i = 0; i < fps; i++) v = smoothVoiceLevel(v, 1, 1 / fps); return v; });
  assert.ok(Math.max(...levels) - Math.min(...levels) < 1e-10);
  assert.ok(smoothVoiceLevel(0, 1, 0.025) > 0.6);
  assert.ok(smoothVoiceLevel(1, 0, 0.025) > 0.8);
});
test('sound affects charging scale, brightness and particle rate before any text exists', () => {
  const quiet = voiceChargeFeedback(0, true), loud = voiceChargeFeedback(1, true);
  assert.ok(loud.scale > quiet.scale); assert.ok(loud.glow > quiet.glow); assert.ok(loud.particleRate > quiet.particleRate);
  assert.deepEqual(voiceChargeFeedback(1, false), voiceChargeFeedback(0, false));
  assert.deepEqual(voiceChargeFeedback(5, true), loud);
});
