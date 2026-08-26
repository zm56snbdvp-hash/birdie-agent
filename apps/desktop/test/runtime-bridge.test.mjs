import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  RuntimeBridge,
  TAURI_EVENTS,
  TAURI_EVENT_NAME_PATTERN,
  evaluateSnapshotStatus,
} from '../src/runtime-bridge.js';

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
      reason: 'test',
    },
    microphoneState,
    brainState,
  };
}

function harness(invokeSnapshots) {
  const handlers = new Map();
  const invokeCalls = [];
  const statuses = [];
  const presences = [];
  const snapshots = [];
  const diagnostics = [];
  const errors = [];
  const queue = [...invokeSnapshots];
  const bridge = new RuntimeBridge(
    {
      onStatus: (status, metadata) => statuses.push({ status, metadata }),
      onPresence: (presence) => presences.push(presence),
      onSnapshot: (value) => snapshots.push(value),
      onDiagnostic: (entry) => diagnostics.push(entry),
      onError: (entry) => errors.push(entry),
    },
    {
      invokeFn: async (command, args) => {
        invokeCalls.push({ command, args });
        if (command !== 'runtime_get_snapshot') return null;
        assert.ok(queue.length > 0, 'unexpected snapshot invoke');
        return queue.shift();
      },
      listenFn: async (event, handler) => {
        handlers.set(event, handler);
        return async () => handlers.delete(event);
      },
      setIntervalFn: () => 42,
      clearIntervalFn: () => {},
      persistDiagnostics: false,
    },
  );
  return {
    bridge,
    handlers,
    invokeCalls,
    statuses,
    presences,
    snapshots,
    diagnostics,
    errors,
  };
}

test('Tauri event IDs satisfy the v2 EventName grammar', () => {
  for (const event of Object.values(TAURI_EVENTS)) {
    assert.match(event, TAURI_EVENT_NAME_PATTERN);
    assert.equal(event.includes('.'), false);
  }
});

