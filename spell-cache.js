import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const TTL = 7 * 24 * 60 * 60;
const hash = value => createHash('sha256').update(value).digest('hex');
export const normalizeChant = text => text.trim().toLowerCase();

// A deployment gets a new namespace; local edits get a new namespace on restart.
export function spellCacheVersion(identity) {
  const release = process.env.JEV_CACHE_VERSION || process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL;
  const digest = createHash('sha256').update(JSON.stringify(identity));
  if (release) digest.update(release);
  else {
    for (const name of ['api-handler.js', 'spell-ontology.js', 'spell-cache.js', 'p2p-signaling.js', 'package.json']) digest.update(readFileSync(new URL(name, import.meta.url)));
    const visit = directory => {
      for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
        if (item.isDirectory()) visit(path);
        else if (/\.(js|css|html|json)$/.test(item.name)) digest.update(item.name).update(readFileSync(path));
      }
    };
    try { visit(new URL('./public/', import.meta.url)); } catch { /* public files may be CDN-only */ }
  }
  return digest.digest('hex').slice(0, 24);
}

// Only the server can write interpretations. The download contains spell parameters,
// not the original provider response, account metadata, or rejected conversation.
export function compactSpell(entry) {
  return { text: entry.text, params: entry.value.params, model: entry.value.model, endpoint: entry.value.endpoint };
}

export class SpellCache {
  constructor({ version, url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
    fetcher = (...args) => fetch(...args), maxMemory = 10000 } = {}) {
    this.version = version;
    this.url = url?.replace(/\/$/, ''); this.token = token; this.fetcher = fetcher;
    this.memory = new Map(); this.maxMemory = maxMemory; this.pending = new Map(); this.retryAt = 0;
    this.shared = !!(this.url && this.token);
  }
  status() { return { version: this.version, storage: this.shared ? 'redis' : 'memory', shared: this.shared, degraded: Date.now() < this.retryAt }; }
  keys(text, language) {
    const rank = `vox:spells:${this.version}:${language}`;
    const id = hash(normalizeChant(text));
    return { rank, id, key: `${rank}:${id}` };
  }
  async commands(commands) {
    if (!this.shared || Date.now() < this.retryAt) return null;
    try {
      const response = await this.fetcher(`${this.url}/pipeline`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands), signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error('cache unavailable');
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length !== commands.length || rows.some(row => row.error)) throw new Error('cache unavailable');
      return rows.map(row => row.result);
    } catch {
      this.retryAt = Date.now() + 30000;
      return null; // Cache outages must not prevent spell casting or expose credentials.
    }
  }
  remember(key, entry) {
    this.memory.delete(key); this.memory.set(key, entry);
    if (this.memory.size > this.maxMemory) this.memory.delete(this.memory.keys().next().value);
  }
  async get(text, language) {
    const { key, rank, id } = this.keys(text, language);
    const rows = await this.commands([['GET', key]]);
    let entry;
    try { entry = rows ? (rows[0] ? JSON.parse(rows[0]) : null) : this.memory.get(key); } catch { entry = null; }
    if (!entry?.value?.params || entry.language !== language || normalizeChant(entry.text) !== normalizeChant(text)) return null;
    entry.hits = (entry.hits || 0) + 1;
    this.remember(key, entry);
    if (entry.value.params.isSpell >= 0.65) await this.commands([
      ['ZINCRBY', rank, 1, id], ['EXPIRE', rank, TTL], ['ZREMRANGEBYRANK', rank, 0, -50001],
    ]);
    return { ...entry.value, cached: true, latency: 0, cacheVersion: this.version };
  }
  async put(text, language, value) {
    const { key, rank, id } = this.keys(text, language);
    const entry = { text: normalizeChant(text), language, value, hits: 1 };
    this.remember(key, entry);
    const commands = [['SET', key, JSON.stringify(entry), 'EX', TTL]];
    if (value.params.isSpell >= 0.65) commands.push(['ZINCRBY', rank, 1, id], ['EXPIRE', rank, TTL], ['ZREMRANGEBYRANK', rank, 0, -50001]);
    await this.commands(commands);
  }
  async resolve(text, language, interpret) {
    const { key } = this.keys(text, language);
    if (this.pending.has(key)) return { ...await this.pending.get(key), cached: true, latency: 0 };
    const job = (async () => {
      const cached = await this.get(text, language);
      if (cached) return cached;
      const value = { ...await interpret(), cacheVersion: this.version };
      await this.put(text, language, value);
      return value;
    })();
    this.pending.set(key, job);
    try { return await job; } finally { if (this.pending.get(key) === job) this.pending.delete(key); }
  }
  async top(language, limit = 1000) {
    const { rank } = this.keys('', language);
    const ranking = await this.commands([['ZREVRANGE', rank, 0, limit - 1]]);
    let entries;
    if (ranking && Array.isArray(ranking[0])) {
      const ids = ranking[0];
      const rows = ids.length ? await this.commands([['MGET', ...ids.map(id => `${rank}:${id}`)]]) : [[]];
      if (rows) entries = (rows[0] || []).flatMap(value => { try { return value ? [JSON.parse(value)] : []; } catch { return []; } });
    }
    entries ||= [...this.memory.values()].filter(entry => entry.language === language).sort((a, b) => b.hits - a.hits);
    const selected = []; let bytes = 0;
    for (const entry of entries) {
      if (entry.language !== language || !(entry.value?.params?.isSpell >= 0.65)) continue;
      const compact = compactSpell(entry);
      bytes += Buffer.byteLength(JSON.stringify(compact));
      if (bytes > 2 * 1024 * 1024 || selected.length >= limit) break;
      selected.push(compact);
    }
    return { ...this.status(), language, entries: selected };
  }
}
