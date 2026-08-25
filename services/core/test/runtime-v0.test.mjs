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
  };
}

test('normal turn reaches IDLE', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(evt('component.ready', 1));
  runtime.apply(evt('voice.activity.started', 2));
  runtime.apply(evt('voice.activation.accepted', 3));
  runtime.apply(evt('voice.utterance.finalized', 4, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.started', 5, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.completed', 6, { turn_id: 'turn-1' }));
  assert.equal(runtime.getSnapshot().presence.state, 'IDLE');
  assert.equal(runtime.getSnapshot().activeTurn, null);
});

test('rejected barge-in resumes speaking', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(evt('component.ready', 1));
  runtime.apply(evt('voice.activity.started', 2));
  runtime.apply(evt('voice.activation.accepted', 3));
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
  runtime.apply(evt('voice.activation.accepted', 3));
  runtime.apply(evt('voice.utterance.finalized', 4, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.started', 5, { turn_id: 'turn-1' }));
  runtime.apply(evt('voice.output.completed', 6, { turn_id: 'turn-1' }));
  assert.throws(() => runtime.apply(evt('voice.output.started', 7, { turn_id: 'turn-1' })), /TURN.STALE_EVENT/);
});
