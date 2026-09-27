import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkPeerTree, safePeerSpec, validateHostMessage } from '../public/js/peer-validation.js';
import { buildJevSpec, boltSpec } from '../public/js/spellbook.js';
import { SHAPE_KEYS } from '../public/js/elements.js';
import { Combatant } from '../public/js/combat.js';
import { snapshot } from '../online/protocol.js';
import { ApiRateLimit } from '../api-rate-limit.js';

const player = () => snapshot(new Combatant({ id:'guest', name:'Guest' }));
const spec = () => buildJevSpec('fire orb',{ok:true,params:{element:'fire',shape:'orb',power:0.5,tier:0.5,isSpell:1}});
test('host HTML and computed spell fields cannot reach rendering', () => {
  const original=spec(), hostile={...original,name:'<img src=x onerror=alert(1)>',cost:'<svg onload=alert(1)>',mag:1e8,dmgMult:1e8,seed:[]};
  const clean=validateHostMessage({type:'cast',caster:'guest',player:player(),spec:hostile}).spec;
  assert.equal(clean.name,original.name);assert.equal(clean.cost,original.cost);assert.equal(clean.mag,original.mag);assert.equal(clean.dmgMult,original.dmgMult);
  assert.equal(typeof clean.seed,'number');
});
test('all legitimate spell forms and basic attacks survive peer validation', () => {
  for (const shape of SHAPE_KEYS) {const value=buildJevSpec('Spell',{ok:true,params:{element:'fire',shape,isSpell:1}});assert.equal(safePeerSpec(value).shape,shape);}
  assert.equal(safePeerSpec(boltSpec('arcane')).basic,true);
});
test('malformed, excessive and prototype payloads are rejected before dispatch', () => {
  for(const data of [JSON.parse('{"type":"state","__proto__":{"polluted":true}}'),{type:'state',values:Array(257).fill(0)},{type:'state',value:Infinity}]) assert.throws(()=>checkPeerTree(data));
  let nested={};for(let i=0;i<15;i++)nested={nested};assert.throws(()=>checkPeerTree({type:'state',nested}));
  assert.throws(()=>safePeerSpec({...spec(),power:1e9}));
  assert.throws(()=>safePeerSpec({...spec(),morph:'<script>'}));
  const p=player();p.pos=[0,'<img>',0];assert.throws(()=>validateHostMessage({type:'cast',caster:'guest',player:p,spec:spec()}));
  assert.equal({}.polluted,undefined);
});
test('state arrays are bounded and valid snapshots including reactions work', () => {
  const a=player(),b={...player(),id:'host'};
  const m={type:'state',matchId:'match',round:1,players:[a,b],score:[0,0],time:3,phase:'playing',countdown:0,boxes:[]};
  assert.doesNotThrow(()=>validateHostMessage(m));
  assert.throws(()=>validateHostMessage({...m,players:Array(100).fill(a)}));
  assert.doesNotThrow(()=>validateHostMessage({type:'hit',target:'guest',damage:20,pos:[0,0,0],element:'fire',reaction:{name:'Melt',color:'#ff7700'}}));
});
test('HTTP rate limits deny bursts and fail closed when shared storage is unavailable', async () => {
  const limit=new ApiRateLimit({shared:false},false);
  await limit.consume('test',2);await limit.consume('test',2);
  await assert.rejects(limit.consume('test',2),{status:429});
  const failed=new ApiRateLimit({shared:true,commands:async()=>null},true);
  await assert.rejects(failed.consume('test',2),{status:503});
});
test('production CSP allows only the exact import map as inline script', () => {
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url)));
  const csp=config.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const script=html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1].replaceAll('\r\n','\n');
  assert.ok(csp.includes('sha256-'+createHash('sha256').update(script).digest('base64')));
  assert.ok(!csp.split(';').find(s=>s.includes('script-src')).includes('unsafe-inline'));
  assert.ok(csp.includes("frame-ancestors 'none'"));
});


test('relay selection reaches WebRTC and never enables a direct fallback', async () => {
  const { P2PDuelTransport }=await import('../public/js/p2p.js');
  const previous=globalThis.RTCPeerConnection;let configuration;
  globalThis.RTCPeerConnection=class {constructor(options){configuration=options;}};
  try {
    for(const relayOnly of [false,true]) {
      const peer=new P2PDuelTransport({});peer.api=async()=>({iceServers:[{urls:'turn:example.test:3478'}],turnConfigured:true,relayOnly});peer.poll=()=>{};
      await peer.setup(peer.generation);clearTimeout(peer.connectTimer);
      assert.equal(configuration.iceTransportPolicy,relayOnly?'relay':'all');
    }
  } finally {globalThis.RTCPeerConnection=previous;}
});


test('peer room win targets reject invalid values and retain legacy defaults', () => {
  const room = {code:'ABCDEF123456',phase:'waiting',region:'P2P',interpreter:'jev',public:false,players:[]};
  assert.equal(validateHostMessage({type:'room',room:{...room}}).room.winsToWin, 2);
  assert.equal(validateHostMessage({type:'room',room:{...room,winsToWin:3}}).room.winsToWin, 3);
  for (const winsToWin of [0,11,1.5,'3',null]) assert.throws(() => validateHostMessage({type:'room',room:{...room,winsToWin}}));
});
