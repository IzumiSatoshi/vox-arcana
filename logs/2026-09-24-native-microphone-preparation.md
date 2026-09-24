# Native microphone preparation

User clarified: orb reacts but prepared recognition produces no words; explicitly requested removing the fallback and fixing preparation itself.

## Final change

Preparation now calls ordinary SpeechRecognition.start() for gameplay, immediately after the previous cast's recognizer has ended. It no longer routes the real microphone through GainNode -> MediaStreamAudioDestinationNode -> start(track). The analyzer for the orb remains independent. Recognition stays active between casts, which the English/Japanese setting labels now state. Menu/pause stops recognition.

Idle results are discarded by result index; no idle text is stored. If an idle utterance has started and remains unfinished, pressing F creates a fresh recognizer to prevent its delayed corrections entering the new chant. Completed casts always retire their recognizer; idle no-speech expiration renews preparation. Preparation never changes to a generated-track input.

Removed the previous no-text watchdog, automatic microphone fallback and repeat-chant hint. Retained explicit error reporting. Injected synthetic streams remain confined to their supplied audio and cannot silently open a real microphone. Existing local-engine error handling is separate from input preparation.

## Evidence and limits

- 41 tests pass, covering direct microphone reuse, idle result-index exclusion, unfinished idle speech isolation, idle expiry renewal and pause cancellation, and existing casting flow.
- Chrome 153 live microphone readiness check with ja-JP and browser recognition: UI reported ready, input=browser-microphone, prepared=true, audioTrack=false. Stopped capture after checking readiness. This verifies startup, not recognition of the user's spoken spell.
- The old generated-track path recognized the full synthetic ice-spear phrase after both 1-second and 12-second idle intervals. Therefore idle duration alone did not reproduce the user's failure, and no exact device-level cause is claimed.
- A trial using disabled cloned tracks did not prewarm browser recognition and was rejected; it is not in the final implementation.
- Updated casting-lab disclaimer: generated audio tests do not establish native microphone preparation success.
- Web Speech events have no per-word capture timestamps. Index exclusion and unfinished-utterance isolation cannot establish precise audio/key timing for speech that the browser has not yet reported. Fast consecutive casts and real spoken phrases still need user-side validation.

Only scoped speech changes are committed. Other agents' graphics and gameplay edits remain untouched.
