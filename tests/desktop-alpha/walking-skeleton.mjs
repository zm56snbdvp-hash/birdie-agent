import assert from 'node:assert/strict';
import { BirdieRuntimeV0 } from '../../services/core/src/runtime-v0.mjs';
import { createEnvelope } from '../../packages/protocol/src/contract.mjs';

let seq = 0;
const event = (name, { turnId = null, payload = {}, source = 'birdie-voice' } = {}) => createEnvelope({
  name,
  eventId: `evt-${++seq}`,
  source,
  monotonicMs: seq * 10,
  sourceSequence: seq,
  traceId: 'trace-walking-skeleton',
  sessionId: 'session-windows-alpha',
  turnId,
  payload,
});

const runtime = new BirdieRuntimeV0();
const states = [];
const apply = (e) => {
  const result = runtime.apply(e);
  if (result?.snapshot?.presence?.state) states.push(result.snapshot.presence.state);
  return result;
};

apply(event('component.ready', { source: 'birdie-runtime', payload: { component: 'voice' } }));
apply(event('voice.activity.started', { payload: { confidence: 0.94 } }));
apply(event('voice.activation.accepted', { payload: { activation_mode: 'WAKE_ON_SPEAK', confidence: 0.93 } }));
apply(event('voice.utterance.finalized', { turnId: 'turn-001', payload: { transcript: 'Wie spät ist es?', language: 'de-DE' } }));
apply(event('voice.output.started', { turnId: 'turn-001', payload: { output_id: 'out-001' } }));
apply(event('voice.output.completed', { turnId: 'turn-001', payload: { output_id: 'out-001' } }));

assert.deepEqual(states, [
  'IDLE',
  'SPEECH_DETECTED',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'IDLE',
]);

assert.equal(runtime.getSnapshot().presence.state, 'IDLE');
assert.equal(runtime.getSnapshot().activeTurn, null);

console.log('walking-skeleton: ok');
