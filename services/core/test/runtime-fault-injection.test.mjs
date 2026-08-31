import assert from 'node:assert/strict';
import test from 'node:test';
import { BirdieRuntimeV0 } from '../src/runtime-v0.mjs';

function event({
  name,
  sequence,
  eventId = `${name}-${sequence}`,
  payload = {},
} = {}) {
  return {
    contract_version: '1.0',
    kind: 'event',
    name,
    event_id: eventId,
    source: 'birdie-voice',
    timestamp_utc: `2026-08-29T00:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    monotonic_ms: sequence,
    source_sequence: sequence,
    trace_id: `trace-fault-${eventId}`,
    session_id: 'voice-fault-session',
    turn_id: null,
    data_classification: 'operational',
    payload,
  };
}

class ReferenceCoreModel {
  constructor() {
    this.state = 'OFFLINE';
    this.revision = 0;
    this.highWatermarks = new Map();
    this.seen = new Set();
  }

  apply(input, sourceScope) {
    const replayKey = `${sourceScope}:${input.event_id}`;
    if (this.seen.has(replayKey)) return { dropped: 'duplicate_event' };
    this.seen.add(replayKey);

    const previous = this.highWatermarks.get(sourceScope) ?? -1;
    if (input.source_sequence <= previous) {
      return { dropped: 'stale_source_sequence' };
    }
    this.highWatermarks.set(sourceScope, input.source_sequence);

    let nextState = this.state;
    if (input.name === 'component.ready') nextState = 'IDLE';
    if (
      input.name === 'component.health.changed'
      && input.payload?.status === 'UNAVAILABLE'
    ) {
      nextState = 'OFFLINE';
    }
    if (nextState !== this.state) {
      this.state = nextState;
      this.revision += 1;
    }
    return { dropped: null };
  }
}

const CORE_FAULT_CORPUS = Object.freeze([
  {
    id: 'exact-event-id-duplicate',
    coverage: ['duplicate-event-id'],
    actions: (() => {
      const ready = event({
        name: 'component.ready',
        sequence: 1,
        eventId: 'duplicate-ready',
      });
      return [
        { sourceScope: 'voice-a', event: ready },
        { sourceScope: 'voice-a', event: structuredClone(ready) },
      ];
    })(),
  },
  {
    id: 'unique-event-with-stale-source-sequence',
    coverage: ['out-of-order-source-sequence', 'stale-source-sequence'],
    actions: [
      {
        sourceScope: 'voice-a',
        event: event({ name: 'component.ready', sequence: 10 }),
      },
      {
        sourceScope: 'voice-a',
        event: event({
          name: 'component.health.changed',
          sequence: 12,
          payload: { status: 'UNAVAILABLE' },
        }),
      },
      {
        sourceScope: 'voice-a',
        event: event({
          name: 'component.ready',
          sequence: 11,
          eventId: 'late-ready-11',
        }),
      },
    ],
  },
  {
    id: 'rapid-offline-ready-edge',
    coverage: ['rapid-edge', 'offline', 'ready'],
    actions: [
      {
        sourceScope: 'voice-a',
        event: event({ name: 'component.ready', sequence: 20 }),
      },
      {
        sourceScope: 'voice-a',
        event: event({
          name: 'component.health.changed',
          sequence: 21,
          payload: { status: 'UNAVAILABLE' },
        }),
      },
      {
        sourceScope: 'voice-a',
        event: event({ name: 'component.ready', sequence: 22 }),
      },
    ],
  },
  {
    id: 'new-reconnect-scope-has-independent-sequence-watermark',
    coverage: ['reconnect-scope'],
    actions: [
      {
        sourceScope: 'voice-old',
        event: event({ name: 'component.ready', sequence: 50 }),
      },
      {
        sourceScope: 'voice-new',
        event: event({
          name: 'component.health.changed',
          sequence: 1,
          eventId: 'new-scope-sequence-1',
          payload: { status: 'UNAVAILABLE' },
        }),
      },
    ],
  },
]);

test('Core fault corpus matches sequence and Presence invariants', () => {
  const covered = new Set();
  for (const scenario of CORE_FAULT_CORPUS) {
    scenario.coverage.forEach((entry) => covered.add(entry));
    const runtime = new BirdieRuntimeV0();
    const model = new ReferenceCoreModel();

    for (const [index, action] of scenario.actions.entries()) {
      const expected = model.apply(action.event, action.sourceScope);
      const actual = runtime.apply(action.event, {
        sourceScope: action.sourceScope,
      });
      const snapshot = runtime.getSnapshot();
      assert.equal(
        actual?.dropped ?? null,
        expected.dropped,
        `${scenario.id} action=${index + 1} drop result`,
      );
      assert.equal(
        snapshot.presence.state,
        model.state,
        `${scenario.id} action=${index + 1} Presence`,
      );
      assert.equal(
        snapshot.presence.revision,
        model.revision,
        `${scenario.id} action=${index + 1} revision`,
      );
    }
  }

  assert.deepEqual(
    [...covered].sort(),
    [
      'duplicate-event-id',
      'offline',
      'out-of-order-source-sequence',
      'rapid-edge',
      'ready',
      'reconnect-scope',
      'stale-source-sequence',
    ],
  );
});
