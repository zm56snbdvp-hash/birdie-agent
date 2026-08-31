import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  RuntimeBridge,
  TAURI_EVENTS,
} from '../src/runtime-bridge.js';
import { projectRuntimeUiState } from '../src/runtime-state-contract.js';
import {
  loadTraceFixtures,
  minimizeTrace,
  orderedSubsequences,
} from '../../../tests/desktop-alpha/helpers/trace-minimizer.mjs';
import {
  TRACE_SCHEMA_ID,
  TRACE_SCHEMA_CANONICAL_HASH,
  TRACE_SCHEMA_VERSION,
  canonicalJson,
  computeManifestCanonicalHash,
  computeTraceCanonicalHash,
  computeTraceSchemaCanonicalHash,
  createCorpusManifest,
  deserializeTraceFixture,
  loadTraceCorpus,
  resolveMinimalTrace,
  serializeTraceFixture,
  traceSemanticProjection,
  upgradeTraceFixture,
} from '../../../tests/desktop-alpha/helpers/runtime-fault-corpus.mjs';

const FIXTURE_DIRECTORY = new URL(
  '../../../tests/desktop-alpha/golden/runtime-fault-regressions/',
  import.meta.url,
);
const TRACE_SCHEMA_URL = new URL(
  '../../../tests/desktop-alpha/schemas/runtime-fault-trace-v2.schema.json',
  import.meta.url,
);
const LEGACY_V1_DIRECTORY = new URL('legacy-v1/', FIXTURE_DIRECTORY);

const FAULT_PROFILES = Object.freeze({
  duplicate: { acceptConflictingEqualRevision: true },
  'out-of-order': { acceptLowerRevision: true },
  'stale-snapshot': { acceptLowerRevision: true },
  'reconnect-race': { connectAlwaysTransitions: true },
});

const INVARIANT_IDS = Object.freeze({
  duplicate: 'BRIDGE.SAME_REVISION_CONFLICT_IS_NO_OP',
  'out-of-order': 'BRIDGE.OUT_OF_ORDER_SNAPSHOT_IS_NO_OP',
  'stale-snapshot': 'BRIDGE.STALE_SNAPSHOT_IS_NO_OP',
  'reconnect-race': 'BRIDGE.LATE_CONNECTED_HAS_NO_TRANSIENT_UI',
});

function snapshotFingerprint(value) {
  return JSON.stringify({
    lifecycle: value.lifecycle,
    presence: {
      revision: value.presence?.revision ?? null,
      state: value.presence?.state ?? null,
      reason: value.presence?.reason ?? null,
    },
    microphoneState: value.microphoneState,
    brainState: value.brainState,
  });
}

function compactTransitions(initialState, transitions) {
  let current = initialState;
  const compact = [];
  for (const next of transitions) {
    if (next === current) continue;
    compact.push(next);
    current = next;
  }
  return compact;
}

function projectedUiState(value) {
  return projectRuntimeUiState({
    lifecycle: value.lifecycle,
    presenceState: value.presence?.state,
  }).status;
}

class TraceRuntimeModel {
  constructor(initialSnapshot, faultProfile = {}) {
    this.faultProfile = faultProfile;
    this.bridgeRevision = initialSnapshot.bridgeRevision;
    this.snapshotRevision = initialSnapshot.bridgeRevision;
    this.snapshotFingerprint = snapshotFingerprint(initialSnapshot);
    this.lifecycle = initialSnapshot.lifecycle;
    this.uiState = projectedUiState(initialSnapshot);
  }

