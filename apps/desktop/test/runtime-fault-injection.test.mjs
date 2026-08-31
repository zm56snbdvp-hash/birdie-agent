import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RuntimeBridge,
  TAURI_EVENTS,
} from '../src/runtime-bridge.js';
import {
  FreshnessState,
  UiRuntimeState,
  projectRuntimeUiState,
} from '../src/runtime-state-contract.js';
import { SystemModel } from '../src/system-model.js';

function snapshot({
  bridgeRevision,
  lifecycle = 'READY',
  presenceRevision = 1,
  presenceState = 'IDLE',
  microphoneState = 'ENABLED',
  brainState = 'READY',
} = {}) {
  return {
    bridgeRevision,
    lifecycle,
    presence: {
      revision: presenceRevision,
      state: presenceState,
      reason: 'fault-injection',
    },
    microphoneState,
    brainState,
  };
}

function fingerprint(value) {
  return JSON.stringify({
    lifecycle: value.lifecycle,
    presence: value.presence,
    microphoneState: value.microphoneState,
    brainState: value.brainState,
  });
}

function modelPresenceFingerprint(presence, bridgeRevision) {
  return JSON.stringify({
    bridgeRevision,
    revision: presence?.revision ?? null,
    state: presence?.state ?? null,
    reason: presence?.reason ?? null,
  });
}

class ReferenceRuntimeModel {
  constructor(initialSnapshot) {
    this.bridgeRevision = -1;
    this.snapshotRevision = -1;
    this.snapshotFingerprint = null;
    this.pendingDisconnectRevision = null;
    this.presenceEvidenceRevision = -1;
    this.presenceEvidenceFingerprint = null;
    this.lifecycle = 'STARTING';
    this.presence = null;
    this.uiState = 'CONNECTING';
    this.applySnapshot(initialSnapshot);
  }

  apply(action) {
    if (action.type === 'snapshot') return this.applySnapshot(action.snapshot);
    if (action.type === 'presence') return this.applyPresence(action.payload);
    if (action.type === 'disconnect') return this.applyDisconnect(action.bridgeRevision);
    if (action.type === 'reconnect') {
      this.uiState = 'CONNECTING';
      return ['CONNECTING', ...this.applySnapshot(action.snapshot)];
    }
    if (action.type === 'stale-reconnect') {
      return this.applySnapshot(action.snapshot);
    }
    throw new Error(`Unknown model action: ${action.type}`);
  }

  applyDisconnect(bridgeRevision) {
    if (bridgeRevision < this.bridgeRevision) return [];
    if (bridgeRevision === this.bridgeRevision) {
      return this.pendingDisconnectRevision === bridgeRevision ? [] : [];
    }
    this.bridgeRevision = bridgeRevision;
    this.pendingDisconnectRevision = bridgeRevision;
    this.uiState = 'OFFLINE';
    return ['OFFLINE'];
  }

  applyPresence(payload) {
    const bridgeRevision = Number(payload.bridgeRevision);
    const presence = payload.snapshot;
    const nextFingerprint = modelPresenceFingerprint(presence, bridgeRevision);
    if (bridgeRevision < this.bridgeRevision) return [];
    if (
      bridgeRevision === this.presenceEvidenceRevision
      && nextFingerprint !== this.presenceEvidenceFingerprint
    ) {
      return [];
    }
    if (
      bridgeRevision === this.pendingDisconnectRevision
      && presence?.state !== 'OFFLINE'
    ) {
      return [];
    }
    if (
      bridgeRevision === this.presenceEvidenceRevision
      && nextFingerprint === this.presenceEvidenceFingerprint
    ) {
      return [];
    }
    this.bridgeRevision = Math.max(this.bridgeRevision, bridgeRevision);
    this.presenceEvidenceRevision = bridgeRevision;
    this.presenceEvidenceFingerprint = nextFingerprint;
    this.presence = structuredClone(presence);
    this.uiState = projectRuntimeUiState({
      lifecycle: this.lifecycle,
      presenceState: this.presence.state,
    }).status;
    return [this.uiState];
  }

