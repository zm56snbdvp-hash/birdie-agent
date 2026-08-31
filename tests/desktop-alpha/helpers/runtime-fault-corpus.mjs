import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export const TRACE_SCHEMA_VERSION = '2.0';
export const MANIFEST_SCHEMA_VERSION = '1.0';
export const TRACE_SCHEMA_ID = 'urn:birdie:schema:desktop-runtime-fault-trace:2.0';
export const CORPUS_ID = 'birdie-desktop-runtime-fault-regressions';
export const HASH_ALGORITHM = 'sha256';
export const CANONICALIZATION_ID = 'birdie-canonical-json-safe-integers/v1';
export const HASH_PROFILE_ID = 'birdie.desktop.runtime-fault-hash/v1';
export const TRACE_SCHEMA_CANONICAL_HASH = 'sha256:d4af35e7ac420a2930ed36a3e132b1e7b639d59b871d8c58ac5f98da87b3bfb4';

const TRACE_HASH_DOMAIN = 'birdie.desktop.runtime-fault-fixture\0v1\0';
const MANIFEST_HASH_DOMAIN = 'birdie.desktop.runtime-fault-corpus\0v1\0';
const SCHEMA_HASH_DOMAIN = 'birdie.desktop.runtime-fault-schema\0v1\0';
const LOCAL_TRACE_SCHEMA_URL = new URL(
  '../schemas/runtime-fault-trace-v2.schema.json',
  import.meta.url,
);
const TRACE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LIFECYCLES = new Set(['STARTING', 'READY', 'DEGRADED']);
const PRESENCE_STATES = new Set([
  'OFFLINE',
  'IDLE',
  'SPEECH_DETECTED',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'ERROR',
]);
const MICROPHONE_STATES = new Set([
  'UNKNOWN',
  'ENABLED',
  'DISABLED',
  'UNAVAILABLE',
]);
const BRAIN_STATES = new Set(['UNKNOWN', 'READY', 'DISABLED', 'ERROR']);
const UI_TRANSITIONS = new Set(['CONNECTING', 'READY', 'OFFLINE', 'ERROR']);
const FAULT_CLASSES = new Set([
  'duplicate',
  'out-of-order',
  'reconnect-race',
  'stale-snapshot',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertUnicodeScalarString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`CORPUS.CANONICAL_UNPAIRED_SURROGATE:${path}`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`CORPUS.CANONICAL_UNPAIRED_SURROGATE:${path}`);
    }
  }
}

function canonicalValue(value, path, ancestors) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`CORPUS.CANONICAL_SAFE_INTEGER_REQUIRED:${path}`);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`CORPUS.CANONICAL_JSON_VALUE_REQUIRED:${path}`);
  }
  if (ancestors.has(value)) {
    throw new Error(`CORPUS.CANONICAL_CYCLE:${path}`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const allowedKeys = new Set([
        'length',
        ...Array.from({ length: value.length }, (_entry, index) => String(index)),
      ]);
      if (
        Reflect.ownKeys(value).some((key) => (
          typeof key !== 'string' || !allowedKeys.has(key)
        ))
      ) {
        throw new Error(`CORPUS.CANONICAL_ARRAY_PROPERTY:${path}`);
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new Error(`CORPUS.CANONICAL_SPARSE_ARRAY:${path}[${index}]`);
        }
      }
      return `[${value
        .map((entry, index) => canonicalValue(entry, `${path}[${index}]`, ancestors))
        .join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`CORPUS.CANONICAL_PLAIN_OBJECT_REQUIRED:${path}`);
    }
    if (
      Reflect.ownKeys(value).some((key) => (
        typeof key !== 'string'
        || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
      ))
    ) {
      throw new Error(`CORPUS.CANONICAL_OBJECT_PROPERTY:${path}`);
    }
    const entries = Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) {
        throw new Error(`CORPUS.CANONICAL_UNDEFINED:${path}.${key}`);
      }
      assertUnicodeScalarString(key, `${path}.<key>`);
      return `${JSON.stringify(key)}:${canonicalValue(value[key], `${path}.${key}`, ancestors)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value) {
  return canonicalValue(value, '$', new Set());
}

function hashCanonicalProjection(domain, value) {
  return `${HASH_ALGORITHM}:${createHash(HASH_ALGORITHM)
    .update(domain, 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex')}`;
}

export function computeTraceSchemaCanonicalHash(schema) {
  return hashCanonicalProjection(SCHEMA_HASH_DOMAIN, schema);
}

function assertExactKeys(value, expected, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`TRACE.FIXTURE.OBJECT_REQUIRED:${path}`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`TRACE.FIXTURE.PLAIN_OBJECT_REQUIRED:${path}`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => (
    typeof key !== 'string'
    || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
  ))) {
    throw new Error(`TRACE.FIXTURE.KEYS_MISMATCH:${path}`);
  }
  const actual = ownKeys.sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new Error(`TRACE.FIXTURE.KEYS_MISMATCH:${path}`);
  }
}

