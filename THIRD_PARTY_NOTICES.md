# Third-party components

The MIT license in this repository covers its original code and documentation.
It does not replace the licenses of dependencies, downloaded models, fonts, or
external services. Preserve the applicable notices when packaging a release.

## Software

- Three.js 0.169.0 is loaded from jsDelivr, including its addons, under MIT:
  https://github.com/mrdoob/three.js/blob/r169/LICENSE
- Transformers.js is installed through npm under Apache-2.0:
  https://github.com/huggingface/transformers.js
- `@vercel/oidc` is Apache-2.0. It and transitive npm packages carry their own license files.
  The resolved package versions and available license metadata are recorded in
  `package-lock.json`; include the installed packages' notices in binary releases.

## Models, fonts, and services

- The optional local model is downloaded separately:
  https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2
  Consult its model card and the upstream model terms before redistribution.
- Google Fonts supplies Cormorant Garamond, Barlow Condensed, Cinzel,
  Noto Sans JP, and Noto Serif JP. Preserve each font's license when bundling it:
  https://github.com/google/fonts
- Jev / TypeSafe, Vercel AI Gateway, and browser speech services are external
  services. This repository does not license those services or provide credits.

## Media

The source-code MIT license does not automatically relicense bundled media.
`public/voice-fixtures/README.txt` documents the synthetic speech test fixtures.
Review media provenance and applicable redistribution terms before repackaging.
