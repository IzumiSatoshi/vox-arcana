// Vox Arcana server
// - serves the game from ./public
// - POST /api/spell : turns an incantation into spell parameters via Jev (System One decisions API)
// - GET  /api/status: Jev availability for the HUD
// - /ws             : tiny WebSocket relay for online duels (no dependencies)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PUBLIC = path.join(__dirname, 'public');

// ---------------------------------------------------------------- Jev config
const config = {
  url: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  keyFile: path.join(__dirname, '..', 'api_key', 'jev_api.txt'),
  timeoutMs: 6000,
};
try {
  Object.assign(config, JSON.parse(fs.readFileSync(path.join(__dirname, 'jev.config.json'), 'utf8')));
} catch { /* optional */ }
if (process.env.JEV_URL) config.url = process.env.JEV_URL;
if (process.env.JEV_MODEL) config.model = process.env.JEV_MODEL;

function loadKey() {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY.trim();
  try {
    const raw = fs.readFileSync(config.keyFile, 'utf8').trim();
    // tolerate "KEY=value" / "key: value" files
    const m = raw.match(/([A-Za-z0-9_\-\.]{20,})/);
    return m ? m[1] : raw;
  } catch { return null; }
}
const API_KEY = loadKey();
const jevState = { keyLoaded: !!API_KEY, lastOk: null, lastError: null, lastLatency: null, calls: 0 };

