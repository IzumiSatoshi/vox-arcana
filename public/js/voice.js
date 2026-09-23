// Each push-to-talk chant owns its Web Speech results, including late events.
import { clamp } from './util.js';

export class Voice {
  constructor() {
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!this.SR;
    this.lang = 'en-US'; this.running = false; this.want = false;
    this.win = null; this.pending = null; this.session = null;
    this.error = null; this.level = 0; this.peak = 0; this._handsFree = false;
    this.onAuto = null; this.onStatus = null; this.onText = null; this.lastResultAt = 0; this.version = 0;
  }
  get handsFree() { return this._handsFree; }
  set handsFree(value) {
    this._handsFree = value;
    if (this.want && !this.win && !this.pending) {
      this.retire();
      if (value) this.start();
    }
  }
  async init(audioCtx) {
    if (!this.supported) { this.error = 'unsupported'; this.onStatus?.('unsupported'); return false; }
    this.want = true;
    // Start recognition independently of the optional loudness meter permission.
    this.rec = new this.SR();
    if (this.win || this.handsFree) this.start();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (audioCtx) {
        const src = audioCtx.createMediaStreamSource(this.stream);
        this.analyser = audioCtx.createAnalyser(); this.analyser.fftSize = 1024; src.connect(this.analyser);
        this.buf = new Float32Array(this.analyser.fftSize);
      }
    } catch {
      // Recognition uses its own capture: meter failure must not disable it.
      this.level = 0;
    }
    return true;
  }
  retire() {
    clearTimeout(this.retry);
    const session = this.session;
    this.session = null; this.running = false;
    if (session) { try { session.rec.abort(); } catch { /* already ended */ } }
    this.onStatus?.('idle');
  }
  start() {
    if (!this.SR || !this.want || this.session || this.pending || (!this.win && !this.handsFree)) return;
    clearTimeout(this.retry);
    const rec = new this.SR(), win = this.win, chunk = [];
    if (win) { win.chunks.push(chunk); win.ended = false; }
    const session = this.session = { rec, win, chunk, stopping: false };
    this.rec = rec;
    rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1; rec.lang = this.lang;
    rec.onstart = () => {
      if (this.session !== session) return;
      this.running = true; this.error = null; this.onStatus?.('listening');
    };
    rec.onresult = (e) => {
      if (this.session !== session || win?.closed) return;
      // Interim entries can be replaced or removed; results is a snapshot.
      chunk.length = e.results.length;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], previous = chunk[i];
        chunk[i] = { text: r[0].transcript.trim(), final: r.isFinal };
        if (!win && r.isFinal && !previous?.final && this.handsFree && !this.win && !this.pending && chunk[i].text) {
          this.onAuto?.(chunk[i].text);
        }
      }
      this.lastResultAt = performance.now(); this.version++;
      this.onText?.();
    };
    rec.onend = () => {
      if (this.session !== session) return;
      this.session = null; this.running = false;
      if (win) win.ended = true;
      if (this.want && !session.stopping && (this.win || this.handsFree)) {
        // Preserve a long chant across a browser-imposed recognition timeout.
        this.retry = setTimeout(() => this.start(), this.error ? 300 : 0);
      } else this.onStatus?.('idle');
    };
    rec.onerror = (e) => {
      if (this.session !== session || e.error === 'no-speech' || e.error === 'aborted') return;
      this.error = e.error; this.onStatus?.('error:' + e.error);
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) this.want = false;
    };
    try { rec.start(); }
    catch (error) {
      this.session = null;
      if (error.name === 'InvalidStateError') this.retry = setTimeout(() => this.start(), 50);
      else { this.want = false; this.error = error.name; this.onStatus?.('error:' + error.name); }
    }
  }
  setLang(lang) {
    if (this.lang === lang) return;
    this.lang = lang;
    this.cancelChant();
  }
  beginChant() {
    // No pre-roll or character offsets: corrections stay with their old session.
    if (this.win) this.win.closed = true;
    if (this.pending) this.pending.closed = true;
    this.pending = null;
    this.retire();
    this.win = { chunks: [], closed: false, ended: false, t0: performance.now() };
    this.peak = 0;
    this.start();
  }
  textOf(win) {
    if (!win || win.closed) return '';
    return win.chunks.flat().map((s) => s.text).filter(Boolean).join(' ');
  }
  chantText() { return this.textOf(this.win); }
  endChant() {
    const win = this.win, text = this.textOf(win);
    this.win = null; this.pending = win;
    const result = { text, chantSeconds: win ? (performance.now() - win.t0) / 1000 : 0, loudness: this.peak, win };
    if (text) this.finishChant(win);
    else if (this.session) {
      this.session.stopping = true;
      try { this.session.rec.stop(); } catch { /* browser already ending */ }
    }
    return result;
  }
  finishChant(win) {
    if (win) win.closed = true;
    if (this.pending === win) this.pending = null;
    if (this.session?.win === win) this.retire();
    if (!this.win && this.handsFree) this.start();
  }
  cancelChant() {
    if (this.win) this.win.closed = true;
    if (this.pending) this.pending.closed = true;
    this.win = null; this.pending = null;
    this.retire();
    if (this.handsFree) this.start();
  }
  update() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const lv = clamp((Math.sqrt(s / this.buf.length) - 0.01) / 0.22);
    this.level += (lv - this.level) * 0.3;
    if (this.win) this.peak = Math.max(this.peak * 0.999, this.level);
  }
}