function assertSafeInteger(value, path, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`TRACE.FIXTURE.INVALID_INTEGER:${path}`);
  }
}

function validateSnapshot(value, path) {
  assertExactKeys(
    value,
    ['bridgeRevision', 'lifecycle', 'presence', 'microphoneState', 'brainState'],
    path,
  );
  assertSafeInteger(value.bridgeRevision, `${path}.bridgeRevision`);
  if (!LIFECYCLES.has(value.lifecycle)) {
    throw new Error(`TRACE.FIXTURE.INVALID_LIFECYCLE:${path}`);
  }
  assertExactKeys(value.presence, ['revision', 'state', 'reason'], `${path}.presence`);
  assertSafeInteger(value.presence.revision, `${path}.presence.revision`);
  if (
    !PRESENCE_STATES.has(value.presence.state)
    || typeof value.presence.reason !== 'string'
  ) {
    throw new Error(`TRACE.FIXTURE.INVALID_PRESENCE:${path}`);
  }
  if (!MICROPHONE_STATES.has(value.microphoneState)) {
    throw new Error(`TRACE.FIXTURE.INVALID_MICROPHONE:${path}`);
  }
  if (!BRAIN_STATES.has(value.brainState)) {
    throw new Error(`TRACE.FIXTURE.INVALID_BRAIN:${path}`);
  }
}

function derivedSeedId(name) {
  return `seed.${name}.v1`;
}

function derivedEventId(name, sequenceId) {
  return `event.${name}.${String(sequenceId).padStart(3, '0')}`;
}

function snapshot({
  bridgeRevision,
  lifecycle = 'READY',
  presenceRevision = 4,
  presenceState = 'IDLE',
  microphoneState = 'ENABLED',
} = {}) {
  return {
    bridgeRevision,
    lifecycle,
    presence: {
      revision: presenceRevision,
      state: presenceState,
      reason: 'trace-minimizer',
    },
    microphoneState,
    brainState: 'READY',
  };
}

const READY_10 = snapshot({ bridgeRevision: 10 });
const READY_11 = snapshot({ bridgeRevision: 11, presenceRevision: 5 });
const READY_12 = snapshot({ bridgeRevision: 12, presenceRevision: 5 });
const OFFLINE_8 = snapshot({
  bridgeRevision: 8,
  lifecycle: 'DEGRADED',
  presenceState: 'OFFLINE',
  microphoneState: 'UNAVAILABLE',
});
const OFFLINE_9 = { ...cloneJson(OFFLINE_8), bridgeRevision: 9 };
const OFFLINE_10 = { ...cloneJson(OFFLINE_8), bridgeRevision: 10 };
const OFFLINE_11 = { ...cloneJson(OFFLINE_8), bridgeRevision: 11 };

const LEGACY_V1_SEEDS = deepFreeze({
  'desktop-duplicate-revision-conflict': [
    { kind: 'snapshot', payload: OFFLINE_9 },
    { kind: 'snapshot', payload: READY_10 },
    { kind: 'snapshot', payload: OFFLINE_10 },
    { kind: 'snapshot', payload: READY_11 },
  ],
  'desktop-out-of-order-snapshot': [
    { kind: 'snapshot', payload: READY_10 },
    { kind: 'snapshot', payload: READY_12 },
    { kind: 'snapshot', payload: READY_12 },
    { kind: 'snapshot', payload: OFFLINE_11 },
  ],
  'desktop-reconnect-race': [
    { kind: 'snapshot', payload: READY_10 },
    { kind: 'connected', snapshot_response: READY_10 },
    { kind: 'snapshot', payload: READY_10 },
  ],
  'desktop-stale-snapshot': [
    { kind: 'snapshot', payload: READY_10 },
    { kind: 'snapshot', payload: OFFLINE_9 },
    { kind: 'snapshot', payload: READY_10 },
  ],
});

