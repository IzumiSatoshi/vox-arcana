# Shared spell cache

## Enable it on Vercel

1. Open the `mushoku1/jev-spell` project in Vercel, choose **Storage**, and connect an **Upstash Redis** database. Select the deployment environments that should use it.
2. Check that the server has `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The integration's `KV_REST_API_URL` and `KV_REST_API_TOKEN` names are also supported. Use a read/write token; the server records interpretations and popularity.
3. Deploy the updated game. No database schema or seed job is required.
4. Check `/api/status`: `cache.storage` should be `redis`, `cache.shared` should be `true`, and `cache.degraded` should be `false` after exercising the cache. Then request the same spell twice and check for `cached: true` on the second response.

Credentials stay in server environment variables. Do not put them in `public/` or paste them into the game. This change does not provision a database or deploy the game.

Without Redis credentials, `/api/status` reports `storage: memory` and `shared: false`. That fallback is shared only by players reaching the same running process, holds up to 10,000 entries, and is lost on restart. It is not a global Vercel cache.

Reference: [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi).

## Lookup and download

- Successful Jev replies enter the browser cache immediately, whether requested
  by a preview, a no-preview voice cast, or typed casting. NPC spells always use the local parser and never call Jev.
  Online and solo modes share this code; the P2P host uses it for guest requests
  too. Cache hits skip the API, and identical pending requests share one promise.
  Failed and incomplete replies are not cached. Ordinary bolts and keyword-only
  spells do not call Jev and do not produce Jev cache entries.
- Normal casts always check the server cache before calling Jev. Keys include the release/model/question identity, recognition locale, and trimmed, lowercased incantation. `en-US`, `en-GB`, and `ja-JP` have separate pools.
- Concurrent identical requests within one server process share a pending promise. Simultaneous first misses on different server instances can still make separate Jev calls.
- On loading, the browser requests `/api/spell-cache?language=ja-JP` (using the selected recognition language). The download runs alongside shader preparation and has a three-second timeout. Failures do not prevent play.
- The pack contains up to 1,000 successful spells, ranked by server-observed requests, capped at 2 MiB of entry JSON. Rejected non-spell text and full provider responses are excluded. Successful incantations in this pack are shared publicly with other players.
- Browser hits need no HTTP request and do not increase the Jev request counter. Consequently, popularity measures server-observed demand, not all casts performed from browser caches. The performance counter still counts HTTP requests, including server-cache hits, rather than billed upstream calls.
- Downloaded parameters drive the same spell preview and casting code. Their readout is explicitly labeled “Cached spell parameters”; it does not invent Jev probabilities. A full server response retains the original probability readout.
- Changing recognition language downloads that language's pack. The browser holds at most 5,000 entries across languages. Typed, rival, and online-server requests still benefit from the server cache; the preload accelerates the manual voice-preview path.

A synthetic 1,000-spell sample using all current parameter fields and varied full-precision scores measured **994,620 bytes of JSON** and **269,648 bytes with gzip**. This is a size estimate, not a live popularity dataset or a guarantee of transport compression. Actual size depends on chant lengths, parameters, and the hosting server's compression.

## Reset on updates

Every Vercel deployment uses a new cache namespace based on `VERCEL_DEPLOYMENT_ID` (falling back to `VERCEL_URL`), plus model, endpoint, and question identity. It begins empty and grows as players use spells. Old namespaces expire after seven days without use; they are never downloaded into the new version. Each remote entry expires seven days after its creation. The popularity index retains at most 50,000 spell IDs per language; other unexpired entries remain available by direct lookup.

For another hosting platform, set `JEV_CACHE_VERSION` to a fresh release identifier on every update. If this variable is set on Vercel, it overrides the automatic deployment identity, so it must also change on each release. Local development hashes the source at server startup; restart after edits.

Open pages check `/api/status` once a minute while not casting, clear old cached interpretations when the version changes, and download the new pack. A page that is continuously casting can continue using its previous version until the next idle check. Reloading starts with the new pack immediately.

Redis failures have a 1.5-second timeout and a 30-second retry backoff. Casting falls back to process memory, then Jev, so an outage can increase upstream calls. `/api/status` exposes `cache.degraded` without exposing credentials. Monitor database capacity and request usage in the storage provider's dashboard.

Reference: [Vercel deployment environment variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_deployment_id).
