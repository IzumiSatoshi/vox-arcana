import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const port = 18947;
const child = spawn(process.execPath, ['server.js'], {env: {...process.env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe']});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timed out')), 10000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited: ${code}`)); });
    child.stdout.on('data', data => { if (String(data).includes('Vox Arcana running')) { clearTimeout(timer); resolve(); } });
  });
  const get = async () => (await fetch(`http://localhost:${port}/api/status`)).json();
  const post = async (path, body) => {
    const res = await fetch(`http://localhost:${port}${path}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await get()).local.phase, 'unloaded');
  assert.equal((await post('/api/spell', {text: 'Fireball', provider: 'local'})).status, 503);
  assert.equal((await post('/api/spell', {text: 'Fireball', provider: 'invalid'})).status, 400);
  assert.equal((await post('/api/local/load', {})).body.ok, true);
  assert.equal((await get()).local.phase, 'ready');
  for (const text of ['a sphere of burning flame', '凍りつく氷の矢', '水の波', 'thank you for your help']) {
    const { body } = await post('/api/spell', {text, provider: 'local'});
    assert.equal(body.ok, true); assert.equal(body.provider, 'local');
    assert.equal(body.params.isSpell, text === 'thank you for your help' ? 0 : 1, text);
    console.log(JSON.stringify({text, element: body.params.element, shape: body.params.shape, isSpell: body.params.isSpell, latency: body.latency}));
  }
  assert.equal((await post('/api/spell', {text: '水の波', provider: 'local'})).body.cached, true);
  console.log('HTTP routing, loading, errors, inference, and cache checks passed.');
} finally {
  child.kill();
}