  apply(event) {
    if (event.kind === 'snapshot') return this.#applySnapshot(event.payload);
    if (event.kind === 'connected') {
      const transitions = [];
      if (
        this.faultProfile.connectAlwaysTransitions
        || this.lifecycle !== 'READY'
      ) {
        transitions.push('CONNECTING');
        this.uiState = 'CONNECTING';
      }
      transitions.push(...this.#applySnapshot(event.snapshot_response));
      return transitions;
    }
    throw new Error(`TRACE.MODEL.UNSUPPORTED_EVENT:${event.kind}`);
  }

  #applySnapshot(next) {
    const revision = next.bridgeRevision;
    const nextFingerprint = snapshotFingerprint(next);
    if (
      revision < this.bridgeRevision
      && !this.faultProfile.acceptLowerRevision
    ) {
      return [];
    }
    if (
      revision === this.snapshotRevision
      && nextFingerprint !== this.snapshotFingerprint
      && !this.faultProfile.acceptConflictingEqualRevision
    ) {
      return [];
    }

    const identical =
      revision === this.snapshotRevision
      && nextFingerprint === this.snapshotFingerprint;
    if (!identical) {
      this.bridgeRevision = revision;
      this.snapshotRevision = revision;
      this.snapshotFingerprint = nextFingerprint;
      this.lifecycle = next.lifecycle;
    }

    const nextUiState = projectedUiState(next);
    if (nextUiState === this.uiState) return [];
    this.uiState = nextUiState;
    return [nextUiState];
  }
}

function violationSignature(fixture, events) {
  const reference = new TraceRuntimeModel(fixture.initial_state.snapshot);
  const faultModel = new TraceRuntimeModel(
    fixture.initial_state.snapshot,
    FAULT_PROFILES[fixture.fault_class],
  );

  for (const [index, event] of events.entries()) {
    const expected = reference.apply(event);
    const observed = faultModel.apply(event);
    if (JSON.stringify(expected) !== JSON.stringify(observed)) {
      return {
        invariantId: INVARIANT_IDS[fixture.fault_class],
        eventId: event.event_id,
        sequenceId: event.sequence_id,
        eventKind: event.kind,
        eventIndex: index + 1,
        expectedTransitions: expected,
        faultModelTransitions: observed,
      };
    }
  }
  return null;
}

function expectedSignature(fixture) {
  const first = fixture.expected_first_violation;
  return {
    invariantId: first.invariant_id,
    eventId: first.event_id,
    sequenceId: first.sequence_id,
    eventKind: first.event_kind,
    expectedTransitions: first.expected_transitions,
    faultModelTransitions: first.fault_model_transitions,
  };
}

function sameFailure(fixture, events) {
  const violation = violationSignature(fixture, events);
  if (!violation) return false;
  const { eventIndex: _ignored, ...stable } = violation;
  return JSON.stringify(stable) === JSON.stringify(expectedSignature(fixture));
}

