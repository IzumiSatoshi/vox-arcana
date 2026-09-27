import { canvasDocument } from '../scripts/balance/environment.js';
globalThis.document = canvasDocument();
let sim, timer;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      if (sim || timer) throw new Error('Match already started');
      const { DuelSimulation } = await import('./simulation.js');
      sim = new DuelSimulation(data.players, data.collision, event => self.postMessage(event), data.winsToWin);
      let previous = performance.now(), accumulator = 0, frame = 0;
      timer = setInterval(() => {
        try {
          const now = performance.now(); accumulator += Math.min(0.15, (now - previous) / 1000); previous = now;
          while (accumulator >= 1 / 60) {
            sim.step(1 / 60); accumulator -= 1 / 60;
            if (++frame % 3 === 0) self.postMessage(sim.state());
          }
        } catch (error) { clearInterval(timer); self.postMessage({ type: 'matchError', error: 'Host simulation failed.' }); }
      }, 8);
    } else if (sim && data.type === 'input') sim.input(data.side, data.input);
    else if (sim && data.type === 'dash') sim.dash(data.side);
    else if (sim && data.type === 'cast') {
      const player = sim.players[data.side], yaw = player.yaw, pitch = player.pitch;
      // Interpretations may arrive later: launch along the aim saved on release.
      if (data.aim) { player.yaw = data.aim.yaw; player.pitch = data.aim.pitch; }
      try { sim.cast(data.side, data.spec, data.basic); }
      finally { player.yaw = yaw; player.pitch = pitch; }
    }
  } catch { self.postMessage({ type: 'matchError', error: 'Host simulation failed.' }); }
};
