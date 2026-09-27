import test from 'node:test';
import assert from 'node:assert/strict';
import { Voice, cleanTranscript } from '../public/js/voice.js';

class Recognition {
  start() { this.starts = (this.starts || 0) + 1; this.onstart?.(); }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; this.onend?.(); }
  result(values, resultIndex = 0) {
    this.onresult({ resultIndex, results: values.map(([text, final = false]) => Object.assign([{ transcript: text }], { isFinal: final })) });
  }
}
globalThis.window = { SpeechRecognition: Recognition };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({}) } } });
async function setup() { const v = new Voice(); await v.init(); return v; }

test('release returns interim words immediately and retires the session', async () => {
  const v = await setup(); v.beginChant(); const rec = v.rec;
  rec.result([['fireball']]);
  assert.equal(v.endChant().text, 'fireball');
  assert.equal(rec.aborted, true);
  assert.equal(v.pending, null);
});
test('late corrections cannot leak into a rapid next cast', async () => {
  const v = await setup(); v.beginChant(); const old = v.rec;
  old.result([['fire']]); v.endChant(); v.beginChant();
  old.result([['Fire ball!', true], ['more old words']]);
  old.onend();
  assert.equal(v.chantText(), '');
  v.rec.result([['ice spear']]);
  assert.equal(v.endChant().text, 'ice spear');
});
test('empty release flushes recognition and late text remains readable until consumed', async () => {
  const v = await setup(); v.beginChant(); const rec = v.rec;
  const res = v.endChant(); assert.equal(rec.stopped, true);
  let notifications = 0; v.onText = () => notifications++;
  rec.result([['雷', true]]);
  assert.equal(v.textOf(res.win), '雷'); assert.equal(notifications, 1);
  v.finishChant(res.win);
  rec.result([['雷よ', true]]);
  assert.equal(v.textOf(res.win), '');
});
test('pressing again cancels an empty pending cast', async () => {
  const v = await setup(); v.beginChant(); const old = v.rec;
  const res = v.endChant(); v.beginChant();
  old.result([['old fire', true]]);
  assert.equal(v.textOf(res.win), ''); assert.equal(v.chantText(), '');
});
test('interim rewrites and result removal do not retain stale suffixes', async () => {
  const v = await setup(); v.beginChant();
  v.rec.result([['summon', true], ['fire'], ['stale']]);
  v.rec.result([['summon', true], ['ice']], 1);
  assert.equal(v.chantText(), 'summon ice');
  v.rec.result([['summon', true]], 1);
  assert.equal(v.chantText(), 'summon'); v.cancelChant();
});
test('browser restarts preserve the current chant without old-session callbacks', async () => {
  const v = await setup(); v.beginChant(); const old = v.rec;
  old.result([['summon fire', true]]); old.onend();
  v.start(); // same path as the scheduled restart, without waiting
  v.rec.result([['dragon']]); old.result([['wrong']]);
  assert.equal(v.chantText(), 'summon fire dragon'); v.cancelChant();
});
test('browser session ending during a long hold restarts recognition without ending the chant', async () => {
  const v = await setup(); v.beginChant(); const first = v.rec;
  v.win.t0 -= 30000;
  first.result([['summon fire', true]]);
  first.onend();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.notEqual(v.rec, first);
  assert.equal(v.win?.closed, false);
  v.rec.result([['dragon', true]]);
  const cast = v.endChant();
  assert.equal(cast.text, 'summon fire dragon');
  assert.ok(cast.chantSeconds >= 30);
  v.dispose();
});
test('hands-free final results cast once and manual results never auto-cast', async () => {
  const v = await setup(), casts = []; v.onAuto = s => casts.push(s);
  v.handsFree = true; const auto = v.rec;
  auto.result([['fire', true]]); auto.result([['fire', true]]);
  assert.deepEqual(casts, ['fire']);
  v.beginChant(); v.rec.result([['ice']]); const manual = v.rec; v.endChant();
  manual.result([['ice', true]]);
  assert.deepEqual(casts, ['fire']); v.handsFree = false;
});
test('hands-free does not restart while manual late results are pending', async () => {
  const v = await setup(); v.handsFree = true; v.beginChant();
  const res = v.endChant(); v.rec.onend(); v.start();
  assert.equal(v.session, null);
  v.finishChant(res.win); assert.ok(v.session); v.handsFree = false;
});
test('permission error prevents automatic restart', async () => {
  const v = await setup(); v.beginChant();
  v.rec.onerror({ error: 'not-allowed' }); v.rec.onend(); v.start();
  assert.equal(v.want, false); assert.equal(v.session, null); v.cancelChant();
});
test('language switch discards old results and uses the new language', async () => {
  const v = await setup(); v.beginChant(); const old = v.rec;
  v.setLang('ja-JP'); v.beginChant(); old.result([['old fire', true]]);
  assert.equal(v.rec.lang, 'ja-JP'); assert.equal(v.chantText(), ''); v.cancelChant();
});
test('keypress before initialization is retained', async () => {
  const v = new Voice(); v.beginChant(); await v.init();
  v.rec.result([['wind']]); assert.equal(v.endChant().text, 'wind');
});
test('cancellation closes the transcript and ignores delayed events', async () => {
  const v = await setup(); v.beginChant(); const old = v.rec, win = v.win;
  v.cancelChant(); old.result([['fire', true]]);
  assert.equal(v.textOf(win), ''); assert.equal(v.session, null);
});