test('desktop capability grants event IPC to the core window', async () => {
  const capability = JSON.parse(
    await readFile(
      new URL('../src-tauri/capabilities/desktop.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(capability.windows, ['core']);
  assert.ok(capability.permissions.includes('core:event:default'));
  assert.ok(capability.platforms.includes('windows'));
});

test('IDLE is READY when the runtime lifecycle is READY', () => {
  assert.deepEqual(evaluateSnapshotStatus(snapshot()), {
    status: 'READY',
    reason: 'lifecycle=READY presence.state=IDLE',
  });
});

test('READY lifecycle without a valid Presence state fails closed', () => {
  assert.deepEqual(evaluateSnapshotStatus({ lifecycle: 'READY' }), {
    status: 'OFFLINE',
    reason: 'presence.state=MISSING',
  });
  assert.deepEqual(
    evaluateSnapshotStatus({
      lifecycle: 'READY',
      presence: { state: 'FUTURE_UNKNOWN_STATE' },
    }),
    {
      status: 'OFFLINE',
      reason: 'presence.state=FUTURE_UNKNOWN_STATE',
    },
  );
});

test('READY snapshot transports IDLE and microphone ENABLED through the bridge', async () => {
  const ready = snapshot({ bridgeRevision: 4, presenceRevision: 7 });
  const state = harness([ready, ready]);

  await state.bridge.connect();

  assert.equal(state.statuses.at(-1).status, 'READY');
  assert.equal(state.presences.at(-1).state, 'IDLE');
  assert.equal(state.snapshots.at(-1).microphoneState, 'ENABLED');
  assert.deepEqual(
    state.invokeCalls.filter(({ command }) => command === 'runtime_get_snapshot'),
    [
      { command: 'runtime_get_snapshot', args: { lastRevision: -1 } },
      { command: 'runtime_get_snapshot', args: { lastRevision: 7 } },
    ],
  );
  state.bridge.dispose();
});

test('initial OFFLINE snapshot is replaced by the authoritative READY snapshot', async () => {
  const state = harness([
    snapshot({
      bridgeRevision: 0,
      lifecycle: 'STARTING',
      presenceRevision: 0,
      presenceState: 'OFFLINE',
      microphoneState: 'UNAVAILABLE',
      brainState: 'UNAVAILABLE',
    }),
    snapshot({ bridgeRevision: 1, presenceRevision: 0 }),
  ]);

  await state.bridge.connect();

  assert.equal(state.statuses.at(-1).status, 'READY');
  assert.equal(state.presences.at(-1).state, 'IDLE');
  assert.equal(state.snapshots.at(-1).microphoneState, 'ENABLED');
  state.bridge.dispose();
});

test('late stale OFFLINE snapshot cannot overwrite READY', async () => {
  const ready = snapshot({ bridgeRevision: 10, presenceRevision: 3 });
  const state = harness([ready, ready]);
  await state.bridge.connect();

  state.handlers.get(TAURI_EVENTS.SNAPSHOT)({
    payload: snapshot({
      bridgeRevision: 9,
      lifecycle: 'STARTING',
      presenceRevision: 0,
      presenceState: 'OFFLINE',
      microphoneState: 'UNAVAILABLE',
    }),
  });

  assert.equal(state.statuses.at(-1).status, 'READY');
  assert.equal(state.presences.at(-1).state, 'IDLE');
  assert.ok(
    state.diagnostics.some(({ stage }) => stage === 'JS_SNAPSHOT_IGNORED'),
  );
  state.bridge.dispose();
});

test('late stale disconnected event cannot overwrite a newer READY snapshot', async () => {
  const ready = snapshot({ bridgeRevision: 10, presenceRevision: 3 });
  const state = harness([ready, ready]);
  await state.bridge.connect();

  state.handlers.get(TAURI_EVENTS.DISCONNECTED)({
    payload: {
      reason: 'RUNTIME.IPC.DISCONNECTED',
      bridgeRevision: 9,
    },
  });

  assert.equal(state.statuses.at(-1).status, 'READY');
  assert.ok(
    state.diagnostics.some(
      ({ stage }) => stage === 'RUNTIME_DISCONNECTED_IGNORED',
    ),
  );
  state.bridge.dispose();
});

test('presence events keep READY status in sync without waiting for polling', async () => {
  const ready = snapshot({ bridgeRevision: 4, presenceRevision: 7 });
  const state = harness([ready, ready]);
  await state.bridge.connect();

  state.handlers.get(TAURI_EVENTS.PRESENCE_CHANGED)({
    payload: {
      bridgeRevision: 5,
      snapshot: {
        revision: 8,
        state: 'LISTENING',
        reason: 'voice.activation.accepted',
      },
    },
  });

  assert.equal(state.statuses.at(-1).status, 'READY');
  assert.equal(state.presences.at(-1).state, 'LISTENING');
  state.bridge.dispose();
});

test('reconnect accepts lower Core revision in a newer bridge revision', async () => {
  const ready = snapshot({ bridgeRevision: 1, presenceRevision: 9 });
  const state = harness([ready, ready]);
  await state.bridge.connect();
  const onSnapshot = state.handlers.get(TAURI_EVENTS.SNAPSHOT);

  onSnapshot({
    payload: snapshot({
      bridgeRevision: 2,
      lifecycle: 'DEGRADED',
      presenceRevision: 9,
      presenceState: 'OFFLINE',
      microphoneState: 'UNAVAILABLE',
    }),
  });
  onSnapshot({
    payload: snapshot({
      bridgeRevision: 3,
      presenceRevision: 2,
      presenceState: 'IDLE',
    }),
  });

  assert.equal(state.statuses.at(-1).status, 'READY');
  assert.equal(state.presences.at(-1).revision, 2);
  assert.equal(state.presences.at(-1).state, 'IDLE');
  assert.equal(state.snapshots.at(-1).microphoneState, 'ENABLED');
  state.bridge.dispose();
});

test('listener rejection propagates the concrete Tauri exception', async () => {
  const ready = snapshot({ bridgeRevision: 1 });
  const diagnostics = [];
  const errors = [];
  const bridge = new RuntimeBridge(
    {
      onDiagnostic: (entry) => diagnostics.push(entry),
      onError: (entry) => errors.push(entry),
    },
    {
      invokeFn: async (command) =>
        command === 'runtime_get_snapshot' ? ready : null,
      listenFn: async () => {
        throw new Error('event.listen not allowed');
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      persistDiagnostics: false,
    },
  );

  await assert.rejects(
    bridge.connect(),
    /Tauri listen rejected for runtime:presence-changed:.*event\.listen not allowed/,
  );
  assert.match(errors.at(-1).detail, /event\.listen not allowed/);
  assert.ok(diagnostics.some(({ stage }) => stage === 'ERROR'));
});

test('invoke rejection is reported and not converted to a silent fallback', async () => {
  const diagnostics = [];
  const errors = [];
  const bridge = new RuntimeBridge(
    {
      onDiagnostic: (entry) => diagnostics.push(entry),
      onError: (entry) => errors.push(entry),
    },
    {
      invokeFn: async () => {
        throw new Error('command runtime_get_snapshot not found');
      },
      listenFn: async () => async () => {},
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      persistDiagnostics: false,
    },
  );

  await assert.rejects(bridge.connect(), /runtime_get_snapshot not found/);
  assert.match(errors.at(-1).detail, /runtime_get_snapshot not found/);
  assert.ok(diagnostics.some(({ stage }) => stage === 'ERROR'));
});

test('successful polling restores visible READY Presence after a transient invoke error', async () => {
  const ready = snapshot({ bridgeRevision: 6, presenceRevision: 3 });
  let failNextSnapshot = false;
  let poll = null;
  let visibleState = 'STARTING';
  let visibleStatus = 'CONNECTING';
  const bridge = new RuntimeBridge(
    {
      onPresence: (presence) => {
        visibleState = presence.state;
      },
      onStatus: (status) => {
        visibleStatus = status;
        if (status === 'OFFLINE') visibleState = 'OFFLINE';
      },
      onError: () => {
        visibleState = 'ERROR';
      },
    },
    {
      invokeFn: async (command) => {
        if (command !== 'runtime_get_snapshot') return null;
        if (failNextSnapshot) {
          failNextSnapshot = false;
          throw new Error('transient invoke failure');
        }
        return ready;
      },
      listenFn: async () => async () => {},
      setIntervalFn: (callback) => {
        poll = callback;
        return 1;
      },
      clearIntervalFn: () => {},
      persistDiagnostics: false,
    },
  );

  await bridge.connect();
  assert.equal(visibleState, 'IDLE');
  assert.equal(visibleStatus, 'READY');

  failNextSnapshot = true;
  poll();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(visibleState, 'OFFLINE');
  assert.equal(visibleStatus, 'OFFLINE');

  poll();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(visibleState, 'IDLE');
  assert.equal(visibleStatus, 'READY');
  bridge.dispose();
});
