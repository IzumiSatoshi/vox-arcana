import test from 'node:test';
import assert from 'node:assert/strict';
import { UI_LANGUAGES, VOICE_LANGUAGES, uiLanguage, recognitionLanguage, defaultRecognitionLanguage } from '../public/js/languages.js';
import { filterLanguages } from '../public/js/language-picker.js';
import { createApiHandler } from '../api-handler.js';

test('interface language and recognition locale can be chosen independently', () => {
  assert.equal(uiLanguage('fr-CA'), 'fr');
  assert.equal(uiLanguage('zh-CN'), 'zh-Hans');
  assert.equal(defaultRecognitionLanguage('ko'), 'ko-KR');
  assert.equal(recognitionLanguage('ES-mx'), 'es-MX');
  assert.equal(recognitionLanguage('xx-@@'), null);
  assert.ok(Object.keys(UI_LANGUAGES).length >= 8);
  assert.ok(Object.keys(VOICE_LANGUAGES).length >= 20);
});

test('language search accepts English names, native names, aliases, and codes', () => {
  assert.deepEqual(filterLanguages(UI_LANGUAGES, 'chinese').map(([code]) => code), ['zh-Hans']);
  assert.deepEqual(filterLanguages(VOICE_LANGUAGES, 'chinese').map(([code]) => code), ['zh-CN', 'zh-TW']);
  assert.deepEqual(filterLanguages(VOICE_LANGUAGES, 'mandarin').map(([code]) => code), ['zh-CN', 'zh-TW']);
  assert.deepEqual(filterLanguages(VOICE_LANGUAGES, 'espanol').map(([code]) => code), ['es-ES', 'es-MX']);
  assert.deepEqual(filterLanguages(VOICE_LANGUAGES, 'es-MX').map(([code]) => code), ['es-MX']);
});

test('spell API forwards non-English recognition locales and rejects malformed codes', async t => {
  const states = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    states.push(JSON.parse(options.body).state);
    return { ok: true, text: async () => JSON.stringify({ answers: {} }) };
  });
  const handler = createApiHandler({ apiKey: 'test-key' });
  async function call(language) {
    let status, data;
    await handler({ url: '/api/spell', method: 'POST', headers: {}, body: { text: 'Un hechizo', language } }, {
      writeHead(code) { status = code; }, end(body) { data = JSON.parse(body); },
    });
    return { status, data };
  }
  assert.equal((await call('es-MX')).status, 200);
  assert.match(states[0], /voice recognition language: es-MX/);
  assert.equal((await call('bad_@@')).status, 400);
  assert.equal(states.length, 1);
});
