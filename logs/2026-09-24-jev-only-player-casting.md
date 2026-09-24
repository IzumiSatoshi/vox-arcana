# Jev-only player interpretation

User asked to disable static word matching when using Jev. Browser-local speech recognition is unrelated and remains unchanged.

Changes:
- Player manual voice, hands-free and typed casts use buildJevSpec with Jev-only semantic parameters and neutral numeric defaults. Voice loudness and chant-duration bonuses remain gameplay mechanics.
- Keyword parsing runs only when the player's Jev setting is off. Removed keyword eligibility checks and keyword previews in Jev mode.
- Final casts use exact-text Jev results, reuse pending exact-text speculative requests, or await a fresh request. An interpretation of an earlier partial transcript cannot supply the final spell.
- Pending results are invalidated by a new chant, typed chant, pause/menu, player replacement, or changing the Jev preference. Failed requests show an error without keyword fallback.
- Incomplete speech that Jev does not yet consider a spell remains eligible for recognition corrections through the existing grace window.
- English/Japanese status text and README describe the new behavior.

Validation: 55 tests pass across casting, Jev-only interpretation, voice, voice feedback and language download suites. Nine new tests execute actual Game methods and the Jev-only builder with a keyword parser that throws if called; coverage includes conflicting keywords, no-magic decisions, waiting for exact requests, errors, stale replies, typed/hands-free entry points and incomplete fragments. Syntax and staged diff checks pass. No live Jev latency or microphone behavior was measured for this change.

Scope: player interpretation. Rival AI settings/behavior and explicitly local debug helpers remain unchanged. Other agents' concurrent graphics and gameplay edits are not included in this commit.