// ---------------------------------------------------------------- spell ontology
const ELEMENTS = {
  fire: 'Fire: flame, heat, burning, magma, inferno, blaze, explosion of flame',
  ice: 'Ice: frost, snow, freezing cold, glacier, blizzard, frozen crystals',
  water: 'Water: waves, tide, ocean, rain, bubbles, torrent, flood',
  lightning: 'Lightning: thunder, electricity, plasma, sparks, thunderbolts',
  wind: 'Wind: air, gale, gust, cyclone, sky currents, blades of wind',
  earth: 'Earth: stone, rock, mountain, sand, metal, gems, crystal of the ground',
  darkness: 'Darkness: shadow, void, abyss, curse, death, night, black flame, demons',
  light: 'Light: holy, radiance, heaven, angels, sunlight, divine judgment',
  nature: 'Nature: plants, vines, thorns, roots, forest, flowers, leaves, life, growth',
  poison: 'Poison: venom, toxins, acid, miasma, plague, disease, corrosion, toxic gas (毒・瘴気・酸)',
  arcane: 'Pure arcane: mana, runes, stars, cosmos, space, time, raw magical force with no natural element',
};
const SHAPES = {
  orb: 'A single ball projectile thrown at the enemy (fireball, orb, sphere, magic bullet).',
  barrage: 'A volley of many small projectiles fired in rapid succession: arrows, shards, spears, needles, missiles.',
  funnels: 'Summoned floating drones / familiars / wisps / bits that fly around the enemy and shoot it repeatedly (homing funnels).',
  beam: 'A continuous laser, ray, breath or cannon blast channeled in a straight line.',
  tornado: 'A tornado, cyclone, whirlwind or spinning column that travels along the ground.',
  meteor: 'Something crashing down from the sky onto the target: meteor, comet, falling star, sky hammer.',
  nova: 'An explosion or shockwave bursting outward all around the caster (nova, burst, ring blast).',
  spikes: 'Spikes, pillars, spires or eruptions bursting from the ground in a line toward the enemy.',
  wall: 'A defensive wall, barrier or rampart raised in front of the caster to block attacks.',
  vortex: 'A black hole, gravity well, whirlpool or singularity that pulls enemies into a point.',
  chain: 'An instant strike that zaps the target directly: chain lightning, smite, thunderbolt, judgment strike.',
  storm: 'A cloud raining damage over an area for a while: rain, hail, blizzard, fire rain, thunderstorm.',
  crescent: 'A flying crescent slash or blade wave: wind cutter, sword arc, scythe slash.',
  ward: 'Healing or a protective shield bubble on the caster: heal, cure, protect, barrier around me.',
  field: 'A lingering zone left on the ground: poison pool, burning ground, glyph/rune circle, quagmire, electrified field, frozen floor.',
  wave: 'A huge advancing wave or wall that rolls forward along the ground: tidal wave, tsunami, avalanche, rolling wall of flame.',
  enhance: 'Empower or infuse the caster\'s own body with an element (speed, strength, armor, regeneration, elemental coating). Not a plain heal.',
  hand: 'Summon a persistent giant spectral hand, fist, arm or familiar weapon that floats beside the caster and attacks by itself.',
  leap: 'Launch the caster high into the air in one magical jump.',
  flight: 'Let the caster fly, levitate or hover for a while.',
  blink: 'Teleport, warp, dash through space or blink the caster to another spot.',
  construct: 'Build a solid physical structure to stand on or hide behind: platform, floor, bridge, stairs, box, pillar, tower, fortress rampart.',
};
const TRAITS = {
  trajectory: {
    instructions: 'How does the magic travel? Pick the motion the words imply; default to straight when nothing is said.',
    criteria: {
      straight: 'Flies straight at the target.', arc: 'Lobbed in a high arc like a thrown grenade or catapult.', spiral: 'Corkscrews / spirals / twists around its path.',
      zigzag: 'Zigzags or jitters erratically like lightning.', boomerang: 'Flies out and comes back to the caster.', orbit: 'First circles around the caster, then launches.',
      serpentine: 'Snakes and slithers like a dragon or serpent.', homing: 'Seeks, chases or hunts the target.',
    },
  },
  pattern: {
    instructions: 'How many copies are emitted and in what arrangement? Default single.',
    criteria: {
      single: 'One instance.', fan: 'A spread / fan of several at once.', ring: 'All around the caster in every direction.', cascade: 'A rapid stream one after another.',
      crossfire: 'From both sides converging on the target.', rain: 'Falling down from the sky over the target.', spiral: 'A rotating spiral stream.', swarm: 'A chaotic swarm or flock.',
    },
  },
  payload: {
    instructions: 'What happens when the magic lands or ends? Default explode.',
    criteria: {
      explode: 'Explodes.', split: 'Bursts into many smaller fragments or shrapnel.', linger: 'Leaves a lingering pool, fire, cloud or zone behind.', erupt: 'Erupts upward as a pillar, geyser or column.',
      chain: 'Arcs or jumps onward to other targets.', implode: 'Collapses inward, pulling things in, then bursts.', echo: 'Repeats in aftershocks / echoes several times.',
      crystallize: 'Grows crystals, thorns or spikes out of the ground where it hits.', none: 'Nothing special, just hits.',
    },
  },
  morph: {
    instructions: 'What does the magic itself look like? Default orb.',
    criteria: {
      orb: 'A ball or sphere.', lance: 'A spear, lance, javelin, arrow or needle.', shard: 'Crystal shards or jagged fragments.', disc: 'A spinning disc, ring, wheel or chakram.',
      star: 'A star or glittering sparkle.', blade: 'A blade or sword.', dragon: 'A dragon, serpent, phoenix, wolf or other beast shape.', skull: 'A skull, ghost, spirit or wraith.',
      bubble: 'A bubble or droplet.', cube: 'A cube, block or geometric solid.',
    },
  },
  construct: {
    instructions: 'If the incantation builds a structure, which kind? Otherwise platform.',
    criteria: { platform: 'A floor, platform or bridge.', stairs: 'Stairs or a staircase.', box: 'A box, cube or block.', pillar: 'A pillar, column or tower.', rampart: 'A thick fortress wall or rampart.' },
  },
};
const SCORES = {
  power: {
    levels: ['feeble', 'weak', 'modest', 'standard', 'strong', 'powerful', 'devastating', 'cataclysmic', 'world-ending'],
    instructions: 'How much raw power does this incantation convey? A plain name like "Fireball" is standard. Grandiose, invoking incantations with superlatives (ultimate, supreme, gods, ancient, forbidden, all the power of...) are cataclysmic or world-ending. Diminutives (tiny, little, weak) lower it.',
  },
  tier: {
    levels: ['cantrip', 'novice', 'adept', 'expert', 'master', 'archmage', 'legendary', 'mythic', 'divine'],
    instructions: 'Rank of the spell judged by the ceremony of the incantation. One or two plain words = novice. Summoning spirits, invoking gods or elements, multi-clause chants, oaths and dramatic declarations push it toward legendary, mythic or divine.',
  },
  speed: { levels: ['glacial', 'slow', 'moderate', 'fast', 'lightning-fast'], instructions: 'How fast should the spell travel or act?' },
  size: { levels: ['tiny', 'small', 'medium', 'large', 'huge', 'colossal'], instructions: 'Physical size / area of effect of the spell.' },
  temperature: {
    levels: ['absolute zero', 'freezing', 'cold', 'cool', 'neutral', 'warm', 'hot', 'scorching', 'inferno', 'stellar core'],
    instructions: 'Temperature of the magic. Ice is freezing, ordinary fire is hot, blue/white/solar fire is stellar core, non-thermal magic is neutral.',
  },
  weight: { levels: ['weightless', 'light', 'medium', 'heavy', 'crushing'], instructions: 'How heavy / massive is the spell (rock and meteors are heavy, light and wind are weightless)?' },
  sharpness: { levels: ['blunt', 'rounded', 'edged', 'keen', 'razor-sharp'], instructions: 'How sharp / piercing is the spell (blades, lances, needles are sharp; orbs and hammers are blunt)?' },
  count: { levels: ['single', 'a pair', 'a few', 'many', 'countless'], instructions: 'How many projectiles or instances are described?' },
  duration: { levels: ['instant', 'brief', 'moderate', 'sustained', 'lingering'], instructions: 'How long does the spell persist?' },
  chaos: { levels: ['precise', 'controlled', 'unstable', 'chaotic'], instructions: 'How wild and unstable is the magic?' },
};

