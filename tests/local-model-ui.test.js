import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const method = main.slice(main.indexOf('  async loadLocalModel()'), main.indexOf('  jevError(j)'));
function setup(response) {
  const nodes = { 'set-loadmodel': {disabled:false}, 'local-model-status': {textContent:''} };
  const context = vm.createContext({$: id => nodes[id], t:key=>key, fetch:async()=>response});
  const game = vm.runInContext('({' + method + '})', context);
  game.checkJev = async () => { game.localStatus={phase:'unloaded'}; nodes['local-model-status'].textContent='unloaded'; };
  return {game,nodes};
}
test('old server 404 remains actionable after status refresh', async () => {
  const {game,nodes}=setup({status:404});
  await game.loadLocalModel();
  assert.equal(nodes['local-model-status'].textContent,'local.restart');
  assert.equal(nodes['set-loadmodel'].disabled,false);
});
test('model load failure is not overwritten by unloaded status', async () => {
  const {game,nodes}=setup({status:503,ok:false,headers:new Map([['content-type','application/json']]),json:async()=>({ok:false,error:'Download failed'})});
  await game.loadLocalModel();
  assert.equal(nodes['local-model-status'].textContent,'Download failed');
  assert.equal(nodes['set-loadmodel'].disabled,false);
});
test('successful load shows ready after refreshing server state', async () => {
  const {game,nodes}=setup({status:200,ok:true,headers:new Map([['content-type','application/json']]),json:async()=>({ok:true})});
  game.checkJev=async()=>{game.localStatus={phase:'ready'};};
  await game.loadLocalModel();
  assert.equal(nodes['local-model-status'].textContent,'local.ready');
});
