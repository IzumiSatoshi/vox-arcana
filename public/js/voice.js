// Each cast owns its Web Speech results. Supported browsers can prepare a
// recognizer against a silent Web Audio track, opening it only on keypress.
import { clamp } from './util.js';
import { smoothVoiceLevel } from './voice-feedback.js';

export class Voice {
  constructor() {
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!this.SR;
    this.lang = 'en-US'; this.running = false; this.want = false; this.active = true;
    this.win = null; this.pending = null; this.session = null;
    this.error = null; this.level = 0; this.peak = 0; this._handsFree = false;
    this.onAuto = null; this.onStatus = null; this.onText = null; this.lastResultAt = 0; this.version = 0;
    this.preferLocal = true; this.prewarm = true; this.localAvailability = 'unchecked';
    this.localByLanguage = new Map(); this.localFailed = new Set();
    this.trackSupported = false; this.history = []; this.nextId = 0;
  }
  get handsFree() { return this._handsFree; }
  set handsFree(value) {
    if (this._handsFree === value) return;
    this._handsFree = value;
    if (this.want && !this.win && !this.pending) { this.retire(); this.prepareNext(); }
  }
  get useLocal() { return this.preferLocal && this.localByLanguage.get(this.lang) === 'available' && !this.localFailed.has(this.lang); }
  async checkLocal() {
    const lang = this.lang;
    if (!this.SR || !('processLocally' in new this.SR()) || typeof this.SR.available !== 'function') {
      this.localAvailability = 'unsupported'; this.checkingLocal = false; return;
    }
    this.checkingLocal = true;
    let state;
    try { state = await this.SR.available({ langs: [lang], processLocally: true }); }
    catch { state = 'unavailable'; }
    this.localByLanguage.set(lang, state);
    if (this.lang !== lang) return;
    this.checkingLocal = false;
    this.localAvailability = state;
    // Never interrupt a chant just because the capability check completed.
    if (!this.win && !this.pending) { this.retire(); this.prepareNext(); }
  }
  async init(audioCtx, { stream } = {}) {
    if (!this.supported) { this.error = 'unsupported'; this.onStatus?.('unsupported'); return false; }
    this.want = true; this.rec = new this.SR();
    void this.checkLocal();
    if (this.win || this.handsFree) this.start();
    try {
      this.stream = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (audioCtx) {
        this.audioCtx = audioCtx;
        this.source = audioCtx.createMediaStreamSource(this.stream);
        this.analyser = audioCtx.createAnalyser(); this.analyser.fftSize = 512;
        this.source.connect(this.analyser); this.buf = new Float32Array(this.analyser.fftSize);
        // An ended audio track MUST synchronously throw InvalidStateError when
        // the start(track) overload is implemented. Older engines may ignore it.
        // Probe only while idle, after capture was explicitly enabled.
        if (!this.session && !this.win) this.probeTrackSupport();
      }
    } catch { this.level = 0; }
    this.prepareNext();
    return true;
  }
  probeTrackSupport() {
    const dest = this.audioCtx.createMediaStreamDestination(), track = dest.stream.getAudioTracks()[0];
    track.stop();
    const probe = new this.SR(); probe.onerror = () => {};
    try { probe.start(track); probe.abort(); }
    catch (e) { this.trackSupported = e.name === 'InvalidStateError'; }
    dest.disconnect();
  }
  setActive(value) {
    this.active = value;
    if (!value) this.cancelChant(); else this.prepareNext();
  }
  prepareNext() {
    if (!this.want || !this.active || this.win || this.pending || this.session || this.checkingLocal) return;
    if (this.handsFree) this.start();
    else if (this.prewarm && this.trackSupported && this.audioCtx?.state === 'running') this.start(true);
  }
  closeInput(session) {
    if (!session?.input) return;
    const { gain, dest, track } = session.input;
    gain.gain.value = 0;
    this.source.disconnect(gain); gain.disconnect(); dest.disconnect(); track.stop();
    session.input = null;
  }
  retire() {
    clearTimeout(this.retry);
    const session = this.session;
    this.session = null; this.running = false;
    if (session) {
      this.draining = session;
      try { session.rec.abort(); } catch { this.draining = null; }
      this.closeInput(session);
      // Some engines omit end when aborted before start. Bound that wait.
      if (this.draining === session) this.drainTimer = setTimeout(() => this.completeDrain(session), 1000);
    }
    this.onStatus?.('idle');
  }
  completeDrain(session) {
    if (this.draining !== session) return;
    clearTimeout(this.drainTimer); this.draining = null;
    const queued = this.queuedStart; this.queuedStart = null;
    if (this.win || this.handsFree) this.start();
    else if (queued === 'prepared') this.prepareNext();
  }
  start(prepared = false) {
    if (!this.SR || !this.want || !this.active || this.session || this.pending || (!prepared && !this.win && !this.handsFree)) return;
    // Chrome's recognizers share a service. Wait for abort/end before starting
    // its replacement; overlapping teardown can silently lose a whole chant.
    if (this.draining) { this.queuedStart = prepared ? 'prepared' : 'active'; return; }
    this.queuedStart = null;
    clearTimeout(this.retry);
    const rec = new this.SR(), chunk = [], win = this.win;
    if (win) { win.chunks.push(chunk); win.ended = false; }
    const session = this.session = { rec, win, chunk, stopping: false, prepared, local: this.useLocal, lang: this.lang };
    this.rec = rec;
    rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1; rec.lang = this.lang;
    if ('processLocally' in rec) rec.processLocally = session.local;
    if (win) { win.metric.engine = session.local ? 'local' : 'browser'; win.metric.attempts++; }
    rec.onstart = () => {
      if (this.session !== session) return;
      this.running = true; this.error = null; this.onStatus?.('starting');
      if (session.win) session.win.metric.startAt ??= performance.now();
    };
    rec.onaudiostart = () => {
      if (this.session !== session) return;
      session.audioAt = performance.now();
      if (session.win) session.win.metric.audioAt ??= session.audioAt;
      this.onStatus?.(session.prepared ? 'ready' : 'listening');
    };
    rec.onresult = (e) => {
      const win = session.win;
      if (this.session !== session || win?.closed) return;
      // An idle gated session should hear silence. If an engine emits words,
      // discard it instead of allowing that result into the next cast.
      if (session.prepared) { this.retire(); return; }
      chunk.length = e.results.length;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], previous = chunk[i];
        chunk[i] = { text: r[0].transcript.trim(), final: r.isFinal };
        if (!win && r.isFinal && !previous?.final && this.handsFree && !this.win && !this.pending && chunk[i].text) this.onAuto?.(chunk[i].text);
      }
      this.lastResultAt = performance.now(); this.version++;
      if (win && this.textOf(win)) win.metric.resultAt ??= this.lastResultAt;
      this.onText?.();
    };
    rec.onend = () => {
      if (this.draining === session) {
        this.completeDrain(session); return;
      }
      if (this.session !== session) return;
      this.closeInput(session); this.session = null; this.running = false;
      const win = session.win;
      if (win) win.ended = true;
      if (this.want && this.active && !session.stopping && (this.win || this.handsFree)) {
        this.retry = setTimeout(() => this.start(), this.error ? 300 : 0);
      } else this.onStatus?.('idle'); // Idle warm sessions may expire; do not loop on silence.
    };
    rec.onerror = (e) => {
      if (this.session !== session || e.error === 'no-speech' || e.error === 'aborted') return;
      this.error = e.error;
      if (session.win) session.win.metric.error = e.error;
      // A local service or audio-track failure must not disable the ordinary API.
      if ((session.local && ['language-not-supported', 'service-not-allowed', 'network'].includes(e.error)) || (session.input && e.error === 'audio-capture')) {
        if (session.local) this.localFailed.add(session.lang);
        if (e.error === 'audio-capture') this.trackSupported = false;
        this.retire();
        if (this.win || this.handsFree) this.start(); else this.prepareNext();
        return;
      }
      this.onStatus?.('error:' + e.error);
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) this.want = false;
    };
    try {
      if (this.trackSupported && this.source && this.audioCtx.state === 'running') {
        const gain = this.audioCtx.createGain(), dest = this.audioCtx.createMediaStreamDestination();
        gain.gain.value = prepared ? 0 : 1;
        this.source.connect(gain); gain.connect(dest);
        session.input = { gain, dest, track: dest.stream.getAudioTracks()[0] };
        rec.start(session.input.track);
      } else rec.start();
    } catch (error) {
      const hadInput = !!session.input;
      this.closeInput(session); this.session = null;
      if (hadInput) {
        this.trackSupported = false;
        if (this.win || this.handsFree) this.retry = setTimeout(() => this.start(), 50);
      } else if (error.name === 'InvalidStateError' && (win?.metric.attempts || 0) < 4) this.retry = setTimeout(() => this.start(), 50);
      else { this.want = false; this.error = error.name; this.onStatus?.('error:' + error.name); }
    }
  }
  setLang(lang) {
    if (this.lang === lang) return;
    this.lang = lang; this.cancelChant(); void this.checkLocal();
  }
  beginChant() {
    if (this.win) this.finishMetric(this.win, 'superseded');
    if (this.pending) this.finishMetric(this.pending, 'superseded');
    if (this.win) this.win.closed = true;
    if (this.pending) this.pending.closed = true;
    this.pending = null;
    const now = performance.now();
    const metric = { id: ++this.nextId, pressedAt: now, engine: this.useLocal ? 'local' : 'browser', prepared: false, readyOnPress: false, attempts: 0, outcome: 'listening' };
    this.history.push(metric); if (this.history.length > 30) this.history.shift();
    this.win = { chunks: [], closed: false, ended: false, t0: now, metric };
    this.peak = 0;
    const s = this.session;
    if (s?.prepared && s.input && s.lang === this.lang && s.local === this.useLocal && this.audioCtx.state === 'running') {
      s.prepared = false; s.win = this.win; this.win.chunks.push(s.chunk);
      metric.prepared = true; metric.attempts = 1;
      metric.readyOnPress = s.audioAt !== undefined;
      if (this.running) metric.startAt = now;
      if (s.audioAt !== undefined) metric.audioAt = now;
      s.input.gain.gain.value = 1;
      if (s.audioAt !== undefined) this.onStatus?.('listening');
    } else { this.retire(); this.start(); }
  }
  textOf(win) {
    if (!win || win.closed) return '';
    return win.chunks.flat().map((s) => s.text).filter(Boolean).join(' ');
  }
  chantText() { return this.textOf(this.win); }
  endChant() {
    const win = this.win, text = this.textOf(win), now = performance.now();
    this.win = null; this.pending = win;
    if (win) { win.metric.releasedAt = now; win.metric.outcome = 'pending'; }
    const result = { text, chantSeconds: win ? (now - win.t0) / 1000 : 0, loudness: this.peak, win };
    if (text) this.finishChant(win);
    else if (this.session) {
      this.session.stopping = true;
      if (this.session.input) this.session.input.gain.gain.value = 0;
      try { this.session.rec.stop(); } catch { /* browser already ending */ }
    }
    return result;
  }
  finishMetric(win, outcome) {
    if (!win?.metric || win.metric.castAt !== undefined) return;
    win.metric.outcome = outcome; win.metric.finishedAt = performance.now();
  }
  markCast(win) {
    if (!win?.metric || win.metric.castAt !== undefined) return;
    win.metric.castAt = performance.now(); win.metric.outcome = 'cast';
  }
  diagnostics() {
    const elapsed = (end, start) => end === undefined || start === undefined ? null : Math.round(Math.max(0, end - start));
    return { language: this.lang, localAvailability: this.localAvailability, localFailed: this.localFailed.has(this.lang), audioTrack: this.trackSupported,
      engine: this.session ? (this.session.local ? 'local' : 'browser') : (this.useLocal ? 'local' : 'browser'), prepared: !!this.session?.prepared,
      recent: this.history.map(m => ({ id: m.id, engine: m.engine, prepared: m.prepared, readyOnPress: m.readyOnPress, outcome: m.outcome, attempts: m.attempts,
        startMs: elapsed(m.startAt, m.pressedAt), audioReadyMs: elapsed(m.audioAt, m.pressedAt), soundMs: elapsed(m.soundAt, m.pressedAt),
        firstTextMs: elapsed(m.resultAt, m.pressedAt), soundToTextMs: elapsed(m.resultAt, m.soundAt), releaseToCastMs: elapsed(m.castAt, m.releasedAt), error: m.error || null })) };
  }
  finishChant(win) {
    if (win) { const recognized = !!this.textOf(win); win.closed = true; this.finishMetric(win, recognized ? 'recognized' : 'empty'); }
    if (this.pending === win) this.pending = null;
    if (this.session?.win === win) this.retire();
    this.prepareNext();
  }
  cancelChant() {
    for (const win of [this.win, this.pending]) if (win) { win.closed = true; this.finishMetric(win, 'cancelled'); }
    this.win = null; this.pending = null; this.queuedStart = null; this.retire();
    if (this.active && this.handsFree) this.start();
  }
  dispose() {
    this.active = false; this.want = false; this.cancelChant();
    clearTimeout(this.drainTimer); this.draining = null;
    this.source?.disconnect(); this.stream?.getTracks?.().forEach(track => track.stop());
    this.analyser = null; this.level = 0;
  }
  update(dt = 1 / 60) {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const lv = clamp((Math.sqrt(s / this.buf.length) - 0.01) / 0.22);
    this.level = smoothVoiceLevel(this.level, lv, dt);
    if (this.win) {
      this.peak = Math.max(this.peak, this.level);
      if (lv > 0.08) this.win.metric.soundAt ??= performance.now();
    }
  }
}