function buildQuestions() {
  const q = {
    element: { type: 'choice', instructions: 'Primary element of the spell being cast.', criteria: ELEMENTS },
    element2: {
      type: 'choice',
      instructions: 'Secondary element fused into the spell, if the incantation clearly mixes two elements. Otherwise none.',
      criteria: { none: 'Only one element is involved.', ...ELEMENTS },
    },
    shape: { type: 'choice', instructions: 'The form the spell takes.', criteria: SHAPES },
    is_spell: {
      type: 'noul',
      instructions: 'Is this text an attempt to cast a spell or attack (as opposed to random chatter)?',
      criteria: { true: 'It names or describes magic, an attack, an element, or a spell.', false: 'It is unrelated talk with no magic intent.' },
    },
    homing: {
      type: 'noul',
      instructions: 'Should the spell seek and track the enemy?',
      criteria: { true: 'Words like seeking, homing, chasing, hunting, guided, never miss.', false: 'Fired straight or placed.' },
    },
  };
  for (const [k, v] of Object.entries(SCORES)) q[k] = { type: 'score', instructions: v.instructions, criteria: v.levels };
  for (const [k, v] of Object.entries(TRAITS)) q[k] = { type: 'choice', instructions: v.instructions, criteria: v.criteria };
  return q;
}
const QUESTIONS = buildQuestions();

