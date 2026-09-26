# Deploy Vox Arcana

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

## Local Vercel build check

```powershell
npx vercel pull --yes --environment=preview
npm run vercel:build
```

The wrapper normalizes duplicate `Path` / `PATH` entries passed by Vercel CLI on Windows and uses the system command processor. It affects only child processes; no machine configuration is changed.

## Hosting configuration

`vercel.json` overrides the old project's Vite preset with a framework-neutral build. `npm run build` syntax-checks browser modules and copies `public/` to `dist/`. `/api/*` is rewritten to the Node function in `api/index.js`, which shares interpretation logic with the local server. Node is pinned to 24.x, matching the existing project.

Hosted spell requests always use Vercel AI Gateway. On Vercel they authenticate
with the deployment OIDC token, which is covered by the project budget. The
must have a suitable AI Gateway spending cap and Vercel Firewall rate limits
for `/api/spell` before opening the deployment to the public. Configure these
in your own account; the repository does not create them. The local server
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

Typed casting is available without a microphone. Browser permission and speech
support vary; selecting a local spell model does not make speech recognition
offline. Display language and speech language are independent.

The local Node server is for development. Do not expose it directly to an
untrusted network. See `SECURITY_AUDIT.md` for the historical findings and scope;
that report is not a certification of the current application.
