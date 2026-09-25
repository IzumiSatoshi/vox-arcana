# Deploy Vox Arcana to the existing jev-spell project

This checkout is linked locally to the same Vercel project as `C:/Users/81809/Documents/ChatGPT/jev_spell`:

- Project: `jev-spell` (scope: `mushoku1`)
- Project ID: `prj_A3m0YKjFavWZHvTXeZDONK2Bgmua`
- The link lives in ignored `.vercel/project.json`.

## Validate and deploy

Use Node.js 24, then run:

```powershell
npm ci
npm test
npm run build
npm run deploy:preview
```

`deploy:preview` uploads this checkout to a preview deployment in the existing project. Check the menu, Settings, `/api/status`, and a typed spell in Practice there. This preparation has not published a deployment.

When ready to replace the production site:

```powershell
npm run deploy:production
```

This command uses `vercel deploy --prod` and replaces the existing project's production site. It uploads source and builds on Vercel; it does not require a successful local `vercel build` or `--prebuilt`.

On another checkout, first run `npx vercel link --project jev-spell --scope mushoku1`, then `npx vercel pull --yes --environment=preview`. Keep `.vercel` and environment files out of Git.

## Local Vercel build check

```powershell
npx vercel pull --yes --environment=preview
npm run vercel:build
```

The wrapper normalizes duplicate `Path` / `PATH` entries passed by Vercel CLI 59 on Windows and uses the system command processor. It affects only child processes; no machine configuration is changed. The Vercel build was verified locally with this normalization. The standard app build and 84 automated tests also passed. Browser checks covered the main screen, settings, difficulty selection, Japanese labels, and Practice with the microphone off. Physical microphone capture and hosted gateway access remain unverified.

## Hosting configuration

`vercel.json` overrides the old project's Vite preset with a framework-neutral build. `npm run build` syntax-checks browser modules and copies `public/` to `dist/`. `/api/*` is rewritten to the Node function in `api/index.js`, which shares interpretation logic with the local server. Node is pinned to 24.x, matching the existing project.

Hosted spell requests always use Vercel AI Gateway. On Vercel they authenticate
with the deployment OIDC token, which is covered by the project budget. The
project currently has a $5 monthly AI Gateway budget and a live Vercel Firewall
rule limiting `/api/spell` to 600 requests per IP per 60 seconds. Keep both
controls in place before opening the deployment to the public. The local server
can still use `JEV_API_KEY` or `TYPESAFE_API_KEY` for direct TypeSafe requests;
hosted requests ignore those direct keys so they cannot bypass the budget.

Gateway access and available credits still need to be checked by casting a spell on the preview. A configured credential is not proof that upstream requests will succeed. No credential values are bundled into the browser or copied into tracked files. Optional `JEV_URL` and `JEV_MODEL` configure local direct requests. The local server alone reads the local key file or `jev.config.json`. The production build excludes `voice-lab.html`, `casting-lab.html`, and `voice-fixtures/`.

## Features by environment

| Feature | Local server | Vercel |
| --- | --- | --- |
| Practice and AI duel | Yes | Yes |
| Browser speech / typed spells | Yes | Yes |
| Jev interpretation | Configured key | AI Gateway only |
| MiniLM on the server CPU | Yes | Disabled with an explanation |

The hosted function intentionally does not import the heavyweight local inference runtime. Local-model availability is exposed through `/api/status` and the UI.

The microphone is opt-in on the main screen. Starting Practice or Duel does not request microphone permission. Display language and speech language are independent. Game Settings contains a single Back to main screen action; voice options are in the main-screen sidebar.
