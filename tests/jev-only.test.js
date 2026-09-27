import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { baseManaCost } from '../public/js/mana.js';
import { requestCachedSpell, cachedSpellResult } from '../public/js/jev-cache.js';
const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const book = readFileSync(new URL('../public/js/spellbook.js', import.meta.url), 'utf8');
const builder = book.slice(book.indexOf('export function buildJevSpec'), book.indexOf('// Merge local + Jev')).replace('export ', '');
const gameClass = main.slice(main.indexOf('class Game {'), main.indexOf('window.game = new Game();'));
function setup(ask = async () => ({ok: false}), now = () => 1000) {
  const context = vm.createContext({
    baseManaCost, requestCachedSpell, cachedSpellResult,
    clamp: n => Math.max(0, Math.min(1,n)), ELEMENT_KEYS: ['arcane','fire','ice'], SHAPE_KEYS: ['orb','spear'], finalizeSpec: x => x,
    localParse: () => { throw new Error('Keyword parser must not run in Jev mode'); },
    buildSpec: () => { throw new Error('Hybrid builder must not run in Jev mode'); },
    performance: {now}, askJev: ask, audio: {chantStart() {}, chantStop() {}, ui() {}}, t: x => x,
  });
  vm.runInContext(builder, context);
  const Game = vm.runInContext(gameClass+'; Game;', context);
  const g = Object.create(Game.prototype);
  g.settings = {useJev: true}; g.mode='practice'; g.player={alive:true,canAct:()=>true}; g.cast=[];
  g.voice={finishMetric(_,outcome){g.outcome=outcome;},markCast(){},setActive(){},init:async()=>{}};
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
test('voice initialization always disables hands-free and prepares the next recognition', async () => {
  const {g}=setup();g.settings.handsFree=true;g.settings.warmVoice=false;await g.initVoice();
  assert.equal(g.voice.handsFree,false);assert.equal(g.voice.prewarm,true);
});


test('negative Jev interpretation of an unfinished fragment does not end recognition early', () => {
  const {g}=setup();g.spec={map:new Map([['Sum',{ok:true,params:{isSpell:0}}]])};
  assert.equal(g.readyToInterpret('Sum',{chunks:[[{text:'Sum',final:false}]]}),false);
  assert.equal(g.readyToInterpret('Sum',{chunks:[[{text:'Sum',final:true}]]}),true);
});


function startSpec(g) {
  g.settings.jevPauseMs=0;
  g.spec={map:new Map(),pending:new Map(),latest:null,latestMagic:null,order:0,lastText:'',lastSend:0,inflight:0};
  g.chantT=1;g.voice.peak=0.4;
}
test('speech and transcript changes postpone interpretation until the fixed pause', async () => {
  let time=1000; const calls=[];
  const {g}=setup(text=>{calls.push(text);return new Promise(()=>{});},()=>time);startSpec(g);
  g.settings.jevPauseMs=300; await g.initVoice();g.chanting=true;
  g.voice.chantText=()=> 'fire';g.voice.onText();assert.equal(calls.length,0);
  time+=200;g.voice.chantText=()=> 'fire dragon';g.voice.onText();
  time+=299;g.speculate('fire dragon');assert.equal(calls.length,0);
  g.voice.lastSpeechAt=time;time+=299;g.speculate('fire dragon');assert.equal(calls.length,0);
  time++;g.speculate('fire dragon');assert.deepEqual(calls,['fire dragon']);
  g.speculate('fire dragon');assert.equal(calls.length,1);
});

test('newest valid magic is chosen by transcript order, not response order', async () => {
  const replies=[];const {g}=setup(()=>new Promise(r=>replies.push(r)));startSpec(g);
  g.speculate('first',true);g.speculate('second',true);g.speculate('third',true);
  replies[1](result);await new Promise(resolve=>setImmediate(resolve));
  replies[2]({ok:true,params:{isSpell:0}});await new Promise(resolve=>setImmediate(resolve));
  replies[0](result);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(g.spec.latestMagic.text,'second');
});
test('instant release cannot cast an earlier Jev answer without the last words', async () => {
  const replies=[];const {g}=setup(()=>new Promise(r=>replies.push(r)));startSpec(g);
  g.speculate('fire',true);replies[0](result);await new Promise(resolve=>setImmediate(resolve));
  const win={ended:false,closed:false,text:'fire with ice'};
  g.chanting=true;g.voice.rec={};g.voice.chantText=()=> 'fire with ice';
  g.voice.endChant=()=>({text:win.text,win,loudness:0.4});g.voice.finishChant=()=>{};g.voice.textOf=w=>w.text;
  g.endChant();assert.equal(g.cast.length,0);assert.ok(g.grace);
  g.resolveVoiceGrace();assert.equal(g.cast.length,0);
  win.ended=true;g.resolveVoiceGrace();assert.equal(g.cast.length,0);
  replies[1]({...result,params:{...result.params,element:'ice'}});await new Promise(r=>setImmediate(r));
  assert.equal(g.cast.length,1);assert.equal(g.cast[0].text,'fire with ice');assert.equal(g.cast[0].element,'ice');
});
test('superseded speculative replies cannot populate another chant', async () => {
  let reply;const {g}=setup(()=>new Promise(r=>reply=r));startSpec(g);g.speculate('old',true);
  startSpec(g);reply(result);await new Promise(resolve=>setImmediate(resolve));assert.equal(g.spec.latestMagic,null);
});
test('release bypasses pause and reuses an identical pending request', () => {
  const calls=[];const {g}=setup(t=>{calls.push(t);return new Promise(()=>{});});startSpec(g);g.settings.jevPauseMs=300;
  g.speculate('fire');assert.equal(calls.length,0);
  g.speculate('fire',true);g.speculate('fire',true);assert.deepEqual(calls,['fire']);
  assert.equal(g.bestJev('different'),null);
});

test('successful results are displayed from cache across chants without another call', async () => {
  const calls=[],shown=[];const {g}=setup(async t=>{calls.push(t);return {...result,raw:{}};});startSpec(g);
  g.hud.jevReply=(_,text)=>shown.push(text);
  g.speculate('fire',true);await new Promise(resolve=>setImmediate(resolve));startSpec(g);g.settings.jevPauseMs=300;
  g.speculate('fire');assert.equal(calls.length,1);assert.equal(g.bestJev('fire').ok,true);assert.deepEqual(shown,['fire','fire']);
  g.voice.lang='ja-JP';startSpec(g);g.speculate('fire',true);assert.equal(calls.length,2);
});

test('non-instant mode activates the full chant instead of its earlier partial answer', async () => {
  const calls=[];const {g}=setup(async text=>{calls.push(text);return result;});startSpec(g);g.settings.instantCast=false;
  g.speculate('open your eyes',true);
  await g.castIncantation('open your eyes fire tornado',{},null);
  assert.deepEqual(calls,['open your eyes','open your eyes fire tornado']);
  assert.equal(g.cast[0].text,'open your eyes fire tornado');
});
test('temporary failure of the latest speculative result retries exactly those words', async () => {
  const calls=[];const {g}=setup(async text=>{calls.push(text);return result;});
  const text='ウォーターフィールドを展開';
  g.spec={pending:new Map([[text,Promise.resolve({ok:false,retryable:true})]])};
  await g.castIncantation(text,{},null);
  assert.deepEqual(calls,[text]);assert.equal(g.cast.length,1);assert.equal(g.cast[0].text,text);
});
test('temporary failures are retried once and cannot activate an older spell', async () => {
  let calls=0;const {g}=setup(async()=>{calls++;return {ok:false,retryable:true};});
  g.spec={map:new Map([['old',result]]),pending:new Map()};
  await g.castIncantation('latest words',{},null);
  assert.equal(calls,2);assert.equal(g.cast.length,0);assert.equal(g.outcome,'jev-error');
});
test('holding unchanged complete words retries a 503 and replaces the partial response with Instant Cast off', async () => {
  let time=1000; const calls=[], replies=[], shown=[];
  const {g}=setup(text=>{calls.push(text);return new Promise(r=>replies.push(r));},()=>time);
  startSpec(g);g.settings.instantCast=false;
  g.hud.jevPending=text=>shown.push(['pending',text]);
  g.hud.jevFailure=text=>shown.push(['error',text]);
  g.hud.jevReply=(_,text)=>shown.push(['reply',text]);
  g.speculate('ファイヤートルネ',true);
  time+=200;g.speculate('ファイヤートルネード',true);
  replies[1]({ok:false,retryable:true,errorCode:'upstream_unavailable'});await new Promise(resolve=>setImmediate(resolve));
  replies[0]({...result,raw:{}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(shown.at(-1),['error','ファイヤートルネード']);
  time+=499;g.speculate('ファイヤートルネード',true);assert.equal(calls.length,2);
  time+=1;g.speculate('ファイヤートルネード',true);assert.equal(calls.length,3);
  replies[2]({...result,raw:{}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(shown.at(-1),['reply','ファイヤートルネード']);
  time+=5000;g.speculate('ファイヤートルネード',true);assert.equal(calls.length,3);
  await g.castIncantation('ファイヤートルネード',{},g.bestJev('ファイヤートルネード'));
  assert.equal(g.cast[0].text,'ファイヤートルネード');
});
test('holding retries are bounded and rate limits do not trigger retry loops', async () => {
  for (const retryable of [true,false]) {
    let time=1000,calls=0;
    const {g}=setup(async()=>{calls++;return {ok:false,retryable};},()=>time);
    startSpec(g);g.settings.instantCast=false;
    for(let i=0;i<10;i++){g.speculate('same words',true);await new Promise(resolve=>setImmediate(resolve));time+=2000;}
    assert.equal(calls,retryable?3:1);
    g.spec.closed=true;time+=10000;g.speculate('same words',true);assert.equal(calls,retryable?3:1);
  }
});


test('a prepared exact spell fires on release without waiting for recognition shutdown', async () => {
  let time=1000,calls=0;const {g}=setup(async()=>{calls++;return result;},()=>time);startSpec(g);g.settings.jevPauseMs=300;
  g.speculate('fire');time+=300;g.speculate('fire');await new Promise(resolve=>setImmediate(resolve));
  g.chanting=true;g.voice.rec={};g.voice.chantText=()=> 'fire';
  g.voice.endChant=({waitForWords})=>{assert.equal(waitForWords,false);return {text:'fire'};};
  g.endChant();assert.equal(g.cast.length,1);assert.equal(calls,1);assert.equal(g.grace,undefined);
});

test('legacy pause preferences cannot change the fixed 300 ms pause', () => {
  let time=1000,calls=0;const {g}=setup(()=>{calls++;return new Promise(()=>{});},()=>time);startSpec(g);g.settings.jevPauseMs=650;
  g.speculate('fire');time+=299;g.speculate('fire');assert.equal(calls,0);
  time++;g.speculate('fire');assert.equal(calls,1);
});

test('online speech uses host interpretation after the pause and immediately on forced release', async () => {
  let time=1000; const calls=[];
  const {g}=setup(()=>{throw new Error('Guest must not call Jev directly');},()=>time);
  startSpec(g);g.mode='online';g.settings.jevPauseMs=300;g.settings.useJev=false;
  g.voice.lang='ja-JP';g.online={ws:{host:false},interpret:async(text,language)=>{calls.push([text,language]);return result;}};
  g.speculate('炎');time+=299;g.speculate('炎');assert.equal(calls.length,0);
  time++;g.speculate('炎');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[['炎','ja-JP']]);
  time++;g.speculate('氷');assert.equal(calls.length,1);
  g.speculate('氷',true);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);
});

test('guest cache displays immediately and warms the authoritative host once', () => {
  const {g}=setup(()=>{throw new Error('Guest must not call Jev directly');});startSpec(g);g.mode='online';
  g.voice.lang='ja-JP';g.settings.spellProvider='local';let calls=0;
  g.online={ws:{host:false},interpret:async()=>{calls++;return result;}};
  g.jevCache=new Map([[JSON.stringify(['jev','ja-JP','炎']),result]]);
  g.speculate('炎',true);g.speculate('炎',true);assert.equal(g.bestJev('炎').params,result.params);assert.equal(g.bestJev('炎').cached,true);assert.equal(calls,1);
});

test('online release keeps its saved aim through late recognition', async () => {
  const {g}=setup();g.mode='online';let sent;
  g.releaseAim={yaw:0.3,pitch:0.2};g.player.yaw=1.2;g.player.pitch=0;
  g.online={interpret:async()=>result,cast:(text,aim)=>{sent={text,aim};}};
  await g.castIncantation('Fire orb',{win:{}},null);
  assert.equal(sent.aim,g.releaseAim);assert.equal(sent.text,'Fire orb');
});

test('cancelling a pending interpretation suppresses late casting in solo and online modes', async () => {
  for (const mode of ['practice','online']) {
    let finish;const {g}=setup(()=>new Promise(resolve=>{finish=resolve;}));g.mode=mode;
    g.voice.cancelChant=()=>{};
    if(mode==='online')g.online={ws:{host:true},cast:()=>{throw new Error('Cancelled spell reached the host');}};
    const pending=g.castIncantation('fireball',{},null);
    assert.equal(g.cancelPendingCast(),true);finish(result);await pending;
    assert.equal(g.cast.length,0);assert.equal(g.message,'chant.cancelled');assert.equal(g.pendingJevCast,null);
  }
});

test('without a preview release waits past 1.8 seconds for recognition to end in either mode', async () => {
  for (const mode of ['practice','online']) {
    let time=1000; const requests=[],casts=[];
    const {g}=setup(async text=>{requests.push(text);return result;},()=>time);startSpec(g);g.mode=mode;
    if(mode==='online') g.online={ws:{host:true},cast:text=>casts.push(text)};
    else g.performCast=spec=>casts.push(spec.text);
    const win={ended:false,closed:false};let words='fi';g.chanting=true;g.voice.rec={};
    g.voice.chantText=()=>words;g.voice.textOf=()=>words;
    g.voice.endChant=({waitForWords})=>{assert.equal(waitForWords,true);return {text:words,win};};
    g.voice.finishChant=()=>{};
    g.endChant();assert.deepEqual(requests,[]);
    time+=2500;words='fire';g.resolveVoiceGrace();assert.deepEqual(requests,[]);assert.deepEqual(casts,[]);
    words='fire tornado';win.ended=true;g.resolveVoiceGrace();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(requests,['fire tornado']);assert.deepEqual(casts,['fire tornado']);
    assert.equal(g.jevCache.size,1);
  }
});

test('recognition timeout cancels without interpreting or casting partial words', () => {
  let time=1000;const {g}=setup(()=>{throw new Error('Must not interpret timed-out recognition');},()=>time);
  g.grace={win:{ended:false},meta:{},until:2000};g.voice.textOf=()=> 'partial';g.voice.finishChant=()=>{};
  time=2001;g.resolveVoiceGrace();assert.equal(g.grace,null);assert.equal(g.cast.length,0);
  assert.equal(g.message,'chant.recognitiontimeout');
});

test('typed and no-preview solo casts populate the same browser cache', async () => {
  let calls=0;const {g}=setup(async()=>{calls++;return result;});
  await g.castIncantation('Fireball',{},null);assert.equal(calls,1);
  g.typedCast('Fireball');await g.channel.jev;assert.equal(calls,1);
  await g.castIncantation('Fireball',{},g.channel.jev);assert.equal(calls,1);
});

test('cache previews refresh the HUD and clear old latency without relabeling a live reply', async () => {
  let calls=0;const live={...result,cached:false,latency:180,rtt:220,raw:{model:'test'}};
  const {g}=setup(async()=>{calls++;return live;});const shown=[];g.noteJev=j=>shown.push(j);
  startSpec(g);g.speculate('fire',true);await new Promise(resolve=>setImmediate(resolve));
  g.speculate('fire',true);assert.equal(g.bestJev('fire').cached,false);
  startSpec(g);g.speculate('fire',true);
  assert.equal(calls,1);assert.equal(shown.at(-1).cached,true);
  assert.equal(shown.at(-1).latency,0);assert.equal(shown.at(-1).rtt,0);
  assert.equal(g.bestJev('fire').cached,true);assert.equal(live.cached,false);
});


test('a guest cached preview is instant but host interpretation waits for 300 ms silence', () => {
  let time=1000;const calls=[];const {g}=setup(()=>{throw new Error('No direct guest request');},()=>time);
  startSpec(g);g.mode='online';g.voice.lang='en-US';
  g.online={ws:{host:false},interpret:(text)=>{calls.push(text);return Promise.resolve(result);}};
  g.jevCache=new Map([[JSON.stringify(['jev','en-US','fire']),result]]);
  g.speculate('fire');assert.equal(g.bestJev('fire').ok,true);assert.equal(calls.length,0);
  time+=299;g.speculate('fire');assert.equal(calls.length,0);
  g.voice.lastSpeechAt=time;time+=299;g.speculate('fire');assert.equal(calls.length,0);
  time++;g.speculate('fire');assert.deepEqual(calls,['fire']);
  g.speculate('fire');assert.equal(calls.length,1);
});