function createBridgeHarness(initialSnapshot, events) {
  const handlers = new Map();
  const statuses = [];
  const queue = [
    structuredClone(initialSnapshot),
    structuredClone(initialSnapshot),
    ...events
      .filter(({ kind }) => kind === 'connected')
      .map(({ snapshot_response: response }) => structuredClone(response)),
  ];
  const bridge = new RuntimeBridge(
    { onStatus: (status) => statuses.push(status) },
    {
      invokeFn: async (command) => {
        if (command !== 'runtime_get_snapshot') return null;
        assert.ok(queue.length > 0, 'unexpected minimizer snapshot request');
        return queue.shift();
      },
      listenFn: async (event, handler) => {
        handlers.set(event, handler);
        return async () => handlers.delete(event);
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      persistDiagnostics: false,
    },
  );
  return { bridge, handlers, statuses };
}

async function productionViolation(fixture) {
  const events = resolveMinimalTrace(fixture);
  const state = createBridgeHarness(fixture.initial_state.snapshot, events);
  await state.bridge.connect();
  state.statuses.length = 0;
  const reference = new TraceRuntimeModel(fixture.initial_state.snapshot);
  try {
    for (const [index, event] of events.entries()) {
      const initialUiState = reference.uiState;
      const before = state.statuses.length;
      if (event.kind === 'snapshot') {
        state.handlers.get(TAURI_EVENTS.SNAPSHOT)({ payload: event.payload });
      } else if (event.kind === 'connected') {
        await state.handlers.get(TAURI_EVENTS.CONNECTED)({ payload: {} });
      }
      const expected = reference.apply(event);
      const observed = compactTransitions(
        initialUiState,
        state.statuses.slice(before),
      );
      if (JSON.stringify(expected) !== JSON.stringify(observed)) {
        return {
          eventIndex: index + 1,
          eventKind: event.kind,
          expected,
          observed,
        };
      }
    }
    return null;
  } finally {
    state.bridge.dispose();
  }
}

function resolveSchemaReference(root, reference) {
  if (!reference.startsWith('#/')) throw new Error(`unsupported schema ref ${reference}`);
  return reference.slice(2).split('/').reduce(
    (value, token) => value[token.replaceAll('~1', '/').replaceAll('~0', '~')],
    root,
  );
}

function assertLocalSchema(value, schema, root = schema, path = '$') {
  if (schema.$ref) {
    assertLocalSchema(value, resolveSchemaReference(root, schema.$ref), root, path);
    return;
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const alternative of schema.oneOf) {
      try {
        assertLocalSchema(value, alternative, root, path);
        matches += 1;
      } catch {
        // A oneOf branch is expected to fail while selecting the event variant.
      }
    }
    if (matches !== 1) throw new Error(`schema oneOf mismatch at ${path}`);
    return;
  }
  if (schema.const !== undefined && canonicalJson(value) !== canonicalJson(schema.const)) {
    throw new Error(`schema const mismatch at ${path}`);
  }
  if (schema.enum && !schema.enum.some((entry) => (
    canonicalJson(entry) === canonicalJson(value)
  ))) {
    throw new Error(`schema enum mismatch at ${path}`);
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`schema object required at ${path}`);
    }
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        throw new Error(`schema required field ${path}.${required}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) {
          throw new Error(`schema additional field ${path}.${key}`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        assertLocalSchema(value[key], childSchema, root, `${path}.${key}`);
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`schema array required at ${path}`);
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new Error(`schema minItems mismatch at ${path}`);
    }
    if (schema.uniqueItems) {
      const unique = new Set(value.map((entry) => canonicalJson(entry)));
      if (unique.size !== value.length) throw new Error(`schema uniqueItems mismatch at ${path}`);
    }
    if (schema.items) {
      value.forEach((entry, index) => (
        assertLocalSchema(entry, schema.items, root, `${path}[${index}]`)
      ));
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') throw new Error(`schema string required at ${path}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new Error(`schema minLength mismatch at ${path}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      throw new Error(`schema pattern mismatch at ${path}`);
    }
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) throw new Error(`schema integer required at ${path}`);
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new Error(`schema minimum mismatch at ${path}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new Error(`schema maximum mismatch at ${path}`);
    }
  }
}

test('cardinality minimizer reproduces the checked-in shortest traces', async () => {
  const fixtures = await loadTraceFixtures(FIXTURE_DIRECTORY);
  assert.deepEqual(
    fixtures.map(({ name }) => name),
    [
      'desktop-duplicate-revision-conflict',
      'desktop-out-of-order-snapshot',
      'desktop-reconnect-race',
      'desktop-stale-snapshot',
    ],
  );

  for (const fixture of fixtures) {
    const seed = fixture.seed.events;
    const minimalTrace = resolveMinimalTrace(fixture);
    assert.equal(seed.length, fixture.minimization.original_event_count);
    assert.equal(sameFailure(fixture, seed), true, `${fixture.name} seed`);

    const minimized = await minimizeTrace(
      seed,
      async (candidate) => sameFailure(fixture, candidate),
    );
    assert.deepEqual(minimized.events, minimalTrace, `${fixture.name} events`);
    assert.deepEqual(
      minimized.sourceIndices,
      fixture.minimization.source_event_indices,
      `${fixture.name} source indices`,
    );

    const violation = violationSignature(fixture, minimized.events);
    assert.equal(
      violation.eventIndex,
      fixture.expected_first_violation.trace_index,
      `${fixture.name} first violation`,
    );
    for (let size = 0; size < minimized.events.length; size += 1) {
      for (const shorter of orderedSubsequences(seed, size)) {
        assert.equal(
          sameFailure(fixture, shorter.events),
          false,
          `${fixture.name} shorter candidate ${shorter.sourceIndices.join(',')}`,
        );
      }
    }
  }
});

