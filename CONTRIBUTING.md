# Contributing

Use Node.js 24.x and install dependencies with `npm ci`.
Run the game with `npm start`; see the README for optional Jev configuration.
Keyword interpretation and typed casting let you develop without an API key
or microphone. Optional model downloads and live API calls are separate from
the default automated tests.

Before submitting a change, run:

```sh
npm test
npm run build
```

Describe the behavior changed and how you checked it. For gameplay or UI
changes, include reproduction steps and screenshots where useful.
Do not commit credentials, `.env` files, `.vercel`, downloaded model caches,
or generated build output. Use `.env.example` for placeholder configuration.

Contributions to the original code and documentation are submitted under the
repository's MIT license. Identify the source and license of any added assets
or third-party code.
