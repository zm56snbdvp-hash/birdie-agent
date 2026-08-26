import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainStatus } from '../src/brain.mjs';
import { TurnCoordinator } from '../src/turn-coordinator.mjs';

function finalizedEvent(overrides = {}) {
  return {
    contract_version: '1.0',
    kind: 'event',
    name: 'voice.utterance.finalized',
    event_id: 'voice-finalized-1',
    source: 'birdie-voice',
    timestamp_utc: '2026-08-26T12:00:00.000Z',
    monotonic_ms: 1234,
    source_sequence: 9,
    trace_id: 'trace-dialog-1',
    session_id: 'session-dialog-1',
    turn_id: 'turn-dialog-1',
    data_classification: 'content',
    payload: {
      transcript: 'Birdie, bist du da?',
      language: 'de-DE',
      ...overrides.payload,
    },
    ...overrides,
  };
}

function completedBrain(text = 'Ich bin da.') {
  return {
    async respond(request) {
      return {
        status: BrainStatus.COMPLETED,
        turnId: request.turnId,
        text,
        language: request.language,
        provider: 'test-brain',
        model: 'test-v1',
        errorCode: null,
      };
    },
  };
}

test('finalized transcript becomes one content-classified Voice output command', async () => {
  const commands = [];
  const events = [];
  const coordinator = new TurnCoordinator({
    brain: completedBrain('Ich bin da.'),
    sendVoiceCommand(payload) {
      commands.push(payload);
      return 1;
    },
    publishInternalEvent(event) {
      events.push(event);
    },
    clock: () => new Date('2026-08-26T12:00:01.000Z'),
  });

  const result = await coordinator.handleFinalized(finalizedEvent());
  assert.equal(result.accepted, true);
  assert.equal(result.turnId, 'turn-dialog-1');
  assert.equal(result.outputId, 'output-turn-dialog-1-1');

  assert.deepEqual(commands, [{
    name: 'voice.output.play',
    turn_id: 'turn-dialog-1',
    output_id: 'output-turn-dialog-1-1',
    text: 'Ich bin da.',
    language: 'de-DE',
    data_classification: 'content',
  }]);

  assert.deepEqual(
    events.map((event) => event.name),
    ['brain.turn.start', 'brain.response.completed'],
  );
  assert.equal(
    events.some((event) => Object.hasOwn(event.payload, 'text')),
    false,
    'operational Brain events must not contain response content',
  );
});

test('Brain failure creates an operational turn failure and no Voice command', async () => {
  const commands = [];
  const events = [];
  const coordinator = new TurnCoordinator({
    brain: {
      async respond() {
        return {
          status: BrainStatus.UNAVAILABLE,
          errorCode: 'BRAIN.PROVIDER.UNAVAILABLE',
        };
      },
    },
    sendVoiceCommand(payload) {
      commands.push(payload);
      return 1;
    },
    publishInternalEvent(event) {
      events.push(event);
    },
  });

  const result = await coordinator.handleFinalized(finalizedEvent());
  assert.equal(result.failed, 'BRAIN.PROVIDER.UNAVAILABLE');
  assert.equal(commands.length, 0);
  assert.equal(events.at(-1).name, 'brain.turn.failed');
  assert.equal(
    events.at(-1).payload.error_code,
    'BRAIN.PROVIDER.UNAVAILABLE',
  );
});

test('missing Voice output recipient fails the same turn', async () => {
  const events = [];
  const coordinator = new TurnCoordinator({
    brain: completedBrain(),
    sendVoiceCommand() {
      return 0;
    },
    publishInternalEvent(event) {
      events.push(event);
    },
  });

  const result = await coordinator.handleFinalized(finalizedEvent());
  assert.equal(result.failed, 'VOICE.OUTPUT.UNAVAILABLE');
  assert.equal(events.at(-1).name, 'brain.turn.failed');
  assert.equal(events.at(-1).turn_id, 'turn-dialog-1');
});

test('cancelled turn ignores a late Brain response', async () => {
  let resolveBrain;
  const response = new Promise((resolve) => {
    resolveBrain = resolve;
  });
  const commands = [];
  const events = [];
  const coordinator = new TurnCoordinator({
    brain: {
      respond() {
        return response;
      },
    },
    sendVoiceCommand(payload) {
      commands.push(payload);
      return 1;
    },
    publishInternalEvent(event) {
      events.push(event);
    },
  });

  const pending = coordinator.handleFinalized(finalizedEvent());
  coordinator.cancel('turn-dialog-1');
  resolveBrain({
    status: BrainStatus.COMPLETED,
    text: 'Zu spät.',
    language: 'de',
    provider: 'delayed-test',
    model: 'delayed-v1',
  });

  const result = await pending;
  assert.equal(result.ignored, 'stale_brain_response');
  assert.equal(commands.length, 0);
  assert.deepEqual(events.map((event) => event.name), ['brain.turn.start']);
});

test('invalid finalized content fails before invoking Brain', async () => {
  let calls = 0;
  const events = [];
  const coordinator = new TurnCoordinator({
    brain: {
      async respond() {
        calls += 1;
        return { status: BrainStatus.COMPLETED, text: 'never' };
      },
    },
    sendVoiceCommand() {
      return 1;
    },
    publishInternalEvent(event) {
      events.push(event);
    },
  });

  const result = await coordinator.handleFinalized(finalizedEvent({
    payload: { transcript: '   ', language: 'de' },
  }));
  assert.equal(result.failed, 'BRAIN.REQUEST.INVALID');
  assert.equal(calls, 0);
  assert.equal(events.at(-1).name, 'brain.turn.failed');
});
