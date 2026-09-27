import { createHash } from 'node:crypto';

// Vercel owns the forwarded address in hosted requests; local servers use the socket.
// Raw IP addresses are never stored in Redis keys or logs.
export class ApiRateLimit {
  constructor(cache, hosted) { this.cache = cache; this.hosted = hosted; this.local = new Map(); }
  async consume(key, max, seconds = 60) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const id = `vox:limits:${key}:${bucket}`;
    let count;
    if (this.cache.shared) {
      const rows = await this.cache.commands([['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, id, seconds * 2]]);
      count = rows?.[0];
      if (!Number.isFinite(count)) throw Object.assign(new Error('Request limits unavailable. Please retry.'), { status:503 });
    } else {
      for (const [k, row] of this.local) if (row.bucket < bucket) this.local.delete(k);
      if (!this.local.has(id) && this.local.size >= 5000) throw Object.assign(new Error('Too many requests. Please wait.'), { status:429 });
      count = (this.local.get(id)?.count || 0) + 1; this.local.set(id, { bucket, count });
    }
    if (count > max) throw Object.assign(new Error('Too many requests. Please wait a minute.'), { status:429 });
  }
  async check(req, route, action) {
    const address = this.hosted ? req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress : req.socket?.remoteAddress;
    const ip = createHash('sha256').update(String(address || 'unknown').split(',')[0].trim()).digest('hex').slice(0,32);
    if (route === '/api/spell') { await this.consume(`spell:${ip}`,120); await this.consume('spell:global',600); }
    else if (route === '/api/p2p') {
      await this.consume(`rooms:${ip}`,240);
      if (action === 'create' || action === 'join') await this.consume(`${action}:${ip}`,action === 'create' ? 10 : 30);
    } else if (route === '/api/spell-cache') await this.consume(`cache:${ip}`,30);
  }
}