function wrapSeedEvents(name, events) {
  return events.map((event, index) => ({
    event_id: derivedEventId(name, index + 1),
    sequence_id: index + 1,
    ...cloneJson(event),
  }));
}

function validateLegacyV1(legacy) {
  assertExactKeys(
    legacy,
    [
      'schema_version',
      'name',
      'system',
      'fault_class',
      'initial_state',
      'events',
      'oracle',
      'minimization',
    ],
    '$',
  );
  if (legacy.schema_version !== '1.0' || !TRACE_NAME_PATTERN.test(legacy.name ?? '')) {
    throw new Error('TRACE.UPGRADE.LEGACY_V1_REQUIRED');
  }
  assertExactKeys(legacy.initial_state, ['snapshot'], 'initial_state');
  validateSnapshot(legacy.initial_state.snapshot, 'initial_state.snapshot');
  if (!Array.isArray(legacy.events) || legacy.events.length === 0) {
    throw new Error('TRACE.UPGRADE.EVENTS_REQUIRED');
  }
  assertExactKeys(
    legacy.oracle,
    [
      'invariant_id',
      'event_kind',
      'first_violation_event',
      'expected_transitions',
      'fault_model_transitions',
    ],
    'oracle',
  );
  assertSafeInteger(legacy.oracle.first_violation_event, 'oracle.first_violation_event', {
    minimum: 1,
  });
  if (legacy.oracle.first_violation_event > legacy.events.length) {
    throw new Error('TRACE.UPGRADE.INVALID_FIRST_VIOLATION');
  }
  assertExactKeys(
    legacy.minimization,
    [
      'source_scenario',
      'original_event_count',
      'minimal_event_count',
      'source_event_indices',
    ],
    'minimization',
  );
  return legacy;
}

function traceSemanticProjectionCurrent(fixture) {
  return {
    semantic_contract: 'birdie.desktop.runtime-fault-semantics.v1',
    trace_id: fixture.name,
    system: fixture.system,
    fault_class: fixture.fault_class,
    initial_state: cloneJson(fixture.initial_state),
    seed: cloneJson(fixture.seed),
    minimal_trace_event_ids: cloneJson(fixture.minimal_trace.event_ids),
    expected_first_violation: cloneJson(fixture.expected_first_violation),
    minimization: cloneJson(fixture.minimization),
  };
}

function hashTraceCurrent(fixture) {
  return hashCanonicalProjection(
    TRACE_HASH_DOMAIN,
    traceSemanticProjectionCurrent(fixture),
  );
}

function upgradeLegacyV1(legacyInput) {
  validateLegacyV1(legacyInput);
  const legacy = cloneJson(legacyInput);
  const legacySeed = LEGACY_V1_SEEDS[legacy.name];
  if (!legacySeed || legacySeed.length !== legacy.minimization.original_event_count) {
    throw new Error(`TRACE.UPGRADE.SEED_MISSING:${legacy.name}`);
  }
  if (
    legacy.events.length !== legacy.minimization.minimal_event_count
    || legacy.events.length !== legacy.minimization.source_event_indices.length
  ) {
    throw new Error('TRACE.UPGRADE.MINIMIZATION_MISMATCH');
  }
  for (const [index, minimalEvent] of legacy.events.entries()) {
    const sourceIndex = legacy.minimization.source_event_indices[index];
    assertSafeInteger(sourceIndex, `minimization.source_event_indices[${index}]`, {
      minimum: 1,
    });
    if (
      sourceIndex > legacySeed.length
      || canonicalJson(legacySeed[sourceIndex - 1]) !== canonicalJson(minimalEvent)
    ) {
      throw new Error(`TRACE.UPGRADE.SEED_EVENT_MISMATCH:${legacy.name}:${sourceIndex}`);
    }
  }

  const seedEvents = wrapSeedEvents(legacy.name, legacySeed);
  const minimalEventIds = legacy.minimization.source_event_indices
    .map((sequenceId) => derivedEventId(legacy.name, sequenceId));
  const traceIndex = legacy.oracle.first_violation_event;
  const violationEventId = minimalEventIds[traceIndex - 1];
  const violationEvent = seedEvents.find(({ event_id: eventId }) => (
    eventId === violationEventId
  ));
  const current = {
    schema_version: TRACE_SCHEMA_VERSION,
    name: legacy.name,
    system: legacy.system,
    fault_class: legacy.fault_class,
    initial_state: cloneJson(legacy.initial_state),
    seed: {
      seed_id: derivedSeedId(legacy.name),
      events: seedEvents,
    },
    minimal_trace: {
      event_ids: minimalEventIds,
    },
    expected_first_violation: {
      invariant_id: legacy.oracle.invariant_id,
      event_id: violationEvent.event_id,
      sequence_id: violationEvent.sequence_id,
      trace_index: traceIndex,
      event_kind: legacy.oracle.event_kind,
      expected_transitions: cloneJson(legacy.oracle.expected_transitions),
      fault_model_transitions: cloneJson(legacy.oracle.fault_model_transitions),
    },
    minimization: cloneJson(legacy.minimization),
  };
  current.canonical_hash = hashTraceCurrent(current);
  return current;
}

