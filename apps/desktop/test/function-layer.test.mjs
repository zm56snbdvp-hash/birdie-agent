import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureService } from '../src/capture-service.js';
import { CommandCenterModel } from '../src/command-center-model.js';
import { FocusService, FOCUS_STATUS } from '../src/focus-service.js';
import {
  MODULE_IDS,
  listModules,
  moduleIdForKeyboardEvent,
} from '../src/module-registry.js';
import { RuntimeBridge } from '../src/runtime-bridge.js';
import { SurfaceController } from '../src/surface-controller.js';
import { SystemModel } from '../src/system-model.js';

test('registry exposes exactly four modules and only local module shortcuts', () => {
  assert.deepEqual(listModules().map(({ id }) => id), [
    MODULE_IDS.COMMAND_CENTER,
    MODULE_IDS.SYSTEM,
    MODULE_IDS.FOCUS,
    MODULE_IDS.CAPTURE,
  ]);
  for (const [key, expected] of Object.entries({
    1: MODULE_IDS.COMMAND_CENTER,
    2: MODULE_IDS.SYSTEM,
    3: MODULE_IDS.FOCUS,
    4: MODULE_IDS.CAPTURE,
    k: MODULE_IDS.COMMAND_CENTER,
  })) {
    assert.equal(moduleIdForKeyboardEvent({ key, ctrlKey: true }), expected);
  }
  assert.equal(
    moduleIdForKeyboardEvent({ key: ' ', ctrlKey: true, shiftKey: true }),
    null,
    'the global Ctrl+Shift+Space shortcut must stay native-only',
  );
  assert.equal(moduleIdForKeyboardEvent({ key: '1', ctrlKey: false }), null);
});

test('surface controller serializes native state and one Escape performs one invoke', async () => {
  let snapshot = {
    mode: 'AMBIENT',
    activeModule: null,
    revision: 0,
    globalShortcutStatus: 'REGISTERED',
  };
  const calls = [];
  const bridge = {
    async getSurfaceState() { calls.push('get'); return snapshot; },
    async openModule(moduleId) {
      calls.push(`open:${moduleId}`);
      snapshot = { ...snapshot, mode: 'CONTROL', activeModule: moduleId, revision: snapshot.revision + 1 };
      return snapshot;
    },
    async setInteractionMode(enabled) {
      calls.push(`mode:${enabled}`);
      snapshot = { ...snapshot, mode: enabled ? 'CONTROL' : 'AMBIENT', activeModule: null, revision: snapshot.revision + 1 };
      return snapshot;
    },
  };
  const controller = new SurfaceController(bridge);
  await controller.initialize();
  await controller.openModule(MODULE_IDS.FOCUS);
  assert.equal(controller.getState().activeModule, MODULE_IDS.FOCUS);

  assert.equal(controller.applyNativeState({ ...snapshot, mode: 'BROKEN', revision: 99 }), false);
  assert.equal(controller.applyNativeState({ ...snapshot, revision: 0 }), false);
  assert.equal(controller.getState().revision, 1);

  await Promise.all([controller.escape(), controller.escape()]);
  assert.equal(controller.getState().mode, 'AMBIENT');
  assert.equal(calls.filter((call) => call === 'mode:false').length, 1);
});

test('system model preserves UNKNOWN, clears nullable identity, and marks stale truthfully', () => {
  let now = 10_000;
  const model = new SystemModel({}, { now: () => now, staleAfterMs: 3_000 });
  assert.equal(model.getState().coreStatus, 'UNKNOWN');
  assert.equal(model.getState().voiceStatus, 'UNKNOWN');
  assert.equal(model.getState().microphoneState, 'UNAVAILABLE');

  model.updateNativeSnapshot({
    coreStatus: 'READY',
    voiceStatus: 'RUNNING',
    microphoneState: 'ENABLED',
    presenceState: 'IDLE',
    brainState: 'READY',
    ipcState: 'CONNECTED',
    connectionId: 'connection-1234',
    lastCoreMessageAt: 9_000,
    mode: 'CONTROL',
    activeModule: 'SYSTEM',
    globalShortcutStatus: 'REGISTERED',
  });
  assert.equal(model.getState().stale, false);
  assert.equal(model.getState().activeModule, 'SYSTEM');
  now = 13_001;
  assert.equal(model.getState().stale, true);

  model.updateNativeSnapshot({ connectionId: null, lastCoreMessageAt: null, ipcState: 'OFFLINE' });
  assert.equal(model.getState().connectionId, null);
  assert.equal(model.getState().lastCoreMessageAt, null);
  assert.equal(model.getState().stale, true);
});

test('focus persists deadline transitions and reconstructs an expired timer after restart', async () => {
  let now = 1_000;
  let persisted = null;
  const saves = [];
  const bridge = {
    async getFocusState() { return persisted; },
    async saveFocusState(state) {
      persisted = structuredClone(state);
      saves.push(structuredClone(state));
      return persisted;
    },
  };
  const focus = new FocusService(bridge, { now: () => now });
  await focus.load();
  await focus.start({ task: 'Alpha bauen', durationMs: 60_000 });
  assert.equal(focus.getState().status, FOCUS_STATUS.RUNNING);
  assert.equal(persisted.deadlineAtMs, 61_000);

  now = 11_000;
  await focus.pause();
  assert.equal(focus.getState().remainingMs, 50_000);
  assert.equal(focus.getState().status, FOCUS_STATUS.PAUSED);
  now = 21_000;
  await focus.resume();
  assert.equal(persisted.deadlineAtMs, 71_000);
  now = 71_000;
  assert.equal(focus.getState().status, FOCUS_STATUS.COMPLETED);
  await focus.tick();
  assert.equal(persisted.status, FOCUS_STATUS.COMPLETED);

  persisted = {
    schemaVersion: 1,
    task: 'Nach Neustart',
    durationMs: 10_000,
    remainingMs: 10_000,
    status: FOCUS_STATUS.RUNNING,
    startedAtMs: 1,
    deadlineAtMs: 5_000,
    updatedAtMs: 1,
  };
  const restarted = new FocusService(bridge, { now: () => now });
  await restarted.load();
  assert.equal(restarted.getState().status, FOCUS_STATUS.COMPLETED);
  assert.equal(saves.at(-1).status, FOCUS_STATUS.COMPLETED);
});

