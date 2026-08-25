import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { BirdieIpcServer, PIPE_NAME } from '../../services/core/src/ipc-server.mjs';

const expectedStates = [
  'IDLE',
  'SPEECH_DETECTED',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'IDLE',
];

function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) {
        return reject(new Error(`condition timed out after ${timeoutMs} ms`));
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`voice smoke publisher exited code=${code} signal=${signal}`));
    });
  });
}

const executable = process.env.BIRDIE_VOICE_SMOKE_EXE;
assert.ok(executable, 'BIRDIE_VOICE_SMOKE_EXE must point to the built C++ smoke publisher');

const server = new BirdieIpcServer();
let observer;
let child;

try {
  await server.start();

  const states = [];
  observer = net.createConnection(PIPE_NAME);
  observer.setEncoding('utf8');
  let buffer = '';
  observer.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.type === 'runtime.presence.changed') {
        states.push(message.payload.state);
      }
    }
  });
  await once(observer, 'connect');

  child = spawn(executable, [], { stdio: 'inherit', windowsHide: true });
  await waitForExit(child);
  await waitFor(() => states.length >= expectedStates.length);

  assert.deepEqual(
    states.slice(0, expectedStates.length),
    expectedStates,
    `unexpected Voice→Core presence trace: ${states.join(' → ')}`,
  );

  console.log(`voice-core-process-smoke: PASS (${states.join(' → ')})`);
} finally {
  if (child && child.exitCode === null) child.kill();
  observer?.destroy();
  await server.stop();
}
