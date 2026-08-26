import { BrainStatus } from './brain.mjs';

function text(value, maximumLength) {
  return String(value ?? '').trim().slice(0, maximumLength);
}

export class TurnCoordinator {
  constructor({
    brain,
    sendVoiceCommand,
    publishInternalEvent = () => {},
    clock = () => new Date(),
  }) {
    if (!brain || typeof brain.respond !== 'function') {
      throw new TypeError('TurnCoordinator requires a Brain provider');
    }
    if (typeof sendVoiceCommand !== 'function') {
      throw new TypeError('TurnCoordinator requires sendVoiceCommand');
    }
    if (typeof publishInternalEvent !== 'function') {
      throw new TypeError('publishInternalEvent must be a function');
    }

    this.brain = brain;
    this.sendVoiceCommand = sendVoiceCommand;
    this.publishInternalEvent = publishInternalEvent;
    this.clock = clock;
    this.generations = new Map();
    this.sequence = 0;
    this.stopped = false;
  }

  async handleFinalized(event) {
    if (this.stopped) return { ignored: 'coordinator_stopped' };

    const turnId = text(event?.turn_id, 256);
    const transcript = text(event?.payload?.transcript, 8_000);
    const language = text(event?.payload?.language, 32) || 'und';
    if (!turnId || !transcript) {
      this.#publishFailure(event, turnId, 'BRAIN.REQUEST.INVALID');
      this.finish(turnId);
      return { failed: 'BRAIN.REQUEST.INVALID' };
    }

    const generation = (this.generations.get(turnId) ?? 0) + 1;
    this.generations.set(turnId, generation);
    this.#publishOperational(event, 'brain.turn.start', turnId, {
      provider: this.brain.constructor.name,
      inputCharacters: transcript.length,
      language,
    });

    let response;
    try {
      response = await this.brain.respond({
        turnId,
        transcript,
        language,
        traceId: event.trace_id ?? null,
        sessionId: event.session_id ?? null,
      });
    } catch (error) {
      if (!this.#isCurrent(turnId, generation)) {
        return { ignored: 'stale_brain_failure' };
      }
      this.#publishFailure(
        event,
        turnId,
        'BRAIN.PROVIDER.EXCEPTION',
        String(error?.message ?? error).slice(0, 512),
      );
      this.finish(turnId);
      return { failed: 'BRAIN.PROVIDER.EXCEPTION' };
    }

    if (!this.#isCurrent(turnId, generation)) {
      return { ignored: 'stale_brain_response' };
    }

    if (response?.status !== BrainStatus.COMPLETED) {
      const errorCode = text(response?.errorCode, 256) ||
        'BRAIN.PROVIDER.FAILED';
      this.#publishFailure(event, turnId, errorCode);
      this.finish(turnId);
      return { failed: errorCode };
    }

    const responseText = text(response.text, 16_000);
    if (!responseText) {
      this.#publishFailure(event, turnId, 'BRAIN.RESPONSE.EMPTY');
      this.finish(turnId);
      return { failed: 'BRAIN.RESPONSE.EMPTY' };
    }

    const outputId = `output-${turnId}-${generation}`;
    this.#publishOperational(event, 'brain.response.completed', turnId, {
      output_id: outputId,
      provider: text(response.provider, 128) || 'unknown',
      model: text(response.model, 128) || 'unknown',
      responseCharacters: responseText.length,
      language: text(response.language, 32) || language,
    });

    let recipients = 0;
    try {
      recipients = Number(this.sendVoiceCommand({
        name: 'voice.output.play',
        turn_id: turnId,
        output_id: outputId,
        text: responseText,
        language: text(response.language, 32) || language,
        data_classification: 'content',
      })) || 0;
    } catch (error) {
      this.#publishFailure(
        event,
        turnId,
        'VOICE.OUTPUT.DISPATCH_FAILED',
        String(error?.message ?? error).slice(0, 512),
      );
      this.finish(turnId);
      return { failed: 'VOICE.OUTPUT.DISPATCH_FAILED' };
    }

    if (recipients < 1) {
      this.#publishFailure(event, turnId, 'VOICE.OUTPUT.UNAVAILABLE');
      this.finish(turnId);
      return { failed: 'VOICE.OUTPUT.UNAVAILABLE' };
    }

    return {
      accepted: true,
      turnId,
      outputId,
      recipients,
    };
  }

  cancel(turnId) {
    const normalized = text(turnId, 256);
    if (!normalized) return false;
    this.generations.set(
      normalized,
      (this.generations.get(normalized) ?? 0) + 1,
    );
    return true;
  }

  finish(turnId) {
    const normalized = text(turnId, 256);
    if (!normalized) return false;
    return this.generations.delete(normalized);
  }

  stop() {
    this.stopped = true;
    this.generations.clear();
  }

  #isCurrent(turnId, generation) {
    return !this.stopped && this.generations.get(turnId) === generation;
  }

  #publishFailure(sourceEvent, turnId, errorCode, detail = undefined) {
    this.#publishOperational(
      sourceEvent,
      'brain.turn.failed',
      turnId || null,
      {
        error_code: errorCode,
        ...(detail ? { detail } : {}),
      },
    );
  }

  #publishOperational(sourceEvent, name, turnId, payload) {
    const sequence = ++this.sequence;
    this.publishInternalEvent({
      contract_version: '1.0',
      kind: 'event',
      name,
      event_id: `core-brain-${sequence}-${name}`,
      source: 'birdie-core',
      timestamp_utc: this.clock().toISOString(),
      monotonic_ms: sequence,
      source_sequence: sequence,
      trace_id: sourceEvent?.trace_id ?? `trace-core-${sequence}`,
      session_id: sourceEvent?.session_id ?? null,
      turn_id: turnId,
      data_classification: 'operational',
      payload,
    });
  }
}
