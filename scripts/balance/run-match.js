import { Worker } from 'node:worker_threads';

// Use this entry point for reproducible games. Each worker gets fresh module
// caches, global timers, spell IDs and RNG state; no browser is started.
export function runMatch(left, right, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { left, right, options }, execArgv: [],
    });
    let result, received = false;
    worker.once('message', value => { result = value; received = true; });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0 || !received) reject(new Error(`Simulation worker exited with code ${code} without a result`));
      else resolve(result);
    });
  });
}