function validateSeedEvent(event, fixtureName, index) {
  const path = `seed.events[${index}]`;
  const sequenceId = index + 1;
  if (
    event?.sequence_id !== sequenceId
    || event.event_id !== derivedEventId(fixtureName, sequenceId)
    || !STABLE_ID_PATTERN.test(event.event_id)
  ) {
    throw new Error(`TRACE.FIXTURE.INVALID_EVENT_ID:${path}`);
  }
  if (event.kind === 'snapshot') {
    assertExactKeys(event, ['event_id', 'sequence_id', 'kind', 'payload'], path);
    validateSnapshot(event.payload, `${path}.payload`);
  } else if (event.kind === 'connected') {
    assertExactKeys(event, ['event_id', 'sequence_id', 'kind', 'snapshot_response'], path);
    validateSnapshot(event.snapshot_response, `${path}.snapshot_response`);
  } else {
    throw new Error(`TRACE.FIXTURE.UNSUPPORTED_EVENT:${event?.kind}`);
  }
}

function validateCurrentTraceFixture(fixture, { verifyHash = true } = {}) {
  assertExactKeys(
    fixture,
    [
      'schema_version',
      'name',
      'system',
      'fault_class',
      'initial_state',
      'seed',
      'minimal_trace',
      'expected_first_violation',
      'minimization',
      'canonical_hash',
    ],
    '$',
  );
  if (fixture.schema_version !== TRACE_SCHEMA_VERSION) {
    throw new Error(`TRACE.FIXTURE.UNSUPPORTED_SCHEMA:${fixture.schema_version}`);
  }
  if (!TRACE_NAME_PATTERN.test(fixture.name ?? '')) {
    throw new Error(`TRACE.FIXTURE.INVALID_NAME:${fixture.name}`);
  }
  if (fixture.system !== 'desktop-runtime-bridge') {
    throw new Error(`TRACE.FIXTURE.UNSUPPORTED_SYSTEM:${fixture.system}`);
  }
  if (!FAULT_CLASSES.has(fixture.fault_class)) {
    throw new Error(`TRACE.FIXTURE.UNSUPPORTED_FAULT:${fixture.fault_class}`);
  }
  assertExactKeys(fixture.initial_state, ['snapshot'], 'initial_state');
  validateSnapshot(fixture.initial_state.snapshot, 'initial_state.snapshot');

  assertExactKeys(fixture.seed, ['seed_id', 'events'], 'seed');
  if (
    fixture.seed.seed_id !== derivedSeedId(fixture.name)
    || !STABLE_ID_PATTERN.test(fixture.seed.seed_id)
    || !Array.isArray(fixture.seed.events)
    || fixture.seed.events.length === 0
  ) {
    throw new Error('TRACE.FIXTURE.INVALID_SEED');
  }
  fixture.seed.events.forEach((event, index) => (
    validateSeedEvent(event, fixture.name, index)
  ));

  assertExactKeys(fixture.minimal_trace, ['event_ids'], 'minimal_trace');
  if (
    !Array.isArray(fixture.minimal_trace.event_ids)
    || fixture.minimal_trace.event_ids.length === 0
    || new Set(fixture.minimal_trace.event_ids).size
      !== fixture.minimal_trace.event_ids.length
  ) {
    throw new Error('TRACE.FIXTURE.INVALID_MINIMAL_TRACE');
  }
  const eventsById = new Map(
    fixture.seed.events.map((event) => [event.event_id, event]),
  );
  let previousSequence = 0;
  for (const eventId of fixture.minimal_trace.event_ids) {
    const event = eventsById.get(eventId);
    if (!event || event.sequence_id <= previousSequence) {
      throw new Error('TRACE.FIXTURE.INVALID_MINIMAL_EVENT_ID');
    }
    previousSequence = event.sequence_id;
  }

  const first = fixture.expected_first_violation;
  assertExactKeys(
    first,
    [
      'invariant_id',
      'event_id',
      'sequence_id',
      'trace_index',
      'event_kind',
      'expected_transitions',
      'fault_model_transitions',
    ],
    'expected_first_violation',
  );
  const violationEvent = eventsById.get(first.event_id);
  if (
    !/^[A-Z][A-Z0-9_.]+$/.test(first.invariant_id ?? '')
    || !violationEvent
    || first.sequence_id !== violationEvent.sequence_id
    || first.event_kind !== violationEvent.kind
    || !Number.isSafeInteger(first.trace_index)
    || first.trace_index < 1
    || first.trace_index > fixture.minimal_trace.event_ids.length
    || fixture.minimal_trace.event_ids[first.trace_index - 1] !== first.event_id
    || !Array.isArray(first.expected_transitions)
    || !Array.isArray(first.fault_model_transitions)
  ) {
    throw new Error('TRACE.FIXTURE.INVALID_FIRST_VIOLATION');
  }
  if (
    [...first.expected_transitions, ...first.fault_model_transitions]
      .some((transition) => !UI_TRANSITIONS.has(transition))
    || canonicalJson(first.expected_transitions)
      === canonicalJson(first.fault_model_transitions)
  ) {
    throw new Error('TRACE.FIXTURE.INVALID_ORACLE_TRANSITIONS');
  }

  assertExactKeys(
    fixture.minimization,
    [
      'source_scenario',
      'original_event_count',
      'minimal_event_count',
      'source_event_indices',
    ],
    'minimization',
  );
  const minimization = fixture.minimization;
  if (
    typeof minimization.source_scenario !== 'string'
    || minimization.source_scenario.length === 0
    || minimization.original_event_count !== fixture.seed.events.length
    || minimization.minimal_event_count !== fixture.minimal_trace.event_ids.length
    || !Array.isArray(minimization.source_event_indices)
    || minimization.source_event_indices.length
      !== fixture.minimal_trace.event_ids.length
  ) {
    throw new Error('TRACE.FIXTURE.INVALID_MINIMIZATION');
  }
  const selectedSequences = fixture.minimal_trace.event_ids
    .map((eventId) => eventsById.get(eventId).sequence_id);
  if (canonicalJson(selectedSequences) !== canonicalJson(minimization.source_event_indices)) {
    throw new Error('TRACE.FIXTURE.MINIMIZATION_PROVENANCE_MISMATCH');
  }

  const expectedHash = hashTraceCurrent(fixture);
  if (!HASH_PATTERN.test(fixture.canonical_hash ?? '')) {
    throw new Error('TRACE.FIXTURE.INVALID_HASH');
  }
  if (verifyHash && fixture.canonical_hash !== expectedHash) {
    throw new Error(`TRACE.FIXTURE.HASH_MISMATCH:${fixture.name}`);
  }
  return fixture;
}