test('minimal traces reproduce the same failure signature 20 out of 20 times', async () => {
  const fixtures = await loadTraceFixtures(FIXTURE_DIRECTORY);
  for (const fixture of fixtures) {
    const minimalTrace = resolveMinimalTrace(fixture);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const violation = violationSignature(fixture, minimalTrace);
      assert.equal(
        sameFailure(fixture, minimalTrace),
        true,
        `${fixture.name} fault replay ${attempt}`,
      );
      assert.equal(
        violation.eventIndex,
        fixture.expected_first_violation.trace_index,
        `${fixture.name} violation index ${attempt}`,
      );
      const minimizedAgain = await minimizeTrace(
        minimalTrace,
        async (candidate) => sameFailure(fixture, candidate),
      );
      assert.deepEqual(
        minimizedAgain.events,
        minimalTrace,
        `${fixture.name} idempotent minimization ${attempt}`,
      );
    }
  }
});

test('current RuntimeBridge satisfies every minimal regression trace 20 out of 20 times', async () => {
  const fixtures = await loadTraceFixtures(FIXTURE_DIRECTORY);
  for (const fixture of fixtures) {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      assert.equal(
        await productionViolation(fixture),
        null,
        `${fixture.name} production replay ${attempt}`,
      );
    }
  }
});

test('versioned corpus manifest binds schema, IDs, counts, and canonical hashes', async () => {
  const schema = JSON.parse(await readFile(TRACE_SCHEMA_URL, 'utf8'));
  assert.equal(schema.$id, TRACE_SCHEMA_ID);
  assert.equal(schema.properties.schema_version.const, TRACE_SCHEMA_VERSION);
  assert.equal(
    computeTraceSchemaCanonicalHash(schema),
    TRACE_SCHEMA_CANONICAL_HASH,
  );

  const { manifest, fixtures } = await loadTraceCorpus(FIXTURE_DIRECTORY);
  assert.equal(manifest.fixture_count, 4);
  assert.equal(manifest.trace_schema_hash, TRACE_SCHEMA_CANONICAL_HASH);
  assert.equal(
    computeManifestCanonicalHash(manifest),
    manifest.canonical_hash,
  );
  assert.deepEqual(
    createCorpusManifest(manifest.fixtures.map((entry, index) => ({
      file: entry.file,
      fixture: fixtures[index],
    }))),
    manifest,
  );

  for (const [index, fixture] of fixtures.entries()) {
    assertLocalSchema(fixture, schema);
    const entry = manifest.fixtures[index];
    assert.equal(fixture.canonical_hash, computeTraceCanonicalHash(fixture));
    assert.equal(fixture.seed.seed_id, entry.seed_id);
    assert.equal(fixture.seed.events.length, entry.seed_event_count);
    assert.equal(
      fixture.expected_first_violation.event_id,
      entry.first_violation_event_id,
    );
  }

  const tampered = structuredClone(fixtures[0]);
  tampered.seed.events[0].payload.presence.reason = 'tampered';
  assert.throws(
    () => upgradeTraceFixture(tampered),
    /TRACE\.FIXTURE\.HASH_MISMATCH/,
  );
  const provenanceTampered = structuredClone(fixtures[0]);
  provenanceTampered.minimization.source_scenario = 'different-provenance';
  assert.throws(
    () => upgradeTraceFixture(provenanceTampered),
    /TRACE\.FIXTURE\.HASH_MISMATCH/,
  );
  const schemaInvalid = structuredClone(fixtures[0]);
  schemaInvalid.seed.events[0].sequence_id = 0;
  assert.throws(() => assertLocalSchema(schemaInvalid, schema), /schema .* mismatch/);
});

