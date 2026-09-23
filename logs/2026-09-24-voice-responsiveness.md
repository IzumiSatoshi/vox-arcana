# Voice responsiveness handoff — 2026-09-24

## Result
- Web Speech API remains the recognizer.
- Manual casts can prepare recognition between presses using a separate Web Audio destination track with gain 0. Keypress opens only that cast's gain. Release mutes it; consumed/cancelled sessions disconnect and stop their track. Old callbacks still cannot write into a new cast.
- Track input is probed using an ended track: the specified InvalidStateError proves the overload is implemented. Unsupported engines retain direct microphone recognition on press.
- Recognition replacement waits for abort/end, with a bounded 1-second recovery for engines omitting end before startup. Local capability checks complete before idle preparation, avoiding an unnecessary initial engine switch.
- Prefer installed on-device language packs. No automatic downloads. Local service errors and audio-track failures fall back to ordinary recognition where appropriate.
- Settings include offline preference and preparation preference in English/Japanese.
- Volume is sampled before the game tick. A frame-rate-independent 25 ms attack / 120 ms release envelope drives orb scale, staff glow/spin, and charging particle emission before transcription arrives. It does not cast spells from sound alone.
- VA.voiceStats() reports the last 30 manual cast timings. Records contain no words or audio and stay in page memory.
- /voice-lab.html provides browser capability checks, synthetic and microphone tests, and quiet/loud visual previews. Synthetic fixtures use Windows Microsoft Zira Desktop, rate -1, 16 kHz 16-bit mono, and never play through speakers.

## Validation
26 node:test cases passed: original stale-word cases plus silent gating, prepared session claiming, asynchronous teardown, absent-end recovery, local capability races, fallback, pause/resume, timing accuracy, bounded history, and frame-rate-independent feedback. JavaScript syntax and git diff --check passed.

Actual Chrome 153 on Windows reports en-US local pack available, ja-JP downloadable, and audio-track input supported. Real Web Speech recognition was exercised with synthetic audio tracks, not a fake recognizer. No user's microphone audio was recorded for this test.

Final synthetic comparison, milliseconds (two phrases per condition):

| Engine | Prepared | Phrase | Key to audio ready | Key to first text | Release to cast | Complete phrase |
| --- | --- | --- | ---: | ---: | ---: | --- |
| local | no | Summon a blazing fireball | 233 | 1945 | 1 | yes |
| local | no | Summon an ice spear | 182 | 1101 | 0 | yes |
| local | yes | Summon a blazing fireball | 0 | 1112 | 0 | yes |
| local | yes | Summon an ice spear | 0 | 1624 | 0 | yes |
| browser service | no | Summon a blazing fireball | 252 | 1192 | 0 | yes |
| browser service | no | Summon an ice spear | 204 | 2085 | 2 | yes |
| browser service | yes | Summon a blazing fireball | 0 | 2106 | 0 | yes |
| browser service | yes | Summon an ice spear | 0 | 1096 | 1 | yes |

All final runs returned the two separate phrases without previous-cast words. Earlier development runs exposed missed startup speech and overlapping engine changes; these drove the capability-check and teardown changes.

These are small functional checks, not a statistically controlled speech benchmark. Prepared runs wait up to 8 seconds for readiness outside the measured keypress interval. Both cases play speech 120 ms after keypress and hold through a fixed 1.8-second silence tail before release. The first-text metric includes time spent speaking. At volume threshold onset there were about 300 ms since keypress. No universal transcription speedup is claimed: the observed win is removing 182–252 ms of startup from an already prepared keypress. Fast release with partial words can still produce an incomplete spell; the existing immediate-cast policy is preserved.

Actual rendered staff was inspected in the lab: simulated silence showed glow 2.30 and orb scale around 0.96; loud voice showed glow 4.10 and scale around 1.30. Orb scale has a small periodic pulse. The actual game loaded successfully and displayed both new Japanese settings.

## Limitations / next useful checks
- Human microphone latency, background noise, and Japanese recognition quality still need playtesting. Japanese currently falls back to the browser service because its local pack is not installed.
- A prepared session may time out while idle; a very fast next press can arrive before preparation finishes. The readiness indicator and readyOnPress metric expose this rather than assuming readiness.
- Local recognition is a configurable preference, not proven faster for every phrase.
- Sound detection for metrics uses amplitude, not a speech classifier.
- Preparation keeps a silent recognition session during active play; pause/menu close it. The loudness-meter microphone stream stays open as it did before.

## Files and collaboration
Only the voice implementation, voice feedback, their game/view integration, localized settings, README, regression tests, lab/fixtures, and this handoff log were changed. Existing .claude/ files remain untracked and unchanged. No remote push.

References consulted:
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static
