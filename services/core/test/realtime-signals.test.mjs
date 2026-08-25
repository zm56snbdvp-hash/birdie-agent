import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { BirdieIpcServer } from '../src/ipc-server.mjs';

function pipeName() {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\birdie-realtime-test-${process.pid}-${Date.now()}`;
  }
  return path.join(
    os.tmpdir(),
    `birdie-realtime-test-${process.pid}-${Date.now()}.sock`,
  );
}

async function connect(name) {
  const socket = net.createConnection(name);
  socket.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  let buffer = '';
  const messages = [];
  const waiters = new Set();

  socket.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) messages.push(JSON.parse(line));
    }
    for (const waiter of [...waiters]) {
      const match = messages.find(waiter.predicate);
      if (!match) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(match);
    }
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
          reject(new Error('timeout waiting for realtime IPC message'));
        }, timeoutMs),
      };
      waiters.add(waiter);
    });
  }

  return { socket, messages, waitFor };
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
  const observer = await connect(name);
  const publisher = await connect(name);

  try {
    await observer.waitFor((message) => message.type === 'runtime.snapshot');
    const revisionBefore = server.getSnapshot().presence.revision;

    publisher.socket.write(`${JSON.stringify({
      type: 'runtime.event.publish',
      requestId: 'best-effort-level',
      payload: inputLevelEvent(),
    })}\n`);

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
      publisher.messages.some(
        (message) =>
          message.type === 'runtime.event.ack' &&
          message.requestId === 'best-effort-level',
      ),
      false,
      'best-effort level events must not create ACK traffic',
    );
    assert.equal(
      publisher.messages.some(
        (message) => message.type === 'runtime.audio.input',
      ),
      false,
      'Core must not echo derived audio levels back to the Voice publisher',
    );
  } finally {
    observer.socket.destroy();
    publisher.socket.destroy();
    await server.stop();
    if (process.platform !== 'win32' && fs.existsSync(name)) fs.unlinkSync(name);
  }
});
