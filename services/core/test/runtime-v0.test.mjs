import test from 'node:test';
import assert from 'node:assert/strict';
import { BirdieRuntimeV0 } from '../src/runtime-v0.mjs';

function evt(name, seq, extra = {}) {
  return {
    contract_version: '1.0',
    name,
    event_id: `evt-${seq}-${name}`,
    source: extra.source ?? 'test',
    timestamp_utc: `2026-08-25T21:29:${String(seq).padStart(2, '0')}.000Z`,
    source_sequence: seq,
    trace_id: 'trace-alpha',
    turn_id: extra.turn_id ?? null,
    payload: extra.payload ?? {},
    data_classification: extra.data_classification ?? 'operational',
  };
}

test('normal turn distinguishes capture from finalized transcript', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(evt('component.ready', 1));
  runtime.apply(evt('voice.activity.started', 2));
  runtime.apply(evt('voice.activation.accepted', 3, { turn_id: 'turn-1' }));

  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.presence.state, 'LISTENING');
  assert.equal(snapshot.activeTurn.id, 'turn-1');
  assert.equal(snapshot.activeTurn.status, 'CAPTURING');

  runtime.apply(evt('voice.utterance.captured', 4, { turn_id: 'turn-1' }));
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.presence.state, 'THINKING');
  assert.equal(snapshot.presence.reason, 'voice.utterance.captured');
  assert.equal(snapshot.activeTurn.status, 'PROCESSING');
  const revisionAfterCapture = snapshot.presence.revision;

  runtime.apply(evt('voice.utterance.finalized', 5, {
    turn_id: 'turn-1',
    data_classification: 'content',
    payload: { transcript: 'Birdie, öffne den Kalender' },
  }));
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.presence.state, 'THINKING');
  assert.equal(
    snapshot.presence.reason,
    'voice.utterance.captured',
    'internal STT completion must not manufacture a second visible transition',
  );
  assert.equal(snapshot.presence.revision, revisionAfterCapture);
  assert.equal(snapshot.activeTurn.id, 'turn-1');
  assert.equal(snapshot.activeTurn.status, 'PROCESSING');
  assert.equal(runtime.turns.turns.size, 1);

  runtime.apply(evt('voice.output.started', 6, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.completed', 7, { turn_id: 'turn-1' }));
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.presence.state, 'IDLE');
  assert.equal(snapshot.presence.activeTurnId, null);
  assert.equal(snapshot.activeTurn, null);
});

test('full transcription failure cancels the same capturing turn', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(evt('component.ready', 1));
  runtime.apply(evt('voice.activity.started', 2));
  runtime.apply(evt('voice.activation.accepted', 3, {
    turn_id: 'turn-cancelled',
  }));
  runtime.apply(evt('voice.utterance.captured', 4, {
    turn_id: 'turn-cancelled',
  }));
  runtime.apply(evt('voice.input.cancelled', 5, {
    turn_id: 'turn-cancelled',
    payload: {
      reason: 'conversation_stt_failed',
      error_code: 'VOICE.CONVERSATION_STT.UNAVAILABLE',
    },
  }));

  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.presence.state, 'IDLE');
  assert.equal(snapshot.presence.activeTurnId, null);
  assert.equal(snapshot.activeTurn, null);
  assert.equal(
    runtime.turns.get('turn-cancelled').status,
    'CANCELLED',
  );
});

test('rejected barge-in resumes speaking', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(evt('component.ready', 1));
  runtime.apply(evt('voice.activity.started', 2));
  runtime.apply(evt('voice.activation.accepted', 3, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.utterance.finalized', 4, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.started', 5, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.activity.started', 6));
  assert.equal(runtime.getSnapshot().presence.state, 'SPEECH_DETECTED');
  runtime.apply(evt('voice.activation.rejected', 7));
  assert.equal(runtime.getSnapshot().presence.state, 'SPEAKING');
});

test('completed turn cannot speak again', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(evt('component.ready', 1));
  runtime.apply(evt('voice.activity.started', 2));
  runtime.apply(evt('voice.activation.accepted', 3, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.utterance.finalized', 4, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.started', 5, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.completed', 6, { turn_id: 'turn-1' }));
  assert.throws(
    () => runtime.apply(evt('voice.output.started', 7, { turn_id: 'turn-1' })),
    /TURN.STALE_EVENT/,
  );
});
