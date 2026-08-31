import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  CONTRACT_VERSION,
  DesktopCommandStatus,
  IpcMessageType,
  IpcRole,
} from '../../../packages/protocol/src/contract.mjs';
import {
  DESKTOP_COMMAND_ID_PATTERN,
  validateDesktopCommandEnvelope,
  validateDesktopCommandResult,
  validateDesktopIntentSubmission,
} from '../../../packages/protocol/src/desktop-command.mjs';
import { BirdieRuntimeV0 } from './runtime-v0.mjs';
import { DesktopCommandLedger } from './desktop-command-ledger.mjs';
import {
  DesktopIntentRouter,
  voiceDesktopCommandId,
} from './desktop-intent-router.mjs';
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
const VOICE_PUBLISHABLE_EVENTS = new Set([
  'component.ready',
  'component.health.changed',
  'voice.activity.started',
  'voice.activity.ended',
  'voice.activation.accepted',
  'voice.activation.rejected',
  'voice.activation.abstained',
  'voice.utterance.captured',
  'voice.utterance.finalized',
  'voice.input.level',
  'voice.input.cancelled',
  'voice.privacy.changed',
  'voice.output.started',
  'voice.output.level',
  'voice.output.completed',
  'voice.output.cancelled',
  'voice.output.failed',
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

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export class BirdieIpcServer extends EventEmitter {
  constructor({
    pipeName = PIPE_NAME,
    brain = null,
    now = () => Date.now(),
    desktopCommandTimeoutMs = 5_000,
  } = {}) {
    super();
    this.pipeName = pipeName;
    this.now = now;
    this.desktopCommandTimeoutMs = desktopCommandTimeoutMs;
    this.runtime = new BirdieRuntimeV0();
    this.server = null;
    this.clients = new Map();
    this.serverInstanceId = randomUUID();
    this.connectionSequence = 0;
    this.activeDesktop = null;
    this.activeVoice = null;
    this.microphoneState = 'UNAVAILABLE';
    this.internalSequence = 0;
    this.desktopIntentRouter = new DesktopIntentRouter();
    this.desktopLedger = new DesktopCommandLedger({ now });
    this.desktopCommandTimers = new Map();
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
    for (const timer of this.desktopCommandTimers.values()) clearTimeout(timer);
    this.desktopCommandTimers.clear();
    for (const socket of this.clients.keys()) socket.destroy();
    this.clients.clear();
    this.activeDesktop = null;
    this.activeVoice = null;
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

  publish(event, { coordinate = true, sourceScope = null, voiceClient = null } = {}) {
    const previousTurnId = this.runtime.turns.activeTurnId;
    const result = this.runtime.apply(event, { sourceScope });
    if (result?.dropped) return result;
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

    if (coordinate) {
      if (
        event?.name === 'voice.activation.accepted' &&
        previousTurnId &&
        previousTurnId !== event.turn_id
      ) {
        this.turnCoordinator?.cancel(previousTurnId);
      }
      if (event?.name === 'voice.utterance.finalized') {
        const intent = this.desktopIntentRouter.route(event.payload?.transcript);
        if (intent.matched) {
          this.#dispatchVoiceDesktopIntent(event, voiceClient, intent);
        } else if (this.turnCoordinator) {
          void this.turnCoordinator.handleFinalized(event).catch((error) => {
            this.#publishCoordinatorFailure(event, error);
          });
        } else {
          this.#finishVoiceDesktopTurn(event, false, 'BRAIN.UNAVAILABLE');
        }
      } else if (
        event?.name === 'voice.input.cancelled' ||
        event?.name === 'voice.output.cancelled' ||
        event?.name === 'voice.output.failed'
      ) {
        this.turnCoordinator?.cancel(event.turn_id);
      } else if (event?.name === 'voice.output.completed') {
        this.turnCoordinator?.finish(event.turn_id);
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
    const remove = () => {
      const client = this.clients.get(socket);
      const wasActiveVoice = this.activeVoice === socket;
      this.clients.delete(socket);
      if (this.activeDesktop === socket) this.activeDesktop = null;
      if (wasActiveVoice) {
        this.activeVoice = null;
        this.microphoneState = 'UNAVAILABLE';
        const activeTurnId = this.runtime.turns.activeTurnId;
        if (activeTurnId) {
          this.#finishVoiceDesktopTurn({
            session_id: client?.instanceId ?? this.serverInstanceId,
            turn_id: activeTurnId,
            trace_id: `trace-voice-disconnect-${this.internalSequence + 1}`,
          }, false, 'VOICE.DISCONNECTED');
        }
        this.#broadcastToRoles(SNAPSHOT_ROLES, {
          type: IpcMessageType.RUNTIME_SNAPSHOT,
          payload: this.getSnapshot(),
        });
      }
      if (client?.role === IpcRole.DESKTOP) {
        this.emit('desktop.disconnected', { ...client });
      }
    };
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
      if (socket !== this.activeVoice) {
        return this.#sendError(socket, message.requestId ?? null, 'VOICE.CONNECTION.STALE');
      }
      const contractError = this.#validateVoiceEvent(message.payload, client);
      if (contractError) {
        return this.#sendError(
          socket,
          message.requestId ?? null,
          contractError,
        );
      }
      try {
        const result = this.publish(message.payload, {
          sourceScope: `${client.instanceId}:${message.payload.session_id}`,
          voiceClient: client,
        });
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

    if (message.type === IpcMessageType.DESKTOP_INTENT_SUBMIT) {
      if (client.role !== IpcRole.DESKTOP) {
        return this.#forbidden(socket, message, 'desktop.intent.submit');
      }
      return this.#handleDesktopIntentSubmit(socket, client, message);
    }

    if (message.type === IpcMessageType.DESKTOP_COMMAND_RESULT) {
      if (client.role !== IpcRole.DESKTOP) {
        return this.#forbidden(socket, message, 'desktop.command.result');
      }
      return this.#handleDesktopCommandResult(socket, client, message);
    }

    this.#sendError(
      socket,
      message.requestId ?? null,
      'UNKNOWN_MESSAGE_TYPE',
    );
  }

  #validateVoiceEvent(event, client) {
    const required = [
      'contract_version',
      'name',
      'event_id',
      'source',
      'timestamp_utc',
      'source_sequence',
      'trace_id',
      'session_id',
      'data_classification',
      'payload',
    ];
    if (!event || required.some((field) => event[field] === null || event[field] === undefined)) {
      return 'CONTRACT.INVALID_EVENT';
    }
    if (
      typeof event.event_id !== 'string' ||
      event.event_id.length < 1 ||
      event.event_id.length > 256 ||
      typeof event.source !== 'string' ||
      event.source.length < 1 ||
      event.source.length > 128 ||
      typeof event.session_id !== 'string' ||
      event.session_id.length < 1 ||
      event.session_id.length > 256 ||
      !Number.isSafeInteger(event.source_sequence) ||
      event.source_sequence < 0 ||
      !event.payload ||
      typeof event.payload !== 'object' ||
      Array.isArray(event.payload)
    ) {
      return 'CONTRACT.INVALID_EVENT';
    }
    if (
      (event.source !== 'birdie-voice' || event.session_id !== client.instanceId)
    ) {
      return 'CONTRACT.PROVENANCE_MISMATCH';
    }
    if (!VOICE_PUBLISHABLE_EVENTS.has(event.name)) {
      return 'CONTRACT.EVENT_NOT_ALLOWED';
    }
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

    if (
      !ALL_ROLES.has(role) ||
      !component ||
      !DESKTOP_COMMAND_ID_PATTERN.test(instanceId) ||
      !contractVersion
    ) {
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

    if (
      (role === IpcRole.DESKTOP && component !== 'birdie-desktop') ||
      (role === IpcRole.VOICE && component !== 'birdie-voice')
    ) {
      return this.#sendError(
        socket,
        message.requestId ?? null,
        'CONTRACT.ROLE_COMPONENT_MISMATCH',
      );
    }

    const connectionId = `core-${this.serverInstanceId}-${++this.connectionSequence}`;
    const client = {
      role,
      component,
      instanceId,
      connectionId,
      contractVersion,
      connectedAt: new Date().toISOString(),
    };
    this.clients.set(socket, client);

    if (role === IpcRole.DESKTOP) {
      const previousDesktop = this.activeDesktop;
      this.activeDesktop = socket;
      if (previousDesktop && previousDesktop !== socket && !previousDesktop.destroyed) {
        previousDesktop.end();
      }
    } else if (role === IpcRole.VOICE) {
      const previousVoice = this.activeVoice;
      this.activeVoice = socket;
      if (previousVoice && previousVoice !== socket && !previousVoice.destroyed) {
        previousVoice.end();
      }
    }

    this.#send(socket, {
      type: IpcMessageType.COMPONENT_HELLO_ACK,
      requestId: message.requestId ?? null,
      payload: {
        accepted: true,
        role,
        connectionId,
        serverInstanceId: this.serverInstanceId,
        contractVersion: CONTRACT_VERSION,
      },
    });

    if (SNAPSHOT_ROLES.has(role)) {
      this.#send(socket, {
        type: IpcMessageType.RUNTIME_SNAPSHOT,
        payload: this.getSnapshot(),
      });
    }

    if (role === IpcRole.DESKTOP) this.#redispatchPendingDesktopCommands(socket, client);

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

  #handleDesktopIntentSubmit(socket, client, message) {
    const commandId = String(message.payload?.commandId ?? '');
    if (!hasExactKeys(message, ['type', 'requestId', 'payload'])) {
      return this.#sendDesktopIntentAck(socket, message.requestId, {
        commandId,
        status: DesktopCommandStatus.REJECTED,
        errorCode: 'DESKTOP.INTENT.MESSAGE_SCHEMA_INVALID',
      });
    }
    if (socket !== this.activeDesktop) {
      return this.#sendDesktopIntentAck(socket, message.requestId, {
        commandId,
        status: DesktopCommandStatus.REJECTED,
        errorCode: 'DESKTOP.CONNECTION.STALE',
      });
    }
    const validated = validateDesktopIntentSubmission(message.payload, {
      nowMs: this.now(),
    });
    if (!validated.ok) {
      return this.#sendDesktopIntentAck(socket, message.requestId, {
        commandId,
        status: DesktopCommandStatus.REJECTED,
        errorCode: validated.errorCode,
      });
    }
    const intent = this.desktopIntentRouter.route(validated.value.text, {
      allowShortCommands: true,
    });
    if (!intent.matched) {
      return this.#sendDesktopIntentAck(socket, message.requestId, {
        commandId: validated.value.commandId,
        status: DesktopCommandStatus.REJECTED,
        errorCode: 'DESKTOP.INTENT.UNKNOWN',
      });
    }
    const command = {
      commandId: validated.value.commandId,
      name: intent.name,
      args: intent.args,
      issuedAtMs: validated.value.issuedAtMs,
      expiresAtMs: validated.value.expiresAtMs,
      target: {
        instanceId: client.instanceId,
        connectionId: client.connectionId,
      },
      provenance: {
        origin: 'COMMAND_CENTER',
        sourceComponent: client.component,
        sourceInstanceId: client.instanceId,
        sessionId: client.instanceId,
        eventId: null,
        turnId: null,
        traceId: null,
      },
    };
    const registration = this.#registerDesktopCommand(command, {
      requesterConnectionId: client.connectionId,
      requestId: message.requestId ?? null,
    });
    if (registration.kind === 'CONFLICT') {
      return this.#sendDesktopIntentAck(socket, message.requestId, {
        commandId: command.commandId,
        status: DesktopCommandStatus.REJECTED,
        errorCode: 'DESKTOP.COMMAND.REPLAY_CONFLICT',
      });
    }
    if (registration.kind === 'CAPACITY') {
      return this.#sendDesktopIntentAck(socket, message.requestId, {
        commandId: command.commandId,
        status: DesktopCommandStatus.REJECTED,
        errorCode: 'DESKTOP.COMMAND.CAPACITY',
      });
    }
    this.#sendDesktopIntentAck(socket, message.requestId, {
      commandId: command.commandId,
      status: DesktopCommandStatus.SENT,
      errorCode: null,
    });
    if (registration.kind === 'NEW') {
      this.#send(socket, { type: IpcMessageType.DESKTOP_COMMAND, requestId: command.commandId, payload: command });
      this.#scheduleDesktopCommandTimeout(command);
    } else if (registration.entry.status === DesktopCommandStatus.SENT) {
      this.#send(socket, {
        type: IpcMessageType.DESKTOP_COMMAND,
        requestId: registration.entry.command.commandId,
        payload: registration.entry.command,
      });
      this.#scheduleDesktopCommandTimeout(registration.entry.command);
    } else {
      this.#sendDesktopCommandStatus(socket, registration.entry);
    }
  }

  #dispatchVoiceDesktopIntent(event, voiceClient, intent) {
    const target = this.#activeDesktopClient();
    if (!target) {
      this.#finishVoiceDesktopTurn(event, false, 'DESKTOP.UNAVAILABLE');
      return;
    }
    const issuedAtMs = this.now();
    const command = {
      commandId: voiceDesktopCommandId(event),
      name: intent.name,
      args: intent.args,
      issuedAtMs,
      expiresAtMs: issuedAtMs + this.desktopCommandTimeoutMs,
      target: {
        instanceId: target.client.instanceId,
        connectionId: target.client.connectionId,
      },
      provenance: {
        origin: 'VOICE',
        sourceComponent: voiceClient?.component ?? event.source,
        sourceInstanceId: voiceClient?.instanceId ?? event.session_id,
        sessionId: event.session_id ?? null,
        eventId: event.event_id ?? null,
        turnId: event.turn_id ?? null,
        traceId: event.trace_id ?? null,
      },
    };
    const registration = this.#registerDesktopCommand(command);
    if (registration.kind === 'CONFLICT') {
      this.#finishVoiceDesktopTurn(event, false, 'DESKTOP.COMMAND.REPLAY_CONFLICT');
      return;
    }
    if (registration.kind === 'CAPACITY') {
      this.#finishVoiceDesktopTurn(event, false, 'DESKTOP.COMMAND.CAPACITY');
      return;
    }
    if (registration.kind === 'NEW') {
      this.#send(target.socket, { type: IpcMessageType.DESKTOP_COMMAND, requestId: command.commandId, payload: command });
      this.#scheduleDesktopCommandTimeout(command);
    } else if (registration.entry.status === DesktopCommandStatus.ACKNOWLEDGED) {
      this.#finishVoiceDesktopTurn(event, true, null);
    } else if (registration.entry.status !== DesktopCommandStatus.SENT) {
      this.#finishVoiceDesktopTurn(event, false, registration.entry.errorCode);
    }
  }

  #registerDesktopCommand(command, context = {}) {
    const validated = validateDesktopCommandEnvelope(command, { nowMs: this.now() });
    if (!validated.ok) throw new Error(validated.errorCode);
    return this.desktopLedger.register(validated.value, context);
  }

  #handleDesktopCommandResult(socket, client, message) {
    if (!hasExactKeys(message, ['type', 'requestId', 'payload'])) {
      return this.#sendError(socket, message.requestId ?? null, 'DESKTOP.COMMAND.RESULT_MESSAGE_SCHEMA_INVALID');
    }
    const validated = validateDesktopCommandResult(message.payload, { nowMs: this.now() });
    if (!validated.ok) {
      return this.#sendError(socket, message.requestId ?? null, validated.errorCode);
    }
    const result = validated.value;
    if (message.requestId !== result.commandId) {
      return this.#sendError(socket, message.requestId, 'DESKTOP.COMMAND.RESULT_CORRELATION_MISMATCH');
    }
    const entry = this.desktopLedger.get(result.commandId);
    if (!entry) {
      return this.#sendError(socket, message.requestId ?? null, 'DESKTOP.COMMAND.UNKNOWN_ID');
    }
    if (
      result.connectionId !== client.connectionId ||
      entry.command.target.connectionId !== client.connectionId
    ) {
      return this.#sendError(socket, message.requestId ?? null, 'DESKTOP.COMMAND.CONNECTION_MISMATCH');
    }
    if (this.desktopLedger.isTerminal(result.commandId)) {
      this.#sendDesktopCommandStatus(socket, entry);
      return;
    }
    if (
      this.now() >= entry.command.expiresAtMs ||
      result.completedAtMs > entry.command.expiresAtMs
    ) {
      this.#timeoutDesktopCommand(result.commandId, socket);
      return;
    }
    const completed = this.desktopLedger.complete(
      result.commandId,
      result.status,
      result.errorCode,
    );
    this.#clearDesktopCommandTimeout(result.commandId);
    this.#sendDesktopCommandStatusToTarget(completed, socket);
    const provenance = completed.command.provenance;
    if (provenance.origin === 'VOICE') {
      this.#finishVoiceDesktopTurn(
        {
          session_id: provenance.sessionId,
          event_id: provenance.eventId,
          turn_id: provenance.turnId,
          trace_id: provenance.traceId,
        },
        completed.status === DesktopCommandStatus.ACKNOWLEDGED,
        completed.errorCode,
      );
    }
  }

  #scheduleDesktopCommandTimeout(command) {
    this.#clearDesktopCommandTimeout(command.commandId);
    const delay = Math.max(
      1,
      Math.min(this.desktopCommandTimeoutMs, command.expiresAtMs - this.now()),
    );
    const timer = setTimeout(() => this.#timeoutDesktopCommand(command.commandId), delay);
    timer.unref?.();
    this.desktopCommandTimers.set(command.commandId, timer);
  }

  #clearDesktopCommandTimeout(commandId) {
    const timer = this.desktopCommandTimers.get(commandId);
    if (timer) clearTimeout(timer);
    this.desktopCommandTimers.delete(commandId);
  }

  #redispatchPendingDesktopCommands(socket, client) {
    for (const pending of this.desktopLedger.pending()) {
      if (pending.command.expiresAtMs <= this.now()) {
        this.#timeoutDesktopCommand(pending.command.commandId, socket);
        continue;
      }
      if (pending.command.target.instanceId !== client.instanceId) continue;
      const command = {
        ...pending.command,
        target: {
          instanceId: client.instanceId,
          connectionId: client.connectionId,
        },
      };
      this.desktopLedger.retarget(command.commandId, command);
      this.#send(socket, { type: IpcMessageType.DESKTOP_COMMAND, requestId: command.commandId, payload: command });
      this.#scheduleDesktopCommandTimeout(command);
    }
  }

  #timeoutDesktopCommand(commandId, fallbackSocket = null) {
    this.#clearDesktopCommandTimeout(commandId);
    const timedOut = this.desktopLedger.timeout(commandId);
    if (!timedOut) return null;
    this.#sendDesktopCommandStatusToTarget(timedOut, fallbackSocket);
    const provenance = timedOut.command.provenance;
    if (provenance.origin === 'VOICE') {
      this.#finishVoiceDesktopTurn(
        {
          session_id: provenance.sessionId,
          event_id: provenance.eventId,
          turn_id: provenance.turnId,
          trace_id: provenance.traceId,
        },
        false,
        timedOut.errorCode,
      );
    }
    return timedOut;
  }

  #activeDesktopClient() {
    if (!this.activeDesktop || this.activeDesktop.destroyed) return null;
    const client = this.clients.get(this.activeDesktop);
    return client?.role === IpcRole.DESKTOP
      ? { socket: this.activeDesktop, client }
      : null;
  }

  #sendDesktopIntentAck(socket, requestId, payload) {
    this.#send(socket, {
      type: IpcMessageType.DESKTOP_INTENT_ACK,
      requestId: requestId ?? null,
      payload,
    });
  }

  #sendDesktopCommandStatus(socket, entry) {
    if (!socket || !entry) return;
    this.#send(socket, {
      type: IpcMessageType.DESKTOP_COMMAND_STATUS,
      payload: {
        commandId: entry.command.commandId,
        status: entry.status,
        errorCode: entry.errorCode,
      },
    });
  }

  #sendDesktopCommandStatusToTarget(entry, fallbackSocket = null) {
    if (!entry) return;
    const targetInstanceId = entry.command.target.instanceId;
    const active = this.#activeDesktopClient();
    if (active?.client.instanceId === targetInstanceId) {
      this.#sendDesktopCommandStatus(active.socket, entry);
      return;
    }
    const fallback = fallbackSocket ? this.clients.get(fallbackSocket) : null;
    if (fallback?.role === IpcRole.DESKTOP && fallback.instanceId === targetInstanceId) {
      this.#sendDesktopCommandStatus(fallbackSocket, entry);
    }
  }

  #finishVoiceDesktopTurn(sourceEvent, succeeded, errorCode) {
    const sequence = ++this.internalSequence;
    this.publish({
      contract_version: CONTRACT_VERSION,
      kind: 'event',
      name: succeeded ? 'runtime.turn.completed' : 'runtime.turn.failed',
      event_id: `core-desktop-result-${sequence}`,
      source: 'birdie-core',
      timestamp_utc: new Date(this.now()).toISOString(),
      monotonic_ms: sequence,
      source_sequence: sequence,
      trace_id: sourceEvent?.trace_id ?? `trace-core-desktop-${sequence}`,
      session_id: sourceEvent?.session_id ?? this.serverInstanceId,
      turn_id: sourceEvent?.turn_id ?? null,
      data_classification: 'operational',
      payload: succeeded ? {} : { error_code: errorCode ?? 'DESKTOP.COMMAND.FAILED' },
    }, {
      coordinate: false,
      sourceScope: `birdie-core:${this.serverInstanceId}`,
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
    if (role === IpcRole.VOICE) {
      const client = this.activeVoice ? this.clients.get(this.activeVoice) : null;
      if (client?.role !== IpcRole.VOICE || this.activeVoice.destroyed) return 0;
      this.#send(this.activeVoice, message);
      return 1;
    }
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