export function upgradeTraceFixture(input) {
  if (input?.schema_version === '1.0') {
    const upgraded = upgradeLegacyV1(input);
    return validateCurrentTraceFixture(upgraded);
  }
  validateCurrentTraceFixture(input);
  return cloneJson(input);
}

export function validateTraceFixture(fixture) {
  return upgradeTraceFixture(fixture);
}

export function traceSemanticProjection(fixture) {
  return traceSemanticProjectionCurrent(upgradeTraceFixture(fixture));
}

export function computeTraceCanonicalHash(fixture) {
  if (fixture?.schema_version === '1.0') {
    return hashTraceCurrent(upgradeLegacyV1(fixture));
  }
  validateCurrentTraceFixture(fixture, { verifyHash: false });
  return hashTraceCurrent(fixture);
}

export function resolveMinimalTrace(fixture) {
  const current = upgradeTraceFixture(fixture);
  const byId = new Map(current.seed.events.map((event) => [event.event_id, event]));
  return current.minimal_trace.event_ids.map((eventId) => cloneJson(byId.get(eventId)));
}

export function serializeTraceFixture(fixture) {
  return `${canonicalJson(upgradeTraceFixture(fixture))}\n`;
}

export function deserializeTraceFixture(serialized) {
  if (typeof serialized !== 'string') {
    throw new TypeError('TRACE.FIXTURE.SERIALIZED_STRING_REQUIRED');
  }
  return upgradeTraceFixture(JSON.parse(serialized));
}