  applySnapshot(next) {
    const revision = Number(next.bridgeRevision);
    const nextFingerprint = fingerprint(next);
    if (revision < this.bridgeRevision) return [];
    if (
      revision === this.snapshotRevision
      && nextFingerprint !== this.snapshotFingerprint
    ) {
      return [];
    }
    if (
      revision === this.snapshotRevision
      && nextFingerprint === this.snapshotFingerprint
    ) {
      return [];
    }
    if (
      revision === this.bridgeRevision
      && this.pendingDisconnectRevision === revision
    ) {
      const projection = projectRuntimeUiState({
        lifecycle: next.lifecycle,
        presenceState: next.presence?.state,
      });
      if (projection.status !== 'OFFLINE') return [];
      this.pendingDisconnectRevision = null;
    }
    this.bridgeRevision = Math.max(this.bridgeRevision, revision);
    this.snapshotRevision = revision;
    this.snapshotFingerprint = nextFingerprint;
    this.presenceEvidenceRevision = revision;
    this.presenceEvidenceFingerprint = modelPresenceFingerprint(
      next.presence,
      revision,
    );
    this.lifecycle = next.lifecycle;
    this.presence = structuredClone(next.presence);
    this.uiState = projectRuntimeUiState({
      lifecycle: next.lifecycle,
      presenceState: next.presence?.state,
    }).status;
    return [this.uiState];
  }
}

function compactTransitions(initialState, transitions) {
  let current = initialState;
  const compact = [];
  for (const next of transitions) {
    if (next === current) continue;
    compact.push(next);
    current = next;
  }
  return compact;
}