// ---------------------------------------------------------------- answer normalisation
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
function scoreTo01(ans, levels) {
  if (!ans) return null;
  const n = levels.length;
  const probs = ans.probabilities;
  if (probs && typeof probs === 'object') {
    const entries = Object.entries(probs).filter(([, p]) => num(p) !== null);
    if (entries.length) {
      const keys = entries.map(([k]) => k);
      const allNumeric = keys.every((k) => /^-?\d+(\.\d+)?$/.test(k));
      const base = allNumeric ? Math.min(...keys.map(Number)) : 0;
      let s = 0, t = 0;
      for (const [k, p] of entries) {
        let idx = levels.indexOf(k);
        if (idx < 0 && ans.legend && ans.legend[k] !== undefined) idx = levels.indexOf(ans.legend[k]);
        if (idx < 0 && allNumeric) idx = Number(k) - (base === 1 ? 1 : 0);
        if (idx < 0 || idx >= n) continue;
        s += idx * p; t += p;
      }
      if (t > 0) return Math.max(0, Math.min(1, s / t / (n - 1)));
    }
  }
  const sc = ans.score;
  if (typeof sc === 'string') {
    const i = levels.indexOf(sc);
    if (i >= 0) return i / (n - 1);
  }
  if (num(sc) !== null) {
    if (sc > 0 && sc < 1 && !Number.isInteger(sc)) return sc;
    if (sc >= n) return 1;
    // a legend usually tells us whether levels are 0- or 1-based; otherwise guess 1-based when score==n
    let base = 0;
    if (ans.legend && typeof ans.legend === 'object') {
      const lk = Object.keys(ans.legend).map(Number).filter((x) => !isNaN(x));
      if (lk.length) base = Math.min(...lk);
    }
    return Math.max(0, Math.min(1, (sc - base) / (n - 1)));
  }
  return null;
}
function noulTo01(ans) {
  if (!ans) return null;
  if (num(ans.noul) !== null) return ans.noul;
  if (typeof ans.noul === 'boolean') return ans.noul ? 1 : 0;
  if (ans.probabilities && num(ans.probabilities.true) !== null) return ans.probabilities.true;
  return null;
}
function choiceOf(ans, allowed) {
  if (!ans) return { value: null, conf: 0 };
  let value = ans.choice ?? ans.value ?? null;
  let conf = num(ans.confidence) ?? 0.5;
  if ((!value || !allowed.includes(value)) && ans.probabilities) {
    const best = Object.entries(ans.probabilities).sort((a, b) => b[1] - a[1])[0];
    if (best) { value = best[0]; conf = best[1]; }
  }
  if (!allowed.includes(value)) value = null;
  return { value, conf };
}

function normalise(answers) {
  const el = choiceOf(answers.element, Object.keys(ELEMENTS));
  const el2 = choiceOf(answers.element2, ['none', ...Object.keys(ELEMENTS)]);
  const sh = choiceOf(answers.shape, Object.keys(SHAPES));
  const p = {
    element: el.value, elementConf: el.conf,
    element2: el2.value && el2.value !== 'none' && el2.value !== el.value && el2.conf > 0.3 ? el2.value : null,
    shape: sh.value, shapeConf: sh.conf,
    isSpell: noulTo01(answers.is_spell),
    homing: noulTo01(answers.homing),
  };
  for (const [k, v] of Object.entries(SCORES)) p[k] = scoreTo01(answers[k], v.levels);
  for (const [k, v] of Object.entries(TRAITS)) { const c = choiceOf(answers[k], Object.keys(v.criteria)); p[k] = c.value; p[k + 'Conf'] = c.conf; }
  return p;
}

