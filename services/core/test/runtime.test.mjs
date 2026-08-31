import test from 'node:test';
import assert from 'node:assert/strict';
import { BirdieRuntime } from '../src/runtime.mjs';

function evt(name, seq, overrides = {}) {
  return {
    event_id: `evt-${seq}-${name}`,
    name,
    source: overrides.source ?? 'voice',
    source_sequence: seq,
    turn_id: overrides.turn_id ?? null,
    payload: overrides.payload ?? {},
  };
}

test('normal turn reaches IDLE through canonical alpha flow', () => {
  const runtime = new BirdieRuntime();
  runtime.ready();
  assert.equal(runtime.snapshot().presenceState, 'IDLE');

  runtime.apply(evt('voice.activity.started', 1));
  assert.equal(runtime.snapshot().presenceState, 'SPEECH_DETECTED');

  runtime.apply(evt('voice.activation.accepted', 2, { turn_id: 'turn-1' }));
  assert.equal(runtime.snapshot().presenceState, 'LISTENING');

  runtime.apply(evt('voice.utterance.finalized', 3, { turn_id: 'turn-1' }));
  assert.equal(runtime.snapshot().presenceState, 'THINKING');

  runtime.apply(evt('voice.output.started', 4, { turn_id: 'turn-1', payload: { output_id: 'out-1' } }));
  assert.equal(runtime.snapshot().presenceState, 'SPEAKING');

  runtime.apply(evt('voice.output.completed', 5, { turn_id: 'turn-1', payload: { output_id: 'out-1' } }));
  assert.equal(runtime.snapshot().presenceState, 'IDLE');
  assert.equal(runtime.snapshot().activeTurn.status, 'COMPLETED');
});

test('rejected barge-in returns to same speaking turn', () => {
  const runtime = new BirdieRuntime();
  runtime.ready();
  runtime.apply(evt('voice.activation.accepted', 1, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.utterance.finalized', 2, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.started', 3, { turn_id: 'turn-1', payload: { output_id: 'out-1' } }));
  runtime.apply(evt('voice.activity.started', 4));
  assert.equal(runtime.snapshot().presenceState, 'SPEECH_DETECTED');

  runtime.apply(evt('voice.activation.rejected', 5));
  assert.equal(runtime.snapshot().presenceState, 'SPEAKING');
  assert.equal(runtime.snapshot().activeTurn.turnId, 'turn-1');
  assert.equal(runtime.snapshot().activeTurn.status, 'OUTPUTTING');
});

test('accepted barge-in isolates old turn and stale output cannot return', () => {
  const runtime = new BirdieRuntime();
  runtime.ready();
  runtime.apply(evt('voice.activation.accepted', 1, { turn_id: 'turn-old' }));
  runtime.apply(evt('voice.utterance.finalized', 2, { turn_id: 'turn-old' }));
  runtime.apply(evt('voice.output.started', 3, { turn_id: 'turn-old', payload: { output_id: 'out-old' } }));
  runtime.apply(evt('voice.activity.started', 4));
  runtime.apply(evt('voice.activation.accepted', 5, { turn_id: 'turn-new' }));
  assert.equal(runtime.snapshot().presenceState, 'LISTENING');
  assert.equal(runtime.snapshot().activeTurn.turnId, 'turn-new');

  const stale = runtime.apply(evt('voice.output.started', 6, { turn_id: 'turn-old', payload: { output_id: 'late-old' } }));
  assert.equal(stale.dropped, 'stale_turn_event');
  assert.equal(runtime.snapshot().presenceState, 'LISTENING');
});

test('duplicate and stale source events are dropped', () => {
  const runtime = new BirdieRuntime();
  runtime.ready();
  const first = evt('voice.activity.started', 10);
  runtime.apply(first);
  assert.equal(runtime.apply(first).dropped, 'duplicate_event');
  assert.equal(runtime.apply(evt('voice.activity.ended', 9)).dropped, 'stale_source_sequence');
});

test('snapshot revisions only increase on visible state changes', () => {
  const runtime = new BirdieRuntime();
  runtime.ready();
  const r1 = runtime.snapshot().revision;
  runtime.apply(evt('voice.activity.started', 1));
  const r2 = runtime.snapshot().revision;
  runtime.apply(evt('voice.activity.started', 2));
  const r3 = runtime.snapshot().revision;
  assert.ok(r2 > r1);
  assert.equal(r3, r2);
});
