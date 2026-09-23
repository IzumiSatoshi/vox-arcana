// Web Speech API wrapper. Recognition runs continuously and is never stopped between chants,
// so there is no restart gap. A "chant window" (hold key) collects the text spoken while it is open;
// releasing returns the transcript immediately (instant cast).
import { clamp } from './util.js';

export class Voice {
  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.SR = SR; this.supported = !!SR;
    this.lang = 'en-US'; this.segs = []; this.base = 0; this.running = false; this.want = false;
    this.win = null; // { seg, offset }
    this.error = null; this.level = 0; this.peak = 0; this.handsFree = false;
    this.onAuto = null; this.onStatus = null; this.lastResultAt = 0; this.version = 0;
  }
  async init(audioCtx) {
    if (!this.supported) { this.error = 'unsupported'; this.onStatus?.('unsupported'); return false; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (audioCtx) {
        const src = audioCtx.createMediaStreamSource(this.stream);
        this.analyser = audioCtx.createAnalyser(); this.analyser.fftSize = 1024; src.connect(this.analyser);
        this.buf = new Float32Array(this.analyser.fftSize);
      }
    } catch { this.error = 'mic-denied'; this.onStatus?.('mic-denied'); return false; }
    this.rec = new this.SR();
    this.rec.continuous = true; this.rec.interimResults = true; this.rec.maxAlternatives = 1; this.rec.lang = this.lang;
    this.rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const seg = (this.segs[this.base + i] ||= { text: '', final: false, t0: performance.now() });
        seg.text = r[0].transcript.trim(); if (r.isFinal && !seg.final) seg.tf = performance.now(); seg.final = r.isFinal;
        if (r.isFinal && this.handsFree && !this.win && seg.text) this.onAuto?.(seg.text);
      }
      this.lastResultAt = performance.now(); this.version++;
    };
    this.rec.onstart = () => { this.running = true; this.onStatus?.('listening'); };
    this.rec.onend = () => {
      this.running = false;
      for (const s of this.segs) s.final = true;
      this.base = this.segs.length;
      if (this.want) this.start(); else this.onStatus?.('idle'); // restart at once so the next press is heard
    };
    this.rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.error = e.error; this.onStatus?.('error:' + e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.want = false;
    };
    this.want = true; this.start();
    return true;
  }
  setLang(l) { this.lang = l; if (this.rec) { this.rec.lang = l; if (this.running) this.rec.stop(); } }
  start() {
    if (!this.rec || this.running) return;
    try { this.rec.start(); } catch { setTimeout(() => { try { if (!this.running) this.rec.start(); } catch { /* busy */ } }, 30); }
  }

  // Anything already recognised (even in an unfinished utterance) belongs to the past, not this chant.
  beginChant() {
    const n = this.segs.length, last = this.segs[n - 1], now = performance.now();
    // pre-roll: an utterance that began just before the press is part of this chant
    if (last && !last.final) this.win = { seg: n - 1, offset: last.consumed ?? (now - last.t0 < 1200 ? 0 : last.text.length) };
    else this.win = { seg: n, offset: 0 };
    this.peak = 0; this.chantT0 = performance.now();
    if (!this.running) this.start();
  }
  textOf(win) {
    if (!win) return '';
    return this.segs.slice(win.seg).map((s, i) => (i === 0 ? s.text.slice(win.offset) : s.text).trim()).filter(Boolean).join(' ');
  }
  chantText() { return this.textOf(this.win); }
  // Instant: returns what has been recognised so far. `win` is returned so late words can still be read
  // for a short grace period when nothing had been recognised yet.
  endChant() {
    const win = this.win; this.win = null;
    const last = this.segs[this.segs.length - 1];
    if (last && !last.final) last.consumed = last.text.length; // words already used by this chant never leak into the next
    return { text: this.textOf(win), chantSeconds: (performance.now() - (this.chantT0 || performance.now())) / 1000, loudness: this.peak, win };
  }
  cancelChant() { this.win = null; }
  update() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const lv = clamp((Math.sqrt(s / this.buf.length) - 0.01) / 0.22);
    this.level += (lv - this.level) * 0.3;
    if (this.win) this.peak = Math.max(this.peak * 0.999, this.level);
  }
}