test('capture uses only the local native adapter, sorts entries, and deletes by exact id', async () => {
  const calls = [];
  let entries = [
    { id: 'old', text: 'Alt', createdAt: 10 },
    { id: 'new', text: 'Neu', createdAt: 20 },
    { id: '', text: 'invalid', createdAt: 30 },
  ];
  const bridge = {
    async listCaptures() { calls.push('list'); return entries; },
    async addCapture(text) {
      calls.push(['add', text]);
      const entry = { id: 'added', text, createdAt: 30 };
      entries = [entry, ...entries];
      return entry;
    },
    async deleteCapture(id) { calls.push(['delete', id]); return true; },
  };
  const capture = new CaptureService(bridge);
  await capture.load();
  assert.deepEqual(capture.getEntries().map(({ id }) => id), ['new', 'old']);
  await capture.add('  Nur lokal  ');
  assert.deepEqual(calls.at(-1), ['add', 'Nur lokal']);
  await capture.delete('new');
  assert.deepEqual(calls.at(-1), ['delete', 'new']);
  assert.deepEqual(capture.getEntries().map(({ id }) => id), ['added', 'old']);
});

test('command center keeps correlation IDs and never turns late status into success', async () => {
  let now = 5_000;
  const timers = new Map();
  let timerId = 0;
  const submissions = [];
  const model = new CommandCenterModel(
    {
      async submitDesktopIntent(payload) {
        submissions.push(payload);
        return { commandId: payload.commandId, status: 'SENT' };
      },
    },
    {
      now: () => now,
      idFactory: () => 'command-1234',
      timeoutMs: 2_000,
      setTimeoutFn: (callback) => { timers.set(++timerId, callback); return timerId; },
      clearTimeoutFn: (id) => timers.delete(id),
    },
  );
  await model.submit('Öffne System');
  assert.deepEqual(submissions[0], {
    commandId: 'command-1234',
    text: 'Öffne System',
    issuedAtMs: 5_000,
    expiresAtMs: 7_000,
  });
  assert.equal(model.getEntries()[0].status, 'SENT');
  now = 5_100;
  assert.equal(model.applyStatus({ commandId: 'command-1234', status: 'ACKNOWLEDGED' }), true);
  assert.equal(model.getEntries()[0].status, 'ACKNOWLEDGED');
  assert.equal(model.applyStatus({ commandId: 'command-1234', status: 'FAILED' }), false);

  const timeoutModel = new CommandCenterModel(
    { async submitDesktopIntent() { return null; } },
    {
      now: () => now,
      idFactory: () => 'command-timeout',
      timeoutMs: 1_000,
      setTimeoutFn: (callback) => { timers.set(++timerId, callback); return timerId; },
      clearTimeoutFn: (id) => timers.delete(id),
    },
  );
  await timeoutModel.submit('Capture');
  const timeout = [...timers.values()].at(-1);
  now += 1_000;
  timeout();
  assert.equal(timeoutModel.getEntries()[0].status, 'TIMEOUT');
  assert.equal(timeoutModel.applyStatus({ commandId: 'command-timeout', status: 'ACKNOWLEDGED' }), false);
});

test('runtime bridge invokes every native Function Layer command with exact arguments', async () => {
  const calls = [];
  const bridge = new RuntimeBridge({}, {
    invokeFn: async (command, args) => { calls.push([command, args]); return {}; },
    listenFn: async () => async () => {},
    persistDiagnostics: false,
  });
  await bridge.getSurfaceState();
  await bridge.openModule('FOCUS');
  await bridge.setInteractionMode(false);
  await bridge.submitDesktopIntent({ commandId: 'command-1234', text: 'Focus', issuedAtMs: 1, expiresAtMs: 2 });
  await bridge.getSystemSnapshot();
  await bridge.getFocusState();
  await bridge.saveFocusState({ status: 'IDLE' });
  await bridge.listCaptures();
  await bridge.addCapture('lokal');
  await bridge.deleteCapture('capture-1');
  assert.deepEqual(calls, [
    ['desktop_get_surface_state', undefined],
    ['desktop_open_module', { moduleId: 'FOCUS' }],
    ['desktop_set_interaction_mode', { enabled: false }],
    ['runtime_submit_desktop_intent', { commandId: 'command-1234', text: 'Focus', issuedAtMs: 1, expiresAtMs: 2 }],
    ['runtime_get_system_snapshot', undefined],
    ['focus_get_state', undefined],
    ['focus_save_state', { state: { status: 'IDLE' } }],
    ['capture_list', undefined],
    ['capture_add', { text: 'lokal' }],
    ['capture_delete', { id: 'capture-1' }],
  ]);
});
