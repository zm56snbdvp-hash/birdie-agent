import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { BirdieIpcServer } from '../src/ipc-server.mjs';

function connectAndCollect(pipeName) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName);
    socket.setEncoding('utf8');
    let buffer = '';
    const messages = [];
    socket.on('data', chunk => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) messages.push(JSON.parse(line));
      }
      if (messages.length >= 1) resolve({ socket, messages });
    });
    socket.on('error', reject);
  });
}

test('IPC emits snapshot and applies microphone command', async () => {
  const pipeName = process.platform === 'win32'
    ? `\\\\.\\pipe\\birdie-core-test-${process.pid}-${Date.now()}`
    : path.join(os.tmpdir(), `birdie-core-test-${process.pid}-${Date.now()}.sock`);

  if (process.platform !== 'win32' && fs.existsSync(pipeName)) fs.unlinkSync(pipeName);
  const server = new BirdieIpcServer({ pipeName });
  await server.start();

  const { socket, messages } = await connectAndCollect(pipeName);
  assert.equal(messages[0].type, 'runtime.snapshot');
  assert.equal(messages[0].payload.microphoneState, 'ENABLED');

  socket.write(JSON.stringify({
    type: 'runtime.command',
    requestId: 'mic-off',
    payload: { name: 'ui.microphone.set_enabled', enabled: false }
  }) + '\n');

  const response = await new Promise((resolve, reject) => {
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n').filter(Boolean).map(line => JSON.parse(line));
      const ack = lines.find(m => m.type === 'runtime.command.ack');
      if (ack) resolve(ack);
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('timeout waiting for runtime.command.ack')), 1500);
  });

  assert.equal(response.payload.accepted, true);
  assert.equal(response.payload.microphoneState, 'MUTED_BY_USER');

  socket.destroy();
  await server.stop();
  if (process.platform !== 'win32' && fs.existsSync(pipeName)) fs.unlinkSync(pipeName);
});