function manifestSemanticProjection(manifest) {
  return {
    manifest_schema_version: manifest.manifest_schema_version,
    corpus_id: manifest.corpus_id,
    corpus_schema_version: manifest.corpus_schema_version,
    trace_schema: manifest.trace_schema,
    trace_schema_hash: manifest.trace_schema_hash,
    canonicalization_id: manifest.canonicalization_id,
    hash_profile: manifest.hash_profile,
    hash_algorithm: manifest.hash_algorithm,
    fixture_count: manifest.fixture_count,
    fixtures: cloneJson(manifest.fixtures),
  };
}

export function computeManifestCanonicalHash(manifest) {
  return hashCanonicalProjection(
    MANIFEST_HASH_DOMAIN,
    manifestSemanticProjection(manifest),
  );
}

export function createCorpusManifest(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('TRACE.MANIFEST.ENTRIES_REQUIRED');
  }
  const fixtures = entries
    .map(({ file, fixture }) => {
      const current = upgradeTraceFixture(fixture);
      return {
        file,
        name: current.name,
        schema_version: current.schema_version,
        seed_id: current.seed.seed_id,
        seed_event_count: current.seed.events.length,
        minimal_event_count: current.minimal_trace.event_ids.length,
        first_violation_event_id: current.expected_first_violation.event_id,
        canonical_hash: current.canonical_hash,
      };
    })
    .sort((left, right) => (
      left.file === right.file ? 0 : left.file < right.file ? -1 : 1
    ));
  const manifest = {
    manifest_schema_version: MANIFEST_SCHEMA_VERSION,
    corpus_id: CORPUS_ID,
    corpus_schema_version: TRACE_SCHEMA_VERSION,
    trace_schema: TRACE_SCHEMA_ID,
    trace_schema_hash: TRACE_SCHEMA_CANONICAL_HASH,
    canonicalization_id: CANONICALIZATION_ID,
    hash_profile: HASH_PROFILE_ID,
    hash_algorithm: HASH_ALGORITHM,
    fixture_count: fixtures.length,
    fixtures,
  };
  manifest.canonical_hash = computeManifestCanonicalHash(manifest);
  return validateCorpusManifest(manifest);
}

