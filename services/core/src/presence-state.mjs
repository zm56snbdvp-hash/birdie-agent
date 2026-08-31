export const PresenceState = Object.freeze({
  IDLE: 'IDLE',
  SPEECH_DETECTED: 'SPEECH_DETECTED',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  WORKING: 'WORKING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  OFFLINE: 'OFFLINE',
});

const ALPHA_ALLOWED = new Set([
  PresenceState.IDLE,
  PresenceState.SPEECH_DETECTED,
  PresenceState.LISTENING,
  PresenceState.THINKING,
  PresenceState.SPEAKING,
  PresenceState.ERROR,
  PresenceState.OFFLINE,
]);

export function assertAlphaState(state) {
  if (!ALPHA_ALLOWED.has(state)) {
    throw new Error(`STATE.NOT_ALPHA_ENABLED:${state}`);
  }
}

export function createPresenceSnapshot() {
  return {
    revision: 0,
    state: PresenceState.OFFLINE,
    reason: 'runtime.starting',
    since: new Date(0).toISOString(),
    activeTurnId: null,
  };
}

export function projectPresence(current, nextState, meta = {}) {
  assertAlphaState(nextState);
  if (current.state === nextState && !meta.forceRevision) return current;

  const hasTurnId = Object.prototype.hasOwnProperty.call(meta, 'turnId');

  return {
    ...current,
    state: nextState,
    revision: current.revision + 1,
    reason: meta.reason ?? 'runtime.unspecified',
    since: meta.timestampUtc ?? new Date().toISOString(),
    // An explicit null is meaningful: the terminal transition owns clearing
    // the correlation. Only an omitted turnId inherits the previous value.
    activeTurnId: hasTurnId ? meta.turnId : (current.activeTurnId ?? null),
  };
}