class TrackRecognition extends Recognition {
  processLocally = false;
  static availability = 'available';
  static async available() { return this.availability; }
  start(track) {
    if (track?.readyState === 'ended') throw new DOMException('Ended track', 'InvalidStateError');
    this.input = track;
    super.start(); this.onaudiostart?.();
  }
}
function fakeAudio() {
  const makeTrack = () => ({ readyState: 'live', stop() { this.readyState = 'ended'; } });
  const node = () => ({ connect() {}, disconnect() {} });
  return {
    state: 'running', createMediaStreamSource: node,
    createAnalyser: () => ({ fftSize: 512, getFloatTimeDomainData: buf => buf.fill(0.12) }),
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createMediaStreamDestination: () => { const track = makeTrack(); return { ...node(), stream: { getAudioTracks: () => [track] } }; },
  };
}
async function preparedVoice() {
  const v = new Voice(); v.SR = TrackRecognition;
  v.preferLocal = true; v.prewarm = true; await v.init(fakeAudio(), { stream: {} }); return v;
}
test('prepared recognizer receives silence until claimed, then is retired before the next cast', async () => {
  const v = await preparedVoice(); const ready = v.session;
  assert.equal(v.useLocal, true); assert.equal(v.trackSupported, true);
  assert.equal(ready.prepared, true); assert.equal(ready.input.gain.gain.value, 0);
  v.beginChant(); assert.equal(v.session, ready); assert.equal(ready.input.gain.gain.value, 1);
  ready.rec.result([['fireball']]); const input = ready.input, res = v.endChant(); v.markCast(res.win);
  assert.equal(input.gain.gain.value, 0); assert.equal(input.track.readyState, 'ended');
  assert.notEqual(v.session, ready); assert.equal(v.session.input.gain.gain.value, 0);
  v.beginChant(); ready.rec.result([['old correction', true]]);
  assert.equal(v.chantText(), ''); v.dispose();
});
test('unexpected results in a silent prepared session invalidate it', async () => {
  const v = await preparedVoice(); const old = v.rec; old.result([['unexpected']]);
  assert.equal(v.session, null); v.beginChant(); old.result([['late unexpected']]);
  assert.equal(v.chantText(), ''); v.dispose();
});
test('local service failure falls back without contaminating the next cast', async () => {
  const v = await preparedVoice(); v.beginChant(); const old = v.rec;
  old.onerror({ error: 'language-not-supported' });
  assert.equal(v.useLocal, false); assert.equal(v.rec.processLocally, false);
  old.result([['obsolete', true]]); v.rec.result([['wind']]);
  assert.equal(v.endChant().text, 'wind'); v.dispose();
});
test('downloadable language stays on browser service without initiating an installation', async () => {
  const v = new Voice(); v.SR = class extends TrackRecognition { static availability = 'downloadable'; };
  await v.checkLocal(); assert.equal(v.useLocal, false); assert.equal(v.localAvailability, 'downloadable');
});
test('language availability race cannot select the wrong engine', async () => {
  const v = new Voice(); const queries = [];
  v.SR = class extends TrackRecognition { static available() { return new Promise(resolve => queries.push(resolve)); } };
  const old = v.checkLocal(); v.lang = 'ja-JP'; const current = v.checkLocal();
  queries[1]('downloadable'); await current; queries[0]('available'); await old;
  assert.equal(v.localAvailability, 'downloadable'); assert.equal(v.useLocal, false);
});
test('pause closes prepared audio and prevents restart', async () => {
  const v = await preparedVoice(); const old = v.session, input = old.input;
  v.setActive(false); assert.equal(input.track.readyState, 'ended'); assert.equal(v.session, null);
  old.rec.onend(); v.prepareNext(); assert.equal(v.session, null);
  v.setActive(true); assert.equal(v.session.prepared, true); v.dispose();
});
test('injected track failure reports an error without opening the microphone', async () => {
  const v = await preparedVoice(); v.beginChant(); const rec = v.rec;
  rec.onerror({ error: 'audio-capture' });
  assert.equal(v.want, false); assert.equal(v.rec, rec); assert.ok(rec.input); v.dispose();
});
test('timing records separate ready, sound, first text, and release-to-cast latency', async t => {
  let now = 100; t.mock.method(performance, 'now', () => now);
  const v = await preparedVoice(); v.beginChant();
  now = 120; v.update(0.02); now = 170; v.rec.result([['fire']]);
  now = 200; const res = v.endChant(); now = 205; v.markCast(res.win);
  const m = v.diagnostics().recent[0];
  assert.equal(m.audioReadyMs, 0); assert.equal(m.soundMs, 20);
  assert.equal(m.firstTextMs, 70); assert.equal(m.soundToTextMs, 50); assert.equal(m.releaseToCastMs, 5);
  assert.equal(m.prepared, true); assert.equal(m.outcome, 'cast');
  assert.equal(JSON.stringify(v.diagnostics()).includes('fire'), false); v.dispose();
});
test('latency history is bounded', async () => {
  const v = await setup();
  for (let i = 0; i < 45; i++) { v.beginChant(); v.cancelChant(); }
  assert.equal(v.diagnostics().recent.length, 30); assert.equal(v.diagnostics().recent[0].id, 16);
});

