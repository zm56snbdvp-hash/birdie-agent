import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { IpcRole } from '../../../packages/protocol/src/contract.mjs';
import { BirdieIpcServer } from '../src/ipc-server.mjs';
import { connectIpcClient } from './helpers/ipc-client.mjs';

function voicePrivacyEvent(state, sequence = 1) {
  return {
    contract_version: '1.0',
    kind: 'event',
    name: 'voice.privacy.changed',
    event_id: `privacy-${sequence}`,
    source: 'birdie-voice',
    timestamp_utc: new Date().toISOString(),
    monotonic_ms: sequence,
    source_sequence: sequence,
    trace_id: 'trace-microphone-test',
    session_id: 'session-microphone-test',
    turn_id: null,
    data_classification: 'operational',
    payload: { microphone_state: state },
  };
}

test('IPC routes microphone command and waits for Voice privacy confirmation', async () => {
  const pipeName = process.platform === 'win32'
    ? `\\\\.\\pipe\\birdie-core-test-${process.pid}-${Date.now()}`
    : path.join(os.tmpdir(), `birdie-core-test-${process.pid}-${Date.now()}.sock`);

  if (process.platform !== 'win32' && fs.existsSync(pipeName)) fs.unlinkSync(pipeName);
  const server = new BirdieIpcServer({ pipeName });
  await server.start();

  const desktop = await connectIpcClient(pipeName, {
    role: IpcRole.DESKTOP,
    component: 'birdie-desktop',
  });
  const voice = await connectIpcClient(pipeName, {
    role: IpcRole.VOICE,
    component: 'birdie-voice',
    instanceId: 'session-microphone-test',
  });

  try {
    const initial = await desktop.waitFor(
      (message) => message.type === 'runtime.snapshot',
    );
    assert.equal(initial.payload.microphoneState, 'UNAVAILABLE');
    assert.equal(
      voice.messages.some((message) => message.type === 'runtime.snapshot'),
      false,
      'Voice role must not receive desktop snapshots',
    );

    desktop.send({
      type: 'runtime.command',
      requestId: 'mic-off',
      payload: { name: 'ui.microphone.set_enabled', enabled: false },
    });

    const routed = await voice.waitFor(
      (message) =>
        message.type === 'voice.command' && message.requestId === 'mic-off',
    );
    assert.deepEqual(routed.payload, {
      name: 'voice.mute.set',
      enabled: false,
    });

    const ack = await desktop.waitFor(
      (message) =>
        message.type === 'runtime.command.ack' &&
        message.requestId === 'mic-off',
    );
    assert.equal(ack.payload.accepted, true);
    assert.equal(ack.payload.pendingVoiceConfirmation, true);
    assert.equal(ack.payload.microphoneState, 'UNAVAILABLE');
    assert.equal(server.getSnapshot().microphoneState, 'UNAVAILABLE');

    voice.send({
      type: 'runtime.event.publish',
      requestId: 'privacy-confirmation',
      payload: voicePrivacyEvent('MUTED_BY_USER'),
    });

    const confirmed = await desktop.waitFor(
      (message) =>
        message.type === 'runtime.snapshot' &&
        message.payload.microphoneState === 'MUTED_BY_USER',
    );
    assert.equal(confirmed.payload.microphoneState, 'MUTED_BY_USER');
    assert.equal(server.getSnapshot().microphoneState, 'MUTED_BY_USER');

    const eventAck = await voice.waitFor(
      (message) =>
        message.type === 'runtime.event.ack' &&
        message.requestId === 'privacy-confirmation',
    );
    assert.equal(eventAck.payload.accepted, true);
  } finally {
    desktop.socket.destroy();
    voice.socket.destroy();
    await server.stop();
    if (process.platform !== 'win32' && fs.existsSync(pipeName)) fs.unlinkSync(pipeName);
  }
});
