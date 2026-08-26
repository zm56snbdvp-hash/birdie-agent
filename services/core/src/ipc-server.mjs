import net from 'node:net';
import { EventEmitter } from 'node:events';
import {
  CONTRACT_VERSION,
  IpcMessageType,
  IpcRole,
} from '../../../packages/protocol/src/contract.mjs';
import { BirdieRuntimeV0 } from './runtime-v0.mjs';
import { TurnCoordinator } from './turn-coordinator.mjs';

const PIPE_NAME = String.raw`\\.\pipe\birdie.core.control.v1`;
const MICROPHONE_STATES = new Set([
  'ENABLED',
  'MUTED_BY_USER',
  'UNAVAILABLE',
  'PERMISSION_DENIED',
]);
const DATA_CLASSIFICATIONS = new Set([
  'operational',
  'content',
  'sensitive',
]);
const BEST_EFFORT_VOICE_EVENTS = new Set([
  'voice.input.level',
  'voice.output.level',
]);
const SNAPSHOT_ROLES = new Set([IpcRole.DESKTOP, IpcRole.OBSERVER]);
const PRESENCE_ROLES = new Set([IpcRole.DESKTOP, IpcRole.OBSERVER]);
const AUDIO_ROLES = new Set([IpcRole.DESKTOP, IpcRole.OBSERVER]);
const ALL_ROLES = new Set(Object.values(IpcRole));

