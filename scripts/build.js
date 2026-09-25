import { cp, mkdir, readdir, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['public/js', 'api']) {
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
await access('public/index.html');
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
for (const diagnostic of ['voice-lab.html', 'casting-lab.html', 'voice-fixtures']) {
  await rm(`dist/${diagnostic}`, { recursive: true, force: true });
}
console.log('Built static game in dist/; API is served by api/index.js.');
