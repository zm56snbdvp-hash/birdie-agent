import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DesktopCommandLedger } from '../src/desktop-command-ledger.mjs';
import { DesktopIntentRouter } from '../src/desktop-intent-router.mjs';
import { BirdieIpcServer } from '../src/ipc-server.mjs';
import { BirdieRuntimeV0 } from '../src/runtime-v0.mjs';
import { connectIpcClient } from './helpers/ipc-client.mjs';

function pipeName(label) {
  return process.platform === 'win32'
    ? String.raw`\\.\pipe\birdie-function-${label}-${process.pid}-${Date.now()}`
    : path.join(os.tmpdir(), `birdie-function-${label}-${process.pid}-${Date.now()}.sock`);
}

async function withServer(label, callback, options = {}) {
  const name = pipeName(label);
  if (process.platform !== 'win32' && fs.existsSync(name)) fs.unlinkSync(name);
  const server = new BirdieIpcServer({ pipeName: name, ...options });
  await server.start();
  try {
    await callback(server, name);
  } finally {
    await server.stop();
    if (process.platform !== 'win32' && fs.existsSync(name)) fs.unlinkSync(name);
  }
}

function command(commandId, overrides = {}) {
  return {
    commandId,
    name: 'desktop.module.open',
    args: { moduleId: 'SYSTEM' },
    issuedAtMs: 1_000,
    expiresAtMs: 6_000,
    target: { instanceId: 'desktop-a', connectionId: 'connection-1234' },
    provenance: {
      origin: 'COMMAND_CENTER',
      sourceComponent: 'birdie-desktop',
      sourceInstanceId: 'desktop-a',
      sessionId: 'desktop-a',
      eventId: null,
      turnId: null,
      traceId: null,
    },
    ...overrides,
  };
}

function runtimeEvent(name, sequence, { sessionId = 'voice-session-a', turnId = null, payload = {}, classification = 'operational', eventId } = {}) {
  return {
    contract_version: '1.0',
    kind: 'event',
    name,
    event_id: eventId ?? `voice-${sessionId}-${sequence}-${name}`,
    source: 'birdie-voice',
    timestamp_utc: new Date(10_000 + sequence).toISOString(),
    monotonic_ms: sequence,
    source_sequence: sequence,
    trace_id: `trace-${sessionId}`,
    session_id: sessionId,
    turn_id: turnId,
    data_classification: classification,
    payload,
  };
}

function sendPublish(client, requestId, payload) {
  client.send({ type: 'runtime.event.publish', requestId, payload });
  return client.waitFor((message) => message.requestId === requestId);
}

test('intent router accepts the local application voice phrases', () => {
  const router = new DesktopIntentRouter();
  const cases = [
    ['Birdie, öffne den Browser', 'BROWSER'],
    ['Birdie, öffne den Rechner', 'CALCULATOR'],
    ['Birdie, öffne die Dateien', 'FILES'],
    ['Birdie, öffne den Notizblock', 'NOTEPAD'],
    ['Birdie, öffne die Einstellungen', 'SETTINGS'],
    ['Birdie, öffne das Terminal', 'TERMINAL'],
  ];
  for (const [phrase, appId] of cases) {
    const result = router.route(phrase);
    assert.equal(result.matched, true, phrase);
    assert.equal(result.name, 'desktop.app.open');
    assert.equal(result.args.appId, appId);
  }
  assert.equal(router.route('Birdie, execute PowerShell').matched, false);
});

test('ledger is bounded, idempotent, and rejects semantic replay conflicts', () => {
  const ledger = new DesktopCommandLedger({ maximumEntries: 2, now: () => 2_000 });
  assert.equal(ledger.register(command('command-0001')).kind, 'NEW');
  assert.equal(ledger.register(command('command-0001')).kind, 'REPLAY');
  assert.equal(ledger.register(command('command-0001', { args: { moduleId: 'FOCUS' } })).kind, 'CONFLICT');
  assert.equal(ledger.register(command('command-0002')).kind, 'NEW');
  assert.equal(ledger.register(command('command-0003')).kind, 'CAPACITY');
  ledger.complete('command-0001', 'ACKNOWLEDGED');
  assert.equal(ledger.register(command('command-0003')).kind, 'NEW');
  assert.equal(ledger.pending().length, 2);
});

test('late completion and failure events cannot mutate a newer active turn', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(runtimeEvent('voice.activation.accepted', 1, { turnId: 'turn-old' }));
  runtime.apply(runtimeEvent('voice.utterance.finalized', 2, { turnId: 'turn-old', classification: 'content', payload: { transcript: 'System' } }));
  runtime.apply(runtimeEvent('voice.activation.accepted', 3, { turnId: 'turn-new' }));
  const before = runtime.getSnapshot();
  for (const [index, name] of ['runtime.turn.completed', 'runtime.turn.failed', 'brain.turn.failed', 'voice.output.failed'].entries()) {
    const result = runtime.apply(runtimeEvent(name, 4 + index, { turnId: 'turn-old' }), { sourceScope: `core:${index}` });
    assert.equal(result.dropped, 'stale_turn_event');
    assert.equal(runtime.getSnapshot().activeTurn.id, 'turn-new');
    assert.equal(runtime.getSnapshot().presence.state, before.presence.state);
  }
});

