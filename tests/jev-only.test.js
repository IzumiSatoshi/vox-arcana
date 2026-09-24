import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const book = readFileSync(new URL('../public/js/spellbook.js', import.meta.url), 'utf8');
const builder = book.slice(book.indexOf('export function buildJevSpec'), book.indexOf('// Merge local + Jev')).replace('export ', '');
const gameClass = main.slice(main.indexOf('class Game {'), main.indexOf('window.game = new Game();'));
function setup(ask = async () => ({ok: false})) {
  const context = vm.createContext({
    clamp: n => Math.max(0, Math.min(1,n)), ELEMENT_KEYS: ['arcane','fire','ice'], SHAPE_KEYS: ['orb','spear'], finalizeSpec: x => x,
    localParse: () => { throw new Error('Keyword parser must not run in Jev mode'); },
    buildSpec: () => { throw new Error('Hybrid builder must not run in Jev mode'); },
    performance: {now:()=>1000}, askJev: ask, audio: {chantStart() {}, chantStop() {}, ui() {}}, t: x => x,
  });
  vm.runInContext(builder, context);
  const Game = vm.runInContext(gameClass+'; Game;', context);
  const g = Object.create(Game.prototype);
  g.settings = {useJev: true}; g.mode='practice'; g.player={alive:true,canAct:()=>true}; g.cast=[];
  g.voice={finishMetric(_,outcome){g.outcome=outcome;},markCast(){},init:async()=>{}};
  g.hud={preview(){},chant(text){g.message=text;}};g.noteJev=()=>{};g.performCast=s=>g.cast.push(s);
  return {g, build: vm.runInContext('buildJevSpec',context)};
}
const result = {ok:true,params:{element:'fire',shape:'orb',power:0.8,tier:0.2,isSpell:1,trajectory:'straight'}};
test('Jev values win even when the text contains conflicting explicit keywords', async () => {
  const {g}=setup(()=>{throw new Error('Already interpreted');});
  await g.castIncantation('ice spear homing', {loudness:0.4}, result);
  assert.equal(g.cast[0].element,'fire');assert.equal(g.cast[0].shape,'orb');assert.equal(g.cast[0].trajectory,'straight');assert.equal(g.cast[0].power,0.8);
});
test('Jev alone may reject words recognized by the keyword parser', async () => {
  const {g}=setup();await g.castIncantation('fireball',{}, {ok:true,params:{isSpell:0}});
  assert.equal(g.cast.length,0);assert.equal(g.outcome,'no-magic');
});
test('awaits exact pending interpretation instead of keyword casting or a duplicate request', async () => {
  let resolve; const pending=new Promise(r=>resolve=r);
  const {g}=setup(()=>{throw new Error('Duplicate request');});g.spec={pending:new Map([['natural phrase',pending]])};
  const cast=g.castIncantation('natural phrase',{},null);assert.equal(g.cast.length,0);
  resolve(result);await cast;assert.equal(g.cast.length,1);
});
test('Jev failure never becomes a keyword cast', async () => {
  const {g}=setup();await g.castIncantation('fireball',{},null);
  assert.equal(g.cast.length,0);assert.equal(g.outcome,'jev-error');
});
test('superseded interpretations do not cast after a new chant or screen change', async () => {
  let resolve;const {g}=setup(()=>new Promise(r=>resolve=r));
  const cast=g.castIncantation('phrase',{},null);g.pendingJevCast=null;resolve(result);await cast;
  assert.equal(g.cast.length,0);
});
test('partial interpretations cannot supply a final spell', () => {
  const {build}=setup();assert.equal(build('ice spear',{...result,partial:true}),null);
});
test('Jev readiness and typed casts require no static keywords', async () => {
  const {g}=setup(async()=>result);
  assert.equal(g.readyToInterpret('Make the air remember winter',{chunks:[[{text:'Make the air remember winter',final:true}]]}),true);
  g.typedCast('Make the air remember winter');assert.ok(g.channel.jev);assert.equal(g.previewCost,0);
  await g.channel.jev;
});
test('hands-free Jev accepts text without keyword gating', async () => {
  const {g}=setup(async()=>result);await g.initVoice();
  g.voice.onAuto('Make the air remember winter');await new Promise(r=>setImmediate(r));
  assert.equal(g.cast.length,1);
});


test('negative Jev interpretation of an unfinished fragment does not end recognition early', () => {
  const {g}=setup();g.spec={map:new Map([['Sum',{ok:true,params:{isSpell:0}}]])};
  assert.equal(g.readyToInterpret('Sum',{chunks:[[{text:'Sum',final:false}]]}),false);
  assert.equal(g.readyToInterpret('Sum',{chunks:[[{text:'Sum',final:true}]]}),true);
});


function startSpec(g) {
  g.settings.instantCast=true;
  g.spec={map:new Map(),pending:new Map(),latest:null,latestMagic:null,order:0,lastText:'',lastSend:0,inflight:0};
  g.chantT=1;g.voice.peak=0.4;
}
test('instant mode submits every changed transcript even with several requests in flight', async () => {
  const calls=[];const {g}=setup(text=>{calls.push(text);return new Promise(()=>{});});startSpec(g);
  await g.initVoice();g.chanting=true;
  for(const text of ['a','ab','abc','abcd','abcde']) {g.voice.chantText=()=>text;g.voice.onText();}
  g.voice.onText();assert.deepEqual(calls,['a','ab','abc','abcd','abcde']);
});
test('newest valid magic is chosen by transcript order, not response order', async () => {
  const replies=[];const {g}=setup(()=>new Promise(r=>replies.push(r)));startSpec(g);
  g.speculate('first');g.speculate('second');g.speculate('third');
  replies[1](result);await Promise.resolve();
  replies[2]({ok:true,params:{isSpell:0}});await Promise.resolve();
  replies[0](result);await Promise.resolve();
  assert.equal(g.spec.latestMagic.text,'second');
});
test('instant release freezes the newest completed magic and casts once', async () => {
  const replies=[];const {g}=setup(()=>new Promise(r=>replies.push(r)));startSpec(g);
  g.speculate('fire');replies[0](result);await Promise.resolve();
  g.chanting=true;g.voice.rec={};g.voice.chantText=()=> 'fire with ice';
  g.voice.endChant=()=>({text:'fire with ice',win:{},loudness:0.4});g.voice.finishChant=()=>{};
  g.endChant();assert.equal(g.cast.length,1);assert.equal(g.cast[0].text,'fire');
  replies[1]({...result,params:{...result.params,element:'ice'}});await Promise.resolve();
  assert.equal(g.cast.length,1);assert.equal(g.cast[0].element,'fire');
});
test('superseded speculative replies cannot populate another chant', async () => {
  let reply;const {g}=setup(()=>new Promise(r=>reply=r));startSpec(g);g.speculate('old');
  startSpec(g);reply(result);await Promise.resolve();assert.equal(g.spec.latestMagic,null);
});
test('non-instant mode keeps throttling and exact-text casting', () => {
  const calls=[];const {g}=setup(t=>{calls.push(t);return new Promise(()=>{});});startSpec(g);g.settings.instantCast=false;
  g.speculate('one');g.speculate('two');assert.deepEqual(calls,['one']);
  g.spec.latestMagic={text:'old',j:result};assert.equal(g.bestJev('two'),null);
});
