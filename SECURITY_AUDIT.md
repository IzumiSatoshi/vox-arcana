# Security audit — 2026-09-24

> Historical snapshot: the online match and WebSocket relay described below were removed after this audit. The other findings concern separate HTTP/API behavior and have not been re-audited here.

## Verdict and scope

The current Node server is not ready for untrusted online players or public exposure. The hosted spell API also needs controls against unauthorized AI spending. This is an audit of the current saved working tree, including uncommitted deployment changes, not just the last commit. Application code was not changed.

Reviewed the Node HTTP/static server, API handler and Vercel entry point, WebSocket relay and client, remote game-state handling, HTML output, local inference, speech integration, build configuration, and dependency audit. No live deployment attacks, real paid inference, destructive load tests, or browser JavaScript payload execution were performed. Deployment access protection, firewall rules, production headers, and provider spending limits were not independently verified. External controls could reduce exposure but are not present in the reviewed application code.

## What “online match” actually is

`public/js/net.js` connects to `/ws` on the same host as the game. Players enter a name and room string (default `arena`). The Node server groups sockets by that string and forwards messages to other members. There are no accounts, room passwords, invitation tokens, matchmaking service, two-player limit, or authoritative game server.

Clients send movement, health, scores, casts, and up to 120 characters of the current chant transcript; receivers render/simulate those messages. The relay does not carry raw microphone audio. Speech recognition and Jev interpretation are separate data paths: browser recognition can use the browser's service, while Jev receives text and cast metadata. Selecting local spell interpretation alone does not guarantee local speech recognition.

`api/index.js` creates the hosted handler with `hosted: true`; `/api/status` advertises `online: false`, and `main.js:137` disables the online button. The Vercel deployment does not run the Node `/ws` relay. Locally, `server.listen(PORT)` omits a host and binds to unspecified network interfaces, subject to firewall/network rules; the printed localhost URL does not restrict access to localhost.

## Findings

### 1. High — Remote player names are inserted as HTML

**Locations:** `public/js/main.js:610`, `:631`, `:653`; `public/js/hud.js:218`, `:268`; `server.js:86`.

A room member can send a `state` message with an arbitrary HTML name. The receiver copies it into the combatant and renders it using scoreboard `innerHTML` every frame. Join/death/leave feeds also interpolate names into HTML. The join-time 24-character limit does not constrain subsequent state names. Scores are also interpolated without type validation.

**Impact:** DOM XSS in other players' game origin, allowing script to tamper with the game, read same-origin browser storage, and invoke its APIs. This does not directly expose the server-side API key, but permits use of the API. No application CSP was found in the reviewed configuration; production-injected headers were not checked.

**Evidence:** The isolated probe relayed a harmless marker payload and executed the real scoreboard method against a fake DOM element; the HTML reached `innerHTML` unchanged. Actual browser execution was not tested.

**Fix:** Build rows and feeds with DOM nodes and `textContent` for every player-controlled value. Validate field types and lengths at the relay and client. Add a suitable CSP as defense in depth.

### 2. High — Unauthenticated requests can spend AI credits

**Locations:** `api-handler.js:118`, `:134`, `:169`, `:181`.

Anyone who can reach `/api/spell` can trigger a credentialed upstream request. The optional Origin check restricts ordinary cross-origin browsers, but a direct HTTP client can omit Origin. There is no application authentication, caller quota, request-rate limit, or upstream concurrency ceiling. Different text bypasses the cache; simultaneous identical uncached requests are not coalesced either.

**Impact:** Unauthorized AI consumption, cost, provider quota exhaustion, and degraded service. Applies to hosted and local APIs when credentials are configured and the endpoint is reachable.

**Evidence:** Twelve concurrent unauthenticated requests without Origin generated twelve mocked upstream calls through the actual hosted handler. No paid requests were made.

**Fix:** For a private prototype, require deployment access protection or a server-validated access session. Apply per-user/IP limits, a global upstream concurrency limit, request coalescing, and provider spending caps. For serverless hosting, use a shared rate-limit store rather than process-local counters.

### 3. High — One malformed URL crashes the Node server

**Location:** `server.js:35–38`.

`decodeURIComponent(url.pathname)` is inside an async HTTP event callback without a catch. A path such as `/%` throws; the returned promise is not handled by the HTTP event emitter.

**Impact:** A reachable client can stop the local game/API/relay process. A supervisor could restart it, but repeated requests could keep it unavailable. The Vercel handler does not use this static server.

**Evidence:** Executed the original HTTP callback in a disposable Node 24.16.0 child process; the malformed path terminated it with exit code 1 and `URIError: URI malformed`.

**Fix:** Catch URL parsing/decoding failures and return 400. Ensure the HTTP callback handles all rejected promises.

### 4. High — The relay trusts arbitrary message types and spell parameters

**Locations:** `server.js:85–87`; `public/js/net.js:13`; `public/js/main.js:613–617`, `:652–657`; `public/js/spells.js:812`, `:2461–2485`.

After joining, clients can send any JSON message type and body. The server overwrites `from`, but forwards everything else, including the server-reserved `welcome` type. The client accepts any welcome message as its identity. Remote casts go straight to `spells.cast`, without the normal local cast validation, mana/cooldown enforcement, or bounded numeric schema. Remote state directly controls displayed health, position, and scores.

**Impact:** Identity/state corruption, cheating, arbitrary cast spam, and potentially expensive rendering work in other players' browsers. For example, meteor count is computed directly from remote `spec.count` and drives object creation. Missing or invalid fields can also throw in client handlers. Full GPU exhaustion and combat exploits were not executed.

