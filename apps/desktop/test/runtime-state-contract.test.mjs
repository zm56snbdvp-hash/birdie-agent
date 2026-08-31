import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_STATE_MATRIX,
  FreshnessState,
  RuntimeLifecycle,
  TransportState,
  UiRuntimeState,
  projectRuntimeUiState,
  runtimeSnapshotInvariantViolations,
} from '../src/runtime-state-contract.js';
import { SystemModel } from '../src/system-model.js';

test('canonical runtime/transport/freshness matrix projects one UI state', () => {
  for (const row of CANONICAL_STATE_MATRIX) {
    const projected = projectRuntimeUiState(row);
    assert.equal(projected.status, row.uiState, row.transition);
  }
});

test('microphone UNAVAILABLE is independent from a fresh READY runtime', () => {
  assert.deepEqual(
    projectRuntimeUiState({
      lifecycle: RuntimeLifecycle.READY,
      transportState: TransportState.CONNECTED,
      freshnessState: FreshnessState.FRESH,
      presenceState: 'IDLE',
      microphoneState: 'UNAVAILABLE',
    }),
    {
      status: UiRuntimeState.READY,
      reason: 'lifecycle=READY presence.state=IDLE',
    },
  );
});

test('DEGRADED, disconnected, and STALE projections can never advertise READY', () => {
  const forbiddenReadyRows = CANONICAL_STATE_MATRIX.filter(({ lifecycle, transportState, freshnessState }) =>
    lifecycle === RuntimeLifecycle.DEGRADED
    || transportState === TransportState.DISCONNECTED
    || freshnessState === FreshnessState.STALE);

  assert.ok(forbiddenReadyRows.length > 0);
  for (const row of forbiddenReadyRows) {
    assert.notEqual(projectRuntimeUiState(row).status, UiRuntimeState.READY, row.transition);
  }
});

test('SystemModel allows mic-only loss but fails closed on STALE and disconnect', () => {
  let now = 10_000;
  const model = new SystemModel({}, { now: () => now, staleAfterMs: 3_000 });
  assert.equal(model.getState().uiState, UiRuntimeState.CONNECTING);

  model.updateNativeSnapshot({
    runtimeLifecycle: RuntimeLifecycle.READY,
    coreStatus: 'READY',
    microphoneState: 'ENABLED',
    presenceState: 'IDLE',
    brainState: 'READY',
    ipcState: 'CONNECTED',
    connectionId: 'connection-matrix',
    lastCoreMessageAt: 9_000,
  });
  assert.equal(model.getState().uiState, UiRuntimeState.READY);

  model.updateRuntimeSnapshot({
    lifecycle: RuntimeLifecycle.READY,
    presence: { state: 'IDLE' },
    microphoneState: 'UNAVAILABLE',
    brainState: 'READY',
  });
  assert.equal(model.getState().uiState, UiRuntimeState.READY);

  now = 12_001;
  assert.equal(model.getState().freshnessState, FreshnessState.STALE);
  assert.equal(model.getState().uiState, UiRuntimeState.OFFLINE);
  assert.equal(model.getState().uiReason, 'freshness=STALE');

  model.updateRuntimeStatus('OFFLINE');
  assert.equal(model.getState().runtimeLifecycle, RuntimeLifecycle.DEGRADED);
  assert.equal(model.getState().transportState, TransportState.DISCONNECTED);
  assert.equal(model.getState().uiState, UiRuntimeState.OFFLINE);

  model.updateNativeSnapshot({
    runtimeLifecycle: RuntimeLifecycle.READY,
    coreStatus: 'READY',
    microphoneState: 'ENABLED',
    presenceState: 'IDLE',
    brainState: 'READY',
    ipcState: 'CONNECTED',
    connectionId: 'connection-reconnected',
    lastCoreMessageAt: now,
  });
  assert.equal(model.getState().freshnessState, FreshnessState.FRESH);
  assert.equal(model.getState().uiState, UiRuntimeState.READY);
});

test('a runtime snapshot cannot contain competing transport or microphone authorities', () => {
  const canonical = {
    lifecycle: 'READY',
    presence: { revision: 1, state: 'IDLE' },
    microphoneState: 'ENABLED',
  };
  assert.deepEqual(runtimeSnapshotInvariantViolations(canonical), []);

  assert.deepEqual(
    runtimeSnapshotInvariantViolations({
      ...canonical,
      presence: {
        ...canonical.presence,
        microphone: 'UNAVAILABLE',
        connectivity: 'DISCONNECTED',
      },
    }),
    [
      'STATE.DUPLICATE_AUTHORITY:presence.microphone',
      'STATE.DUPLICATE_AUTHORITY:presence.connectivity',
    ],
  );
});

test('Presence-only READY evidence cannot recover a STALE transport snapshot', () => {
  let now = 10_000;
  const model = new SystemModel({}, { now: () => now, staleAfterMs: 3_000 });
  model.updateNativeSnapshot({
    runtimeLifecycle: RuntimeLifecycle.READY,
    coreStatus: 'READY',
    microphoneState: 'ENABLED',
    presenceState: 'IDLE',
    brainState: 'READY',
    ipcState: 'CONNECTED',
    connectionId: 'coverage-ledger-stale',
    lastCoreMessageAt: now,
  });

  now += 3_001;
  assert.equal(model.getState().freshnessState, FreshnessState.STALE);
  assert.equal(model.getState().uiState, UiRuntimeState.OFFLINE);

  model.updateRuntimeSnapshot({
    lifecycle: RuntimeLifecycle.READY,
    presence: {
      revision: 2,
      state: 'IDLE',
      reason: 'presence-only-ready',
    },
    microphoneState: 'ENABLED',
    brainState: 'READY',
  });

  assert.equal(model.getState().freshnessState, FreshnessState.STALE);
  assert.equal(model.getState().uiState, UiRuntimeState.OFFLINE);
  assert.equal(model.getState().uiReason, 'freshness=STALE');
});
