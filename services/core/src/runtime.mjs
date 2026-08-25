import { PresenceState } from '../../../packages/protocol/src/contract.mjs';

const PRESENCE_STATES = new Set(Object.values(PresenceState));
const TERMINAL_TURN_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'FAILED', 'INTERRUPTED']);

export class BirdieRuntime {
  constructor() {
    this.revision = 0;
    this.presenceState = 'OFFLINE';
    this.lifecycle = 'STARTING';
    this.activeTurn = null;
    this.lastReason = 'runtime.starting';
    this.seenEventIds = new Set();
    this.lastSourceSequence = new Map();
  }

  ready() {
    this.lifecycle = 'READY';
    return this.#setPresence('IDLE', 'runtime.ready');
  }

  snapshot() {
    return Object.freeze({
      lifecycle: this.lifecycle,
      presenceState: this.presenceState,
      revision: this.revision,
      reason: this.lastReason,
      activeTurn: this.activeTurn ? { ...this.activeTurn } : null,
    });
  }

  apply(event) {
    this.#assertEvent(event);
    if (this.seenEventIds.has(event.event_id)) return { dropped: 'duplicate_event', snapshot: this.snapshot() };

    const previousSequence = this.lastSourceSequence.get(event.source) ?? -1;
    if (event.source_sequence <= previousSequence) {
      return { dropped: 'stale_source_sequence', snapshot: this.snapshot() };
    }

    this.seenEventIds.add(event.event_id);
    this.lastSourceSequence.set(event.source, event.source_sequence);

    if (event.turn_id && this.activeTurn && event.turn_id !== this.activeTurn.turnId) {
      if (TERMINAL_TURN_STATUSES.has(this.activeTurn.status)) {
        return { dropped: 'stale_turn_event', snapshot: this.snapshot() };
      }
    }

    switch (event.name) {
      case 'component.health.changed':
        return this.#handleHealth(event);
      case 'voice.activity.started':
        return this.#setPresence('SPEECH_DETECTED', 'voice.activity.started');
      case 'voice.activation.accepted':
        return this.#startOrContinueTurn(event);
      case 'voice.activation.rejected':
        return this.#handleActivationRejected(event);
      case 'voice.utterance.finalized':
        return this.#finalizeUtterance(event);
      case 'voice.output.started':
        return this.#handleOutputStarted(event);
      case 'voice.output.completed':
        return this.#completeTurn(event);
      case 'voice.output.cancelled':
        return this.#handleOutputCancelled(event);
      case 'brain.turn.failed':
        return this.#failTurn(event, event.payload?.error_code ?? 'BRAIN.UNKNOWN');
      default:
        return { ignored: true, snapshot: this.snapshot() };
    }
  }

  cancelActiveTurn(reason = 'user_cancelled') {
    if (!this.activeTurn) return { ignored: true, snapshot: this.snapshot() };
    this.activeTurn.status = 'CANCELLED';
    this.activeTurn.cancelReason = reason;
    return this.#setPresence('IDLE', 'turn.cancelled');
  }

  #startOrContinueTurn(event) {
    const turnId = event.turn_id ?? event.payload?.turn_id;
    if (!turnId) throw new Error('voice.activation.accepted requires turn_id');

    if (!this.activeTurn || TERMINAL_TURN_STATUSES.has(this.activeTurn.status)) {
      this.activeTurn = { turnId, status: 'CAPTURING', outputId: null };
    } else if (this.activeTurn.turnId !== turnId) {
      this.activeTurn.status = 'INTERRUPTED';
      this.activeTurn = { turnId, status: 'CAPTURING', outputId: null };
    } else {
      this.activeTurn.status = 'CAPTURING';
    }

    return this.#setPresence('LISTENING', 'voice.activation.accepted');
  }

  #handleActivationRejected() {
    if (this.presenceState === 'SPEECH_DETECTED' && this.activeTurn?.status === 'OUTPUTTING') {
      return this.#setPresence('SPEAKING', 'voice.activation.rejected');
    }
    return this.#setPresence('IDLE', 'voice.activation.rejected');
  }

  #finalizeUtterance(event) {
    const turnId = event.turn_id;
    if (!turnId) throw new Error('voice.utterance.finalized requires turn_id');
    if (!this.activeTurn || this.activeTurn.turnId !== turnId) {
      this.activeTurn = { turnId, status: 'PROCESSING', outputId: null };
    } else {
      this.activeTurn.status = 'PROCESSING';
    }
    return this.#setPresence('THINKING', 'voice.utterance.finalized');
  }

  #handleOutputStarted(event) {
    if (!this.activeTurn || this.activeTurn.turnId !== event.turn_id) {
      return { dropped: 'stale_turn_event', snapshot: this.snapshot() };
    }
    if (TERMINAL_TURN_STATUSES.has(this.activeTurn.status)) {
      return { dropped: 'stale_turn_event', snapshot: this.snapshot() };
    }
    this.activeTurn.status = 'OUTPUTTING';
    this.activeTurn.outputId = event.payload?.output_id ?? null;
    return this.#setPresence('SPEAKING', 'voice.output.started');
  }

  #completeTurn(event) {
    if (!this.activeTurn || this.activeTurn.turnId !== event.turn_id) {
      return { dropped: 'stale_turn_event', snapshot: this.snapshot() };
    }
    this.activeTurn.status = 'COMPLETED';
    return this.#setPresence('IDLE', 'voice.output.completed');
  }

  #handleOutputCancelled(event) {
    if (!this.activeTurn || this.activeTurn.turnId !== event.turn_id) {
      return { dropped: 'stale_turn_event', snapshot: this.snapshot() };
    }
    this.activeTurn.status = 'INTERRUPTED';
    return this.#setPresence('SPEECH_DETECTED', 'voice.output.cancelled');
  }

  #failTurn(event, errorCode) {
    if (event.turn_id && this.activeTurn?.turnId === event.turn_id) {
      this.activeTurn.status = 'FAILED';
      this.activeTurn.errorCode = errorCode;
    }
    return this.#setPresence('ERROR', errorCode);
  }

  #handleHealth(event) {
    const status = event.payload?.status;
    if (status === 'UNAVAILABLE' || status === 'STOPPED') {
      this.lifecycle = 'DEGRADED';
      return this.#setPresence('OFFLINE', event.payload?.error_code ?? 'component.unavailable');
    }
    if (status === 'READY' && this.lifecycle !== 'READY') {
      this.lifecycle = 'READY';
      return this.#setPresence('IDLE', 'component.ready');
    }
    return { ignored: true, snapshot: this.snapshot() };
  }

  #setPresence(next, reason) {
    if (!PRESENCE_STATES.has(next)) throw new Error(`Unknown presence state: ${next}`);
    const changed = next !== this.presenceState;
    if (changed) {
      this.presenceState = next;
      this.revision += 1;
    }
    this.lastReason = reason;
    return { changed, snapshot: this.snapshot() };
  }

  #assertEvent(event) {
    const required = ['event_id', 'name', 'source', 'source_sequence'];
    for (const field of required) {
      if (event?.[field] === undefined || event?.[field] === null) throw new Error(`Missing event field: ${field}`);
    }
  }
}