// ---------------------------------------------------------------- Jev call
const cache = new Map();
async function askJev(text, meta) {
  const key = text.trim().toLowerCase();
  if (cache.has(key)) return { ...cache.get(key), cached: true, latency: 0 };
  const state = [
    `Incantation spoken by a mage during a magic duel (English or Japanese): "${text}"`,
    `Chant duration: ${(meta.chantSeconds ?? 0).toFixed(1)} seconds.`,
    `Voice intensity (0-1): ${(meta.loudness ?? 0.5).toFixed(2)}.`,
  ].join('\n');
  const t0 = performance.now();
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, state, questions: QUESTIONS }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const latency = Math.round(performance.now() - t0);
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  const json = JSON.parse(bodyText);
  const answers = json.answers || json.decisions || json.output || {};
  const params = normalise(answers);
  const out = { params, model: json.model || config.model, latency };
  if (process.env.JEV_DEBUG) console.log(JSON.stringify(answers, null, 1));
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- http
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') {
    return sendJson(res, 200, { jev: { ...jevState, url: config.url, model: config.model } });
  }
  if (url.pathname === '/api/spell' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { ok: false, error: 'bad json' }); }
    const text = String(body.text || '').slice(0, 600).trim();
    if (!text) return sendJson(res, 400, { ok: false, error: 'empty incantation' });
    if (!API_KEY) return sendJson(res, 200, { ok: false, error: 'no Jev API key found' });
    jevState.calls++;
    try {
      const r = await askJev(text, body);
      jevState.lastOk = Date.now(); jevState.lastLatency = r.latency; jevState.lastError = null;
      const p = r.params;
      console.log(`[jev ${r.cached ? 'cache' : r.latency + 'ms'}] "${text.slice(0, 70)}" -> ${p.element}/${p.element2 || '-'} ${p.shape} pow=${p.power?.toFixed(2)} tier=${p.tier?.toFixed(2)}`);
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      jevState.lastError = String(e.message || e).slice(0, 300);
      console.warn('[jev error]', jevState.lastError);
      return sendJson(res, 200, { ok: false, error: jevState.lastError });
    }
  }
  // static files
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- minimal WebSocket relay
const rooms = new Map(); // room -> Set(client)
let nextId = 1;

function wsSend(c, obj) {
  if (c.closed) return;
  const p = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  c.socket.write(Buffer.concat([h, p]));
}
function broadcast(c, obj) {
  const set = rooms.get(c.room); if (!set) return;
  const s = JSON.stringify(obj);
  for (const o of set) if (o !== c) wsSend(o, s);
}
function leave(c) {
  if (c.closed) return;
  c.closed = true;
  const set = rooms.get(c.room);
  if (set) { set.delete(c); broadcast(c, { t: 'leave', from: c.id }); if (!set.size) rooms.delete(c.room); }
  c.socket.destroy();
}
function onMessage(c, str) {
  let m; try { m = JSON.parse(str); } catch { return; }
  if (m.t === 'join') {
    c.room = String(m.room || 'arena').slice(0, 32); c.name = String(m.name || 'Mage').slice(0, 24);
    if (!rooms.has(c.room)) rooms.set(c.room, new Set());
    const set = rooms.get(c.room);
    wsSend(c, { t: 'welcome', id: c.id, peers: [...set].map((o) => ({ id: o.id, name: o.name })) });
    set.add(c);
    broadcast(c, { t: 'join', from: c.id, name: c.name });
    return;
  }
  if (!c.room) return;
  m.from = c.id;
  broadcast(c, m);
}
function parseFrames(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const ml = masked ? 4 : 0;
    if (b.length < off + ml + len) return;
    let payload = Buffer.from(b.subarray(off + ml, off + ml + len));
    if (masked) { const mk = b.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i & 3]; }
    c.buf = b.subarray(off + ml + len);
    if (op === 0x8) return leave(c);
    if (op === 0x9) { c.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
    if (op === 0x1 || op === 0x0) {
      c.frag = op === 0x1 ? [payload] : [...(c.frag || []), payload];
      if (fin) { onMessage(c, Buffer.concat(c.frag).toString('utf8')); c.frag = null; }
    }
  }
}
server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const c = { id: nextId++, socket, buf: Buffer.alloc(0), room: null, name: 'Mage', closed: false };
  socket.on('data', (d) => { c.buf = Buffer.concat([c.buf, d]); try { parseFrames(c); } catch { leave(c); } });
  socket.on('close', () => leave(c));
  socket.on('error', () => leave(c));
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Vox Arcana running at  http://localhost:${PORT}`);
  console.log(`  ✦ Jev: ${API_KEY ? 'key loaded' : 'NO KEY (local spell parser only)'} -> ${config.url}\n`);
});
