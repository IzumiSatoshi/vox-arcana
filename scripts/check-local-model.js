import assert from 'node:assert/strict';
import { localModel } from '../local-model.js';
const start = performance.now();
await localModel.load();
console.log(`Model ready in ${Math.round(performance.now() - start)}ms`);
const fixtures = [
  ['Fireball', 'fire', 'orb', 1], ['氷の槍', 'ice', 'barrage', 1],
  ['雷撃', 'lightning', 'chain', 1], ['炎の竜巻', 'fire', 'tornado', 1],
  ['Heal me', 'arcane', 'ward', 1], ['Hello how are you', null, null, 0],
  ['Make the air remember winter', 'ice', null, 1],
];
for (const [text, element, shape, isSpell] of fixtures) {
  const r = await localModel.interpret(text);
  console.log(JSON.stringify({text, element:r.params.element, shape:r.params.shape, isSpell:r.params.isSpell, latency:r.latency}));
  assert.equal(r.params.isSpell, isSpell, text);
  if (element) assert.equal(r.params.element, element, text);
  if (shape) assert.equal(r.params.shape, shape, text);
  for (const value of Object.values(r.params)) if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
}
assert.equal((await localModel.interpret('Fireball')).cached, true);
console.log('Model smoke checks passed (reference examples, not an independent accuracy benchmark).');
