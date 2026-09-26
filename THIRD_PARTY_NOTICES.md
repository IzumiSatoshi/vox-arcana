# Third-party components

The MIT license in this repository covers its original code and documentation.
It does not replace the licenses of dependencies, downloaded models, fonts, or
external services. Preserve the applicable notices when packaging a release.

## Software

- Three.js 0.169.0 is loaded from jsDelivr, including its addons, under MIT:
  https://github.com/mrdoob/three.js/blob/r169/LICENSE
- `@pixiv/three-vrm` 3.5.5 is loaded from jsDelivr under MIT; it loads and poses the VRM mage model:
  https://github.com/pixiv/three-vrm/blob/release/LICENSE
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

- `public/models/mage.vrm`: pixiv Inc.'s `VRM1_Constraint_Twist_Sample` from the
  three-vrm examples, (c) 2022 pixiv Inc., used as a placeholder mage body. Its VRM
  metadata grants redistribution and modification with redistribution, allows
  corporate commercial use, requires no credit, and forbids antisocial or hateful use,
  under the VRM Public License 1.0: https://vrm.dev/licenses/1.0/
  It is **not** covered by this repository's MIT license. Replacing the file with your own
  VRoid Studio export keeps the game code unchanged.

- `public/audio/fantasy-spellcasting-boss-theme.mp3`: the maintainer reports
  generating this track with Google's music-generation AI. The exact product
  and model version were not recorded. This is AI-generated music, not a claim
  of human composition or Google endorsement.
- `public/voice-fixtures/*.wav`: synthetic test utterances generated locally
  using Windows speech synthesis, as documented in
  `public/voice-fixtures/README.txt`; these are not microphone recordings.

The maintainer includes these project-supplied media files under the repository's
MIT terms to the extent the maintainer holds applicable rights. This does not
license any third-party rights or assert that AI-generated output necessarily
qualifies for copyright protection.

Google's general terms say it does not claim ownership of original generated
content. Its Labs FAQ refers commercial-use questions to those terms. These
references document the reviewed general guidance, not verification of the
specific generation session or a guarantee of exclusive rights:

- https://policies.google.com/terms
- https://labs.google/fx/faq
