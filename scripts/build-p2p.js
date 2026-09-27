import { build } from 'esbuild';
export async function buildP2P() {
  await build({ entryPoints: ['online/p2p-worker.js'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    outfile: 'public/js/generated/p2p-worker.js', minify: true, legalComments: 'eof' });
  // Protocol validation is shared with the Node server; expose a browser bundle.
  await build({ entryPoints: ['online/protocol.js'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    outfile: 'public/js/generated/p2p-protocol.js', minify: true });
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/build-p2p.js')) await buildP2P();
