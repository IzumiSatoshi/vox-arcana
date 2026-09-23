// Fully procedural sound design (WebAudio). Every spell sound is synthesised from
// noise + oscillators, shaped by element and magnitude, spatialised with HRTF.
import { clamp, rand, pick } from './util.js';

const BASE = { poison: 147, fire: 110, ice: 440, water: 196, lightning: 82, wind: 262, earth: 55, darkness: 65, light: 330, nature: 220, arcane: 294 };

export class AudioEngine {
  constructor() { this.ctx = null; this.enabled = false; this.volume = 0.8; this.musicVolume = 0.35; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVolume; this.musicBus.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.9;
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.master);
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
  }
  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v; }

  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  // Output chain: input gain -> (panner) -> sfx + reverb send
  out(pos, gain = 1, rev = 0.3) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = gain;
    let tail = g;
    if (pos) {
      const pn = ctx.createPanner();
      pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = 5; pn.maxDistance = 400; pn.rolloffFactor = 0.9;
      if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z; } else pn.setPosition(pos.x, pos.y, pos.z);
      g.connect(pn); tail = pn; g._panner = pn;
    }
    tail.connect(this.sfx);
    if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; tail.connect(s); s.connect(this.reverbIn); }
    return g;
  }
  env(param, t, a, peak, d, sustain = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }
  noise(dest, { type = 'white', dur = 0.5, a = 0.005, gain = 0.5, f = 'lowpass', f0 = 2000, f1 = null, Q = 1, delay = 0, rate = 1 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this[type]; src.loop = true; src.playbackRate.value = rate;
    const fl = ctx.createBiquadFilter(); fl.type = f; fl.Q.value = Q; fl.frequency.setValueAtTime(f0, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); this.env(g.gain, t, a, gain, dur);
    src.connect(fl); fl.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + a + dur + 0.05);
    return fl;
  }
  tone(dest, { type = 'sine', f0 = 440, f1 = null, dur = 0.5, a = 0.005, gain = 0.3, delay = 0, detune = 0, curve = 'exp' } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f0, t);
    if (f1) curve === 'exp' ? o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur) : o.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); this.env(g.gain, t, a, gain, dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  distort(dest, amount = 1) {
    const ws = this.ctx.createWaveShaper(); ws.curve = this.shaperCurve; ws.oversample = '2x';
    const g = this.ctx.createGain(); g.gain.value = amount; g.connect(ws); ws.connect(dest); return g;
  }

  // ---------------------------------------------------------------- spell casts
  cast(el, m = 0.5, pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.55 + m * 0.4, 0.25 + m * 0.3);
    const L = 0.3 + m * 0.6;
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
        for (let i = 0; i < 4; i++) this.tone(o, { type: 'triangle', f0: pick([294, 330, 392, 440, 587]), dur: 0.35, gain: 0.15, delay: i * 0.06 });
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 2500, Q: 1.2, dur: L, a: 0.1, gain: 0.5 });
        break;
      case 'poison':
        for (let i = 0; i < 8; i++) this.tone(o, { f0: rand(150, 320), f1: rand(400, 900), dur: 0.09, gain: 0.14, delay: rand(0, 0.35) });
        this.noise(o, { type: 'pink', f: 'bandpass', f0: 600, f1: 250, Q: 3, dur: L, a: 0.08, gain: 0.9 });
        this.tone(o, { type: 'sawtooth', f0: 90, f1: 70, dur: L, gain: 0.08, detune: 30 });
        break;
      default: // arcane
        this.tone(o, { f0: 300, f1: 1200 + m * 1200, dur: L, gain: 0.2 });
        for (let i = 0; i < 6; i++) this.tone(o, { f0: pick([523, 659, 784, 988, 1175]), dur: 0.2, gain: 0.08, delay: i * 0.05 });
    }
    if (m > 0.8) { // big spells: sub drop + choir-ish swell
      this.tone(o, { f0: 90, f1: 30, dur: 1.4, gain: 0.8 });
      for (const r of [1, 1.5, 2]) this.tone(o, { type: 'triangle', f0: BASE[el] * r, dur: 1.6, a: 0.3, gain: 0.08 });
    }
  }

  impact(el, m = 0.5, pos = null) {
    if (!this.enabled) return;
    const o = this.out(pos, 0.6 + m * 0.6, 0.35 + m * 0.4);
    const L = 0.35 + m * 1.2;
    // universal body
    this.noise(o, { type: 'brown', f0: 1200 + m * 1500, f1: 60, dur: L, gain: 0.9 + m });
    this.tone(o, { f0: 110 - m * 40, f1: 28, dur: L * 0.8, gain: 0.5 + m * 0.5 });
    switch (el) {
      case 'fire':
        this.noise(o, { type: 'pink', f0: 4000, f1: 300, dur: L, gain: 0.8 });
        for (let i = 0; i < 12 + m * 20; i++) this.noise(o, { f: 'highpass', f0: 2000, dur: 0.015, gain: rand(0.1, 0.3), delay: rand(0.05, L * 1.5) });
        break;
      case 'ice':
        for (let i = 0; i < 14 + m * 12; i++) {
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
  hitmarker() { if (!this.enabled) return; const o = this.out(null, 0.35, 0); this.tone(o, { type: 'square', f0: 1800, f1: 1400, dur: 0.05, gain: 0.2 }); }
  hurt() { if (!this.enabled) return; const o = this.out(null, 0.6, 0.1); this.noise(o, { type: 'brown', f0: 600, f1: 80, dur: 0.25, gain: 1.2 }); this.tone(o, { f0: 90, f1: 50, dur: 0.2, gain: 0.5 }); }
  ui(kind = 'click') {
    if (!this.enabled) return;
    const o = this.out(null, 0.4, 0.2);
    if (kind === 'click') this.tone(o, { type: 'triangle', f0: 880, f1: 1320, dur: 0.08, gain: 0.2 });
    else if (kind === 'fizzle') { this.tone(o, { f0: 400, f1: 120, dur: 0.3, gain: 0.2 }); this.noise(o, { f0: 1200, f1: 200, dur: 0.3, gain: 0.3 }); }
    else if (kind === 'victory') [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, dur: 1.2, gain: 0.15, delay: i * 0.12 }));
    else if (kind === 'defeat') [392, 349, 311, 262].forEach((f, i) => this.tone(o, { type: 'sine', f0: f, dur: 1.2, gain: 0.18, delay: i * 0.25 }));
    else if (kind === 'weave') for (let i = 0; i < 4; i++) this.tone(o, { f0: 600 + i * 150, dur: 0.15, gain: 0.06, delay: i * 0.05 });
  }
  footstep() { if (!this.enabled) return; const o = this.out(null, 0.12, 0); this.noise(o, { type: 'brown', f0: rand(500, 800), dur: 0.08, gain: 0.8 }); }
  whoosh(m = 0.5) { if (!this.enabled) return; const o = this.out(null, 0.4, 0.1); this.noise(o, { type: 'pink', f: 'bandpass', f0: 500, f1: 2500, Q: 2, dur: 0.25 + m * 0.2, a: 0.03, gain: 1.2 }); }

  // ---------------------------------------------------------------- looping sounds (beams, tornados, orbs in flight)
  loop(el, pos, gain = 0.5) {
    if (!this.enabled) return { set() {}, stop() {} };
    const ctx = this.ctx, o = this.out(pos, 0, 0.3);
    const src = ctx.createBufferSource(); src.buffer = el === 'earth' || el === 'darkness' ? this.brown : this.pink; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 1.2;
    fl.frequency.value = { fire: 900, ice: 4000, water: 1200, lightning: 2500, wind: 1500, earth: 300, darkness: 400, light: 3000, nature: 1600, arcane: 2000 }[el] || 1200;
    src.connect(fl); fl.connect(o); src.start();
    const osc = ctx.createOscillator(); osc.type = el === 'lightning' ? 'sawtooth' : 'sine'; osc.frequency.value = BASE[el] || 200;
    const og = ctx.createGain(); og.gain.value = el === 'lightning' ? 0.05 : 0.12; osc.connect(og); og.connect(o); osc.start();
    o.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
    return {
      set: (p, g) => {
        const pn = o._panner;
        if (pn && p) { const t = ctx.currentTime; if (pn.positionX) { pn.positionX.setTargetAtTime(p.x, t, 0.03); pn.positionY.setTargetAtTime(p.y, t, 0.03); pn.positionZ.setTargetAtTime(p.z, t, 0.03); } else pn.setPosition(p.x, p.y, p.z); }
        if (g !== undefined) o.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
      },
      stop: () => { const t = ctx.currentTime; o.gain.setTargetAtTime(0, t, 0.08); src.stop(t + 0.5); osc.stop(t + 0.5); },
    };
  }

  // ---------------------------------------------------------------- chant hum
  chantStart(el = 'arcane') {
    if (!this.enabled || this.chant) return;
    const ctx = this.ctx, o = this.out(null, 0, 0.6);
    const oscs = [0, 7, 12].map((semi, i) => {
      const osc = ctx.createOscillator(); osc.type = i ? 'triangle' : 'sine';
      osc.frequency.value = (BASE[el] || 200) * Math.pow(2, semi / 12);
      const g = ctx.createGain(); g.gain.value = i ? 0.05 : 0.12; osc.connect(g); g.connect(o); osc.start(); return osc;
    });
    const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 3000; fl.Q.value = 6;
    const ng = ctx.createGain(); ng.gain.value = 0.15;
    src.connect(fl); fl.connect(ng); ng.connect(o); src.start();
    o.gain.setTargetAtTime(0.5, ctx.currentTime, 0.2);
    this.chant = { o, oscs, src, fl, el };
  }
  chantUpdate(progress, el) {
    const c = this.chant; if (!c) return;
    const t = this.ctx.currentTime, base = BASE[el] || 200;
    c.oscs.forEach((osc, i) => osc.frequency.setTargetAtTime(base * Math.pow(2, ([0, 7, 12][i] + progress * 12) / 12), t, 0.3));
    c.fl.frequency.setTargetAtTime(2000 + progress * 6000, t, 0.2);
    c.o.gain.setTargetAtTime(0.35 + progress * 0.5, t, 0.2);
  }
  chantStop() {
    const c = this.chant; if (!c) return; this.chant = null;
    const t = this.ctx.currentTime; c.o.gain.setTargetAtTime(0, t, 0.1);
    c.oscs.forEach((o) => o.stop(t + 0.6)); c.src.stop(t + 0.6);
  }

  // ---------------------------------------------------------------- ambience + generative music
  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.pink; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0.06;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg); lg.connect(fl.frequency); lfo.start();
    src.connect(fl); fl.connect(g); g.connect(this.master); src.start();
    // generative pentatonic music (gentle, Genshin-ish open-field vibe)
    const chords = [[57, 64, 69, 72], [53, 60, 65, 69], [55, 62, 67, 71], [52, 59, 64, 67]];
    const scale = [69, 71, 74, 76, 79, 81, 83, 86];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let bar = 0;
    const padOut = ctx.createBiquadFilter(); padOut.type = 'lowpass'; padOut.frequency.value = 1400; padOut.connect(this.musicBus);
    const rs = ctx.createGain(); rs.gain.value = 0.7; padOut.connect(rs); rs.connect(this.reverbIn);
    const tick = () => {
      if (!this.enabled) return;
      const ch = chords[bar % chords.length];
      const t = ctx.currentTime;
      ch.forEach((n) => {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n - 12); o.detune.value = det;
          const gg = ctx.createGain(); gg.gain.setValueAtTime(0.0001, t); gg.gain.linearRampToValueAtTime(0.018, t + 1.5); gg.gain.linearRampToValueAtTime(0.0001, t + 6.6);
          o.connect(gg); gg.connect(padOut); o.start(t); o.stop(t + 6.8);
        }
      });
      const bass = ctx.createOscillator(); bass.frequency.value = mtof(ch[0] - 24);
      const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.06, t + 0.3); bg.gain.exponentialRampToValueAtTime(0.0001, t + 5);
      bass.connect(bg); bg.connect(this.musicBus); bass.start(t); bass.stop(t + 5.2);
      for (let i = 0; i < 8; i++) {
        if (Math.random() < 0.45) continue;
        const f = mtof(pick(scale) + (Math.random() < 0.2 ? 12 : 0));
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const gg = ctx.createGain(); const st = t + i * 0.75 + rand(0, 0.05);
        gg.gain.setValueAtTime(0.0001, st); gg.gain.linearRampToValueAtTime(0.05, st + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, st + 1.6);
        o.connect(gg); gg.connect(padOut); o.start(st); o.stop(st + 1.7);
      }
      bar++;
      setTimeout(tick, 6000);
    };
    tick();
  }
}
export const audio = new AudioEngine();