test('Voice-to-Desktop command round-trip is correlated, idempotent, and returns to IDLE', async () => {
  await withServer('voice-roundtrip', async (server, name) => {
    const desktop = await connectIpcClient(name, {
      role: 'desktop', component: 'birdie-desktop', instanceId: 'desktop-session-a',
    });
    const voice = await connectIpcClient(name, {
      role: 'voice', component: 'birdie-voice', instanceId: 'voice-session-a',
    });
    try {
      await sendPublish(voice, 'ready', runtimeEvent('component.ready', 1));
      await sendPublish(voice, 'accepted', runtimeEvent('voice.activation.accepted', 2, { turnId: 'turn-command' }));
      const finalized = runtimeEvent('voice.utterance.finalized', 3, {
        turnId: 'turn-command',
        classification: 'content',
        payload: { transcript: 'Birdie, öffne den Browser' },
      });
      await sendPublish(voice, 'finalized', finalized);

      const routed = await desktop.waitFor((message) => message.type === 'desktop.command');
      assert.equal(routed.requestId, routed.payload.commandId);
      assert.equal(routed.payload.name, 'desktop.app.open');
      assert.equal(routed.payload.args.appId, 'BROWSER');
      assert.equal(routed.payload.provenance.sessionId, 'voice-session-a');
      desktop.send({
        type: 'desktop.command.result',
        requestId: routed.payload.commandId,
        payload: {
          commandId: routed.payload.commandId,
          connectionId: desktop.helloResult.payload.connectionId,
          status: 'ACKNOWLEDGED',
          errorCode: null,
          completedAtMs: Date.now(),
        },
      });
      const status = await desktop.waitFor((message) =>
        message.type === 'desktop.command.status' && message.payload.commandId === routed.payload.commandId);
      assert.equal(status.payload.status, 'ACKNOWLEDGED');
      assert.equal(server.getSnapshot().presence.state, 'IDLE');

      const duplicate = await sendPublish(voice, 'finalized-retry', finalized);
      assert.equal(duplicate.payload.dropped, 'duplicate_event');
      assert.equal(desktop.messages.filter((message) => message.type === 'desktop.command').length, 1);
    } finally {
      desktop.socket.destroy();
      voice.socket.destroy();
    }
  });
});

test('pending command redispatches only to the same stable Desktop instance', async () => {
  await withServer('reconnect', async (_server, name) => {
    const desktopA = await connectIpcClient(name, {
      role: 'desktop', component: 'birdie-desktop', instanceId: 'desktop-stable-a',
    });
    const now = Date.now();
    desktopA.send({
      type: 'desktop.intent.submit',
      requestId: 'intent-reconnect',
      payload: {
        commandId: 'command-reconnect-1',
        text: 'Öffne den Browser',
        issuedAtMs: now,
        expiresAtMs: now + 5_000,
      },
    });
    const first = await desktopA.waitFor((message) => message.type === 'desktop.command');

    const desktopB = await connectIpcClient(name, {
      role: 'desktop', component: 'birdie-desktop', instanceId: 'desktop-foreign-b',
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(desktopB.messages.some((message) => message.type === 'desktop.command'), false);

    const desktopA2 = await connectIpcClient(name, {
      role: 'desktop', component: 'birdie-desktop', instanceId: 'desktop-stable-a',
    });
    const replay = await desktopA2.waitFor((message) => message.type === 'desktop.command');
    assert.equal(replay.payload.commandId, first.payload.commandId);
    assert.notEqual(replay.payload.target.connectionId, first.payload.target.connectionId);
    desktopA.socket.destroy();
    desktopB.socket.destroy();
    desktopA2.socket.destroy();
  });
});

test('an ACK received after the Core deadline is terminally reported as TIMEOUT', async () => {
  let now = 50_000;
  await withServer('late-ack', async (_server, name) => {
    const desktop = await connectIpcClient(name, {
      role: 'desktop', component: 'birdie-desktop', instanceId: 'desktop-late-ack',
    });
    try {
      desktop.send({
        type: 'desktop.intent.submit',
        requestId: 'intent-late-ack',
        payload: {
          commandId: 'command-late-ack',
          text: 'Öffne den Browser',
          issuedAtMs: now,
          expiresAtMs: now + 1_000,
        },
      });
      const routed = await desktop.waitFor((message) => message.type === 'desktop.command');
      now += 1_001;
      desktop.send({
        type: 'desktop.command.result',
        requestId: routed.payload.commandId,
        payload: {
          commandId: routed.payload.commandId,
          connectionId: desktop.helloResult.payload.connectionId,
          status: 'ACKNOWLEDGED',
          errorCode: null,
          completedAtMs: now,
        },
      });
      const status = await desktop.waitFor((message) =>
        message.type === 'desktop.command.status'
        && message.payload.commandId === routed.payload.commandId
        && message.payload.status === 'TIMEOUT');
      assert.equal(status.payload.errorCode, 'DESKTOP.COMMAND.TIMEOUT');
    } finally {
      desktop.socket.destroy();
    }
  }, { now: () => now, desktopCommandTimeoutMs: 10_000 });
});

test('Voice provenance and producer allowlist fail closed', async () => {
  await withServer('voice-guards', async (_server, name) => {
    const voice = await connectIpcClient(name, {
      role: 'voice', component: 'birdie-voice', instanceId: 'voice-session-guard',
    });
    try {
      const wrongSession = await sendPublish(voice, 'wrong-session', runtimeEvent('component.ready', 1, { sessionId: 'foreign-session' }));
      assert.equal(wrongSession.error, 'CONTRACT.PROVENANCE_MISMATCH');
      const forbidden = await sendPublish(voice, 'core-only', runtimeEvent('runtime.turn.completed', 2, { sessionId: 'voice-session-guard', turnId: 'turn-x' }));
      assert.equal(forbidden.error, 'CONTRACT.EVENT_NOT_ALLOWED');
    } finally {
      voice.socket.destroy();
    }
  });
});