test('replacement recognition waits for asynchronous abort teardown', async () => {
  const v = new Voice(); v.SR = class extends TrackRecognition { abort() { this.aborted = true; } };
  v.preferLocal = true; v.prewarm = true; await v.init(fakeAudio(), { stream: {} });
  v.beginChant(); const old = v.rec; old.result([['fire']]); v.endChant();
  assert.equal(v.session, null); assert.ok(v.draining);
  v.beginChant(); assert.equal(v.session, null);
  old.result([['old correction', true]]); assert.equal(v.chantText(), '');
  old.onend(); assert.ok(v.session); assert.equal(v.session.win, v.win);
  v.rec.result([['ice']]); assert.equal(v.chantText(), 'ice'); v.dispose();
});

test('missing end after abort cannot stall the next chant indefinitely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const v = new Voice(); v.SR = class extends Recognition { abort() {} };
  await v.init(); v.beginChant(); v.rec.result([['fire']]); v.endChant(); v.beginChant();
  assert.equal(v.session, null); t.mock.timers.tick(1000);
  assert.ok(v.session); v.rec.result([['ice']]); assert.equal(v.chantText(), 'ice'); v.dispose();
});
test('preparation waits for an outstanding local capability check', async () => {
  let resolve;
  const v = new Voice(); v.SR = class extends TrackRecognition { static available() { return new Promise(r => { resolve = r; }); } };
  v.preferLocal = true; v.prewarm = true; await v.init(fakeAudio(), { stream: {} }); assert.equal(v.session, null);
  resolve('available'); await Promise.resolve();
  assert.equal(v.session.local, true); assert.equal(v.session.prepared, true); v.dispose();
});

test('default gameplay uses browser microphone capture even with audio-track support', async () => {
  const v = await setup(); v.SR = TrackRecognition;
  v.audioCtx = fakeAudio(); v.source = v.audioCtx.createMediaStreamSource(); v.trackSupported = true;
  v.localByLanguage.set(v.lang, 'available');
  assert.equal(v.prewarm, false); assert.equal(v.preferLocal, false);
  v.prepareNext(); assert.equal(v.session, null);
  v.beginChant(); assert.equal(v.rec.input, undefined); assert.equal(v.rec.processLocally, false);
  v.rec.result([['fireball']]); assert.equal(v.endChant().text, 'fireball'); v.dispose();
});

test('incomplete release can keep accepting revisions until spell words arrive', async () => {
  const v = await setup(); v.beginChant(); const rec = v.rec;
  rec.result([['sum']]); const res = v.endChant({ waitForWords: true });
  assert.equal(res.win.closed, false); assert.equal(rec.stopped, true);
  rec.result([['summon an ice spear', true]]);
  assert.equal(v.textOf(res.win), 'summon an ice spear'); v.finishChant(res.win); v.dispose();
});
test('supplied audio track sends silence on release while buffered words finish', async () => {
  const v = await preparedVoice(); v.beginChant(); const session = v.session;
  const res = v.endChant({ waitForWords: true });
  assert.equal(session.input.gain.gain.value, 0); assert.equal(session.rec.stopped, undefined);
  session.rec.result([['ice spear', true]]); assert.equal(v.textOf(res.win), 'ice spear');
  v.finishChant(res.win); v.dispose();
});


