import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Browser modules are not imported by the other tests (they need three.js from the CDN), so at least parse them all.
test('every browser module parses', () => {
  const dir = new URL('../public/js/', import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', new URL(name, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  }
});
