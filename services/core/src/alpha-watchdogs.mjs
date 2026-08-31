export const ALPHA_WATCHDOGS_MS = Object.freeze({
  SPEECH_DETECTED: 2_000,
  LISTENING: 20_000,
  THINKING_WARN: 15_000,
  THINKING_HARD: 30_000,
  SPEAKING_GRACE: 5_000,
  SPEAKING_ABSOLUTE: 90_000,
  RUNTIME_HEARTBEAT: 5_000,
});

export function watchdogForPresence(state, expectedAudioDurationMs = null) {
  switch (state) {
    case 'SPEECH_DETECTED': return ALPHA_WATCHDOGS_MS.SPEECH_DETECTED;
    case 'LISTENING': return ALPHA_WATCHDOGS_MS.LISTENING;
    case 'THINKING': return ALPHA_WATCHDOGS_MS.THINKING_HARD;
    case 'SPEAKING':
      return Math.min(
        ALPHA_WATCHDOGS_MS.SPEAKING_ABSOLUTE,
        (expectedAudioDurationMs ?? 0) + ALPHA_WATCHDOGS_MS.SPEAKING_GRACE,
      );
    default: return null;
  }
}
