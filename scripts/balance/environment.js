// Node-only adapters. No renderer, browser, network, microphone or real timers.
const noop = () => {};

export function canvasDocument() {
  return { createElement(tag) {
    if (tag !== 'canvas') throw new Error(`Unexpected DOM dependency: ${tag}`);
    const ctx = {};
    for (const name of ['save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'closePath', 'arc', 'ellipse', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'strokeText', 'setTransform', 'drawImage', 'putImageData']) ctx[name] = noop;
    ctx.createRadialGradient = ctx.createLinearGradient = () => ({ addColorStop: noop });
    ctx.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return { width: 1, height: 1, getContext: () => ctx };
  } };
}

export class SimClock {
  now = 0;
  nextId = 0;
  timers = new Map();
  schedule(fn, ms = 0) {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.now + Math.max(0, ms), fn });
    return id;
  }
  advance(ms) {
    this.now += ms;
    let calls = 0;
    while (true) {
      const due = [...this.timers].filter(([, t]) => t.at <= this.now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due.length) break;
      for (const [id, timer] of due) {
        if (!this.timers.delete(id)) continue;
        if (++calls > 10000) throw new Error('Simulation timer runaway');
        timer.fn();
      }
    }
  }
}

// Matches the browser FX callback order. These callbacks MUST run: some carry
// seed explosions, totem projectiles, fragments and other gameplay effects.
export function makeFX(THREE) {
  const callbacks = [];
  const fx = { quality: 0, attractors: [], distortScene: new THREE.Scene(),
    lights: { request: noop },
    add(fn) { callbacks.push(fn); },
    update(dt) {
      for (let i = callbacks.length - 1; i >= 0; i--) if (!callbacks[i](dt)) callbacks.splice(i, 1);
      this.attractors.length = 0;
    },
    clear() { callbacks.length = 0; this.distortScene.clear(); },
  };
  for (const key of ['glow', 'smoke', 'sparks']) fx[key] = { emit: noop };
  for (const key of ['element', 'explosion', 'ring', 'bolt', 'puff', 'flash', 'shockwave', 'shockWall', 'blast', 'debris', 'decal', 'haze', 'starburst', 'addShake', 'flame']) fx[key] = noop;
  return fx;
}

export function makeAudio() {
  const audio = {};
  for (const key of ['cast', 'impact', 'reaction', 'whoosh', 'passby', 'clang', 'crack', 'roar', 'runeBurst', 'rushBoom', 'shatter', 'shimmer', 'swordFall', 'tick', 'zap']) audio[key] = noop;
  audio.loop = () => ({ stop: noop, set: noop, update: noop, setVolume: noop, setPosition: noop });
  return audio;
}

export function installEnvironment(clock, rng) {
  const saved = [];
  const replace = (obj, key, value) => {
    saved.push([obj, key, Object.getOwnPropertyDescriptor(obj, key)]);
    Object.defineProperty(obj, key, { configurable: true, writable: true, value });
  };
  replace(Math, 'random', rng);
  replace(Date, 'now', () => 1700000000000 + Math.floor(clock.now));
  replace(globalThis, 'performance', { now: () => clock.now });
  replace(globalThis, 'setTimeout', (fn, ms) => clock.schedule(fn, ms));
  replace(globalThis, 'clearTimeout', id => clock.timers.delete(id));
  replace(globalThis, 'document', canvasDocument());
  replace(globalThis, 'fetch', () => { throw new Error('Network access is forbidden in a balance simulation'); });
  // SpellSystem normally logs and drops a broken spell. A benchmark must fail.
  replace(console, 'error', (...args) => { throw new Error(args.map(String).join(' ')); });
  return () => {
    for (const [obj, key, descriptor] of saved.reverse()) {
      if (descriptor) Object.defineProperty(obj, key, descriptor); else delete obj[key];
    }
  };
}
