// Spell sound design (WebAudio). Every spell sound is synthesised from
// noise + oscillators, shaped by element and magnitude, spatialised with HRTF.
import { clamp, rand, pick } from './util.js';

// loudness trims measured offline (0.4 s window RMS) so every element's cast / impact sits at the same level
const CAST_TRIM = { wind: 1.64, fire: 1.32, nature: 1.2, water: 1.19, arcane: 1.1, ice: 1.1, earth: 0.93, poison: 0.94, darkness: 0.84, light: 0.86, lightning: 0.88 };
const IMPACT_TRIM = { lightning: 0.8, poison: 0.95, water: 0.95, nature: 1.06 };
const BASE = { poison: 147, fire: 110, ice: 440, water: 196, lightning: 82, wind: 262, earth: 55, darkness: 65, light: 330, nature: 220, arcane: 294 };

export class AudioEngine {
  constructor() { this.ctx = null; this.enabled = false; this.volume = 0.8; this.musicVolume = 0.175; this.voices = 0; this.loopCount = 0; this.recentSpells = []; }

  init() {
    if (this.ctx) { this.ctx.resume(); this.startMusic(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfxTone = ctx.createBiquadFilter(); this.sfxTone.type = 'lowpass'; this.sfxTone.frequency.value = 20000; this.sfxTone.Q.value = 0.5;
    this.sfx.connect(this.sfxTone); this.sfxTone.connect(this.master); // world muffle (inside the storm)
    // Keep music outside the spell compressor: a dense impact must not duck it for seconds.
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVolume;
    this.musicMaster = ctx.createGain(); this.musicMaster.gain.value = this.volume;
    // music mix state: a duck gain (chanting, pause) and a lowpass (near death) between the bus and the master
    this.musicDuck = ctx.createGain(); this.musicTone = ctx.createBiquadFilter(); this.musicTone.type = 'lowpass'; this.musicTone.frequency.value = 20000; this.musicTone.Q.value = 0.7;
    this.musicBus.connect(this.musicDuck); this.musicDuck.connect(this.musicTone); this.musicTone.connect(this.musicMaster); this.musicMaster.connect(ctx.destination);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.35;
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.sfxTone);
    const sr = ctx.sampleRate, len = sr * 2;
    this.white = ctx.createBuffer(1, len, sr); this.pink = ctx.createBuffer(1, len, sr); this.brown = ctx.createBuffer(1, len, sr);
    const w = this.white.getChannelData(0), p = this.pink.getChannelData(0), b = this.brown.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1; w[i] = x;
      b0 = 0.99765 * b0 + x * 0.099046; b1 = 0.963 * b1 + x * 0.2965164; b2 = 0.57 * b2 + x * 1.0526913;
      p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.2;
      last = (last + 0.02 * x) / 1.02; b[i] = last * 3.5;
    }
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3); }
    this.shaperCurve = curve;
    this.enabled = true;
    this.startAmbience();
    this.startMusic();
  }
  impulse(sec, decay) {
    // an open-air hall: sparse early reflections off the ruins, then a diffuse tail whose highs die first
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * sec), buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const u = i / len, a = 0.55 - 0.5 * Math.min(1, u * 1.6); // one-pole lowpass closing over time
        lp += ((Math.random() * 2 - 1) - lp) * a;
        d[i] = lp * Math.pow(1 - u, decay) * (i < 300 ? i / 300 : 1) * 0.9;
      }
      for (let k = 0; k < 9; k++) { const at = Math.floor(sr * (0.011 + k * 0.009 + Math.random() * 0.012 + c * 0.003)); if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.7 - k * 0.06); }
    }
    return buf;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; if (this.musicMaster) this.musicMaster.gain.value = v; }
  setMusic(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v; }
  // muffle the whole world's SFX 0..1 (standing inside the storm)
  sfxMuffle(k = 0) {
    if (!this.sfxTone || Math.abs((this._sfxM ?? 0) - k) < 0.01) return;
    this._sfxM = k; this.sfxTone.frequency.setTargetAtTime(20000 * Math.pow(0.06, k), this.ctx.currentTime, 0.3);
  }
  // duck 0..1 (1 = full), muffle 0..1 (1 = heavily low-passed); smoothed so state changes never click
  musicMix(duck = 1, muffle = 0) {
    if (!this.musicDuck) return;
    const t = this.ctx.currentTime;
    if (Math.abs((this._duck ?? 1) - duck) > 0.01) { this._duck = duck; this.musicDuck.gain.setTargetAtTime(duck, t, 0.25); }
    if (Math.abs((this._muffle ?? 0) - muffle) > 0.01) { this._muffle = muffle; this.musicTone.frequency.setTargetAtTime(20000 * Math.pow(0.03, muffle), t, 0.3); }
  }

  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    const t = this.ctx.currentTime;
    (this.lp ||= p.clone()).copy(p);
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  // Output chain: input gain -> (panner) -> sfx + reverb send
  out(pos, gain = 1, rev = 0.3, persistent = false) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = gain;
    g._output = g; g._sources = 0; g._nodes = [g]; g._persistent = persistent;
    g._dispose = () => { for (const node of g._nodes) node.disconnect(); g._nodes.length = 0; };
    // Recipes attach sources synchronously; also clean up fully rejected recipes.
    queueMicrotask(() => { if (!persistent && !g._sources) g._dispose(); });
    let tail = g;
    // air absorption: far sounds lose their top end and sit further back in the reverb
    const dist = pos && this.lp ? Math.hypot(pos.x - this.lp.x, pos.y - this.lp.y, pos.z - this.lp.z) : 0;
    // occlusion: a wall, cliff or ruin between you and the source muffles it heavily
    if (pos && dist > 5 && dist < 70 && this.occluded?.(this.lp, pos)) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.4;
      g._nodes.push(f); tail.connect(f); tail = f; g.gain.value *= 0.7; rev *= 1.3;
    }
    if (dist > 14) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5;
      f.frequency.value = Math.max(900, 20000 * Math.exp(-(dist - 14) / 38));
      g._nodes.push(f); tail.connect(f); tail = f; rev *= 1 + Math.min(1.4, dist / 45);
      if (dist > 30) { const dl = ctx.createDelay(0.5); dl.delayTime.value = Math.min(0.35, dist / 340); g._nodes.push(dl); tail.connect(dl); tail = dl; } // sound arrives after the flash
    }
    if (pos) {
      const pn = ctx.createPanner();
      pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = 5; pn.maxDistance = 400; pn.rolloffFactor = 0.9;
      if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z; } else pn.setPosition(pos.x, pos.y, pos.z);
      g._nodes.push(pn); tail.connect(pn); tail = pn; g._panner = pn;
    }
    tail.connect(this.sfx);
    if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; tail.connect(s); s.connect(this.reverbIn); g._nodes.push(s); }
    return g;
  }
  env(param, t, a, peak, d, sustain = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }
  // Look → timbre. Every recipe below plays through this: weight lowers pitch, heat/brightness open the filters,
  // dispersion jitters timing. Set for the duration of one cast/impact recipe, then cleared.
  withLook(look, fn) {
    const G = look?.g;
    this.mod = G ? { p: 1.35 - G.weight * 0.7, b: 0.55 + G.temperature * 0.5 + G.luminosity * 0.45, j: G.dispersion, grit: G.density } : null;
    try { fn(); } finally { this.mod = null; }
  }
  // Delayed layers count too: scheduled crackles still occupy audio resources.
  busy(gain) { return this.voices >= 96 || (this.voices >= 64 && gain < 0.35); }
  trackSource(dest) {
    const output = dest._output;
    if (output) output._sources++;
    return () => {
      this.voices--;
      if (output && --output._sources === 0 && !output._persistent) {
        // Drain propagation delays; the shared convolver retains its reverb tail.
        setTimeout(() => { if (!output._sources) output._dispose(); }, 400);
      }
    };
  }
  admitSpell(kind, el, pos) {
    const t = this.ctx.currentTime;
    this.recentSpells = this.recentSpells.filter(s => t - s.t < 0.06);
    const distance = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : a === b ? 0 : Infinity;
    // Merge rapid same-element events in one small area before allocating nodes.
    if (this.recentSpells.some(s => s.kind === kind && s.el === el && distance(s.pos, pos) < 8)) return false;
    const near = !pos || (this.lp && distance(pos, this.lp) < 10);
    if (this.recentSpells.length >= (near ? 8 : 6) || this.voices >= (near ? 80 : 64)) return false;
    this.recentSpells.push({ t, kind, el, pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null });
    return true;
  }
  noise(dest, { type = 'white', dur = 0.5, a = 0.005, gain = 0.5, f = 'lowpass', f0 = 2000, f1 = null, Q = 1, delay = 0, rate = 1 } = {}) {
    if (this.busy(gain)) return null;
    this.voices++;
    const release = this.trackSource(dest);
    if (this.mod) { f0 *= this.mod.b; if (f1) f1 *= this.mod.b; delay += Math.random() * this.mod.j * 0.05; rate *= this.mod.p; }
    if (this.vary) { f0 *= this.vary; if (f1) f1 *= this.vary; rate *= this.vary; }
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this[type]; src.loop = true; src.playbackRate.value = rate;
    const fl = ctx.createBiquadFilter(); fl.type = f; fl.Q.value = Q; fl.frequency.setValueAtTime(f0, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); this.env(g.gain, t, a, gain, dur);
    src.connect(fl); fl.connect(g); g.connect(dest);
    src.onended = () => { release(); src.disconnect(); fl.disconnect(); g.disconnect(); };
    src.start(t, Math.random() * 1.5); src.stop(t + a + dur + 0.05);
    return fl;
  }
  tone(dest, { type = 'sine', f0 = 440, f1 = null, dur = 0.5, a = 0.005, gain = 0.3, delay = 0, detune = 0, curve = 'exp' } = {}) {
    if (this.busy(gain)) return null;
    this.voices++;
    const release = this.trackSource(dest);
    if (this.mod) { f0 *= this.mod.p; if (f1) f1 *= this.mod.p; detune += (Math.random() - 0.5) * this.mod.j * 60; }
    if (this.vary) { f0 *= this.vary; if (f1) f1 *= this.vary; }
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f0, t);
    if (f1) curve === 'exp' ? o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur) : o.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); this.env(g.gain, t, a, gain, dur);
    o.connect(g); g.connect(dest);
    o.onended = () => { release(); o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  distort(dest, amount = 1) {
    const ws = this.ctx.createWaveShaper(); ws.curve = this.shaperCurve; ws.oversample = '2x';
    const g = this.ctx.createGain(); g.gain.value = amount; g.connect(ws); ws.connect(dest); g._output = dest._output; g._output?._nodes.push(g, ws); return g;
  }

  // ---------------------------------------------------------------- spell casts
  varied(fn) { const v = this.vary; this.vary = rand(0.93, 1.07); try { fn(); } finally { this.vary = v; } }
  cast(el, m = 0.5, pos = null, look = null) {
    if (!this.enabled) return;
    if (!this.vary) return this.varied(() => this.cast(el, m, pos, look));
    if (look && !this.mod) return this.withLook(look, () => this.cast(el, m, pos, look));
    if (!this.admitSpell('cast', el, pos)) return;
    const o = this.out(pos, (0.55 + m * 0.4) * (CAST_TRIM[el] || 1), 0.25 + m * 0.3);
    const L = 0.3 + m * 0.6;
    // shared launch layer: a rising filtered whoosh and a transient snap, so every cast leaves the hand with energy
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 450, f1: 2600 + m * 1500, Q: 1.6, dur: 0.26 + m * 0.2, a: 0.12 + m * 0.06, gain: 0.55 + m * 0.3 });
    this.noise(o, { f: 'highpass', f0: 3200, dur: 0.03, a: 0.001, gain: 0.35 + m * 0.2 });
    switch (el) {
      case 'fire':
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 300, f1: 2400, Q: 0.8, dur: L, a: 0.08, gain: 0.9 });
        this.noise(o, { type: 'brown', f0: 400, f1: 80, dur: L * 1.2, gain: 0.8 });
        for (let i = 0; i < 6 + m * 10; i++) this.noise(o, { f: 'highpass', f0: 2500, dur: 0.02, gain: rand(0.1, 0.3), delay: rand(0, L) });
        break;
      case 'ice':
        for (let i = 0; i < 5; i++) this.tone(o, { f0: rand(1400, 3800), dur: 0.5 + m, gain: 0.08, delay: i * 0.04 });
        this.noise(o, { f: 'highpass', f0: 5000, f1: 9000, dur: L, a: 0.05, gain: 0.3 });
        this.tone(o, { type: 'triangle', f0: 880, f1: 1760, dur: 0.25, gain: 0.1 });
        break;
      case 'water':
        for (let i = 0; i < 6; i++) this.tone(o, { f0: rand(300, 700), f1: rand(900, 1600), dur: 0.08, gain: 0.12, delay: rand(0, 0.25) });
        this.noise(o, { type: 'pink', f: 'lowpass', f0: 1800, f1: 400, dur: L, a: 0.05, gain: 0.8 });
        break;
      case 'lightning': {
        const d = this.distort(o, 0.6);
        this.tone(d, { type: 'sawtooth', f0: 1400, f1: 60, dur: 0.25 + m * 0.2, gain: 0.5 });
        this.noise(o, { f: 'highpass', f0: 3000, dur: 0.12, gain: 0.7 });
        for (let i = 0; i < 5; i++) this.tone(d, { type: 'square', f0: rand(60, 120), dur: 0.05, gain: 0.3, delay: rand(0, 0.3) });
        break;
      }
      case 'wind':
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 400, f1: 3000, Q: 4, dur: L, a: 0.1, gain: 1.4 });
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 1200, f1: 500, Q: 6, dur: L * 1.2, a: 0.15, gain: 1.0 });
        break;
      case 'earth':
        this.noise(o, { type: 'brown', f0: 300, f1: 60, dur: L * 1.5, a: 0.02, gain: 1.4 });
        this.tone(o, { f0: 70, f1: 35, dur: L, gain: 0.6 });
        for (let i = 0; i < 5; i++) this.noise(o, { f0: 900, dur: 0.06, gain: 0.4, delay: rand(0, L) });
        break;
      case 'darkness':
        for (const dt of [-14, 0, 9]) this.tone(o, { type: 'sawtooth', f0: 55, f1: 40, dur: L * 1.5, a: L * 0.6, gain: 0.12, detune: dt * 10 });
        this.noise(o, { f: 'bandpass', f0: 700, f1: 300, Q: 8, dur: L * 1.4, a: L * 0.7, gain: 1.2 });
        this.tone(o, { f0: 30, dur: L, gain: 0.5 });
        break;
      case 'light':
        for (const r of [1, 1.25, 1.5, 2, 3]) this.tone(o, { f0: 392 * r, dur: 0.9 + m, a: 0.05, gain: 0.07 });
        this.noise(o, { f: 'highpass', f0: 6000, dur: 0.8, a: 0.2, gain: 0.25 });
        break;
      case 'nature':
        for (let i = 0; i < 4; i++) this.tone(o, { type: 'triangle', f0: pick([294, 330, 392, 440, 587]), dur: 0.35, gain: 0.22, delay: i * 0.06 });
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 2500, Q: 1.2, dur: L, a: 0.1, gain: 0.7 });
        this.tone(o, { f0: 190, f1: 120, dur: 0.09, a: 0.002, gain: 0.5 });                                               // woody knock
        for (let i = 0; i < 7; i++) this.noise(o, { f: 'bandpass', f0: rand(2800, 5200), Q: 2, dur: rand(0.03, 0.07), gain: rand(0.25, 0.5), delay: rand(0, L) }); // leaf rustle
        break;
      case 'poison':
        for (let i = 0; i < 10; i++) this.tone(o, { f0: rand(150, 320), f1: rand(400, 900), dur: 0.09, gain: 0.24, delay: rand(0, 0.4) }); // bubbling blips
        this.noise(o, { type: 'brown', f: 'lowpass', f0: 500, f1: 180, dur: L * 1.2, a: 0.05, gain: 0.9 });                // thick gurgle
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 600, f1: 250, Q: 3, dur: L, a: 0.08, gain: 0.9 });
        this.tone(o, { type: 'sawtooth', f0: 90, f1: 70, dur: L, gain: 0.08, detune: 30 });
        break;
      default: // arcane
        this.tone(o, { f0: 300, f1: 1200 + m * 1200, dur: L, gain: 0.32 });
        for (const dt of [0, 7]) this.tone(o, { type: 'triangle', f0: 880, f1: 1320, dur: L * 1.3, a: 0.04, gain: 0.14, detune: dt * 10 }); // beating shimmer
        for (let i = 0; i < 6; i++) this.tone(o, { f0: pick([523, 659, 784, 988, 1175]), dur: 0.2, gain: 0.14, delay: i * 0.05 });
        this.noise(o, { f: 'bandpass', f0: 1500, f1: 5200, Q: 5, dur: L, a: 0.05, gain: 0.8 });                             // phasey sweep
    }
    if (m > 0.8) { // big spells: sub drop + choir-ish swell
      this.tone(o, { f0: 90, f1: 30, dur: 1.4, gain: 0.8 });
      for (const r of [1, 1.5, 2]) this.tone(o, { type: 'triangle', f0: BASE[el] * r, dur: 1.6, a: 0.3, gain: 0.08 });
    }
  }

  impact(el, m = 0.5, pos = null, look = null) {
    if (!this.enabled) return;
    if (!this.vary) return this.varied(() => this.impact(el, m, pos, look));
    if (look && !this.mod) return this.withLook(look, () => this.impact(el, m, pos, look));
    if (!this.admitSpell('impact', el, pos)) return;
    const o = this.out(pos, (0.6 + m * 0.6) * (IMPACT_TRIM[el] || 1), 0.35 + m * 0.4);
    const L = 0.35 + m * 1.2;
    // punch: a transient crack and a sub thump that drops in pitch (heavier spells hit harder and lower)
    const heavy = this.mod ? 0.5 + this.mod.grit : 1;
    this.noise(o, { f: 'highpass', f0: 2200, dur: 0.035, a: 0.001, gain: 0.9 + m * 0.6 });
    this.tone(o, { f0: 150, f1: 38, dur: 0.22 + m * 0.35, a: 0.002, gain: (0.7 + m * 0.8) * heavy });
    // universal body
    this.noise(o, { type: 'brown', f0: 1200 + m * 1500, f1: 60, dur: L, gain: 0.9 + m });
    this.tone(o, { f0: 110 - m * 40, f1: 28, dur: L * 0.8, gain: 0.5 + m * 0.5 });
    if (m > 0.95) {
      this.noise(o, { type: 'brown', f0: 220, f1: 35, dur: 2.2 + m, a: 0.06, gain: 0.7 * m });
      for (let i = 0; i < 8; i++) this.noise(o, { f: 'bandpass', f0: rand(900, 2600), Q: 2, dur: rand(0.03, 0.07), a: 0.001, gain: rand(0.15, 0.3), delay: rand(0.4, 1.8) });
    }
    switch (el) {
      case 'fire':
        this.noise(o, { type: 'pink', f0: 4000, f1: 300, dur: L, gain: 0.8 });
        for (let i = 0; i < 12 + m * 20; i++) this.noise(o, { f: 'highpass', f0: 2000, dur: 0.015, gain: rand(0.1, 0.3), delay: rand(0.05, L * 1.5) });
        break;
      case 'ice':
        // Short ice grains overlap heavily; cap voices during large impacts.
        for (let i = 0; i < Math.min(12, 6 + Math.round(m * 5)); i++) {
          this.noise(o, { f: 'highpass', f0: rand(3000, 7000), dur: rand(0.02, 0.08), gain: rand(0.15, 0.4), delay: rand(0, 0.3) });
          this.tone(o, { f0: rand(2000, 5000), dur: 0.2, gain: 0.04, delay: rand(0, 0.4) });
        }
        break;
      case 'water':
        this.noise(o, { type: 'pink', f0: 2500, f1: 500, dur: L, a: 0.01, gain: 1.0 });
        for (let i = 0; i < 10; i++) this.tone(o, { f0: rand(200, 500), f1: rand(700, 1400), dur: 0.06, gain: 0.1, delay: rand(0.05, 0.6) });
        break;
      case 'lightning': {
        this.noise(o, { f: 'highpass', f0: 1500, dur: 0.08, a: 0.001, gain: 1.4 });
        this.noise(o, { type: 'brown', f0: 500, f1: 50, dur: 1.5 + m * 1.5, a: 0.05, gain: 1.2, delay: 0.05 });
        const d = this.distort(o, 0.4);
        this.tone(d, { type: 'sawtooth', f0: 800, f1: 40, dur: 0.3, gain: 0.4 });
        break;
      }
      case 'wind':
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 2000, f1: 300, Q: 3, dur: L, gain: 1.2 });
        break;
      case 'earth':
        this.noise(o, { type: 'brown', f0: 200, f1: 40, dur: L * 1.5, gain: 1.4 });
        for (let i = 0; i < 10; i++) this.noise(o, { f0: rand(500, 1500), dur: 0.05, gain: 0.4, delay: rand(0, 0.8) });
        break;
      case 'darkness':
        this.tone(o, { type: 'sawtooth', f0: 80, f1: 30, dur: L * 1.3, gain: 0.25 });
        this.noise(o, { f: 'bandpass', f0: 200, f1: 1500, Q: 5, dur: 0.4, gain: 0.8 });
        break;
      case 'light':
        for (const r of [1, 1.5, 2, 2.5]) this.tone(o, { f0: 523 * r, dur: 1 + m, gain: 0.08 });
        this.noise(o, { f: 'highpass', f0: 5000, dur: 0.5, gain: 0.4 });
        break;
      case 'nature':
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 1800, Q: 1, dur: L, gain: 0.7 });
        this.tone(o, { type: 'triangle', f0: 180, f1: 90, dur: 0.3, gain: 0.3 });
        break;
      case 'poison':
        this.noise(o, { type: 'pink', f0: 1400, f1: 200, dur: L, gain: 0.9 });
        for (let i = 0; i < 12; i++) this.tone(o, { f0: rand(120, 300), f1: rand(300, 700), dur: 0.08, gain: 0.12, delay: rand(0.05, 0.8) });
        break;
      default:
        this.tone(o, { f0: 1600, f1: 200, dur: 0.5, gain: 0.25 });
        for (let i = 0; i < 6; i++) this.tone(o, { f0: pick([784, 988, 1175, 1568]), dur: 0.3, gain: 0.06, delay: i * 0.04 });
    }
  }

  reaction(color = 'fire', pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.7, 0.5);
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 0.5, gain: 0.12, delay: i * 0.05 }));
    this.noise(o, { f: 'highpass', f0: 4000, dur: 0.3, gain: 0.3 });
  }
  // hit confirm: a crisp two-partial tick with a tiny body thump, pitched up a little on rapid repeats
  hitmarker() {
    if (!this.enabled) return;
    const now = performance.now(), fast = now - (this._hmT || 0) < 250; this._hmT = now; this._hmN = fast ? Math.min(6, (this._hmN || 0) + 1) : 0;
    const o = this.out(null, 1.1, 0), k = 1 + this._hmN * 0.04;
    this.tone(o, { type: 'triangle', f0: 2100 * k, f1: 1500 * k, dur: 0.045, a: 0.001, gain: 0.22 });
    this.tone(o, { f0: 3150 * k, dur: 0.03, a: 0.001, gain: 0.08 });
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 900, Q: 1.5, dur: 0.04, a: 0.001, gain: 0.3 });
  }
  // taking damage: a muffled body blow with a short ringing ear-tone for heavy hits
  hurt(heavy = 0) {
    if (!this.enabled) return;
    const o = this.out(null, 0.6, 0.1);
    this.noise(o, { type: 'brown', f0: 600, f1: 80, dur: 0.25, gain: 1.2 });
    this.tone(o, { f0: 90, f1: 50, dur: 0.2, gain: 0.5 });
    this.noise(o, { type: 'pink', f: 'lowpass', f0: 1400, f1: 300, dur: 0.18, a: 0.002, gain: 0.5 });
    if (heavy > 0.5) this.tone(o, { f0: 3800, dur: 0.9, a: 0.02, gain: 0.025 * heavy });
  }
  ui(kind = 'click') {
    if (!this.enabled) return;
    const o = this.out(null, 0.4, 0.2);
    if (kind === 'click') this.tone(o, { type: 'triangle', f0: 880, f1: 1320, dur: 0.08, gain: 0.2 });
    else if (kind === 'fizzle') { this.tone(o, { f0: 400, f1: 120, dur: 0.3, gain: 0.2 }); this.noise(o, { f0: 1200, f1: 200, dur: 0.3, gain: 0.3 }); }
    else if (kind === 'victory') { // a short brass fanfare: pickup triplet, held tonic chord, bell sparkle and a timpani roll
      const brass = (f, d, dur, g = 0.1) => { const w = this.distort(o, 0.35); for (const dt of [-6, 6]) this.tone(w, { type: 'sawtooth', f0: f, dur, a: 0.03, gain: g, delay: d, detune: dt }); };
      [[392, 0, 0.14], [392, 0.15, 0.14], [392, 0.3, 0.14], [523, 0.45, 1.5], [659, 0.45, 1.5], [784, 0.45, 1.5]].forEach(([f, d, dur]) => brass(f, d, dur));
      [1568, 2093, 2637].forEach((f, i) => this.tone(o, { f0: f, dur: 1.2, a: 0.002, gain: 0.05, delay: 0.5 + i * 0.07 }));
      for (let i = 0; i < 10; i++) this.tone(o, { f0: 98, f1: 80, dur: 0.18, a: 0.002, gain: 0.25 * (i / 10), delay: 0.45 + i * 0.03 });
    } else if (kind === 'defeat') { // falling minor line over a low drum, fading into the storm
      [392, 349, 311, 262].forEach((f, i) => { this.tone(o, { type: 'triangle', f0: f, dur: 1.2, gain: 0.14, delay: i * 0.28 }); this.tone(o, { f0: f / 2, dur: 1.2, gain: 0.08, delay: i * 0.28 }); });
      this.tone(o, { f0: 65, f1: 40, dur: 1.4, a: 0.004, gain: 0.5, delay: 1.1 });
      this.noise(o, { type: 'brown', f0: 300, f1: 60, dur: 2.2, a: 0.3, gain: 0.5, delay: 0.9 });
    }
    else if (kind === 'weave') for (let i = 0; i < 4; i++) this.tone(o, { f0: 600 + i * 150, dur: 0.15, gain: 0.06, delay: i * 0.05 });
    else if (kind === 'hover') this.tone(o, { type: 'sine', f0: 1320, f1: 1480, dur: 0.05, a: 0.002, gain: 0.06 });
  }
  footstep(stone = false, sprint = false, wet = false) {
    if (!this.enabled) return;
    const o = this.out(null, sprint ? 0.16 : 0.12, 0.02);
    if (wet) { // wading through the shallows: a slosh and a few droplets
      this.noise(o, { type: 'pink', f: 'bandpass', f0: rand(700, 1100), f1: 400, Q: 1.2, dur: 0.18, a: 0.01, gain: 1.4 });
      for (let i = 0; i < 3; i++) this.tone(o, { f0: rand(500, 900), f1: rand(1200, 1800), dur: 0.05, gain: 0.25, delay: rand(0.03, 0.15) });
      return;
    }
    this.noise(o, { type: 'brown', f0: rand(500, 800), dur: 0.08, gain: 0.8 });
    if (stone) this.noise(o, { f: 'bandpass', f0: rand(2500, 3800), Q: 3, dur: 0.025, a: 0.001, gain: 0.35 });
    else this.noise(o, { type: 'pink', f: 'highpass', f0: rand(3000, 5000), dur: 0.09, a: 0.01, gain: 0.3 });
  }
  whoosh(m = 0.5) { if (!this.enabled) return; const o = this.out(null, 0.4, 0.1); this.noise(o, { type: 'pink', f: 'bandpass', f0: 500, f1: 2500, Q: 2, dur: 0.25 + m * 0.2, a: 0.03, gain: 1.2 }); }

  // ---------------------------------------------------------------- form-specific sweeteners (new forms, items, storm)
  // left-click mana bolt: a short tuned "pew" whose pitch and grit follow the element
  bolt(el = 'arcane') {
    if (!this.enabled) return;
    const o = this.out(null, 0.9, 0.12), f = BASE[el] || 294;
    this.tone(o, { type: el === 'lightning' ? 'sawtooth' : 'triangle', f0: f * 4, f1: f * 1.5, dur: 0.12, a: 0.002, gain: 0.35 });
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 1800, f1: 600, Q: 2, dur: 0.1, a: 0.002, gain: 0.5 });
    if (el === 'fire' || el === 'earth') this.noise(o, { type: 'brown', f0: 600, f1: 120, dur: 0.12, gain: 0.5 });
  }
  // whip crack: a supersonic snap (broadband click + ringing high partial) with a slap off the terrain
  crack(m = 0.5, pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.9 + m * 0.3, 0.45);
    this.noise(o, { f: 'highpass', f0: 1800, dur: 0.018, a: 0.0005, gain: 1.6 });
    this.noise(o, { f: 'bandpass', f0: 4200, Q: 3, dur: 0.06, a: 0.001, gain: 0.8 });
    this.tone(o, { type: 'square', f0: 2600, f1: 1200, dur: 0.05, a: 0.001, gain: 0.12 });
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 900, Q: 1, dur: 0.12, a: 0.001, gain: 0.5, delay: 0.07 }); // slap-back
  }
  // beast roar: a growling sawtooth through vocal formants, pitch sagging, with breath noise
  roar(el = 'arcane', m = 0.5, pos = null) {
    if (!this.enabled) return;
    const ctx = this.ctx, o = this.out(pos, 0.7 + m * 0.4, 0.55), t = ctx.currentTime, L = 1.1 + m * 0.6;
    const f0 = el === 'light' || el === 'ice' ? 150 : el === 'earth' || el === 'darkness' ? 62 : 95;
    for (const [ff, q, gg] of [[480, 6, 0.9], [1050, 8, 0.5], [2400, 10, 0.25]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gg; bp.connect(g); g.connect(o); bp._output = o; o._nodes.push(bp, g);
      const d = this.distort(bp, 0.9);
      const osc = this.tone(d, { type: 'sawtooth', f0: f0 * 1.3, f1: f0 * 0.7, dur: L, a: 0.08, gain: 0.5, curve: 'lin' });
      if (osc) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 28; lg.gain.value = f0 * 0.12; lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + L + 0.1); lfo.onended = () => { lfo.disconnect(); lg.disconnect(); }; }
      this.noise(bp, { type: 'pink', dur: L, a: 0.1, gain: 0.5, f: 'lowpass', f0: 3000 });
    }
    this.tone(o, { f0: 55, f1: 32, dur: L, a: 0.05, gain: 0.5 });
  }
  // mark heartbeat: a hollow tick that climbs in pitch as the rune nears detonation
  tick(pos = null, n = 0) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.6, 0.35), f = 700 * Math.pow(1.12, n);
    this.tone(o, { type: 'triangle', f0: f, dur: 0.12, a: 0.001, gain: 0.35 });
    this.tone(o, { f0: f * 2.01, dur: 0.08, a: 0.001, gain: 0.12 });
    this.tone(o, { f0: 90, f1: 50, dur: 0.14, a: 0.001, gain: 0.45 });
  }
  runeBurst(pos = null, m = 0.5) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.7 + m * 0.3, 0.6);
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 300, f1: 5000, Q: 2, dur: 0.18, a: 0.16, gain: 0.8 }); // inhale
    [1, 1.5, 2, 3].forEach((r, i) => this.tone(o, { type: 'triangle', f0: 220 * r, dur: 1.2, a: 0.01, gain: 0.1, delay: 0.17 + i * 0.015 }));
  }
  // decoys / halo: glassy chimes that spread out in time
  shimmer(pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.45, 0.7);
    [1318, 1568, 1976, 2637, 2093].forEach((f, i) => this.tone(o, { f0: f, dur: 0.7, a: 0.004, gain: 0.07, delay: i * 0.045, detune: i % 2 ? 8 : -8 }));
    this.noise(o, { f: 'highpass', f0: 5000, f1: 9000, dur: 0.5, a: 0.1, gain: 0.25 });
  }
  // a blade parrying a shot: inharmonic metal partials
  clang(pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.6, 0.4);
    for (const [r, g] of [[1, 0.25], [2.76, 0.16], [5.4, 0.1], [8.93, 0.06]]) this.tone(o, { f0: 620 * r, dur: 0.5 / Math.sqrt(r), a: 0.001, gain: g });
    this.noise(o, { f: 'highpass', f0: 3000, dur: 0.03, a: 0.001, gain: 0.6 });
  }
  // the sword's plunge: a falling whistle that tightens toward impact
  swordFall(pos = null, m = 0.5) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.7, 0.4);
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 500, f1: 3800, Q: 7, dur: 0.45, a: 0.3, gain: 1.3 });
    this.tone(o, { f0: 400, f1: 1800, dur: 0.42, a: 0.3, gain: 0.08 });
  }
  shatter(pos = null, m = 0.5) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.6 + m * 0.3, 0.5);
    for (let i = 0; i < 14; i++) { this.noise(o, { f: 'highpass', f0: rand(3000, 8000), dur: rand(0.02, 0.07), a: 0.001, gain: rand(0.2, 0.5), delay: rand(0, 0.25) }); this.tone(o, { f0: rand(2200, 5200), dur: rand(0.1, 0.3), a: 0.001, gain: 0.04, delay: rand(0, 0.3) }); }
    this.noise(o, { type: 'brown', f0: 800, f1: 150, dur: 0.4, gain: 0.5 });
  }
  // rush: a sonic boom with a downward sweep
  rushBoom(pos = null, m = 0.5) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.8, 0.35);
    this.noise(o, { type: 'pink', f: 'lowpass', f0: 5000, f1: 200, dur: 0.6, a: 0.01, gain: 1.3 });
    this.tone(o, { f0: 120, f1: 35, dur: 0.5, a: 0.005, gain: 0.8 });
    this.noise(o, { f: 'highpass', f0: 2500, dur: 0.03, a: 0.001, gain: 0.8 });
  }
  // something big flying past your head: a band of wind sweeping from high to low (a poor man's doppler)
  passby(pos = null, m = 0.5) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.8 + m * 0.4, 0.25);
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 2600, f1: 500, Q: 2.5, dur: 0.55, a: 0.12, gain: 1.4 });
    this.noise(o, { type: 'brown', f0: 500, f1: 120, dur: 0.6, a: 0.1, gain: 0.8 });
  }
  // totem shot
  zap(el = 'arcane', pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.45, 0.3), f = (BASE[el] || 294) * 3;
    this.tone(o, { type: el === 'lightning' ? 'sawtooth' : 'triangle', f0: f * 1.8, f1: f * 0.6, dur: 0.14, a: 0.001, gain: 0.3 });
    this.noise(o, { f: 'bandpass', f0: 2500, f1: 800, Q: 3, dur: 0.1, gain: 0.4 });
  }
  // loot: element cores ring bright, relics hum a deeper chord, potions pop their cork
  pickup(type = 'core') {
    if (!this.enabled) return;
    const o = this.out(null, 0.45, 0.35);
    if (type === 'potion') { this.tone(o, { f0: 900, f1: 300, dur: 0.06, a: 0.001, gain: 0.4 }); this.noise(o, { f: 'bandpass', f0: 1500, Q: 2, dur: 0.05, gain: 0.5 }); [523, 784].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 0.25, gain: 0.1, delay: 0.06 + i * 0.07 })); }
    else if (type === 'relic') { [196, 247, 294, 392].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 1.0, a: 0.02, gain: 0.1, delay: i * 0.05 })); this.shimmer(null); }
    else [659, 784, 988, 1319].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 0.35, a: 0.003, gain: 0.13, delay: i * 0.055 }));
  }
  drink(id = 'hp', pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.5, 0.2);
    for (let i = 0; i < 3; i++) { this.tone(o, { f0: rand(180, 260), f1: rand(420, 600), dur: 0.09, a: 0.004, gain: 0.3, delay: i * 0.16 }); this.noise(o, { type: 'pink', f: 'lowpass', f0: 700, dur: 0.1, gain: 0.35, delay: i * 0.16 }); }
    const chord = id === 'hp' ? [523, 659, 784] : id === 'mana' ? [587, 740, 880] : [440, 554, 659];
    chord.forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 0.6, a: 0.02, gain: 0.08, delay: 0.5 + i * 0.05 }));
  }
  // the storm advances: a low horn over rolling thunder
  stormWarn() {
    if (!this.enabled) return;
    const o = this.out(null, 0.55, 0.8);
    for (const d of [-12, 0, 7]) this.tone(o, { type: 'sawtooth', f0: 73.4, dur: 2.2, a: 0.4, gain: 0.07, detune: d * 5 });
    this.noise(o, { type: 'brown', f0: 400, f1: 60, dur: 2.5, a: 0.3, gain: 1.1 });
  }
  // landing thud + scuff (surface aware)
  land(v = 0.5, stone = false) {
    if (!this.enabled) return;
    const o = this.out(null, 0.2 + v * 0.3, 0.05);
    this.tone(o, { f0: 110, f1: 45, dur: 0.15, a: 0.002, gain: 0.6 });
    this.noise(o, { type: stone ? 'white' : 'pink', f: stone ? 'bandpass' : 'lowpass', f0: stone ? 2200 : 900, Q: 1, dur: 0.12, gain: 0.7 });
  }
  heartbeat() {
    if (!this.enabled) return;
    const o = this.out(null, 0.5, 0);
    this.tone(o, { f0: 62, f1: 40, dur: 0.14, a: 0.004, gain: 0.8 }); this.tone(o, { f0: 58, f1: 38, dur: 0.12, a: 0.004, gain: 0.55, delay: 0.2 });
  }
  shieldHit(pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 1.1, 0.4);
    this.tone(o, { type: 'triangle', f0: 1760, f1: 1320, dur: 0.25, a: 0.001, gain: 0.18 }); this.tone(o, { f0: 2640, dur: 0.15, a: 0.001, gain: 0.07 });
  }
  // kill streak fanfare: brass-like stacked fifths, climbing with the streak
  streak(n = 2) {
    if (!this.enabled) return;
    const o = this.out(null, 0.6, 0.6), root = 196 * Math.pow(2, Math.min(4, n - 2) / 6);
    [1, 1.5, 2, 2.5].forEach((r, i) => { const d = this.distort(o, 0.25); this.tone(d, { type: 'sawtooth', f0: root * r, dur: 0.9, a: 0.03, gain: 0.08, delay: i * 0.06 }); });
    this.noise(o, { f: 'highpass', f0: 5000, dur: 0.6, a: 0.05, gain: 0.25 });
  }
  elimination(pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.7, 0.7);
    [784, 587, 440, 294].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 0.5, a: 0.005, gain: 0.12, delay: i * 0.07 }));
    this.noise(o, { type: 'pink', f: 'bandpass', f0: 3000, f1: 300, Q: 2, dur: 0.8, a: 0.02, gain: 0.7 });
  }

  // ---------------------------------------------------------------- looping sounds (beams, tornados, orbs in flight)
  // Sustained spell sound. opts.spin (0..1) adds a swept resonant howl (vortices), the look adds rumble, brightness
  // and crackle grains, so a tornado roars and whistles while a lava field grumbles and pops.
  loop(el, pos, gain = 0.5, look = null, opts = {}) {
    if (!this.enabled || this.loopCount >= 12) return { set() {}, stop() {} };
    this.loopCount++;
    const ctx = this.ctx, o = this.out(pos, 0, 0.3, true), G = look?.g;
    const bright = G ? 0.55 + G.temperature * 0.5 + G.luminosity * 0.45 : 1, pitch = G ? 1.35 - G.weight * 0.7 : 1;
    const src = ctx.createBufferSource(); src.buffer = el === 'earth' || el === 'darkness' ? this.brown : this.pink; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 1.2;
    const fc = ({ fire: 900, ice: 4000, water: 1200, lightning: 2500, wind: 1500, earth: 300, darkness: 400, light: 3000, nature: 1600, arcane: 2000 }[el] || 1200) * bright;
    fl.frequency.value = fc;
    src.connect(fl); fl.connect(o); src.start();
    // slow filter sweep so the bed breathes (faster for spinning spells)
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.25 + (opts.spin || 0) * 1.4; lg.gain.value = fc * 0.45;
    lfo.connect(lg); lg.connect(fl.frequency); lfo.start();
    const osc = ctx.createOscillator(); osc.type = el === 'lightning' ? 'sawtooth' : 'sine'; osc.frequency.value = (BASE[el] || 200) * pitch;
    const og = ctx.createGain(); og.gain.value = el === 'lightning' ? 0.05 : 0.12; osc.connect(og); og.connect(o); osc.start();
    const extra = [lfo, osc];
    o._nodes.push(src, fl, lfo, lg, osc, og);
    if (opts.spin) { // vortex howl: two resonant bands sweeping against each other
      for (const [f0, rate] of [[650, 0.7], [1500, 1.13]]) {
        const s2 = ctx.createBufferSource(); s2.buffer = this.pink; s2.loop = true;
        const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = 9; b.frequency.value = f0 * bright;
        const l2 = ctx.createOscillator(), g2 = ctx.createGain(); l2.frequency.value = rate * (0.6 + opts.spin); g2.gain.value = f0 * 0.5; l2.connect(g2); g2.connect(b.frequency);
        const vg = ctx.createGain(); vg.gain.value = 0.9 * opts.spin;
        s2.connect(b); b.connect(vg); vg.connect(o); s2.start(); l2.start(); extra.push(s2, l2); o._nodes.push(s2, b, l2, g2, vg);
      }
    }
    if (G && G.density > 0.55) { // rumble for heavy matter
      const r = ctx.createBufferSource(); r.buffer = this.brown; r.loop = true; const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 140 * pitch;
      const rg = ctx.createGain(); rg.gain.value = (G.density - 0.4) * 1.6; r.connect(rl); rl.connect(rg); rg.connect(o); r.start(); extra.push(r); o._nodes.push(r, rl, rg);
    }
    // crackle grains: fire pops, electric snaps, grinding stone
    const crackle = G ? Math.max(0, (G.temperature - 0.55) * 2) + (el === 'lightning' ? 1 : 0) + (el === 'earth' ? 0.5 : 0) : 0;
    let timer = null, stopped = false;
    src.onended = () => { this.loopCount--; o._dispose(); };
    if (crackle > 0.2) timer = setInterval(() => { if (Math.random() < crackle * 0.35) this.noise(o, { f: 'highpass', f0: el === 'earth' ? 700 : 2400, dur: rand(0.01, 0.04), a: 0.001, gain: rand(0.2, 0.6) * Math.min(1.5, crackle) }); }, 45);
    o.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
    return {
      set: (p, g) => {
        if (stopped) return;
        const pn = o._panner;
        if (pn && p) { const t = ctx.currentTime; if (pn.positionX) { pn.positionX.setTargetAtTime(p.x, t, 0.03); pn.positionY.setTargetAtTime(p.y, t, 0.03); pn.positionZ.setTargetAtTime(p.z, t, 0.03); } else pn.setPosition(p.x, p.y, p.z); }
        if (g !== undefined) o.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
      },
      stop: () => { if (stopped) return; stopped = true; const t = ctx.currentTime; clearInterval(timer); o.gain.setTargetAtTime(0, t, 0.08); src.stop(t + 0.5); for (const x of extra) x.stop(t + 0.5); },
    };
  }

  // ---------------------------------------------------------------- chant hum
  chantStart(el = 'arcane') {
    if (!this.enabled || this.chant) return;
    const ctx = this.ctx, o = this.out(null, 0, 0.6, true);
    const oscs = [0, 7, 12].map((semi, i) => {
      const osc = ctx.createOscillator(); osc.type = i ? 'triangle' : 'sine';
      osc.frequency.value = (BASE[el] || 200) * Math.pow(2, semi / 12);
      const g = ctx.createGain(); g.gain.value = i ? 0.05 : 0.12; osc.connect(g); g.connect(o); osc.start(); return osc;
    });
    const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 3000; fl.Q.value = 6;
    const ng = ctx.createGain(); ng.gain.value = 0.15;
    src.connect(fl); fl.connect(ng); ng.connect(o); src.start();
    // a distant choir: detuned saws through "ah" vowel formants with a slow vibrato, swelling as the chant grows
    const choirIn = ctx.createGain(); choirIn.gain.value = 0.0;
    for (const [f, q, g] of [[760, 7, 1], [1150, 9, 0.6], [2600, 12, 0.25]]) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const bg = ctx.createGain(); bg.gain.value = g; choirIn.connect(b); b.connect(bg); bg.connect(o); }
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.2; vg.gain.value = 4; vib.connect(vg); vib.start();
    const choir = [1, 1.5, 2].flatMap((r) => [-9, 9].map((dt) => { const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = (BASE[el] || 200) * r; osc.detune.value = dt; vg.connect(osc.detune); osc.connect(choirIn); osc.start(); osc.r = r; return osc; }));
    o.gain.setTargetAtTime(0.5, ctx.currentTime, 0.2);
    this.chant = { o, oscs, src, fl, el, choir, choirIn, vib };
  }
  chantUpdate(progress, el) {
    const c = this.chant; if (!c) return;
    const t = this.ctx.currentTime, base = BASE[el] || 200;
    c.oscs.forEach((osc, i) => osc.frequency.setTargetAtTime(base * Math.pow(2, ([0, 7, 12][i] + progress * 12) / 12), t, 0.3));
    c.fl.frequency.setTargetAtTime(2000 + progress * 6000, t, 0.2);
    c.choir.forEach((osc) => osc.frequency.setTargetAtTime(base * osc.r * Math.pow(2, (progress * 7) / 12), t, 0.4));
    c.choirIn.gain.setTargetAtTime(0.012 + progress * 0.05, t, 0.4);
    c.o.gain.setTargetAtTime(0.35 + progress * 0.5, t, 0.2);
  }
  chantStop() {
    const c = this.chant; if (!c) return; this.chant = null;
    const t = this.ctx.currentTime; c.o.gain.setTargetAtTime(0, t, 0.1);
    c.oscs.forEach((o) => o.stop(t + 0.6)); c.src.stop(t + 0.6); c.choir.forEach((o) => o.stop(t + 0.6)); c.vib.stop(t + 0.6);
  }

  // ---------------------------------------------------------------- ambience + background music
  startMusic() {
    if (!this.musicTrack) {
      this.musicTrack = new Audio('/audio/fantasy-spellcasting-boss-theme.mp3');
      this.musicTrack.loop = true;
      this.musicSource = this.ctx.createMediaElementSource(this.musicTrack);
      this.musicSource.connect(this.musicBus);
    }
    if (this.musicTrack.paused) {
      this.musicTrack.play().catch(error => console.warn('Background music could not start:', error));
    }
  }
  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.pink; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0.06;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg); lg.connect(fl.frequency); lfo.start();
    src.connect(fl); fl.connect(g); g.connect(this.master); src.start();
    // living meadow: songbird phrases from random directions and slow wind gusts through the grass
    this.amb = { on: true };
    setInterval(() => {
      if (!this.amb.on || ctx.state !== 'running') return;
      if (Math.random() < 0.22) this.bird();
      if (Math.random() < 0.12) this.gust();
    }, 1000);
  }
  ambience(on) { if (this.amb) this.amb.on = on; }
  bird() {
    const L = this.lp, pos = L ? { x: L.x + rand(-40, 40), y: L.y + rand(4, 12), z: L.z + rand(-40, 40) } : null;
    const o = this.out(pos, 0.05, 0.3), base = rand(2600, 4200), n = 2 + Math.floor(Math.random() * 5), kind = Math.random();
    for (let i = 0; i < n; i++) {
      const d = i * rand(0.09, 0.16);
      if (kind < 0.5) this.tone(o, { f0: base * rand(0.9, 1.1), f1: base * rand(1.2, 1.5), dur: rand(0.05, 0.09), a: 0.005, gain: 0.5, delay: d });
      else this.tone(o, { f0: base * 1.3, f1: base * 0.8, dur: rand(0.08, 0.14), a: 0.01, gain: 0.45, delay: d });
    }
  }
  gust() {
    const o = this.out(null, 0.05, 0.1);
    this.noise(o, { type: 'pink', f: 'bandpass', f0: rand(300, 500), f1: rand(700, 1300), Q: 0.8, dur: rand(2, 3.5), a: rand(0.8, 1.5), gain: 1.2 });
  }
}
export const audio = new AudioEngine();
