import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const env = { ...process.env, NO_UPDATE_NOTIFIER: '1' };
if (process.platform === 'win32') {
  const shim = fileURLToPath(new URL('./vercel-windows.cjs', import.meta.url)).replaceAll('\\', '/');
  env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require="${shim}"`;
}
const child = spawn('npx vercel build', [], { env, stdio: 'inherit', shell: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
