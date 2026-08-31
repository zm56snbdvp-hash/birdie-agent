import net from 'node:net';
import { CONTRACT_VERSION } from '../../../../packages/protocol/src/contract.mjs';

let instanceSequence = 0;

export async function connectIpcClient(
  pipeName,
  {
    role,
    component = `test-${role}`,
    instanceId = `${component}-${process.pid}-${++instanceSequence}`,
    contractVersion = CONTRACT_VERSION,
    expectAccepted = true,
  },
) {
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
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
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

  const helloRequestId = `hello-${instanceId}`;
  socket.write(`${JSON.stringify({
    type: 'component.hello',
    requestId: helloRequestId,
    payload: {
      component,
      role,
      instanceId,
      contractVersion,
    },
  })}\n`);

  const helloResult = await waitFor(
    (message) =>
      message.requestId === helloRequestId &&
      (message.type === 'component.hello.ack' || message.type === 'error'),
  );

  if (expectAccepted && helloResult.type !== 'component.hello.ack') {
    socket.destroy();
    throw new Error(`IPC hello rejected: ${helloResult.error ?? 'unknown'}`);
  }

  return {
    socket,
    messages,
    waitFor,
    helloResult,
    send(message) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
  };
}

export async function connectRawClient(pipeName) {
  const socket = net.createConnection(pipeName);
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

  return {
    socket,
    messages,
    waitFor(predicate, timeoutMs = 1_500) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error('timeout waiting for raw IPC message'));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    send(message) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
  };
}
