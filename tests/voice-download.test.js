import test from 'node:test';
import assert from 'node:assert/strict';
import { bindVoiceDownload } from '../public/js/voice-download.js';
function ui(SR) {
  const button = { disabled: true, addEventListener(_, fn) { this.click = fn; } }, status = {};
  let language = 'ja-JP'; const installed = [];
  const refresh = bindVoiceDownload({ button, status, SR, getLanguage: () => language, onInstalled: lang => installed.push(lang) });
  return { button, status, refresh, installed, setLanguage: lang => { language = lang; } };
}
test('availability check never installs; click downloads and verifies selected language', async () => {
  let ready = false; const calls = [];
  const u = ui({ available: async () => ready ? 'available' : 'downloadable', install: async options => { calls.push(options); ready = true; return true; } });
  await u.refresh(); assert.equal(calls.length, 0); assert.equal(u.button.disabled, false);
  await u.button.click();
  assert.deepEqual(calls, [{ langs: ['ja-JP'], processLocally: true }]);
  assert.deepEqual(u.installed, ['ja-JP']); assert.equal(u.button.disabled, true);
  assert.match(u.status.textContent, /Installed/);
});
test('failed downloads can be retried without enabling local recognition', async () => {
  const u = ui({ available: async () => 'downloadable', install: async () => false });
  await u.refresh(); await u.button.click();
  assert.match(u.status.textContent, /failed/); assert.equal(u.button.disabled, false); assert.deepEqual(u.installed, []);
});
test('unsupported browsers disable download', async () => {
  const u = ui({}); await u.refresh(); assert.equal(u.button.disabled, true); assert.match(u.status.textContent, /cannot download/);
});
test('language changes cannot show stale availability', async () => {
  const pending = [];
  const u = ui({ available: () => new Promise(r => pending.push(r)), install: async () => true });
  const first = u.refresh(); u.setLanguage('en-US'); const second = u.refresh();
  pending[1]('available'); await second; pending[0]('downloadable'); await first;
  assert.equal(u.button.disabled, true); assert.match(u.status.textContent, /Installed/);
});
test('language change during download preserves install target and updates current selection', async () => {
  let finish; const u = ui({ available: async o => o.langs[0] === 'en-US' ? 'unavailable' : finish ? 'available' : 'downloadable', install: () => new Promise(r => { finish = r; }) });
  await u.refresh(); const installing = u.button.click(); assert.equal(u.button.disabled, true);
  u.setLanguage('en-US'); await u.refresh(); assert.equal(u.button.disabled, true);
  finish(true); await installing;
  assert.deepEqual(u.installed, ['ja-JP']); assert.match(u.status.textContent, /unavailable/);
});
