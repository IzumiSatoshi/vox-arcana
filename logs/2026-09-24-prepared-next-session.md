# Prepare the next recognition session — 2026-09-24

User explicitly requested trying preparation immediately after each cast.

## Behavior

The existing opt-in starts a new Web Speech recognizer against a silent audio track after the previous chant resolves. Old recognition must finish abort/end before the replacement starts because the browser shares the recognition service. Pressing F claims the prepared session and opens its input gain. Results remain owned by one chant. A new press can claim a session that is still starting. Unsupported audio-track input falls back to normal microphone recognition.

Fixed activation after initial microphone setup: prepareNext now probes audio-track support while idle if preparation was enabled later. When the previous recognizer is still draining, it queues preparation and defers that probe until end. The default remains ordinary microphone recognition.

## Verification

37 regression tests pass, including late enablement, enabling during teardown, next-session startup without another keypress, and stale callback isolation. Syntax and scoped whitespace checks pass.

Updated casting-lab.html with a preparation checkbox and four alternating synthetic fireball/ice-spear chants. It releases immediately at fixture end, then starts the next chant 250 ms after the previous result resolves. Chrome actual-game test: all four outcomes were cast; each next session was prepared by the 250 ms observation. All four readyOnPress values were false, so preparation was underway but capture readiness was not yet confirmed at the next press. Release-to-cast times were 1, 1813, 1, and 814 ms. These are individual runs, not evidence of a latency improvement. Current gameplay can commit partial spell text; ice-spear phrases became ice orbs. This test verifies preparation and casting continuity, not exact spell accuracy or the physical microphone.

Enabled the existing warmVoice checkbox through the Chrome game Settings UI (Japanese label: experimental audio-track preparation). Offline recognition remained unchecked, and Japanese recognition language was preserved. Left the game menu open for the user.

Only voice.js, its tests, casting-lab.html and this log belong to this commit. Concurrent unrelated working-tree changes were left untouched.