**Evidence:** The relay probe forwarded a forged welcome with an attacker-chosen ID. Cast/state trust and unbounded object-count derivation were verified from source.

**Fix:** Define explicit client/server message schemas. Reserve server message types, bound every number/string/array, reject non-finite numbers and unknown enum values, and impose cast/message limits. Derive spell statistics on the server. Competitive play additionally requires authoritative movement, resource, hit, and score validation; client-side clamps alone cannot prevent cheating.

### 5. High — WebSocket memory and work are unbounded

**Locations:** `server.js:60`, `:89–106`, `:118`.

The handwritten frame parser has no maximum frame/message/fragment size or receive-buffer ceiling. It accepts declared 64-bit lengths and retains incoming bytes until completion. Rooms, connections, message rates, and outgoing socket queues are also uncapped. Socket write backpressure is ignored.

**Impact:** Reachable clients can grow receive buffers, fragment storage, room membership, and output queues, potentially exhausting memory or CPU and affecting all games/API traffic in the process.

**Evidence:** A 10-byte header declaring a 1 GiB message was accepted and retained without disconnect. The payload was deliberately not allocated or sent. Additional resource-limit omissions were verified from source.

**Fix:** Replace the custom parser with a maintained WebSocket implementation configured with a small maximum payload. Add connection/room/message limits, handshake and idle timeouts, heartbeat handling, and slow-consumer termination based on queued bytes.

### 6. Medium — WebSocket upgrades accept unrelated websites

**Locations:** `server.js:110–118`, `:123`.

The upgrade handler checks neither Origin nor authentication. An unrelated website can attempt to connect a visitor's browser to a reachable relay and join its rooms. Browser mixed-content/private-network protections may block particular routes; those protections are browser-dependent and do not replace server checks.

**Impact:** Cross-site room access, message injection, and access to relayed state/transcripts where the connection succeeds. A room name is a routing label, not a security boundary.

**Evidence:** The actual upgrade callback accepted `Origin: https://untrusted.example` and returned 101 in the isolated socket harness. A browser-to-LAN attack was not tested.

**Fix:** Restrict Origin to explicit trusted origins, enforce session/room authorization, and match exactly `/ws`. Bind to loopback by default; make LAN exposure an explicit configuration. Use TLS for remotely accessible hosting.

### 7. Medium — Switching rooms retains old subscriptions and leaks membership

**Locations:** `server.js:67–83`.

A second join changes `c.room` without removing the socket from its previous room set. It keeps receiving old-room traffic while sending into its new room. On disconnect, only the latest room removes it, leaving stale objects in earlier rooms. One connection can repeat this for many room names.

**Impact:** Broken room isolation and retained socket/client objects. Room names already lack access control, so this is not a bypass of a claimed private-room authorization system.

**Evidence:** A client joined A, switched to B, still received A's state message, and remained in A's member set after leaving.

**Fix:** Reject duplicate joins or remove prior membership atomically before joining. Ensure all disconnect paths release membership, cap room occupancy, and delete empty rooms.

### 8. Medium, conditional — Static path check allows sibling directories sharing the prefix

**Locations:** `server.js:38–41`.

`file.startsWith(PUBLIC)` accepts both the public directory and siblings such as `public-private`. On Windows, an encoded backslash traversal such as `/..%5cpublic-private%5cmarker.txt` survives URL pathname parsing and resolves into that sibling while passing the prefix check.

**Impact:** Files outside the intended static root can be read if such a sibling exists and contains readable files. This is not arbitrary disk access, and no sensitive sibling file was demonstrated.

**Evidence:** The actual path operations accepted the sibling target in a Windows probe; no outside file was read.

**Fix:** Use `path.relative` and reject `..`, parent-prefixed, or absolute relative results, or use a maintained static-file server. Account for symlinks if the served directory can contain them.

## Other observations

- Credential handling is server-side in the reviewed code. Static builds copy `public`, not server credentials; environment files and local credential configuration are ignored. A narrow embedded-secret pattern scan of public/API/scripts sources found no matches. This is not a complete repository-history or production-bundle secret audit.
- API input limits and finite-number checks exist; cross-origin POSTs with mismatching Origin are rejected. These are useful controls but do not provide authentication or quotas.
- Local inference has an eight-request pending cap and shared loading work. Its load endpoint is still unauthenticated for reachable direct clients and can trigger a model download/initialization.
- Chant text is logged on the server, and raw upstream error excerpts are returned to callers and included in public `/api/status`. Prefer minimal logs and generic public errors, with details in restricted server logs.
- Three.js loads from a version-pinned third-party CDN; npm audit does not cover that browser dependency or remote model artifacts. Consider bundling browser code and pinning model revisions for reproducible deployment.

## Validation and next steps

- `npm test`: **83 passed, 0 failed**.
- `npm audit --json`: **0 reported vulnerabilities** at audit time. This checks registry advisories for the npm dependency graph, not application security or all externally loaded assets.
- `node scripts/security-audit.mjs`: **all eight isolated behavior probes confirmed**. This script makes no network requests and uses dummy credentials. Its assertions describe vulnerabilities and are expected to fail once those behaviors are fixed; it is intentionally outside the normal regression-test suite.

First restrict access to any deployed spell API and keep the relay unavailable to untrusted users. Then fix HTML output and request error handling, replace/harden the WebSocket layer, and add server-side protocol validation and quotas. Do not treat the current relay as secure competitive multiplayer.

Only this report and the isolated audit script were added. No fixes, deployment changes, secret rotation, or production setting changes were performed.
