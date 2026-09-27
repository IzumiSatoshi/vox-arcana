# Security audit — Vox Arcana online duels

Date: 2026-09-27. Scope: the current source checkout, WebRTC peer messages, room signaling, spell API/cache, HTML rendering, deployment headers, and installed npm dependencies. This is an application code review with regression and browser tests, not a browser/OS penetration test or a guarantee of security. Cheating and host-authoritative match fairness are outside the requested scope.

## Can an opponent hack a player's PC?

No intended game feature gives an opponent filesystem access, shell execution, file transfers, screen sharing, or microphone audio. Online play exchanges JSON on WebRTC data channels. Microphone capture remains local to the recognition workflow; the browser's speech service may process audio, but it is not sent to the opponent.

However, the reviewed version had a **high-severity application-level HTML injection risk**: a modified host could supply a spell name or cost that reached an HTML template on the guest. That could run script with the game's website privileges, interfere with the game, read its site storage, and make requests as that page. It is not, by itself, an OS escape, but it was a real trust-boundary mistake. Fixed before this release.

A current browser still supplies the sandbox, WebRTC implementation, WebGL/driver integration, and permission enforcement. Unknown browser/OS/driver vulnerabilities cannot be excluded by this review. Keep browsers and the OS updated.

## Findings and fixes

| Severity | Finding | Change / status |
| --- | --- | --- |
| High | Host-controlled spell fields could reach HTML templates | Spell names, costs, magnitude, damage, and seeds are rebuilt locally from bounded parameters; text in remaining HTML templates is escaped. Host-supplied executable markup is not trusted. |
| High availability impact | Guest accepted insufficiently checked host snapshots and spell payloads | Validate message types, finite numbers, enums, positions, players, state arrays, nested depth, and object keys before dispatch. Reject prototype keys. Bound spell effects and disconnect on excessive messages. |
| Medium | Anonymous HTTP requests could consume Jev/Redis/TURN resources | Add per-address request limits and a shared global spell-request cap. Redis-backed deployments use atomic shared counters and fail closed if limit storage fails. Limits also apply to cache hits, and may affect users sharing an IP. |
| Medium | Direct WebRTC exposes the public IP to the opponent | Optional host setting requires TURN relay for both players. No silent direct fallback. The local connection policy, not a host-supplied label, determines the relay label on the guest. |
| Medium defense in depth | No production script-execution or embedding policy | Add CSP, frame denial, no-referrer, MIME-sniffing prevention, and camera/geolocation restrictions. Only the exact import map is allowed as an inline script; inline event handlers and eval are blocked. Microphone remains allowed for the game itself. |
| Low, local server | Static path prefix comparison and malformed URL handling | Require the public-directory path separator boundary and reject malformed path escapes. |

## Request and resource limits

- Spell requests: 120/minute per address and 600/minute globally. These are request limits, not a guaranteed monetary budget.
- Room operations: 240/minute per address, including at most 10 creates and 30 joins; existing global create/join limits remain.
- Cache downloads: 30/minute per address.
- Peer messages: existing 150/second cap plus aggregate payload cap; individual messages larger than 65,536 string units disconnect. Nested structures and arrays have additional limits.
- Cast/round effects: at most 60 events in a rolling ten-second window. Normal basic attacks and the normal spell cadence remain below this.
- Without Redis, HTTP counters are only per process. Vercel production uses Redis; a distributed deployment without shared counters needs edge enforcement.

## Remaining risks and recommended operating choices

1. **Direct-mode IP privacy.** An IP can indicate an ISP and approximate location and give an attacker a target for traffic flooding. It does not reveal passwords or grant file access. Use the optional relay setting for strangers when IP privacy matters. Relay adds bandwidth cost and may add latency. TURN credentials are temporary; the TURN service and site still necessarily see network information. [MDN: ICE addresses and relay policy](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate/address).
2. **Tab disruption / resource exhaustion.** A hostile peer can still stop responding, disconnect, or send a stream of expensive but allowed game events. Validation and limits reduce abuse; they cannot guarantee smooth rendering on every GPU. The host can end or falsify a match by design. This is not equivalent to PC compromise.
3. **API and TURN billing abuse.** The game is anonymous. Non-browser clients can forge Origin headers and distribute traffic across IPs. Request limits reduce abuse but do not replace provider spending caps, Vercel Firewall rules, or monitoring. The global cap can also be exhausted to deny service. No billing/dashboard configuration was changed by this audit.
4. **Room codes are invitations, not accounts.** Anyone with a private room's code/link can join its open slot. Codes contain 48 random bits, member tokens contain 192 random bits, and access is checked server-side. Public room listing omits member tokens, signaling descriptions, and TURN secrets. Names are not verified identities.
5. **Shared spell-cache privacy.** Submitted spell text can enter the shared language cache and appear in cache downloads. Players should not chant secrets or personal information. This behavior is intentional for the shared-cache design; private rooms do not make spells private.
6. **Third-party/browser trust.** Pinned Three.js/VRM libraries are loaded from jsDelivr; fonts, hosting, speech recognition and TURN have their own trust/privacy boundaries. No known npm advisories were reported for the installed dependency tree at audit time. This does not cover every CDN asset, browser bug, or future advisory.
7. **Local server exposure.** The development server currently listens on the default Node interface. Do not expose it directly to the internet; Vercel is the public deployment. Local API limits are process-local when Redis is absent.

WebRTC data transport is encrypted with DTLS, but encryption does not make an adversarial peer's application messages safe. [RFC 8827](https://www.rfc-editor.org/rfc/rfc8827.html). Per-address limits in production rely on Vercel's trusted forwarded-address headers; do not copy that trust assumption to an arbitrary proxy deployment. [Vercel request headers](https://vercel.com/docs/headers/request-headers).

## Validation

- Full suite: 217 tests passed before the final relay-policy regression was added; that regression and all 13 focused security/signaling checks passed afterward.
- All registered spell forms and basic attacks were checked against the peer validator.
- Full browser PvP check passed with real WebRTC, host worker, previews, cached/uncached casts, live chant text, rematch, and disconnect.
- Malformed JSON structures, HTML-bearing spell fields, oversized state arrays, rate-limit exhaustion, unavailable shared limit storage, and relay unavailability have automated checks.
- `npm audit` and `npm audit --omit=dev`: zero reported vulnerabilities.
- The malicious-peer test in two real browsers confirmed that hostile HTML is neutralized and malformed oversized state disconnects. Production verification is recorded in the completion notes. No physical microphone or OS exploitation test was performed.

Players with an already-open tab must refresh after deployment; publishing new JavaScript does not replace code already running in a tab.


## Production verification

Deployment: `https://jev-spell.vercel.app` (Vercel deployment `dpl_EPTiqyGyYWytbrzy4hTBT283Be2M`). Live responses include the expected CSP, X-Frame-Options and nosniff headers. Two test browsers successfully connected in an unlisted relay-only room; both confirmed the `relay` ICE policy and a Relay route. The test room was closed afterward. Browser checks confirmed that CSP allows normal game loading and blocks injected inline event handlers. The new lobby was checked at desktop and mobile widths.
The production API returned HTTP 200 with shared Redis healthy. A live Jev fire-orb cast succeeded, and the production browser check reported no runtime errors.
