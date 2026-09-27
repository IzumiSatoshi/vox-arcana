import { parentPort, workerData } from 'node:worker_threads';
import { SimClock, installEnvironment } from './environment.js';
import { mulberry32 } from '../../public/js/util.js';

// Seed module initialization too: shared spell geometry/textures can consume
// random values. A new realm also resets spell IDs and all visual caches.
const restore = installEnvironment(new SimClock(), mulberry32(workerData.options.seed ?? 12345));
try {
  const { simulateMatch } = await import('./simulate.js');
  parentPort.postMessage(simulateMatch(workerData.left, workerData.right, workerData.options));
} finally { restore(); }
