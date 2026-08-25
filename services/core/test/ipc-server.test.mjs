import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { BirdieIpcServer } from '../src/ipc-server.mjs';

async function connectClient(pipeName) {
  const socket = net.createConnection(pipeName);
  socket.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  let buffer = '';
  const messages = [];
  const waiters = new Set();

  function notify() {
    for (const waiter of [...waiters]) {
      const match = messages.find(waiter.predicate);
      if (!match) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(match);
    }
  }

  socket.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) messages.push(JSON.parse(line));
    }
    notify();
  });

  function waitFor(predicate, timeoutMs = 1_500) {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('timeout waiting for IPC message'));
        }, timeoutMs),
      };
      waiters.add(waiter);
    });
  }

  return { socket, messages, waitFor };
}

function voicePrivacyEvent(state, sequence = 1) {
  return {
    contract_version: '1.0',
    kind: 'event',
    name: 'voice.privacy.changed',
    event_id: `privacy-${sequence}`,
    source: 'birdie-voice-test',
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

  const desktop = await connectClient(pipeName);
  const voice = await connectClient(pipeName);
  try {
    const initial = await desktop.waitFor(
      (message) => message.type === 'runtime.snapshot',
    );
    assert.equal(initial.payload.microphoneState, 'UNAVAILABLE');

    desktop.socket.write(`${JSON.stringify({
      type: 'runtime.command',
      requestId: 'mic-off',
      payload: { name: 'ui.microphone.set_enabled', enabled: false },
    })}\n`);

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

    voice.socket.write(`${JSON.stringify({
      type: 'runtime.event.publish',
      requestId: 'privacy-confirmation',
      payload: voicePrivacyEvent('MUTED_BY_USER'),
    })}\n`);

    const confirmed = await desktop.waitFor(
      (message) =>
        message.type === 'runtime.snapshot' &&
        message.payload.microphoneState === 'MUTED_BY_USER',
    );
    assert.equal(confirmed.payload.microphoneState, 'MUTED_BY_USER');
    assert.equal(server.getSnapshot().microphoneState, 'MUTED_BY_USER');
  } finally {
    desktop.socket.destroy();
    voice.socket.destroy();
    await server.stop();
    if (process.platform !== 'win32' && fs.existsSync(pipeName)) fs.unlinkSync(pipeName);
  }
});