test('serialize deserialize round-trip preserves hash, violation, and production replay', async () => {
  const fixtures = await loadTraceFixtures(FIXTURE_DIRECTORY);
  for (const fixture of fixtures) {
    const serialized = serializeTraceFixture(fixture);
    const restored = deserializeTraceFixture(serialized);
    assert.equal(serializeTraceFixture(restored), serialized, `${fixture.name} bytes`);
    assert.equal(restored.canonical_hash, fixture.canonical_hash);
    assert.deepEqual(
      traceSemanticProjection(restored),
      traceSemanticProjection(fixture),
      `${fixture.name} semantics`,
    );
    const events = resolveMinimalTrace(restored);
    assert.equal(sameFailure(restored, events), true, `${fixture.name} oracle replay`);
    assert.equal(await productionViolation(restored), null, `${fixture.name} production replay`);
  }
});

test('schema v1 upgrade is idempotent and changes no trace semantics', async () => {
  const fixtures = await loadTraceFixtures(FIXTURE_DIRECTORY);
  const fixturesByName = new Map(fixtures.map((fixture) => [fixture.name, fixture]));
  const legacyFiles = (await readdir(LEGACY_V1_DIRECTORY))
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.equal(legacyFiles.length, fixtures.length);
  for (const legacyFile of legacyFiles) {
    const legacy = JSON.parse(
      await readFile(new URL(legacyFile, LEGACY_V1_DIRECTORY), 'utf8'),
    );
    const fixture = fixturesByName.get(legacy.name);
    assert.ok(fixture, `missing current fixture for ${legacy.name}`);
    const upgraded = upgradeTraceFixture(legacy);
    const upgradedAgain = upgradeTraceFixture(upgraded);
    assert.equal(upgraded.schema_version, TRACE_SCHEMA_VERSION);
    assert.equal(upgraded.canonical_hash, fixture.canonical_hash);
    assert.deepEqual(
      traceSemanticProjection(upgraded),
      traceSemanticProjection(fixture),
      `${fixture.name} upgraded semantics`,
    );
    assert.deepEqual(upgradedAgain, upgraded, `${fixture.name} idempotent upgrade`);
    assert.equal(
      sameFailure(upgraded, resolveMinimalTrace(upgraded)),
      true,
      `${fixture.name} upgraded oracle replay`,
    );
    assert.equal(
      await productionViolation(upgraded),
      null,
      `${fixture.name} upgraded production replay`,
    );
  }
});

test('canonical JSON ignores object key order but preserves event order', () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
  );
  assert.notEqual(
    canonicalJson({ events: ['first', 'second'] }),
    canonicalJson({ events: ['second', 'first'] }),
  );
  assert.equal(canonicalJson({ value: -0 }), canonicalJson({ value: 0 }));
  assert.notEqual(canonicalJson({ value: 10 }), canonicalJson({ value: '10' }));
  assert.notEqual(canonicalJson('\u00e9'), canonicalJson('e\u0301'));
  assert.equal(JSON.parse(canonicalJson('Birdie \ud83d\udc26')), 'Birdie \ud83d\udc26');
  assert.throws(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1), /SAFE_INTEGER/);
  assert.throws(() => canonicalJson(Number.NaN), /SAFE_INTEGER/);
  assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), /SAFE_INTEGER/);
  assert.throws(() => canonicalJson('\ud800'), /UNPAIRED_SURROGATE/);
  const decoratedArray = [1];
  decoratedArray.meta = 2;
  assert.throws(() => canonicalJson(decoratedArray), /ARRAY_PROPERTY/);
  assert.throws(() => canonicalJson({ [Symbol('hidden')]: 1 }), /OBJECT_PROPERTY/);
});
