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

  apply(event, { sourceScope = null } = {}) {
    this.#validateEnvelope(event);
    const sequenceScope = sourceScope ?? `${event.source}:${event.session_id ?? 'legacy'}`;
    const replayKey = `${sequenceScope}:${event.event_id}`;
    if (this.seenEventIds.has(replayKey)) return { dropped: 'duplicate_event' };
    this.seenEventIds.add(replayKey);
    if (this.seenEventIds.size > 8_192) {
      this.seenEventIds.delete(this.seenEventIds.values().next().value);
    }

    const previousSeq = this.lastSourceSequence.get(sequenceScope) ?? -1;
    if (event.source_sequence <= previousSeq) return { dropped: 'stale_source_sequence' };
    this.lastSourceSequence.set(sequenceScope, event.source_sequence);

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
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.pendingBargeIn = false;
        this.turns.transition(event.turn_id, TurnStatus.CANCELLED);
        return this.#setPresence(PresenceState.IDLE, event, 'voice.input.cancelled', null);
      case 'voice.utterance.captured':
        return this.#markTurnProcessing(event, 'voice.utterance.captured');
      case 'voice.utterance.finalized':
        return this.#markTurnProcessing(event, 'voice.utterance.finalized');
      case 'voice.output.started':
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.turns.transition(event.turn_id, TurnStatus.OUTPUTTING);
        return this.#setPresence(PresenceState.SPEAKING, event, 'voice.output.started', event.turn_id);
      case 'voice.output.completed':
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.turns.transition(event.turn_id, TurnStatus.COMPLETED);
        return this.#setPresence(PresenceState.IDLE, event, 'voice.output.completed', null);
      case 'runtime.turn.completed':
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.turns.transition(event.turn_id, TurnStatus.COMPLETED);
        return this.#setPresence(PresenceState.IDLE, event, 'runtime.turn.completed', null);
      case 'runtime.turn.cancelled':
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.turns.transition(event.turn_id, TurnStatus.CANCELLED);
        return this.#setPresence(PresenceState.IDLE, event, 'runtime.turn.cancelled', null);
      case 'runtime.turn.failed':
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.turns.transition(event.turn_id, TurnStatus.FAILED);
        return this.#setPresence(PresenceState.IDLE, event, 'runtime.turn.failed', null);
      case 'brain.turn.failed':
      case 'voice.output.failed':
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.turns.transition(event.turn_id, TurnStatus.FAILED);
        return this.#setPresence(PresenceState.ERROR, event, event.name, null);
      case 'voice.output.cancelled':
        if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
        this.turns.transition(event.turn_id, TurnStatus.CANCELLED);
        return this.#setPresence(PresenceState.IDLE, event, 'voice.output.cancelled', null);
      default:
        return { accepted: true, ignored: event.name };
    }
  }

  #markTurnProcessing(event, reason) {
    if (!event.turn_id) throw new Error('TURN.ID_REQUIRED');
    let turn = this.turns.get(event.turn_id);
    if (!turn) {
      if (this.turns.activeTurnId) return { dropped: 'stale_turn_event' };
      turn = this.turns.create(event.turn_id, {
        timestampUtc: event.timestamp_utc,
      });
    }
    if (!this.turns.isCurrent(event.turn_id)) return { dropped: 'stale_turn_event' };
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
