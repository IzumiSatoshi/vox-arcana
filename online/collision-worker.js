import { parentPort } from 'node:worker_threads';
import { canvasDocument } from '../scripts/balance/environment.js';
globalThis.document = canvasDocument();
const THREE = await import('three');
const { World } = await import('../public/js/world.js');
// Build the same seeded terrain and static collision as the browser, once at startup.
const world = new World(new THREE.Scene(), 0);
parentPort.postMessage({ obstacles: world.obstacles, solids: world.solids, bound: world.bound });
