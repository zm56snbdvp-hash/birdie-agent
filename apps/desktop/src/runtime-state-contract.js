export const RuntimeLifecycle = Object.freeze({
  STARTING: 'STARTING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
});

export const TransportState = Object.freeze({
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  UNKNOWN: 'UNKNOWN',
});

export const FreshnessState = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  FRESH: 'FRESH',
  STALE: 'STALE',
});

export const UiRuntimeState = Object.freeze({
  CONNECTING: 'CONNECTING',
  READY: 'READY',
  OFFLINE: 'OFFLINE',
});

export const KNOWN_PRESENCE_STATES = Object.freeze([
  'IDLE',
  'SPEECH_DETECTED',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'WORKING',
  'SUCCESS',
  'ERROR',
  'OFFLINE',
]);

const presenceStates = new Set(KNOWN_PRESENCE_STATES);

function row(value) { return Object.freeze(value); }

// These rows are the executable Desktop projection contract. The five words
// that are often conflated live on separate axes: DEGRADED/READY are runtime
// lifecycle values, OFFLINE is a transport/Presence/UI projection,
// UNAVAILABLE is a capability value, and STALE qualifies data freshness.
export const CANONICAL_STATE_MATRIX = Object.freeze([
  row({
    transition: 'bootstrap',
    lifecycle: RuntimeLifecycle.STARTING,
    transportState: TransportState.CONNECTING,
    freshnessState: FreshnessState.UNKNOWN,
    presenceState: 'OFFLINE',
    microphoneState: 'UNAVAILABLE',
    uiState: UiRuntimeState.CONNECTING,
  }),
  row({
    transition: 'runtime-ready',
    lifecycle: RuntimeLifecycle.READY,
    transportState: TransportState.CONNECTED,
    freshnessState: FreshnessState.FRESH,
    presenceState: 'IDLE',
    microphoneState: 'ENABLED',
    uiState: UiRuntimeState.READY,
  }),
  row({
    transition: 'voice-unavailable',
    lifecycle: RuntimeLifecycle.READY,
    transportState: TransportState.CONNECTED,
    freshnessState: FreshnessState.FRESH,
    presenceState: 'IDLE',
    microphoneState: 'UNAVAILABLE',
    uiState: UiRuntimeState.READY,
  }),
  row({
    transition: 'presence-offline',
    lifecycle: RuntimeLifecycle.READY,
    transportState: TransportState.CONNECTED,
    freshnessState: FreshnessState.FRESH,
    presenceState: 'OFFLINE',
    microphoneState: 'UNAVAILABLE',
    uiState: UiRuntimeState.OFFLINE,
  }),
  row({
    transition: 'transport-disconnected',
    lifecycle: RuntimeLifecycle.DEGRADED,
    transportState: TransportState.DISCONNECTED,
    freshnessState: FreshnessState.STALE,
    presenceState: 'OFFLINE',
    microphoneState: 'UNAVAILABLE',
    uiState: UiRuntimeState.OFFLINE,
  }),
  row({
    transition: 'connected-snapshot-stale',
    lifecycle: RuntimeLifecycle.READY,
    transportState: TransportState.CONNECTED,
    freshnessState: FreshnessState.STALE,
    presenceState: 'IDLE',
    microphoneState: 'ENABLED',
    uiState: UiRuntimeState.OFFLINE,
  }),
  row({
    transition: 'reconnect-awaiting-snapshot',
    lifecycle: RuntimeLifecycle.DEGRADED,
    transportState: TransportState.CONNECTING,
    freshnessState: FreshnessState.STALE,
    presenceState: 'OFFLINE',
    microphoneState: 'UNAVAILABLE',
    uiState: UiRuntimeState.CONNECTING,
  }),
  row({
    transition: 'reconnect-fresh-snapshot',
    lifecycle: RuntimeLifecycle.READY,
    transportState: TransportState.CONNECTED,
    freshnessState: FreshnessState.FRESH,
    presenceState: 'IDLE',
    microphoneState: 'ENABLED',
    uiState: UiRuntimeState.READY,
  }),
]);

function token(value, fallback = '') {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || fallback;
}

export function projectRuntimeUiState({
  lifecycle,
  transportState = TransportState.CONNECTED,
  freshnessState = FreshnessState.FRESH,
  presenceState,
} = {}) {
  const runtime = token(lifecycle);
  const transport = token(transportState, TransportState.UNKNOWN);
  const freshness = token(freshnessState, FreshnessState.UNKNOWN);
  const presence = token(presenceState);

  if (transport === TransportState.CONNECTING) {
    return { status: UiRuntimeState.CONNECTING, reason: 'transport=CONNECTING' };
  }
  if (transport !== TransportState.CONNECTED) {
    return {
      status: UiRuntimeState.OFFLINE,
      reason: `transport=${transport || TransportState.UNKNOWN}`,
    };
  }
  if (freshness !== FreshnessState.FRESH) {
    return {
      status: UiRuntimeState.OFFLINE,
      reason: `freshness=${freshness || FreshnessState.UNKNOWN}`,
    };
  }
  if (runtime === RuntimeLifecycle.STARTING) {
    return { status: UiRuntimeState.CONNECTING, reason: 'lifecycle=STARTING' };
  }
  if (runtime !== RuntimeLifecycle.READY) {
    return {
      status: UiRuntimeState.OFFLINE,
      reason: `lifecycle=${runtime || 'MISSING'}`,
    };
  }
  if (presence === 'OFFLINE') {
    return { status: UiRuntimeState.OFFLINE, reason: 'presence.state=OFFLINE' };
  }
  if (!presenceStates.has(presence)) {
    return {
      status: UiRuntimeState.OFFLINE,
      reason: `presence.state=${presence || 'MISSING'}`,
    };
  }
  return {
    status: UiRuntimeState.READY,
    reason: `lifecycle=READY presence.state=${presence}`,
  };
}

export function runtimeSnapshotInvariantViolations(snapshot = {}) {
  const violations = [];
  const presence = snapshot?.presence ?? {};
  if (Object.hasOwn(presence, 'microphone')) {
    violations.push('STATE.DUPLICATE_AUTHORITY:presence.microphone');
  }
  if (Object.hasOwn(presence, 'connectivity')) {
    violations.push('STATE.DUPLICATE_AUTHORITY:presence.connectivity');
  }
  return Object.freeze(violations);
}
