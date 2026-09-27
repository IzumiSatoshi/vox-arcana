# Online duels on Vercel

Two players create or join a room, ready up, and play a first-to-two duel.
The room creator's browser runs the authoritative simulation in a Web Worker.
WebRTC carries inputs and game events directly between browsers; Cloudflare TURN
can relay them when networks block a direct connection. Vercel serves the website,
room setup API, and Jev API. No separate game server is needed.

## Hosted setup

1. In the Vercel project's **Storage / Marketplace**, connect **Upstash Redis**.
   Allow the integration to add its REST URL and token to the deployment.
   Accepted names: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or
   `KV_REST_API_URL` + `KV_REST_API_TOKEN`. Use the same database for rooms and
   the [shared spell cache](SHARED_SPELL_CACHE.md).
2. In Cloudflare **Realtime → TURN**, create a TURN key. Add its ID and API token
   to Vercel's server environment as `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`.
   These long-lived secrets remain on the server. Each player receives separate
   temporary credentials valid for one hour. See [Cloudflare's setup guide](https://developers.cloudflare.com/realtime/turn/generate-credentials/).
3. Keep the existing Jev/Gateway configuration from [DEPLOYMENT.md](DEPLOYMENT.md).
   Deploy normally with `npm run build` and the Vercel deployment workflow.
   No `ONLINE_SERVER_URL` is needed.
4. Check `GET /api/p2p`: production should report `available: true`, `shared: true`,
   and `turnConfigured: true`. Check `/api/status` for Jev/cache health.
5. Test two devices on different networks. Create/join, ready, move, cast, rematch,
   and close the host tab. The connection indicator says **Direct** or **Relay**
   and shows the round-trip time between peers.

Redis is required for hosted room setup because separate Vercel requests can run
in different instances. Without it, the lobby explains what to configure. Without
TURN, direct connections can work, but some network combinations cannot connect.
The integrations are prepared in code; no database or TURN account is provisioned.

## Local play

Requires Node 24:

```powershell
npm install
npm start
```

The prestart script builds the browser worker. Open `http://localhost:8787` in two
browsers. Choose **Online duel**, create a room, copy its invite, and join from
the other browser. Both players press **Ready**. Microphone permission is optional;
Enter opens typed casting. Local room setup uses process memory unless Redis is
configured in `.env`; local Jev uses the existing credentials.

## Behavior and limits

- Simulation: 60 Hz in the host worker; snapshots: 20 Hz; guest inputs: 30 Hz.
  Movement/state messages use an unordered channel without retransmission.
  Casts, results, and lobby messages use a reliable ordered channel.
- HTTP polling runs every 1.5 seconds during setup, then stops once WebRTC connects.
  Gameplay needs no long-lived Vercel request or WebSocket.
- Pausing speech for the configured delay (default 300 ms) asks the host to obtain
  a Jev interpretation. Duplicate requests share one pending request. Completed
  interpretations reuse the host's memory cache, then the server's shared cache.
  Guest-supplied spell parameters are never accepted as authoritative.
- Releasing right-click with an exact valid preview casts immediately. Without
  that preview, the game waits for recognition to finish, then interprets the
  final words through the same cache/retry flow used in solo modes. A five-second
  recognition timeout cancels the cast instead of using partial text. Either mouse
  button cancels a pending recognition, interpretation, or typed cast; that click
  is consumed, so it does not fire a bolt or start another chant. Cached
  results avoid a new Jev request; new spells still have model/network latency.
  The launch direction is saved at release, including while final speech words
  arrive. The spell starts at the player's position when the host applies it.
- FPS measures local rendering. During a duel, the Jev indicator shows the host
  browser's session total, shared to the guest every two seconds. It includes
  HTTP spell requests that the server cache answers; host/browser cache hits and
  shared pending requests do not increment it.
- Setup rooms expire after 15 minutes. Deployments use distinct room namespaces.
  Established matches continue without room storage. Rematches after 40 minutes
  require a fresh room so the next ten-minute match fits within the relay
  credential lifetime.
- Closing either player's connection ends the match. No host migration or
  reconnect/resume is implemented. Keep the host browser awake and foregrounded;
  browser suspension can interrupt the match. The host controls combat, so this
  suits casual duels rather than cheat-resistant ranked play.
- Room creation/join and model requests have rate limits; peer traffic is bounded.
  Public listings omit access tokens, SDP, and TURN credentials. Private invite
  codes act as invitations, not as player identities.

The old Node WebSocket server remains in `online/server.js` for its tests and
`npm run online`; the website now uses P2P and does not connect to that server.

## Rough monthly cost (USD, checked 2026-09-27)

| Service | Small test | Paid rate / allowance |
|---|---|---|
| Vercel | Hobby $0 for personal noncommercial use within limits | Pro starts at $20/month; usage above included amounts is extra |
| Upstash Redis | Free: 256 MB, 500,000 commands/month | Pay as you go: $0.20 per 100,000 commands; storage/bandwidth limits also apply |
| Cloudflare TURN forwarding | First 1,000 GB/month free | $0.05/GB beyond that; allowance shared with Cloudflare SFU |
| Jev | Depends on uncached requests and billed input tokens | Direct published rate: $0.042 per million input tokens; output free. Confirm the active Gateway rate in its dashboard |
| Dedicated game server | $0 | The host player's browser runs the simulation |

Sources: [Vercel pricing](https://vercel.com/pricing),
[Hobby eligibility](https://vercel.com/docs/plans/hobby),
[Upstash pricing](https://upstash.com/pricing/redis),
[Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/),
[TypeSafe model pricing](https://docs.typesafe.ai/models),
[Jev on Vercel](https://vercel.com/ai-gateway/models/jev).

### Forwarding examples

The local two-browser test measured approximately **1 KB per state snapshot**.
At 20 snapshots/second, this is about 12 MB over ten minutes, plus guest inputs,
spell events, packet overhead, and relay-path differences. Budget **25–50 MB per
ten-minute relayed duel** initially. This is a planning range, not a measurement
of billed TURN traffic; elaborate spells, longer matches, and retransmissions can
change it. Direct duels incur no TURN forwarding charge.

Assuming every match needs forwarding and the free allowance is otherwise unused:

| Ten-minute duels/month | Estimated relay traffic | Estimated TURN charge |
|---:|---:|---:|
| 1,000 | 25–50 GB | $0 |
| 10,000 | 250–500 GB | $0 |
| 100,000 | 2,500–5,000 GB | $75–200 |

If only 20% need forwarding, multiply traffic by 0.2 before applying the allowance.
Example: 100,000 duels → 500–1,000 GB → $0 within that allowance.
The 20% figure is an example, not a measured connection-failure rate.

### Other usage

- Budget around 100–200 Redis commands per room setup when rivals join within a
  minute, excluding spell-cache traffic. Longer waits use more polls. For 1,000
  setups, that is roughly $0.20–0.40 on pay as you go, or within the free plan's
  allowance. Lua scripts may count internal commands; check actual metering.
  Paid plans do not retain the free plan's 500,000-command allowance.
- Jev example only: 100,000 uncached calls × 5,000 billed input tokens/call ×
  $0.042/million = **$21**. Actual billed tokens for this multi-question request
  must be measured; 5,000 is an assumption. Shared-cache hits reduce calls, and
  multiple speech pauses can produce more than one call per cast.
- Website asset downloads, API invocations, cache downloads, optional domains,
  taxes, and usage above plan allowances are additional. TURN's free allowance
  does not cover Vercel bandwidth. A custom domain is optional.

For a small personal test, infrastructure can fit in **$0/month plus Jev**.
For a small commercial launch, start budgeting **about $20–30/month plus Jev**,
then adjust using provider dashboards. Neither estimate is a spending cap.

## Verification

`npm test` covers room isolation, simultaneous joins, cross-instance Redis access,
temporary TURN credential generation, and existing game behavior. `npm run build`
bundles the worker and checks the browser modules.

`node scripts/check-p2p.mjs` runs a two-browser WebRTC check with a deterministic
mock spell API, so it makes no paid Jev calls. It requires Playwright and Chrome;
set `PLAYWRIGHT_MODULE` to a module URL if installed outside this project, or
`BROWSER_CHANNEL` to another installed Playwright browser channel.
Set `P2P_UI=1` to run the same check through the full game UI and real arena.
It checks movement, preview deduplication, cached casting, release aim, stopped
setup polling, rematch worker restart, and host disconnection.

Real TURN forwarding and cross-network deployment still need a check after Redis
and Cloudflare credentials are configured. The automated rematch check forces
the finished phase; natural round/results logic is covered by simulation tests.

Chant text is shared live over the existing peer data channel and displayed above the opponent (or at the top of the screen when outside view). Microphone audio is not sent to the opponent. The lobby explains this immediately on opening. Text clears when chanting stops, and stale input expires after 500 ms.


## Privacy and message security

The lobby starts with public rooms and offers separate Host and Enter room code buttons. Hosting requires choosing Public or Private. The optional “Hide player IP addresses” checkbox requests TURN-only connectivity for both participants; an unavailable relay produces an error without falling back to a direct connection. Direct mode can disclose your public IP to the opponent. Private rooms are unlisted but anyone with their code can join.

Peer messages are validated before rendering; displayed spell fields are rebuilt from bounded parameters and dynamic HUD text is escaped. Rate limits and production CSP add defense in depth. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for findings, checks, and remaining risks. Both players must refresh after a security deployment to use the corrected client.

Room hosts can choose **1–10 wins (n本先取)** before creation; the default is 2. The room list, waiting room and match HUD show the target. Both peers and rematches use that room setting. The existing 10-minute match timeout still applies.
