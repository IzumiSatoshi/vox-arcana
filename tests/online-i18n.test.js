import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ONLINE_MESSAGES } from '../public/js/online-locales.js';
import { UI_LANGUAGES } from '../public/js/languages.js';
import { setLang } from '../public/js/i18n.js';
import { onlineText, translateOnlineMessage } from '../public/js/online-i18n.js';
import { lobbyMarkup } from '../public/js/online-lobby.js';

globalThis.document = { documentElement:{}, body:{classList:{toggle(){}}}, querySelectorAll:()=>[] };
test('all online UI messages cover every supported UI language and retain placeholders', () => {
  for (const [key,row] of Object.entries(ONLINE_MESSAGES)) for (const lang of Object.keys(UI_LANGUAGES)) {
    assert.ok(row[lang]?.trim(), `${key}: missing ${lang}`);
    assert.deepEqual(row[lang].match(/\{\w+\}/g)?.sort() || [], key.match(/\{\w+\}/g)?.sort() || [], `${key}: ${lang} placeholders`);
  }
  for (const file of ['online.js','online-lobby.js']) {
    const source=readFileSync(new URL('../public/js/'+file,import.meta.url),'utf8');
    for (const m of source.matchAll(/(?:text|label)\((['"])(.*?)\1,/g)) assert.ok(ONLINE_MESSAGES[m[2]],m[2]);
  }
});
test('lobby, win targets and error messages render in each selected language', () => {
  for (const lang of Object.keys(UI_LANGUAGES)) {
    setLang(lang);
    const markup=lobbyMarkup();
    assert.ok(markup.includes(ONLINE_MESSAGES['Host a room'][lang]));
    assert.ok(markup.includes(ONLINE_MESSAGES['Chant text is shown live to your opponent. Your microphone audio is not sent to them.'][lang]));
    assert.equal(onlineText('First to {n} wins',null,{n:3}),ONLINE_MESSAGES['First to {n} wins'][lang].replace('{n}','3'));
    assert.equal(translateOnlineMessage('Invalid room code.'),ONLINE_MESSAGES['Invalid room code.'][lang]);
    assert.equal(translateOnlineMessage(ONLINE_MESSAGES['Invite link copied. Send it to your rival.'].ja),ONLINE_MESSAGES['Invite link copied. Send it to your rival.'][lang]);
  }
  setLang('en');
});
