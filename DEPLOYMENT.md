# Deploy Vox Arcana

Online duels use WebRTC: the room creator's browser hosts the match. Vercel serves
the website, spell API, and room setup. Connect Redis and optionally Cloudflare
TURN as described in [ONLINE_DUEL.md](ONLINE_DUEL.md). No separate game server is required.

Use your own Vercel account and project. Run `npx vercel login` and
`npx vercel link` to select or create a project. The local link lives in ignored
`.vercel/project.json`. Credentials, provider budgets, and firewall rules are
not supplied by this repository.

## Validate and deploy

Use Node.js 24, then run:

```powershell
npm ci
npm test
npm run build
npm run deploy:preview
```

`deploy:preview` uploads this checkout to a preview deployment in your linked project. Check the menu, Settings, `/api/status`, and a typed spell in Practice there.

When ready to replace the production site:

```powershell
npm run deploy:production
```

This command uses `vercel deploy --prod` and replaces the existing project's production site. It uploads source and builds on Vercel; it does not require a successful local `vercel build` or `--prebuilt`.

On another checkout, first run `npx vercel link`, then `npx vercel pull --yes --environment=preview`. Keep `.vercel` and environment files out of Git.

## Web Analytics

The game loads Vercel Web Analytics through `public/js/analytics.js`, using
Vercel's script integration for static sites. No npm dependency is needed.
It tracks visits and page views; no custom gameplay events or chant text are sent
by this integration. Analytics is skipped on HTTP and localhost.

In the Vercel dashboard, select this project, open **Analytics**, and click
**Enable** if it is not already enabled. Then deploy the updated project.
After visiting the deployed site, check the browser Network tab for
`/_vercel/insights/script.js` and a successful analytics collection request,
then check the Analytics dashboard for visits. Ad blockers can prevent collection.

See the [Vercel Web Analytics setup guide](https://vercel.com/docs/analytics/quickstart).

## Local Vercel build check

```powershell
npx vercel pull --yes --environment=preview
npm run vercel:build
```

The wrapper normalizes duplicate `Path` / `PATH` entries passed by Vercel CLI on Windows and uses the system command processor. It affects only child processes; no machine configuration is changed.

## Hosting configuration

`vercel.json` overrides the old project's Vite preset with a framework-neutral build. `npm run build` syntax-checks browser modules and copies `public/` to `dist/`. `/api/*` is rewritten to the Node function in `api/index.js`, which shares interpretation logic with the local server. Node is pinned to 24.x, matching the existing project.

## Spell API endpoint

Select the route using the **server environment variable** `JEV_ENDPOINT`:

| Value | Provider | Server credentials | Spending controls |
| --- | --- | --- | --- |
| `gateway` | Vercel AI Gateway | Deployment OIDC on Vercel; `AI_GATEWAY_API_KEY` for local testing | AI Gateway budget |
| `direct` | TypeSafe Jev API | `JEV_API_KEY` (or `TYPESAFE_API_KEY`) | Your Jev account's billing controls |

In Vercel **Project Settings → Environment Variables**, set `JEV_ENDPOINT`
for the desired environment and redeploy. For direct mode, store `JEV_API_KEY`
as a sensitive server variable. Never use a public/client environment prefix,
place the key in `public/`, or commit it. Vercel cannot read files on your PC.
Locally, `server.js` already reads `../api_key/jev_api.txt`; alternatively use
`node --env-file=.env server.js` with your ignored `.env` file.

When unset, hosted deployments default to `gateway`; local runs use `direct`
when a Jev key exists, otherwise `gateway`. Local `jev.config.json` also accepts
`"endpoint": "direct"` or `"endpoint": "gateway"`; the environment takes precedence.
An invalid setting or missing credentials produces an explicit error. Requests
cannot override the chosen endpoint, and failures never switch providers.

Keep Vercel Firewall rate limits for `/api/spell`. Direct requests bypass the
AI Gateway budget, so configure limits with your Jev provider before using it
publicly. Hiding a key does not prevent abuse of a public API proxy.

Errors distinguish missing credentials, failed authentication (401), denied
access (403), payment/credits (402), provider rate limits (429), provider outages,
timeouts, network failures, rejected requests, and malformed responses. The HUD
labels the selected provider. Raw provider errors are not returned or logged.

Gateway access and available credits still need to be checked by casting a spell on the preview. A configured credential is not proof that upstream requests will succeed. No credential values are bundled into the browser or copied into tracked files. Optional `JEV_URL` and `JEV_MODEL` configure local direct requests. The local server alone reads the local key file or `jev.config.json`. The production build excludes `voice-lab.html`, `casting-lab.html`, and `voice-fixtures/`.

## Features by environment

| Feature | Local server | Vercel |
| --- | --- | --- |
| Practice and AI duel | Yes | Yes |
| Browser speech / typed spells | Yes | Yes |
| Jev interpretation | Direct Jev or AI Gateway | Direct Jev or AI Gateway |
| MiniLM on the server CPU | Yes | Disabled with an explanation |

The hosted function intentionally does not import the heavyweight local inference runtime. Local-model availability is exposed through `/api/status` and the UI.

Typed casting is available without a microphone. Browser permission and speech
support vary; selecting a local spell model does not make speech recognition
offline. Display language and speech language are independent.

The local Node server is for development. Do not expose it directly to an
untrusted network. See `SECURITY_AUDIT.md` for the historical findings and scope;
that report is not a certification of the current application.

## Shared spell cache

See [SHARED_SPELL_CACHE.md](SHARED_SPELL_CACHE.md) for the Vercel Storage connection, version resets, language preloading, and fallback behavior. No shared database is provisioned automatically.
