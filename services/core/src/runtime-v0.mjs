import { PresenceState, createPresenceSnapshot, projectPresence } from './presence-state.mjs';
import { TurnManager, TurnStatus } from './turn-manager.mjs';

export class BirdieRuntimeV0 {
  constructor() {
    this.presence = createPresenceSnapshot();
    this.turns = new TurnManager();
    this.lastSourceSequence = new Map();
    this.seenEventIds = new Set();
    this.pendingBargeIn = false;
  }

  getSnapshot() {
    return {
      presence: { ...this.presence },
      activeTurn: this.turns.activeTurnId ? { ...this.turns.get(this.turns.activeTurnId) } : null,
    };
  }

  apply(event) {
    this.#validateEnvelope(event);
    if (this.seenEventIds.has(event.event_id)) return { dropped: 'duplicate_event' };
    this.seenEventIds.add(event.event_id);

    const previousSeq = this.lastSourceSequence.get(event.source) ?? -1;
    if (event.source_sequence <= previousSeq) return { dropped: 'stale_source_sequence' };
    this.lastSourceSequence.set(event.source, event.source_sequence);

    switch (event.name) {
      case 'component.ready':
        return this.#setPresence(PresenceState.IDLE, event, 'runtime.required_components_ready', null);
      case 'component.health.changed':
        if (event.payload?.status === 'UNAVAILABLE') {
          return this.#setPresence(PresenceState.OFFLINE, event, 'runtime.required_component_unavailable');
        }
        return { accepted: true };
      case 'voice.activity.started':
        this.pendingBargeIn = this.presence.state === PresenceState.SPEAKING;
        return this.#setPresence(PresenceState.SPEECH_DETECTED, event, 'voice.activity.started');
      case 'voice.activation.rejected':
      case 'voice.activation.abstained': {
        const reason = event.name;
        if (this.pendingBargeIn) {
          this.pendingBargeIn = false;
          return this.#setPresence(PresenceState.SPEAKING, event, reason);
        }
        return this.#setPresence(PresenceState.IDLE, event, reason, null);
      }
      case 'voice.activation.accepted': {
        if (this.pendingBargeIn) {
          const oldTurn = this.turns.activeTurnId;
          if (oldTurn && this.turns.isCurrent(oldTurn)) {
            this.turns.transition(oldTurn, TurnStatus.INTERRUPTED);
          }
          this.pendingBargeIn = false;
        }
        const turnId = event.turn_id ?? event.payload?.turn_id ?? null;
        if (turnId) {
          this.turns.create(turnId, { timestampUtc: event.timestamp_utc });
          this.turns.transition(turnId, TurnStatus.CAPTURING);
        }
        return this.#setPresence(
          PresenceState.LISTENING,
          event,
          'voice.activation.accepted',
          turnId,
        );
      }
      case 'voice.input.cancelled':
        this.pendingBargeIn = false;
        if (event.turn_id && this.turns.isCurrent(event.turn_id)) {
          this.turns.transition(event.turn_id, TurnStatus.CANCELLED);
        }
        return this.#setPresence(PresenceState.IDLE, event, 'voice.input.cancelled', null);
      case 'voice.utterance.captured':
        return this.#markTurnProcessing(event, 'voice.utterance.captured');
      case 'voice.utterance.finalized':
        return this.#markTurnProcessing(event, 'voice.utterance.finalized');
      case 'voice.output.started':
        this.turns.assertCurrent(event.turn_id);
        this.turns.transition(event.turn_id, TurnStatus.OUTPUTTING);
        return this.#setPresence(PresenceState.SPEAKING, event, 'voice.output.started', event.turn_id);
      case 'voice.output.completed':
        this.turns.assertCurrent(event.turn_id);
        this.turns.transition(event.turn_id, TurnStatus.COMPLETED);
        return this.#setPresence(PresenceState.IDLE, event, 'voice.output.completed', null);
      case 'brain.turn.failed':
      case 'voice.output.failed':
        if (event.turn_id && this.turns.isCurrent(event.turn_id)) this.turns.transition(event.turn_id, TurnStatus.FAILED);
        return this.#setPresence(PresenceState.ERROR, event, event.name, event.turn_id ?? null);
      default:
        return { accepted: true, ignored: event.name };
    }
  }

  #markTurnProcessing(event, reason) {
    if (!event.turn_id) throw new Error('TURN.ID_REQUIRED');
    let turn = this.turns.get(event.turn_id);
    if (!turn) {
      turn = this.turns.create(event.turn_id, {
        timestampUtc: event.timestamp_utc,
      });
    }
    if (turn.status !== TurnStatus.PROCESSING) {
      this.turns.assertCurrent(event.turn_id);
      this.turns.transition(event.turn_id, TurnStatus.PROCESSING);
    }
    return this.#setPresence(
      PresenceState.THINKING,
      event,
      reason,
      event.turn_id,
    );
  }

  #setPresence(state, event, reason, turnId = event.turn_id ?? this.turns.activeTurnId) {
    this.presence = projectPresence(this.presence, state, {
      reason,
      turnId,
      timestampUtc: event.timestamp_utc,
    });
    return { accepted: true, presenceChanged: true, snapshot: this.getSnapshot() };
  }

  #validateEnvelope(event) {
    for (const field of ['contract_version', 'name', 'event_id', 'source', 'timestamp_utc', 'source_sequence', 'trace_id']) {
      if (event?.[field] === undefined || event?.[field] === null) throw new Error(`CONTRACT.MISSING_FIELD:${field}`);
    }
    if (!String(event.contract_version).startsWith('1.')) throw new Error('CONTRACT.VERSION_MISMATCH');
  }
}