function normalized(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function major(version) {
  return String(version ?? '').split('.', 1)[0];
}

export class BirdieIpcServer extends EventEmitter {
  constructor({ pipeName = PIPE_NAME, brain = null } = {}) {
    super();
    this.pipeName = pipeName;
    this.runtime = new BirdieRuntimeV0();
    this.server = null;
    this.clients = new Map();
    this.microphoneState = 'UNAVAILABLE';
    this.internalSequence = 0;
    this.turnCoordinator = brain
      ? new TurnCoordinator({
          brain,
          sendVoiceCommand: (payload) => this.#sendToRole(IpcRole.VOICE, {
            type: IpcMessageType.VOICE_COMMAND,
            requestId: `core-${payload.output_id ?? ++this.internalSequence}`,
            payload,
          }),
          publishInternalEvent: (event) => {
            this.publish(event, { coordinate: false });
          },
        })
      : null;
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
    this.turnCoordinator?.stop();
    for (const socket of this.clients.keys()) socket.destroy();
    this.clients.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }

  getSnapshot() {
    const snapshot = this.runtime.getSnapshot();
    return {
      ...snapshot,
      lifecycle: 'READY',
      microphoneState: this.microphoneState,
      brainState: this.turnCoordinator ? 'READY' : 'UNAVAILABLE',
    };
  }

  publish(event, { coordinate = true } = {}) {
    const result = this.runtime.apply(event);
    if (result?.presenceChanged) {
      this.#broadcastToRoles(PRESENCE_ROLES, {
        type: IpcMessageType.RUNTIME_PRESENCE_CHANGED,
        payload: result.snapshot.presence,
      });
    }

    if (event?.name === 'voice.privacy.changed') {
      const nextState = event.payload?.microphone_state;
      if (MICROPHONE_STATES.has(nextState)) {
        this.microphoneState = nextState;
        this.#broadcastToRoles(SNAPSHOT_ROLES, {
          type: IpcMessageType.RUNTIME_SNAPSHOT,
          payload: this.getSnapshot(),
        });
      }
    }

    if (event?.name === 'voice.input.level') {
      this.#broadcastToRoles(AUDIO_ROLES, {
        type: IpcMessageType.RUNTIME_AUDIO_INPUT,
        payload: {
          level: normalized(event.payload?.normalized_level),
          vadProbability: normalized(event.payload?.vad_probability),
          monotonicMs: Number(event.monotonic_ms) || 0,
        },
      });
    } else if (event?.name === 'voice.output.level') {
      this.#broadcastToRoles(AUDIO_ROLES, {
        type: IpcMessageType.RUNTIME_AUDIO_OUTPUT,
        payload: {
          level: normalized(event.payload?.normalized_level),
          monotonicMs: Number(event.monotonic_ms) || 0,
        },
      });
    }

    if (coordinate && this.turnCoordinator) {
      if (event?.name === 'voice.utterance.finalized') {
        void this.turnCoordinator.handleFinalized(event).catch((error) => {
          this.#publishCoordinatorFailure(event, error);
        });
      } else if (
        event?.name === 'voice.input.cancelled' ||
        event?.name === 'voice.output.cancelled' ||
        event?.name === 'voice.output.failed'
      ) {
        this.turnCoordinator.cancel(event.turn_id);
      } else if (event?.name === 'voice.output.completed') {
        this.turnCoordinator.finish(event.turn_id);
      }
    }

    return result;
  }

  #attach(socket) {
    this.clients.set(socket, null);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 512 * 1024) {
        this.#sendError(socket, null, 'CONTRACT.MESSAGE_TOO_LARGE');
        socket.destroy();
        return;
      }
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) this.#handle(socket, line);
      }
    });
    const remove = () => this.clients.delete(socket);
    socket.on('close', remove);
    socket.on('error', remove);
  }

  #handle(socket, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return this.#sendError(socket, null, 'INVALID_JSON');
    }

    if (message.type === IpcMessageType.COMPONENT_HELLO) {
      return this.#handleHello(socket, message);
    }

    const client = this.clients.get(socket);
    if (!client) {
      return this.#sendError(
        socket,
        message.requestId ?? null,
        'CONTRACT.HANDSHAKE_REQUIRED',
      );
    }

    if (message.type === IpcMessageType.RUNTIME_SNAPSHOT_REQUEST) {
      if (!SNAPSHOT_ROLES.has(client.role)) {
        return this.#forbidden(socket, message, 'snapshot.read');
      }
      return this.#send(socket, {
        type: IpcMessageType.RUNTIME_SNAPSHOT,
        payload: this.getSnapshot(),
      });
    }

    if (message.type === IpcMessageType.RUNTIME_EVENT_PUBLISH) {
      if (client.role !== IpcRole.VOICE) {
        return this.#forbidden(socket, message, 'voice.event.publish');
      }
      const contractError = this.#validateVoiceEvent(message.payload);
      if (contractError) {
        return this.#sendError(
          socket,
          message.requestId ?? null,
          contractError,
        );
      }
      try {
        const result = this.publish(message.payload);
        if (BEST_EFFORT_VOICE_EVENTS.has(message.payload?.name)) return;
        return this.#send(socket, {
          type: IpcMessageType.RUNTIME_EVENT_ACK,
          requestId: message.requestId ?? null,
          payload: result,
        });
      } catch (error) {
        return this.#sendError(
          socket,
          message.requestId ?? null,
          String(error.message ?? error),
        );
      }
    }

    if (message.type === IpcMessageType.RUNTIME_COMMAND) {
      if (client.role !== IpcRole.DESKTOP) {
        return this.#forbidden(socket, message, 'runtime.command');
      }
      return this.#handleRuntimeCommand(socket, message);
    }

    this.#sendError(
      socket,
      message.requestId ?? null,
      'UNKNOWN_MESSAGE_TYPE',
    );
  }

  #validateVoiceEvent(event) {
    const classification = event?.data_classification;
    if (!DATA_CLASSIFICATIONS.has(classification)) {
      return 'CONTRACT.INVALID_DATA_CLASSIFICATION';
    }
    if (
      event?.payload &&
      Object.hasOwn(event.payload, 'transcript') &&
      classification !== 'content' &&
      classification !== 'sensitive'
    ) {
      return 'CONTRACT.CONTENT_CLASSIFICATION_REQUIRED';
    }
    return null;
  }

  #handleHello(socket, message) {
    if (this.clients.get(socket)) {
      return this.#sendError(
        socket,
        message.requestId ?? null,
        'CONTRACT.ALREADY_REGISTERED',
      );
    }

    const payload = message.payload ?? {};
    const role = payload.role;
    const component = String(payload.component ?? '').trim();
    const instanceId = String(payload.instanceId ?? '').trim();
    const contractVersion = String(payload.contractVersion ?? '').trim();

    if (!ALL_ROLES.has(role) || !component || !instanceId || !contractVersion) {
      return this.#sendError(
        socket,
        message.requestId ?? null,
        'CONTRACT.INVALID_HELLO',
      );
    }

    if (major(contractVersion) !== major(CONTRACT_VERSION)) {
      this.#sendError(
        socket,
        message.requestId ?? null,
        'CONTRACT.VERSION_MISMATCH',
        { expected: CONTRACT_VERSION, received: contractVersion },
      );
      socket.end();
      return;
    }

    const client = {
      role,
      component,
      instanceId,
      contractVersion,
      connectedAt: new Date().toISOString(),
    };
    this.clients.set(socket, client);

    this.#send(socket, {
      type: IpcMessageType.COMPONENT_HELLO_ACK,
      requestId: message.requestId ?? null,
      payload: {
        accepted: true,
        role,
        contractVersion: CONTRACT_VERSION,
      },
    });

    if (SNAPSHOT_ROLES.has(role)) {
      this.#send(socket, {
        type: IpcMessageType.RUNTIME_SNAPSHOT,
        payload: this.getSnapshot(),
      });
    }

    this.emit('client.registered', { ...client });
  }

  #handleRuntimeCommand(socket, message) {
    const command = message.payload?.name;
    if (command !== 'ui.microphone.set_enabled') {
      return this.#sendError(
        socket,
        message.requestId ?? null,
        'UNKNOWN_COMMAND',
      );
    }

    const enabled = message.payload?.enabled === true;
    const requestId = message.requestId ?? null;
    const recipients = this.#sendToRole(IpcRole.VOICE, {
      type: IpcMessageType.VOICE_COMMAND,
      requestId,
      payload: {
        name: 'voice.mute.set',
        enabled,
      },
    });

    this.#send(socket, {
      type: IpcMessageType.RUNTIME_COMMAND_ACK,
      requestId,
      payload: {
        accepted: recipients > 0,
        pendingVoiceConfirmation: recipients > 0,
        microphoneState: this.microphoneState,
        errorCode: recipients > 0 ? null : 'VOICE.UNAVAILABLE',
      },
    });
  }

  #publishCoordinatorFailure(sourceEvent, error) {
    const sequence = ++this.internalSequence;
    this.publish({
      contract_version: '1.0',
      kind: 'event',
      name: 'brain.turn.failed',
      event_id: `core-coordinator-failure-${sequence}`,
      source: 'birdie-core',
      timestamp_utc: new Date().toISOString(),
      monotonic_ms: sequence,
      source_sequence: sequence,
      trace_id: sourceEvent?.trace_id ?? `trace-core-${sequence}`,
      session_id: sourceEvent?.session_id ?? null,
      turn_id: sourceEvent?.turn_id ?? null,
      data_classification: 'operational',
      payload: {
        error_code: 'BRAIN.COORDINATOR.EXCEPTION',
        detail: String(error?.message ?? error).slice(0, 512),
      },
    }, { coordinate: false });
  }

  #forbidden(socket, message, capability) {
    this.#sendError(
      socket,
      message.requestId ?? null,
      'CONTRACT.CAPABILITY_DENIED',
      { capability },
    );
  }

  #sendToRole(role, message) {
    let sent = 0;
    for (const [socket, client] of this.clients) {
      if (client?.role !== role) continue;
      this.#send(socket, message);
      sent += 1;
    }
    return sent;
  }

  #broadcastToRoles(roles, message) {
    for (const [socket, client] of this.clients) {
      if (client && roles.has(client.role)) this.#send(socket, message);
    }
  }

  #sendError(socket, requestId, error, details = undefined) {
    this.#send(socket, {
      type: IpcMessageType.ERROR,
      requestId,
      error,
      ...(details ? { details } : {}),
    });
  }

  #send(socket, message) {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }
}

export { PIPE_NAME };
