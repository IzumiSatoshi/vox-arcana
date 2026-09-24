# Instant Jev casting and STT cleanup

- Instant cast defaults on and sends each changed recognition transcript immediately, without the normal 160 ms throttle or three-request cap.
- Releasing the chant casts the newest completed valid Jev interpretation by transcript revision order. If none is ready, interpretation is awaited. Older or superseded replies cannot replace that cast.
- Preview follows the selected interpretation. Disabling instant cast retains throttled, exact-text interpretation.
- English/Japanese punctuation is stripped from interim and final STT before display and interpretation; typed input is unchanged. Disable automatic punctuation where the browser exposes that setting.
- Added English/Japanese settings labels and README documentation.

Validation: 62 tests passed across jev-only, casting, voice, voice-download, and voice-feedback suites. JavaScript syntax checks passed. Tests cover rapid requests, reversed reply order, superseded sessions, single casting, default setting, and punctuation. Live microphone/Jev latency was not benchmarked. Instant mode intentionally increases Jev request volume.

Web Speech phrase hints were discussed as experimental vocabulary biasing; no phrase list was added.
