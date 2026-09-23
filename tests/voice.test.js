import test from 'node:test';
import assert from 'node:assert/strict';
import { Voice } from '../public/js/voice.js';

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
