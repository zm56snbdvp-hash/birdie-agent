import test from 'node:test';
import assert from 'node:assert/strict';
import { BirdieRuntimeV0 } from '../src/runtime-v0.mjs';

function event(name, sequence, { turnId = null, payload = {} } = {}) {
  return {
    contract_version: '1.0',
    kind: 'event',
    name,
    event_id: `addressability-${sequence}`,
    source: 'birdie-voice-addressability-test',
    timestamp_utc: new Date(1_700_000_000_000 + sequence).toISOString(),
    monotonic_ms: sequence,
    source_sequence: sequence,
    trace_id: 'trace-addressability',
    session_id: 'session-addressability',
    turn_id: turnId,
    data_classification: 'operational',
    payload,
  };
}

test('ABSTAIN from idle returns to IDLE and creates no turn', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(event('component.ready', 1));
  runtime.apply(event('voice.activity.started', 2));

  const result = runtime.apply(
    event('voice.activation.abstained', 3, {
      payload: {
        reason: 'ADDRESSABILITY.UNCERTAIN',
        score: 0.51,
      },
    }),
  );

  assert.equal(result.snapshot.presence.state, 'IDLE');
  assert.equal(
    result.snapshot.presence.reason,
    'voice.activation.abstained',
  );
  assert.equal(result.snapshot.activeTurn, null);
  assert.equal(runtime.turns.turns.size, 0);
});

test('ABSTAIN during a Barge-in candidate resumes existing SPEAKING state', () => {
  const runtime = new BirdieRuntimeV0();
  runtime.apply(event('component.ready', 1));
  runtime.apply(event('voice.activation.accepted', 2));
  runtime.apply(
    event('voice.utterance.finalized', 3, { turnId: 'turn-existing' }),
  );
  runtime.apply(
    event('voice.output.started', 4, { turnId: 'turn-existing' }),
  );

  runtime.apply(event('voice.activity.started', 5));
  const result = runtime.apply(
    event('voice.activation.abstained', 6, {
      payload: {
        reason: 'ADDRESSABILITY.UNCERTAIN',
        score: 0.49,
      },
    }),
  );

  assert.equal(result.snapshot.presence.state, 'SPEAKING');
  assert.equal(result.snapshot.activeTurn.id, 'turn-existing');
  assert.equal(result.snapshot.activeTurn.status, 'OUTPUTTING');
  assert.equal(runtime.turns.turns.size, 1);
});
