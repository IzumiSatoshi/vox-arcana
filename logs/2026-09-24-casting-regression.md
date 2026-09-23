# Casting regression repair — 2026-09-24

User report: holding the cast key produced no recognized words after the voice responsiveness changes.

## Reproduction and findings

The actual game was tested in Chrome 153 with injected English speech fixtures, releasing immediately when the spoken audio ended. Prepared local recognition returned no words for both phrases. The previous voice-lab comparison waited through 1.8 seconds of silence before release, so its success did not establish that normal gameplay release worked. This supersedes that earlier validation as evidence of immediate-release reliability.

A second issue appeared during repair: the first delayed interim result could be only "Sum". The game treated any nonempty result as a completed chant and closed recognition before the spell words arrived.

## Changes

- Restore ordinary browser microphone recognition as the default, without an audio-track probe or supplied track in normal gameplay.
- Mark offline recognition and prepared audio-track recognition experimental and opt-in. Migrate old saved settings once to disable previously automatic options, preserving the recognition language and later explicit opt-ins.
- Keep immediate volume-reactive effects and timing diagnostics.
- On release, incomplete or missing text gets up to 1.8 seconds to become a spell. Existing spell words still cast immediately. A new press cancels pending results.
- Supplied-track sessions receive silence on release instead of calling stop immediately, allowing buffered results to arrive. Direct microphone sessions retain stop to request pending results.
- Add an actual-game synthetic casting lab and regression tests for release handling and settings migration.

## Validation

- 34 tests pass: node --test tests/voice.test.js tests/voice-feedback.test.js tests/casting.test.js
- Syntax checks pass for voice.js, main.js and i18n.js; git diff --check passes.
- Actual game, browser recognition, immediate release: both fixtures produced outcome=cast and consumed mana.
  - Fireball: interim text at release "Summon a blaz", HUD "Summon a blazing"; release-to-cast 254 ms; mana 120 -> 82.47 after observation.
  - Ice spear: no text at release, HUD "Summon an ice"; release-to-cast 793 ms; mana 91.60 -> 70.59 after observation.
- These are individual synthetic runs, not a latency benchmark. The lab uses an injected audio track and does not verify the user's physical microphone. Unit coverage verifies that normal gameplay selects direct browser microphone capture.
- Interim spell words may cast before the entire phrase is finalized, as expected under the existing immediate-cast policy. Recognition service speed remains browser-dependent.

Files: public/js/voice.js, public/js/main.js, public/js/i18n.js, public/index.html, public/casting-lab.html, tests/voice.test.js, tests/casting.test.js, README.md.
