import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IpcRole } from '../../../packages/protocol/src/contract.mjs';
import { BirdieIpcServer } from '../src/ipc-server.mjs';
import { connectIpcClient } from './helpers/ipc-client.mjs';

function pipeName() {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\birdie-realtime-test-${process.pid}-${Date.now()}`;
  }
  return path.join(
    os.tmpdir(),
    `birdie-realtime-test-${process.pid}-${Date.now()}.sock`,
  );
}

function inputLevelEvent() {
  return {
    contract_version: '1.0',
    kind: 'event',
    name: 'voice.input.level',
    event_id: 'input-level-1',
    source: 'birdie-voice-realtime-test',
    timestamp_utc: new Date().toISOString(),
    monotonic_ms: 1234,
    source_sequence: 1,
    trace_id: 'trace-realtime',
    session_id: 'session-realtime',
    turn_id: null,
    data_classification: 'operational',
    payload: {
      normalized_level: 1.8,
      vad_probability: -0.2,
    },
  };
}

test('Voice levels are normalized and forwarded without changing Presence', async () => {
  const name = pipeName();
  if (process.platform !== 'win32' && fs.existsSync(name)) fs.unlinkSync(name);

  const server = new BirdieIpcServer({ pipeName: name });
  await server.start();
  const observer = await connectIpcClient(name, {
    role: IpcRole.OBSERVER,
    component: 'presence-observer-test',
  });
  const voice = await connectIpcClient(name, {
    role: IpcRole.VOICE,
    component: 'birdie-voice-realtime-test',
  });

  try {
    await observer.waitFor((message) => message.type === 'runtime.snapshot');
    const revisionBefore = server.getSnapshot().presence.revision;

    voice.send({
      type: 'runtime.event.publish',
      requestId: 'best-effort-level',
      payload: inputLevelEvent(),
    });

    const realtime = await observer.waitFor(
      (message) => message.type === 'runtime.audio.input',
    );
    assert.deepEqual(realtime.payload, {
      level: 1,
      vadProbability: 0,
      monotonicMs: 1234,
    });
    assert.equal(server.getSnapshot().presence.revision, revisionBefore);

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(
      voice.messages.some(
        (message) =>
          message.type === 'runtime.event.ack' &&
          message.requestId === 'best-effort-level',
      ),
      false,
      'best-effort level events must not create ACK traffic',
    );
    assert.equal(
      voice.messages.some(
        (message) => message.type === 'runtime.audio.input',
      ),
      false,
      'Core must not send desktop audio projections to Voice role',
    );
  } finally {
    observer.socket.destroy();
    voice.socket.destroy();
    await server.stop();
    if (process.platform !== 'win32' && fs.existsSync(name)) fs.unlinkSync(name);
  }
});
