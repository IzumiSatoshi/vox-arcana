# Voice casting handoff — 2026-09-23

Scope: Web Speech API casting reliability and avoidable latency.

## Findings
- Old beginChant accepted 1.2 seconds of pre-roll, which could show previous speech.
- Character offsets into mutable interim transcripts were unsafe when recognition revised earlier words.
- Empty release waited passively for up to 700 ms rather than asking recognition to flush.
- Transcript and preview DOM content were rewritten every render frame.

## Changes
- Each manual chant owns a separate recognition session. Late callbacks from retired sessions are ignored.
- Interim text still casts synchronously on release. Empty release calls stop(), and results dispatch the pending cast directly without a render-frame wait.
- Pending windows explicitly close after consumption, timeout, cancellation, new keypress, or arena reset.
- Correctly handle interim result removal, browser session restarts during long chants, language changes, and final-only hands-free delivery.
- Recognition starts independently of optional loudness-meter setup; the meter stream stays available between casts.
- HUD updates reuse existing content when unchanged.
- Guard pending hands-free Jev responses against player replacement, pause, and manual casting.

## Validation
- node --test tests/voice.test.js: 12 regression tests passed with a fake Web Speech implementation.
- node --check public/js/voice.js, public/js/main.js, public/js/hud.js: passed.
- git diff --check: passed.
- No real microphone / Chrome or Edge acoustic latency measurements were performed. No measured end-to-end speedup is claimed.
- Fresh manual sessions add browser-dependent startup time compared with keeping a recognizer always running. This deliberately gives a reliable boundary between casts; hold the key before speaking.
- Hands-free still waits for browser finalization and its existing Jev request. The optional meter's echo cancellation constraints do not configure SpeechRecognition's separate microphone capture.

## Browser playtest
1. Hold F, say fireball, release as soon as text appears: cast immediately.
2. Immediately hold F again: no previous words; say ice spear and release.
3. Release before any text appears: pending result casts once within 700 ms, otherwise silence feedback.
4. Repeat with Japanese, rapid keypresses, pauses in a long chant, and hands-free enabled.
5. Check microphone denial and recognition network error feedback.

## Git / collaboration
- No .git directory existed at the start. Initialized Git and recorded tracked application files as baseline commit 6f1e00e.
- Changes are limited to public/js/voice.js, public/js/main.js, public/js/hud.js, README.md, tests/voice.test.js, and this log.
- Existing .claude/ configuration was left untracked and unchanged.
- No remote push performed.