function createHarness(initialSnapshot, reconnectSnapshots = []) {
  const handlers = new Map();
  const statuses = [];
  const queue = [initialSnapshot, initialSnapshot, ...reconnectSnapshots];
  const bridge = new RuntimeBridge(
    {
      onStatus: (status) => statuses.push(status),
    },
    {
      invokeFn: async (command) => {
        if (command !== 'runtime_get_snapshot') return null;
        assert.ok(queue.length > 0, 'unexpected fault-injection snapshot request');
        return queue.shift();
      },
      listenFn: async (event, handler) => {
        handlers.set(event, handler);
        return async () => handlers.delete(event);
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      persistDiagnostics: false,
    },
  );
  return { bridge, handlers, statuses };
}

const ready10 = snapshot({ bridgeRevision: 10, presenceRevision: 4 });
const offline9 = snapshot({
  bridgeRevision: 9,
  lifecycle: 'DEGRADED',
  presenceRevision: 4,
  presenceState: 'OFFLINE',
  microphoneState: 'UNAVAILABLE',
});
const offline10 = { ...offline9, bridgeRevision: 10 };
const offline11 = { ...offline9, bridgeRevision: 11 };
const ready11 = snapshot({ bridgeRevision: 11, presenceRevision: 1 });
const ready12 = snapshot({ bridgeRevision: 12, presenceRevision: 1 });
const listening11 = snapshot({
  bridgeRevision: 11,
  presenceRevision: 5,
  presenceState: 'LISTENING',
});
const voiceUnavailable11 = snapshot({
  bridgeRevision: 11,
  presenceRevision: 5,
  microphoneState: 'UNAVAILABLE',
});

const FAULT_CORPUS = Object.freeze([
  {
    id: 'duplicate-identical-snapshot',
    coverage: ['duplicate'],
    initial: ready10,
    actions: [{ type: 'snapshot', snapshot: structuredClone(ready10) }],
  },
  {
    id: 'duplicate-conflicting-same-revision',
    coverage: ['duplicate', 'conflicting-same-revision'],
    initial: ready10,
    actions: [{ type: 'snapshot', snapshot: offline10 }],
  },
  {
    id: 'equal-revision-disconnect-marker',
    coverage: ['duplicate', 'conflicting-same-revision', 'disconnect'],
    initial: ready10,
    actions: [{ type: 'disconnect', bridgeRevision: 10 }],
  },
  {
    id: 'disconnect-marker-compatible-snapshot',
    coverage: ['disconnect-marker-pair'],
    initial: ready10,
    actions: [
      { type: 'disconnect', bridgeRevision: 11 },
      { type: 'snapshot', snapshot: offline11 },
    ],
  },
  {
    id: 'disconnect-marker-conflicting-ready-snapshot',
    coverage: ['conflicting-same-revision', 'disconnect-marker-conflict'],
    initial: ready10,
    actions: [
      { type: 'disconnect', bridgeRevision: 11 },
      { type: 'snapshot', snapshot: ready11 },
    ],
  },
  {
    id: 'out-of-order-offline-snapshot',
    coverage: ['out-of-order'],
    initial: ready10,
    actions: [{ type: 'snapshot', snapshot: offline9 }],
  },
  {
    id: 'presence-conflicting-same-revision',
    coverage: ['presence-channel', 'presence-conflict'],
    initial: ready10,
    actions: [{
      type: 'presence',
      payload: {
        bridgeRevision: 10,
        snapshot: {
          revision: 5,
          state: 'OFFLINE',
          reason: 'fault-injection-presence-conflict',
        },
      },
    }],
  },
  {
    id: 'presence-event-first-full-snapshot-pair',
    coverage: ['presence-channel', 'presence-event-first'],
    initial: ready10,
    actions: [
      {
        type: 'presence',
        payload: {
          bridgeRevision: 11,
          snapshot: structuredClone(listening11.presence),
        },
      },
      { type: 'snapshot', snapshot: listening11 },
    ],
  },
  {
    id: 'voice-unavailable-does-not-degrade-runtime',
    coverage: ['microphone-unavailable'],
    initial: ready10,
    actions: [{ type: 'snapshot', snapshot: voiceUnavailable11 }],
  },
  {
    id: 'delayed-reconnect-fresh-snapshot',
    coverage: ['disconnect', 'delayed-reconnect', 'fresh-snapshot'],
    initial: ready10,
    reconnectSnapshots: [ready12],
    actions: [
      { type: 'disconnect', bridgeRevision: 11 },
      { type: 'reconnect', snapshot: ready12 },
    ],
  },
  {
    id: 'late-reconnect-after-ready',
    coverage: ['late-reconnect'],
    initial: ready10,
    reconnectSnapshots: [structuredClone(ready10)],
    actions: [{ type: 'stale-reconnect', snapshot: ready10 }],
  },
  {
    id: 'rapid-offline-ready-edge',
    coverage: ['rapid-edge', 'offline', 'ready'],
    initial: ready10,
    actions: [
      { type: 'snapshot', snapshot: offline11 },
      { type: 'snapshot', snapshot: ready12 },
    ],
  },
]);

test('fault corpus matches the canonical runtime model transition by transition', async () => {
  const covered = new Set();
  for (const scenario of FAULT_CORPUS) {
    scenario.coverage.forEach((entry) => covered.add(entry));
    const state = createHarness(
      scenario.initial,
      scenario.reconnectSnapshots ?? [],
    );
    await state.bridge.connect();
    state.statuses.length = 0;
    const model = new ReferenceRuntimeModel(scenario.initial);

    for (const [index, action] of scenario.actions.entries()) {
      const before = state.statuses.length;
      const initialUiState = model.uiState;
      if (action.type === 'snapshot') {
        state.handlers.get(TAURI_EVENTS.SNAPSHOT)({ payload: action.snapshot });
      } else if (action.type === 'presence') {
        state.handlers.get(TAURI_EVENTS.PRESENCE_CHANGED)({
          payload: action.payload,
        });
      } else if (action.type === 'disconnect') {
        state.handlers.get(TAURI_EVENTS.DISCONNECTED)({
          payload: { bridgeRevision: action.bridgeRevision },
        });
      } else if (action.type === 'reconnect' || action.type === 'stale-reconnect') {
        await state.handlers.get(TAURI_EVENTS.CONNECTED)({ payload: {} });
      }
      const actual = compactTransitions(
        initialUiState,
        state.statuses.slice(before),
      );
      const expected = compactTransitions(initialUiState, model.apply(action));
      assert.deepEqual(
        actual,
        expected,
        `${scenario.id} action=${index + 1} type=${action.type}`,
      );
    }
    state.bridge.dispose();
  }

  assert.deepEqual(
    [...covered].sort(),
    [
      'conflicting-same-revision',
      'delayed-reconnect',
      'disconnect',
      'disconnect-marker-conflict',
      'disconnect-marker-pair',
      'duplicate',
      'fresh-snapshot',
      'late-reconnect',
      'microphone-unavailable',
      'offline',
      'out-of-order',
      'presence-channel',
      'presence-conflict',
      'presence-event-first',
      'rapid-edge',
      'ready',
    ],
  );
});

test('freshness fault injects STALE and recovers only on a fresh transport snapshot', () => {
  let now = 10_000;
  const model = new SystemModel({}, { now: () => now, staleAfterMs: 3_000 });
  const ready = {
    runtimeLifecycle: 'READY',
    coreStatus: 'READY',
    voiceStatus: 'CONNECTED',
    microphoneState: 'ENABLED',
    presenceState: 'IDLE',
    brainState: 'READY',
    ipcState: 'CONNECTED',
    connectionId: 'fault-connection',
    lastCoreMessageAt: now,
  };
  model.updateNativeSnapshot(ready);
  assert.equal(model.getState().uiState, UiRuntimeState.READY);
  assert.equal(model.getState().freshnessState, FreshnessState.FRESH);

  now += 3_001;
  assert.equal(model.getState().freshnessState, FreshnessState.STALE);
  assert.equal(model.getState().uiState, UiRuntimeState.OFFLINE);
  assert.equal(model.getState().uiReason, 'freshness=STALE');

  model.updateNativeSnapshot({ ...ready, lastCoreMessageAt: now });
  assert.equal(model.getState().freshnessState, FreshnessState.FRESH);
  assert.equal(model.getState().uiState, UiRuntimeState.READY);
});
