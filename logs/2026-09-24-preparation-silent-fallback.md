# Prepared recognition: silent failure recovery

User reports that no words appear with next-session preparation enabled. Exact device/browser failure has not been established. Previous generated-English fixture tests bypassed physical microphone capture and did not validate the user's Japanese microphone path.

Confirmed implementation gap: the track-support probe tests API overload acceptance, not successful transcription. Preparation routes getUserMedia through Web Audio gain and a generated track into start(track), whereas ordinary recognition uses start() microphone capture. No timeout previously disabled a session that accepted input but never returned text.

Changes:
- After four seconds without audio readiness, disable the prepared track for this page lifetime.
- When sampled sound has been observed for a four-second elapsed window without text, restart the active chant using ordinary browser microphone recognition. This is a heuristic; sound-level detection is not speech recognition.
- A completed empty supplied-track chant conservatively disables preparation for the next press, even if no meter sound was observed. This can also trigger on intentional silence.
- A non-running audio context also triggers fallback.
- Show a Japanese/English repeat-chant hint. Prior audio cannot be recovered through the direct microphone API. Settings remain saved; reload retries the experiment.
- Diagnostics include capture errors, context state, microphone level, input path and fallback reason. Synthetic injected streams never fall back to the user's physical microphone.

Validation: 43 automated tests pass, including ready-but-silent recognition, missing audio readiness, interrupted context, short empty chants, stale callbacks after fallback, and synthetic input isolation. Syntax checks pass. No live physical-microphone success is claimed; this change adds recovery and diagnostics, not a proven fix for the underlying browser/device behavior.

Only the voice fallback hunk in main.js is included; concurrent graphics and other changes remain unstaged.
