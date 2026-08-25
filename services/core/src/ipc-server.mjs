import net from 'node:net';
import { EventEmitter } from 'node:events';
import { BirdieRuntimeV0 } from './runtime-v0.mjs';

const PIPE_NAME = String.raw`\\.\pipe\birdie.core.control.v1`;
const MICROPHONE_STATES = new Set([
  'ENABLED',
  'MUTED_BY_USER',
  'UNAVAILABLE',
  'PERMISSION_DENIED',
]);

export class BirdieIpcServer extends EventEmitter {
  constructor({ pipeName = PIPE_NAME } = {}) {
    super();
    this.pipeName = pipeName;
    this.runtime = new BirdieRuntimeV0();
    this.server = null;
    this.clients = new Set();
    this.microphoneState = 'ENABLED';
  }

  async start() {
    if (this.server) return;
    this.server = net.createServer((socket) => this.#attach(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.pipeName, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  async stop() {
    for (const socket of this.clients) socket.destroy();
    this.clients.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }

  getSnapshot() {
    const snapshot = this.runtime.getSnapshot();
    return { ...snapshot, lifecycle: 'READY', microphoneState: this.microphoneState };
  }

  publish(event) {
    const result = this.runtime.apply(event);
    if (result?.presenceChanged) {
      this.#broadcast({
        type: 'runtime.presence.changed',
        payload: result.snapshot.presence,
      });
    }

    if (event?.name === 'voice.privacy.changed') {
      const nextState = event.payload?.microphone_state;
      if (MICROPHONE_STATES.has(nextState)) {
        this.microphoneState = nextState;
        this.#broadcast({ type: 'runtime.snapshot', payload: this.getSnapshot() });
      }
    }

    return result;
  }

  #attach(socket) {
    this.clients.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) this.#handle(socket, line);
      }
    });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
    this.#send(socket, { type: 'runtime.snapshot', payload: this.getSnapshot() });
  }

  #handle(socket, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return this.#send(socket, { type: 'error', error: 'INVALID_JSON' });
    }

    if (message.type === 'runtime.snapshot.request') {
      return this.#send(socket, {
        type: 'runtime.snapshot',
        payload: this.getSnapshot(),
      });
    }

    if (message.type === 'runtime.event.publish') {
      try {
        const result = this.publish(message.payload);
        return this.#send(socket, {
          type: 'runtime.event.ack',
          requestId: message.requestId ?? null,
          payload: result,
        });
      } catch (error) {
        return this.#send(socket, {
          type: 'error',
          requestId: message.requestId ?? null,
          error: String(error.message ?? error),
        });
      }
    }

    if (message.type === 'runtime.command') {
      const command = message.payload?.name;
      if (command === 'ui.microphone.set_enabled') {
        const enabled = message.payload?.enabled === true;
        const requestId = message.requestId ?? null;
        this.#broadcast({
          type: 'voice.command',
          requestId,
          payload: {
            name: 'voice.mute.set',
            enabled,
          },
        });
        return this.#send(socket, {
          type: 'runtime.command.ack',
          requestId,
          payload: {
            accepted: true,
            pendingVoiceConfirmation: true,
            microphoneState: this.microphoneState,
          },
        });
      }
      return this.#send(socket, {
        type: 'error',
        requestId: message.requestId ?? null,
        error: 'UNKNOWN_COMMAND',
      });
    }

    this.#send(socket, {
      type: 'error',
      requestId: message.requestId ?? null,
      error: 'UNKNOWN_MESSAGE_TYPE',
    });
  }

  #broadcast(message) {
    for (const socket of this.clients) this.#send(socket, message);
  }

  #send(socket, message) {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }
}

export { PIPE_NAME };