test('preparation enabled after microphone initialization uses normal capture', async () => {
  const v = new Voice(); v.SR = TrackRecognition; await v.init(fakeAudio());
  v.prewarm = true; v.prepareNext();
  assert.equal(v.trackProbed, undefined); assert.equal(v.session.prepared, true);
  assert.equal(v.rec.input, undefined); v.dispose();
});

test('next browser session prepares after asynchronous teardown without another keypress', async () => {
  const v = new Voice(); v.SR = class extends TrackRecognition { abort() { this.aborted = true; } };
  v.prewarm = true; await v.init(fakeAudio(), { stream: {} });
  v.beginChant(); const old = v.rec;
  old.result([['fireball']]); v.endChant();
  assert.equal(v.session, null); assert.equal(v.queuedStart, 'prepared');
  old.onend();
  const next = v.session;
  assert.equal(next.prepared, true); assert.equal(next.input.gain.gain.value, 0);
  assert.equal(next.local, false); assert.notEqual(next.rec, old);
  old.result([['obsolete fireball', true]]);
  v.beginChant(); assert.equal(v.session, next); assert.equal(v.chantText(), '');
  next.rec.result([['ice spear']]); assert.equal(v.endChant().text, 'ice spear');
  v.dispose();
});


test('enabling microphone preparation during teardown waits until end', async () => {
  const v = new Voice(); v.SR = class extends TrackRecognition { abort() {} };
  await v.init(fakeAudio()); v.beginChant(); const old = v.rec;
  old.result([['fire']]); v.endChant();
  v.prewarm = true; v.prepareNext();
  assert.equal(v.trackProbed, undefined); assert.equal(v.queuedStart, 'prepared');
  old.onend();
  assert.equal(v.trackProbed, undefined); assert.equal(v.session.prepared, true);
  v.dispose();
});


test('prepared microphone is reused without a Web Audio track', async () => {
  const v = await setup(); v.prewarm = true; v.prepareNext(); const rec = v.rec;
  rec.onaudiostart(); v.beginChant();
  assert.equal(v.rec, rec); assert.equal(v.win.metric.readyOnPress, true);
  rec.result([['fireball']]); v.endChant();
  assert.equal(v.session.prepared, true); assert.notEqual(v.rec, rec); v.dispose();
});
test('idle final results and their indices are excluded from the next chant', async () => {
  const v = await setup(); v.prewarm = true; v.prepareNext(); const rec = v.rec;
  rec.result([['background conversation', true]]);
  v.beginChant(); rec.result([['background conversation', true], ['ice spear']], 1);
  assert.equal(v.chantText(), 'ice spear'); v.dispose();
});
test('unfinished idle speech gets a fresh session so delayed corrections cannot leak', async () => {
  const v = await setup(); v.prewarm = true; v.prepareNext(); const old = v.rec;
  old.onspeechstart(); old.result([['old fire']]);
  v.beginChant(); assert.notEqual(v.rec, old);
  old.result([['old fireball', true]]); assert.equal(v.chantText(), ''); v.dispose();
});
test('idle expiry renews ordinary microphone preparation but pause cancels renewal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const v = await setup(); v.prewarm = true; v.prepareNext(); const old = v.rec;
  old.onend(); t.mock.timers.tick(250);
  assert.equal(v.session.prepared, true); assert.notEqual(v.rec, old);
  v.rec.onend(); v.setActive(false); t.mock.timers.tick(500);
  assert.equal(v.session, null); v.dispose();
});


test('STT punctuation is removed without merging separated English words', () => {
  assert.equal(cleanTranscript("Summon: fire—ice, don't stop!"), 'Summon fire ice dont stop');
  assert.equal(cleanTranscript('「氷の槍」、ファイアーボール！'), '氷の槍 ファイアーボール');
  assert.equal(cleanTranscript('…！？'), '');
});
test('manual and hands-free callbacks receive punctuation-free STT', async () => {
  const v = await setup(); v.beginChant(); v.rec.result([['Fire, ice!']]);
  assert.equal(v.chantText(), 'Fire ice'); v.cancelChant();
  const seen=[]; v.onAuto=text=>seen.push(text);v.handsFree=true;
  v.rec.result([['「氷の槍」！',true]]); assert.deepEqual(seen,['氷の槍']);v.dispose();
});

test('recognition end notifies a pending cast after the last result event', async () => {
  const v=await setup();v.beginChant();const rec=v.rec;
  rec.result([['fire']]);const res=v.endChant({waitForWords:true});
  const events=[];v.onText=()=>events.push({text:v.textOf(res.win),ended:res.win.ended});
  rec.result([['fire tornado',true]]);rec.onend();
  assert.deepEqual(events,[{text:'fire tornado',ended:false},{text:'fire tornado',ended:true}]);
  v.finishChant(res.win);v.dispose();
});
