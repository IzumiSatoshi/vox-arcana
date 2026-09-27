import { parentPort, workerData } from 'node:worker_threads';
import { canvasDocument } from '../scripts/balance/environment.js';
globalThis.document = canvasDocument();
const { DuelSimulation } = await import('./simulation.js');
const sim = new DuelSimulation(workerData.players, workerData.collision, event => parentPort.postMessage(event), workerData.winsToWin);
parentPort.on('message', message => {
  if (message.type === 'input') sim.input(message.side, message.input);
  if (message.type === 'dash') sim.dash(message.side);
  if (message.type === 'cast') sim.cast(message.side, message.spec, message.basic);
});
// Fixed simulation steps, bounded catch-up; snapshots at 20 Hz.
let previous = performance.now(), accumulator = 0, frame = 0;
setInterval(() => {
  const now = performance.now(); accumulator += Math.min(0.15, (now - previous) / 1000); previous = now;
  while (accumulator >= 1 / 60) { sim.step(1 / 60); accumulator -= 1 / 60; if (++frame % 3 === 0) parentPort.postMessage(sim.state()); }
}, 8);
