import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
function session(warm) {
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) {
      const hidden = new Set();
      nodes.set(id, { classList: { add: x => hidden.add(x), remove: x => hidden.delete(x), contains: x => hidden.has(x) } });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({ $, t: x => x, warmSpellShaders: warm, requestAnimationFrame: f => f(), setTimeout: f => f(), console: { error() {} } });
  const Game = vm.runInContext(main.slice(main.indexOf('class Game {'), main.indexOf('window.game = new Game();')) + '\nGame', context);
  const game = Object.create(Game.prototype);
  game.preloadSpellCache = async () => {};
  let resets = 0;
  game.clock = { getDelta() { resets++; } };
  return { game, $, resets: () => resets };
}

test('play remains blocked until preparation completes, then later matches reuse it', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { game, $, resets } = session(async (g, { onProgress }) => { onProgress(1, 2); return pending; });
  const preparation = game.prepareSession();
  await Promise.resolve();
  assert.equal(game.preparing, true);
  assert.equal($('menu').inert, true);
  assert.equal($('loading-progress').value, 0.5);
  assert.equal(game.startMode('duel'), undefined); // No audio, combatants, or other setup allowed yet.
  finish({ casts: 100 });
  await preparation;
  assert.equal(game.preparing, false);
  assert.equal($('menu').inert, false);
  assert.equal($('loading').classList.contains('hidden'), true);
  assert.equal(game.warmupStats.casts, 100);
  assert.equal(resets(), 1);
});

test('failed preparation stays blocked and retry can recover', async () => {
  let attempts = 0;
  const { game, $ } = session(async () => { if (++attempts === 1) throw new Error('GPU failed'); return {}; });
  await game.prepareSession();
  assert.equal(game.preparing, true);
  assert.equal($('loading-retry').classList.contains('hidden'), false);
  $('loading-retry').onclick();
  await game.shaderWarmup;
  assert.equal(attempts, 2);
  assert.equal(game.preparing, false);
});

const warmup = readFileSync(new URL('../public/js/warmup.js', import.meta.url), 'utf8');
test('GPU completion is awaited and fence released on both success and failure', async () => {
  for (const fail of [false, true]) {
    let polls = 0, deleted = 0, yielded = 0;
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
      isContextLost: () => false, fenceSync: () => ({}), flush() {},
      clientWaitSync: () => ++polls === 1 ? 0 : fail ? 4 : 3,
      deleteSync() { deleted++; },
    };
    const ctx = vm.createContext({ performance, setTimeout: f => { yielded++; f(); } });
    const wait = vm.runInContext(warmup.slice(warmup.indexOf('export async function waitForGPU')).replace('export ', '') + '\nwaitForGPU', ctx);
    if (fail) await assert.rejects(wait({ getContext: () => gl }), /did not complete/);
    else await wait({ getContext: () => gl });
    assert.equal(yielded, 1);
    assert.equal(deleted, 1);
  }
});
