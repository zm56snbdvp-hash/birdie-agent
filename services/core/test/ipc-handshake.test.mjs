import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IpcRole } from '../../../packages/protocol/src/contract.mjs';
import { BirdieIpcServer } from '../src/ipc-server.mjs';
import {
  connectIpcClient,
  connectRawClient,
} from './helpers/ipc-client.mjs';

function uniquePipe(label) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\birdie-handshake-${label}-${process.pid}-${Date.now()}`;
  }
  return path.join(
    os.tmpdir(),
    `birdie-handshake-${label}-${process.pid}-${Date.now()}.sock`,
  );
}

async function withServer(label, callback) {
  const pipeName = uniquePipe(label);
  if (process.platform !== 'win32' && fs.existsSync(pipeName)) {
    fs.unlinkSync(pipeName);
  }
  const server = new BirdieIpcServer({ pipeName });
  await server.start();
  try {
    await callback(server, pipeName);
  } finally {
    await server.stop();
    if (process.platform !== 'win32' && fs.existsSync(pipeName)) {
      fs.unlinkSync(pipeName);
    }
  }
}

test('unregistered sockets cannot request Runtime state', async () => {
  await withServer('required', async (_server, pipeName) => {
    const raw = await connectRawClient(pipeName);
    try {
      raw.send({ type: 'runtime.snapshot.request', requestId: 'before-hello' });
      const error = await raw.waitFor(
        (message) => message.requestId === 'before-hello',
      );
      assert.equal(error.type, 'error');
      assert.equal(error.error, 'CONTRACT.HANDSHAKE_REQUIRED');
      assert.equal(
        raw.messages.some((message) => message.type === 'runtime.snapshot'),
        false,
      );
    } finally {
      raw.socket.destroy();
    }
  });
});

test('contract major mismatch is rejected', async () => {
  await withServer('version', async (_server, pipeName) => {
    const rejected = await connectIpcClient(pipeName, {
      role: IpcRole.DESKTOP,
      component: 'birdie-desktop',
      contractVersion: '2.0',
      expectAccepted: false,
    });
    try {
      assert.equal(rejected.helloResult.type, 'error');
      assert.equal(rejected.helloResult.error, 'CONTRACT.VERSION_MISMATCH');
      assert.deepEqual(rejected.helloResult.details, {
        expected: '1.0',
        received: '2.0',
      });
    } finally {
      rejected.socket.destroy();
    }
  });
});

test('role/component mismatch cannot replace the active Voice client', async () => {
  await withServer('role-component', async (_server, pipeName) => {
    const legitimate = await connectIpcClient(pipeName, {
      role: IpcRole.VOICE,
      component: 'birdie-voice',
      instanceId: 'voice-legitimate',
    });
    let legitimateClosed = false;
    legitimate.socket.once('close', () => {
      legitimateClosed = true;
    });

    const rejected = await connectIpcClient(pipeName, {
      role: IpcRole.VOICE,
      component: 'not-birdie-voice',
      instanceId: 'voice-role-impostor',
      expectAccepted: false,
    });
    try {
      assert.equal(rejected.helloResult.type, 'error');
      assert.equal(
        rejected.helloResult.error,
        'CONTRACT.ROLE_COMPONENT_MISMATCH',
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(legitimateClosed, false);

      rejected.send({
        type: 'runtime.event.publish',
        requestId: 'rejected-voice-publish',
        payload: {},
      });
      const error = await rejected.waitFor(
        (message) => message.requestId === 'rejected-voice-publish',
      );
      assert.equal(error.type, 'error');
      assert.equal(error.error, 'CONTRACT.HANDSHAKE_REQUIRED');
    } finally {
      legitimate.socket.destroy();
      rejected.socket.destroy();
    }
  });
});

test('observer role cannot publish Voice events', async () => {
  await withServer('capability', async (_server, pipeName) => {
    const observer = await connectIpcClient(pipeName, {
      role: IpcRole.OBSERVER,
      component: 'read-only-observer',
    });
    try {
      observer.send({
        type: 'runtime.event.publish',
        requestId: 'forbidden-publish',
        payload: {
          contract_version: '1.0',
          name: 'voice.activity.started',
        },
      });
      const error = await observer.waitFor(
        (message) => message.requestId === 'forbidden-publish',
      );
      assert.equal(error.type, 'error');
      assert.equal(error.error, 'CONTRACT.CAPABILITY_DENIED');
      assert.equal(error.details.capability, 'voice.event.publish');
    } finally {
      observer.socket.destroy();
    }
  });
});

test('Voice role never receives Presence snapshots or realtime projections', async () => {
  await withServer('routing', async (_server, pipeName) => {
    const voice = await connectIpcClient(pipeName, {
      role: IpcRole.VOICE,
      component: 'birdie-voice',
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(
        voice.messages.some((message) => message.type === 'runtime.snapshot'),
        false,
      );
      assert.equal(
        voice.messages.some(
          (message) => message.type === 'runtime.presence.changed',
        ),
        false,
      );
    } finally {
      voice.socket.destroy();
    }
  });
});
