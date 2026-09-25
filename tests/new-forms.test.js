import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ELEMENTS, SHAPES } from '../spell-ontology.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../public/js/spellbook.js').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const context = vm.createContext({
  clamp: n => Math.max(0, Math.min(1, n)), hashStr: () => 42, spellName: () => 'Test spell',
  ELEMENT_KEYS: Object.keys(ELEMENTS), SHAPE_KEYS: Object.keys(SHAPES), performance, AbortSignal,
});
const { localParse, generateIncantation } = vm.runInContext(source + '\n({ localParse, generateIncantation })', context);
const NEW_FORMS = ['whip', 'prison', 'decoy', 'drain', 'beast', 'halo', 'sword', 'rush', 'totem', 'mark'];

test('every new form is known to Jev, the game shape table and the runtime', () => {
  const elementsJs = read('../public/js/elements.js'), extra = read('../public/js/spells-extra.js');
  const shapeBlock = elementsJs.slice(elementsJs.indexOf('export const SHAPES'), elementsJs.indexOf('export const SELF_FORMS'));
  for (const form of NEW_FORMS) {
    assert.ok(SHAPES[form], `${form} missing from the Jev ontology`);
    assert.match(shapeBlock, new RegExp(`\\n  ${form}: \\{ name:`), `${form} missing from elements.js SHAPES`);
    assert.match(extra, new RegExp(`registerShape\\('${form}'`), `${form} has no runtime class`);
  }
});

test('keyword parser recognises the new forms in English and Japanese', () => {
  const cases = {
    'fire whip, lash them': 'whip', '炎の鞭': 'whip',
    'imprison him in a cage of ice': 'prison', '氷の牢獄': 'prison',
    'create clones of me, illusion': 'decoy', '分身の術': 'decoy',
    'drain his life': 'drain', '命を吸収せよ': 'drain',
    'summon a fire dragon': 'beast', '雷の龍よ': 'beast',
    'a halo of blades around me': 'halo', '光の円環': 'halo',
    'holy sword from the sky, excalibur': 'sword', '天より来たれ聖剣': 'sword',
    'rush forward wrapped in flame': 'rush', '岩の突進': 'rush',
    'a stone totem to guard me': 'totem', '雷の祭壇': 'totem',
    'death mark of shadow': 'mark', '闇の刻印': 'mark',
  };
  for (const [text, shape] of Object.entries(cases)) assert.equal(localParse(text).shape, shape, text);
});

test('older forms keep their keywords', () => {
  const cases = { 'fireball': 'orb', 'a remarkable fireball': 'orb', 'lightning strike': 'chain', 'tidal wave': 'wave', 'stone wall': 'wall', 'heal me': 'ward', 'fire dragon breath beam': 'beam' };
  for (const [text, shape] of Object.entries(cases)) assert.equal(localParse(text).shape, shape, text);
});

test('the rival generates incantations for the new forms that parse back to the same form', () => {
  let seed = 1; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const form of NEW_FORMS) for (const lang of ['en', 'ja']) {
    const text = generateIncantation(rng, 0.2, 'fire', form, lang);
    assert.equal(localParse(text).shape, form, `${lang}: ${text}`);
  }
});

test('every form has a How-to guide line in English and Japanese', async () => {
  const { FORM_GUIDE } = await import('../public/js/form-guide.js');
  for (const k of Object.keys(SHAPES)) { assert.ok(FORM_GUIDE[k]?.[0] && FORM_GUIDE[k]?.[1], k); }
});