export function validateCorpusManifest(manifest) {
  assertExactKeys(
    manifest,
    [
      'manifest_schema_version',
      'corpus_id',
      'corpus_schema_version',
      'trace_schema',
      'trace_schema_hash',
      'canonicalization_id',
      'hash_profile',
      'hash_algorithm',
      'fixture_count',
      'fixtures',
      'canonical_hash',
    ],
    '$manifest',
  );
  if (
    manifest.manifest_schema_version !== MANIFEST_SCHEMA_VERSION
    || manifest.corpus_id !== CORPUS_ID
    || manifest.corpus_schema_version !== TRACE_SCHEMA_VERSION
    || manifest.trace_schema !== TRACE_SCHEMA_ID
    || manifest.trace_schema_hash !== TRACE_SCHEMA_CANONICAL_HASH
    || manifest.canonicalization_id !== CANONICALIZATION_ID
    || manifest.hash_profile !== HASH_PROFILE_ID
    || manifest.hash_algorithm !== HASH_ALGORITHM
    || !Number.isSafeInteger(manifest.fixture_count)
    || manifest.fixture_count < 1
    || !Array.isArray(manifest.fixtures)
    || manifest.fixtures.length !== manifest.fixture_count
  ) {
    throw new Error('TRACE.MANIFEST.INVALID_HEADER');
  }
  const names = new Set();
  const files = new Set();
  let previousFile = '';
  for (const entry of manifest.fixtures) {
    assertExactKeys(
      entry,
      [
        'file',
        'name',
        'schema_version',
        'seed_id',
        'seed_event_count',
        'minimal_event_count',
        'first_violation_event_id',
        'canonical_hash',
      ],
      '$manifest.fixtures[]',
    );
    if (
      !TRACE_NAME_PATTERN.test(entry.name ?? '')
      || !/^\d{2}-[a-z0-9-]+\.json$/.test(entry.file ?? '')
      || entry.file.replace(/^\d{2}-/, '').replace(/\.json$/, '') !== entry.name
      || entry.file <= previousFile
      || names.has(entry.name)
      || files.has(entry.file)
      || entry.schema_version !== TRACE_SCHEMA_VERSION
      || !STABLE_ID_PATTERN.test(entry.seed_id ?? '')
      || !STABLE_ID_PATTERN.test(entry.first_violation_event_id ?? '')
      || !Number.isSafeInteger(entry.seed_event_count)
      || entry.seed_event_count < 1
      || !Number.isSafeInteger(entry.minimal_event_count)
      || entry.minimal_event_count < 1
      || entry.minimal_event_count > entry.seed_event_count
      || !HASH_PATTERN.test(entry.canonical_hash ?? '')
    ) {
      throw new Error('TRACE.MANIFEST.INVALID_ENTRY');
    }
    names.add(entry.name);
    files.add(entry.file);
    previousFile = entry.file;
  }
  const expectedHash = computeManifestCanonicalHash(manifest);
  if (!HASH_PATTERN.test(manifest.canonical_hash ?? '')) {
    throw new Error('TRACE.MANIFEST.INVALID_HASH');
  }
  if (manifest.canonical_hash !== expectedHash) {
    throw new Error('TRACE.MANIFEST.HASH_MISMATCH');
  }
  return manifest;
}

export function serializeCorpusManifest(manifest) {
  return `${canonicalJson(validateCorpusManifest(manifest))}\n`;
}

export async function loadTraceCorpus(directoryUrl) {
  const traceSchema = JSON.parse(await readFile(LOCAL_TRACE_SCHEMA_URL, 'utf8'));
  if (
    traceSchema.$id !== TRACE_SCHEMA_ID
    || computeTraceSchemaCanonicalHash(traceSchema) !== TRACE_SCHEMA_CANONICAL_HASH
  ) {
    throw new Error('TRACE.MANIFEST.SCHEMA_HASH_MISMATCH');
  }
  const manifest = validateCorpusManifest(
    JSON.parse(await readFile(new URL('manifest.json', directoryUrl), 'utf8')),
  );
  const diskFiles = (await readdir(directoryUrl))
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .sort();
  const manifestFiles = manifest.fixtures.map(({ file }) => file);
  if (canonicalJson(diskFiles) !== canonicalJson(manifestFiles)) {
    throw new Error('TRACE.MANIFEST.FILE_SET_MISMATCH');
  }

  const fixtures = [];
  for (const entry of manifest.fixtures) {
    const fixture = deserializeTraceFixture(
      await readFile(new URL(entry.file, directoryUrl), 'utf8'),
    );
    if (
      fixture.name !== entry.name
      || fixture.schema_version !== entry.schema_version
      || fixture.seed.seed_id !== entry.seed_id
      || fixture.seed.events.length !== entry.seed_event_count
      || fixture.minimal_trace.event_ids.length !== entry.minimal_event_count
      || fixture.expected_first_violation.event_id
        !== entry.first_violation_event_id
      || fixture.canonical_hash !== entry.canonical_hash
    ) {
      throw new Error(`TRACE.MANIFEST.FIXTURE_MISMATCH:${entry.file}`);
    }
    fixtures.push(fixture);
  }
  return { manifest, fixtures };
}

export async function loadTraceFixtures(directoryUrl) {
  return (await loadTraceCorpus(directoryUrl)).fixtures;
}
