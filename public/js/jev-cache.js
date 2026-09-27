// Shared by solo casting and the authoritative P2P host. Store successful
// interpretations as soon as they arrive, including typed and no-preview casts.
export function spellCacheKey(text, meta = {}) {
  const provider = meta.provider || 'jev';
  return JSON.stringify([provider, meta.language || 'en-US', provider === 'jev' ? text.trim().toLowerCase() : text.trim()]);
}

// Cache status describes this lookup, not the original request that filled it.
export const cachedSpellResult = result => result && ({ ...result, cached: true, latency: 0, rtt: 0 });

export function requestCachedSpell(owner, text, meta, request) {
  const key = spellCacheKey(text, meta);
  owner.jevCache ||= new Map(); owner.jevPending ||= new Map();
  const cached = owner.jevCache.get(key);
  if (cached) return Promise.resolve(cachedSpellResult(cached));
  if (owner.jevPending.has(key)) return owner.jevPending.get(key);
  const version = owner.cacheVersion;
  const pending = request(text, meta).then(result => {
    if (result.cacheVersion && owner.cacheVersion !== version && result.cacheVersion !== owner.cacheVersion) {
      return { ok: false, retryable: true, error: 'The spell cache was updated. Please retry.' };
    }
    if (result.ok && result.params && !result.partial) {
      owner.adoptCacheVersion?.(result.cacheVersion);
      owner.jevCache.set(key, result);
      if (owner.jevCache.size > 5000) owner.jevCache.delete(owner.jevCache.keys().next().value);
    }
    return result;
  }).finally(() => { if (owner.jevPending.get(key) === pending) owner.jevPending.delete(key); });
  owner.jevPending.set(key, pending);
  return pending;
}
