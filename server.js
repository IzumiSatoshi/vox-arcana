// Vox Arcana server
// - serves the game from ./public
// - POST /api/spell : turns an incantation into spell parameters via Jev (System One decisions API)
// - GET  /api/status: Jev availability for the HUD
import http from 'node:http';
import { createApiHandler } from './api-handler.js';
import { localModel } from './local-model.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PUBLIC = path.join(__dirname, 'public');

// Disk credentials and model loading belong only to the local server, never the hosted bundle.
let localConfig = {};
try { localConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'jev.config.json'), 'utf8')); } catch { /* optional */ }
let apiKey;
try {
  const raw = fs.readFileSync(localConfig.keyFile || path.join(__dirname, '..', 'api_key', 'jev_api.txt'), 'utf8').trim();
  apiKey = raw.match(/([A-Za-z0-9_\-\.]{20,})/)?.[1] || raw;
} catch { /* environment credentials or local inference can be used instead */ }
const handleApi = createApiHandler({ localModel, config: localConfig, apiKey });

// ---------------------------------------------------------------- http
const MIME = {
  '.mp3': 'audio/mpeg',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.vrm': 'model/gltf-binary',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res);
  // static files
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('invalid path'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Vox Arcana running at  http://localhost:${PORT}`);
  console.log('  ✦ Jev and local model status: /api/status');
  console.log('  ✦ Peer-to-peer duel rooms: /api/p2p');
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(() => process.exit(0)); });
