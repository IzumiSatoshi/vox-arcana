// Browser integration check, with a deterministic spell API (no paid requests).
// Set PLAYWRIGHT_MODULE to an installed Playwright module URL if not local.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createP2PSignaling } from '../p2p-signaling.js';
import { buildP2P } from './build-p2p.js';
await buildP2P();
delete process.env.TURN_KEY_ID; delete process.env.TURN_KEY_API_TOKEN;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const service = createP2PSignaling({ version: 'browser-check', shared: false });
const requests = {}; let spells = 0;
const server = http.createServer(async (req, res) => {
  const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (req.url === '/api/p2p') {
      if (req.method === 'GET') { send(service.status()); return; }
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests[body.action] = (requests[body.action] || 0) + 1;
      const result = await service.act(body);
      // Test local ICE without requiring any external STUN service.
      if (body.action === 'ice') result.iceServers = [];
      send(result); return;
    }
    if (req.url === '/api/spell') {
      spells++;
      setTimeout(() => send({ ok: true, cacheVersion: 'browser-check', params: { element: 'fire', shape: 'orb', isSpell: 1, power: 0.4, size: 0.4 } }), 180);
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (process.env.P2P_UI) {
        let html = await readFile('public/index.html', 'utf8');
        html = html.replaceAll('https://cdn.jsdelivr.net/npm/three@0.169.0/', '/node_modules/three/').replaceAll('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.5.5/', '/node_modules/@pixiv/three-vrm/');
        res.end(html); return;
      }
      res.end('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>'); return;
    }
    if (req.url.startsWith('/api/status')) { send({ jev: { keyLoaded: true }, capabilities: { localModel: false }, cache: { version: 'browser-check' } }); return; }
    if (req.url.startsWith('/api/spell-cache')) { send({ ok: true, version: 'browser-check', entries: [], language: 'en-US' }); return; }
    const relative = decodeURIComponent(req.url.split('?')[0]).slice(1), root = path.resolve('.');
    const file = path.resolve(root, relative.startsWith('node_modules/') ? relative : 'public/' + relative);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'text/javascript' }); res.end(data);
  } catch (error) { send({ error: error.message }, error.status || 500); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome', args: ['--disable-background-timer-throttling'] });
try {
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const uiErrors = [];
  for (const page of pages) {
    page.on('pageerror', error => uiErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('Online duel:')) uiErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    if (process.env.P2P_UI) {
      await page.waitForFunction(() => window.game?.online, null, { timeout: 60000 });
      await page.evaluate(async () => {
        game.settings.quality = 0; await game.online.open(); window.peer = game.online.ws; window.messages = [];
        const original = peer.onmessage; peer.onmessage = event => { messages.push(JSON.parse(event.data)); original(event); };
      });
      assert.equal(await page.locator('.online-privacy-notice').isVisible(), true);
      assert.match(await page.locator('.online-privacy-notice').textContent(), /microphone audio|マイクの音声/);
      continue;
    }
    await page.evaluate(async () => {
      const { P2PDuelTransport } = await import('/js/p2p.js');
      window.messages = []; window.game = { world: { obstacles: [], solids: [], bound: 80 }, jevCache: new Map() };
      window.peer = new P2PDuelTransport(game);
      peer.onmessage = e => messages.push(JSON.parse(e.data)); await peer.connect();
    });
  }
  const [host, guest] = pages;
  if (process.env.P2P_UI) {
    assert.equal(await host.locator('#online-host-form').isVisible(), false);
    assert.equal(await host.locator('#online-join-form').isVisible(), false);
    assert.equal(await host.locator('.online-discover').isVisible(), true);
    await host.locator('#online-show-join').click();
    assert.equal(await host.locator('#online-code').isVisible(), true);
    await host.locator('#online-show-host').click();
    assert.equal(await host.locator('#online-join-form').isVisible(), false);
    assert.equal(await host.locator('#online-public').isChecked(), false);
    assert.equal(await host.locator('#online-private').isChecked(), false);
    assert.equal(await host.locator('#online-create').isDisabled(), true);
    await host.locator('#online-public').check();
    assert.equal(await host.locator('#online-create').isEnabled(), true);
    await host.locator('#online-private').check();
    assert.equal(await host.locator('#online-public').isChecked(), false);
    assert.equal(await host.locator('#online-create').isEnabled(), true);
    await host.locator('#online-wins').fill('0');
    assert.equal(await host.locator('#online-create').isDisabled(), true);
    await host.locator('#online-wins').fill('3');
    await host.locator('#online-create').click();
    await host.waitForFunction(() => peer.room?.code);
    assert.equal(await host.evaluate(() => peer.room.public), false);
    console.log('PASS: explicit Public/Private selection required before room creation');
  } else await host.evaluate(() => peer.command({ type: 'create', name: 'Host', public: false }));
  const code = await host.evaluate(() => peer.room.code);
  await guest.evaluate(code => peer.command({ type: 'join', code, name: 'Guest' }), code);
  for (const page of pages) await page.waitForFunction(() => peer.connected && peer.room.phase === 'waiting', { timeout: 20000 });
  if (process.env.P2P_UI) for (const page of pages) {
    assert.equal(await page.evaluate(() => peer.room.winsToWin), 3);
    assert.match(await page.locator('#online-rules').textContent(), /3/);
  }
  console.log('PASS: two real browsers connected over WebRTC and share the selected win target');
  const pollCount = requests.poll;
  for (const page of pages) await page.evaluate(() => peer.command({ type: 'ready', ready: true }));
  for (const page of pages) await page.waitForFunction(() => messages.some(m => m.type === 'state' && m.phase === 'playing'));
  if (process.env.P2P_UI) for (const page of pages) {
    await page.waitForFunction(() => game.online.active && game.combatants.length === 2 && game.online.phase === 'playing');
    assert.equal(await page.locator('#online-ping').isVisible(), true);
    await page.waitForFunction(() => Number(document.getElementById('performance-fps').textContent) > 0);
  }
  const startPos = await guest.evaluate(() => messages.findLast(m => m.type === 'state').players[1].pos);
  await guest.evaluate(() => { let seq = 100000; window.testChant = 'Fire'; window.inputTimer = setInterval(() => peer.command({ type: 'input', seq: ++seq, yaw: 1.7, pitch: 0.1, x: 1, z: 0, chanting: !!window.testChant, chantText: window.testChant }), 33); });
  await guest.waitForFunction(x => messages.findLast(m => m.type === 'state').players[1].pos[0] > x + 1, startPos[0]);
  for (const phrase of ['Fire', 'Fire tornado']) {
    await guest.evaluate(text => { window.testChant = text; }, phrase);
    for (const page of pages) await page.waitForFunction(text => messages.findLast(m => m.type === 'state').players[1].chantText === text, phrase);
    if (process.env.P2P_UI) await host.waitForFunction(text => document.getElementById('bubble').textContent.includes(text) && !document.getElementById('bubble').classList.contains('hidden'), phrase);
  }
  await guest.evaluate(() => { window.testChant = ''; });
  for (const page of pages) await page.waitForFunction(() => messages.findLast(m => m.type === 'state').players[1].chantText === '');
  console.log('PASS: live enemy chant updates and clears on both peers');
  const results = await guest.evaluate(() => Promise.all([peer.interpret('Fire orb', 'en-US'), peer.interpret('Fire orb', 'en-US')]));
  assert.ok(results.every(result => result.ok)); assert.equal(spells, 1);
  await guest.evaluate(ui => {
    if (ui) { game.releaseAim = { yaw: 0.3, pitch: 0.2 }; return game.castIncantation('Fire orb', { win: {} }, null); }
    return peer.command({ type: 'cast', text: 'Fire orb', language: 'en-US', aim: { yaw: 0.3, pitch: 0.2 } });
  }, !!process.env.P2P_UI);
  for (const page of pages) await page.waitForFunction(() => messages.some(m => m.type === 'cast' && m.spec.text === 'Fire orb'));
  const cast = await guest.evaluate(() => messages.findLast(m => m.type === 'cast'));
  assert.equal(cast.spec.cached, true, 'Host cache hits must label the spell as cached');
  assert.equal(cast.player.yaw, 0.3); assert.equal(cast.player.pitch, 0.2); assert.equal(spells, 1);
  assert.equal(requests.poll, pollCount, 'No signaling polling during the match');
  console.log('PASS: worker simulation, guest movement, deduplicated preview, cached cast, release aim, no match polling');
  await host.evaluate(ui => {
    if (ui) { game.releaseAim = { yaw: 0.9, pitch: 0.1 }; return game.castIncantation('Ice spear', { win: {} }, null); }
    return peer.command({ type: 'cast', text: 'Ice spear', language: 'en-US', aim: { yaw: 0.9, pitch: 0.1 } });
  }, !!process.env.P2P_UI);
  for (const page of pages) await page.waitForFunction(() => messages.some(m => m.type === 'cast' && m.spec.text === 'Ice spear'));
  assert.equal(spells, 2);
  console.log('PASS: uncached release makes one spell request and casts its result');
  const sizes = await guest.evaluate(() => {
    const states = messages.filter(m => m.type === 'state');
    return { states: states.length, averageStateBytes: Math.round(states.reduce((n,m) => n + new TextEncoder().encode(JSON.stringify(m)).length, 0) / states.length) };
  });
  console.log('Traffic sample', JSON.stringify(sizes));
  // Restarting the worker exercises rematch setup without waiting for a ten-minute draw.
  await host.evaluate(() => { peer.worker.terminate(); peer.worker = null; peer.room.phase = 'finished'; peer.room.players.forEach(p => p.ready = false); peer.announce(); messages.length = 0; });
  await guest.evaluate(() => { clearInterval(inputTimer); messages.length = 0; });
  for (const page of pages) await page.evaluate(() => peer.command({ type: 'ready', ready: true }));
  for (const page of pages) await page.waitForFunction(() => messages.some(m => m.type === 'round'));
  if (process.env.P2P_SECURITY) {
    await host.evaluate(() => {
      const round=messages.findLast(m=>m.type==='round');
      peer.peer({type:'cast',caster:round.players[0].id,player:round.players[0],spec:{text:'security probe',element:'fire',shape:'orb',isSpell:1,power:0.1,tier:0,
        name:'<img src=x onerror="window.peerInjected=true">',cost:'<svg onload="window.peerInjected=true">',mag:999999}});
    });
    await guest.waitForFunction(()=>messages.some(m=>m.type==='cast'&&m.spec.text==='security probe'));
    const safe=await guest.evaluate(()=>({spec:messages.findLast(m=>m.type==='cast').spec,injected:!!window.peerInjected,images:document.querySelectorAll('#feed img, #sc-cost svg').length}));
    assert.equal(safe.injected,false);assert.equal(safe.images,0);assert.equal(typeof safe.spec.cost,'number');assert.ok(safe.spec.mag<2);
    await host.evaluate(()=>peer.peer({type:'state',players:Array(100).fill({}),round:1}));
    await guest.waitForFunction(()=>messages.some(m=>m.type==='expired'));
    console.log('PASS: hostile host HTML neutralized and oversized state disconnected');
  }
  await host.evaluate(() => peer.close());
  await guest.waitForFunction(() => !peer.connected && messages.some(m => m.type === 'expired'));
  console.log('PASS: rematch worker restart and host disconnect');
  await guest.evaluate(() => peer.close());
  assert.deepEqual(uiErrors, [], 'No browser or online UI exceptions');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
