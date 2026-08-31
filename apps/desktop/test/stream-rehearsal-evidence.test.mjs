import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareRehearsalPerformance,
  createStreamRehearsalReport,
  createSyntheticMarkerObservations,
  evaluateMarkerObservations,
  validateRehearsalShowPlan,
} from '../src/stream-rehearsal-evidence.js';
import {
  extractGeneralRehearsalPerformance,
  extractGeneralRehearsalReference,
  extractLaunchConsolePerformance,
  runStreamRehearsalEvidence,
} from '../../../scripts/run-birdie-stream-rehearsal-evidence.mjs';

const repositoryRoot = new URL('../../..', import.meta.url);

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repositoryRoot), 'utf8'));
}

function performance(overrides = {}) {
  return {
    sourceEvidenceId: 'fixture',
    measurementMode: 'REAL_BROWSER',
    timeline: 'SHOW_15',
    producer: 'OBS_BROWSER_SOURCE',
    sourceOwner: 'OBS_BROWSER_SOURCE',
    comparisonFingerprintSha256: 'a'.repeat(64),
    quietHostStatus: 'PASS',
    durationMs: 900_000,
    firstFrameMs: 200,
    fpsP10: 29,
    p95FrameMs: 40,
    maxFrameGapMs: 90,
    errorCount: 0,
    renderer: 'WEBGL',
    viewport: { width: 1920, height: 1080 },
    ...overrides,
  };
}

test('canonical show fixture covers exactly 15 minutes and every required cue family', async () => {
  const plan = await json('ops/stream/birdie-stream-show-15min.json');
  const result = validateRehearsalShowPlan(plan);
  assert.equal(result.status, 'PASS');
  assert.equal(plan.durationMs, 900_000);
  assert.deepEqual(plan.segments.map(({ role }) => role), [
    'HOOK', 'SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3', 'CTA', 'CLOSE',
  ]);
  assert.equal(plan.segments.every((segment, index) => index === 0 || plan.segments[index - 1].endMs === segment.startMs), true);
  assert.equal(new Set(plan.markers.map(({ id }) => id)).size, plan.markers.length);
  assert.equal(plan.markers.every((marker, index) => index === 0 || plan.markers[index - 1].atMs < marker.atMs), true);
  assert.deepEqual(new Set(plan.markers.map(({ kind }) => kind)), new Set([
    'SCENE', 'AUDIO', 'VOICE', 'CTA', 'CLIP', 'FALLBACK', 'OPERATOR',
  ]));
  assert.equal(plan.markers.filter(({ kind }) => kind === 'FALLBACK').length, 7);
  assert.equal(plan.clips.length, 5);
});

test('audio, voice, and CTA plan claims are bound to silent, synthetic, and draft fixtures', async () => {
  const canonical = await json('ops/stream/birdie-stream-show-15min.json');
  for (const [kind, fixture, gateId, reasonId] of [
    ['AUDIO', 'audio:mic-live', 'audio-fixtures', 'SHOW_AUDIO_FIXTURE_NOT_SILENT'],
    ['VOICE', 'voice:microphone-live', 'voice-fixtures', 'SHOW_VOICE_FIXTURE_NOT_SYNTHETIC'],
    ['CTA', 'cta:production-ready', 'cta-fixtures', 'SHOW_CTA_FIXTURE_NOT_DRAFT'],
  ]) {
    const plan = structuredClone(canonical);
    plan.markers.find((marker) => marker.kind === kind).fixture = fixture;
    const result = validateRehearsalShowPlan(plan);
    assert.equal(result.status, 'STOP');
    const failedGate = result.gates.find((gate) => gate.id === gateId);
    assert.equal(failedGate.status, 'STOP');
    assert.equal(failedGate.reasonId, reasonId);
    const report = createStreamRehearsalReport({
      plan,
      observations: createSyntheticMarkerObservations(plan),
      currentPerformance: performance(),
      baselinePerformance: performance({ measurementMode: 'BASELINE_REPLAY' }),
    });
    if (kind === 'AUDIO') assert.equal(report.checks.audio.plannedCaptureContract, 'STOP');
    if (kind === 'VOICE') assert.equal(report.checks.voice.syntheticUiMarkers, 'STOP');
    if (kind === 'CTA') assert.equal(report.checks.cta.draftVisibility, 'STOP');
  }
});

test('synthetic marker replay is deterministic, bounded, and never claims real-time duration', async () => {
  const plan = await json('ops/stream/birdie-stream-show-15min.json');
  const first = createSyntheticMarkerObservations(plan, { seed: 20_260_830 });
  const second = createSyntheticMarkerObservations(plan, { seed: 20_260_830 });
  assert.deepEqual(first, second);
  assert.equal(first.every(({ source }) => source === 'SYNTHETIC_FIXTURE'), true);
  const result = evaluateMarkerObservations(plan, first, { clockMode: 'SIMULATED' });
  assert.equal(result.contractReplayVerdict, 'PASS');
  assert.equal(result.realtimeDurationEvidence, 'UNKNOWN');
  assert.equal(result.trace.length, plan.markers.length);
  assert.deepEqual(result.trace, first);
  assert.equal(result.timing.maximumAbsoluteDriftMs <= 250, true);
  assert.equal(result.timing.observedRealtimeDurationMs, null);
});

test('marker replay fails closed on a missing marker or excessive drift', async () => {
  const plan = await json('ops/stream/birdie-stream-show-15min.json');
  const missing = createSyntheticMarkerObservations(plan).slice(1);
  assert.equal(evaluateMarkerObservations(plan, missing).contractReplayVerdict, 'STOP');
  const drifted = structuredClone(createSyntheticMarkerObservations(plan));
  drifted[3].driftMs = 251;
  assert.equal(evaluateMarkerObservations(plan, drifted).contractReplayVerdict, 'STOP');
});

test('marker timing is bound to the canonical plan and REALTIME needs a monotonic witness', async () => {
  const plan = await json('ops/stream/birdie-stream-show-15min.json');
  const forged = structuredClone(createSyntheticMarkerObservations(plan));
  forged[2].plannedAtMs += 100;
  forged[2].observedAtMs += 100;
  assert.equal(evaluateMarkerObservations(plan, forged).contractReplayVerdict, 'STOP');

  const relabeled = structuredClone(createSyntheticMarkerObservations(plan));
  const relabeledResult = evaluateMarkerObservations(plan, relabeled, { clockMode: 'REALTIME' });
  assert.equal(relabeledResult.realtimeDurationEvidence, 'UNKNOWN');
  assert.equal(relabeledResult.realtimeWitnessConsistency, 'STOP');

  const realtime = structuredClone(createSyntheticMarkerObservations(plan));
  for (const entry of realtime) entry.source = 'REALTIME_CAPTURE';
  const proved = evaluateMarkerObservations(plan, realtime, {
    clockMode: 'REALTIME',
    realtimeWitness: { source: 'PERFORMANCE_NOW', durationMs: plan.durationMs },
  });
  assert.equal(proved.contractReplayVerdict, 'PASS');
  assert.equal(proved.realtimeWitnessConsistency, 'PASS');
  assert.equal(proved.realtimeDurationEvidence, 'UNKNOWN');
});

test('existing baseline and launch take remain strictly incomparable while current absolute gates pass', async () => {
  const [baselineEvidence, currentEvidence] = await Promise.all([
    json('ops/evidence/birdie-stream-general-rehearsal-20260830.json'),
    json('ops/evidence/birdie-stream-launch-console-20260830.json'),
  ]);
  const result = compareRehearsalPerformance(
    extractLaunchConsolePerformance(currentEvidence),
    extractGeneralRehearsalPerformance(baselineEvidence),
  );
  assert.equal(result.verdict, 'UNKNOWN');
  assert.equal(result.strictComparability, 'UNKNOWN');
  assert.equal(result.descriptiveMetricVerdict, 'PASS');
  assert.deepEqual(result.comparableMetrics, []);
  assert.equal(result.gates.find(({ id }) => id === 'duration-comparability').status, 'UNKNOWN');
  assert.equal(result.gates.find(({ id }) => id === 'timeline-comparability').status, 'UNKNOWN');
  assert.equal(result.gates.find(({ id }) => id === 'producer-comparability').status, 'UNKNOWN');
  assert.equal(result.gates.find(({ id }) => id === 'comparison-fingerprint').status, 'UNKNOWN');
  assert.deepEqual(result.current, assertCurrentPerformanceShape(currentEvidence));
});

function assertCurrentPerformanceShape(evidence) {
  const normalized = extractLaunchConsolePerformance(evidence);
  return {
    ...normalized,
    sourceEvidenceId: evidence.evidenceId,
    comparisonFingerprintSha256: null,
  };
}

test('matching fingerprints enable strict regression gates', () => {
  const current = performance();
  const baseline = performance({
    sourceEvidenceId: 'baseline',
    measurementMode: 'BASELINE_REPLAY',
    firstFrameMs: 230,
    fpsP10: 29.5,
    p95FrameMs: 42,
    maxFrameGapMs: 100,
  });
  const result = compareRehearsalPerformance(current, baseline);
  assert.equal(result.strictComparability, 'PASS');
  assert.equal(result.descriptiveMetricVerdict, 'PASS');
  assert.equal(result.verdict, 'PASS');
});

test('absolute current performance failures STOP even when baseline is incompatible', () => {
  const result = compareRehearsalPerformance(
    performance({ timeline: 'CLIP_30', fpsP10: 20 }),
    performance({ measurementMode: 'BASELINE_REPLAY', timeline: 'LOOP', producer: 'PARALLEL_LOCAL_BROWSER' }),
  );
  assert.equal(result.strictComparability, 'UNKNOWN');
  assert.equal(result.descriptiveMetricVerdict, 'STOP');
  assert.equal(result.verdict, 'STOP');
  assert.equal(result.gates.find(({ id }) => id === 'fps-p10').status, 'STOP');
});

test('baseline OBS, scene, and audio extraction preserves facts and explicit unknowns', async () => {
  const baseline = await json('ops/evidence/birdie-stream-general-rehearsal-20260830.json');
  const reference = extractGeneralRehearsalReference(baseline);
  assert.equal(reference.hostStatus, 'CONFOUNDED');
  assert.equal(reference.obs.renderLagPpm, 918);
  assert.equal(reference.obs.encodingSkippedPpm, 918);
  assert.equal(reference.obs.networkDroppedFramesLocal, 'NOT_APPLICABLE');
  assert.equal(reference.scenes.maximumNormalCueDriftMs, 252);
  assert.equal(reference.scenes.clip30HoldMs, 30_048);
  assert.equal(reference.scenes.clip60HoldMs, 60_019);
  assert.equal(reference.scenes.globalSafe, 'FAIL');
  assert.equal(reference.scenes.focusedSafe, 'PASS');
  assert.equal(reference.audio.captureGraphContract, 'PASS');
});

test('report keeps local pipeline PASS separate from evidence HOLD and live STOP', async () => {
  const [plan, baselineEvidence, currentEvidence] = await Promise.all([
    json('ops/stream/birdie-stream-show-15min.json'),
    json('ops/evidence/birdie-stream-general-rehearsal-20260830.json'),
    json('ops/evidence/birdie-stream-launch-console-20260830.json'),
  ]);
  const report = createStreamRehearsalReport({
    plan,
    observations: createSyntheticMarkerObservations(plan),
    currentPerformance: extractLaunchConsolePerformance(currentEvidence),
    baselinePerformance: extractGeneralRehearsalPerformance(baselineEvidence),
    baselineReference: extractGeneralRehearsalReference(baselineEvidence),
    liveDecision: 'STOP',
  });
  assert.deepEqual(report.decisions, {
    localPipeline: 'PASS',
    strictPerformanceRegression: 'UNKNOWN',
    descriptivePerformanceMetrics: 'PASS',
    evidenceCompleteness: 'HOLD',
    supervisedLiveTest: 'STOP',
    publication: 'LOCKED',
  });
  assert.equal(report.markerReplay.realtimeDurationEvidence, 'UNKNOWN');
  assert.equal(report.checks.scenes.actualObsSwitchesCurrent, 'UNKNOWN');
  assert.equal(report.checks.audio.actualListeningCurrent, 'UNKNOWN');
  assert.equal(report.checks.droppedFrames.networkDroppedFramesLocal, 'NOT_APPLICABLE');
  assert.equal(report.unknowns.includes('REAL_MICROPHONE_CURRENT'), true);
});

test('missing current performance remains UNKNOWN and can never become local pipeline PASS', async () => {
  const plan = await json('ops/stream/birdie-stream-show-15min.json');
  const report = createStreamRehearsalReport({
    plan,
    observations: createSyntheticMarkerObservations(plan),
    currentPerformance: null,
    baselinePerformance: null,
    liveDecision: 'STOP',
  });
  assert.equal(report.performanceRegression.descriptiveMetricVerdict, 'UNKNOWN');
  assert.equal(report.decisions.localPipeline, 'UNKNOWN');
  assert.equal(report.decisions.supervisedLiveTest, 'STOP');
});

test('pipeline replay has a stable canonical hash and serializes only redacted local evidence', async () => {
  const first = await runStreamRehearsalEvidence({ synthetic: true });
  const second = await runStreamRehearsalEvidence({ synthetic: true });
  assert.equal(first.report.canonicalSha256, second.report.canonicalSha256);
  assert.match(first.report.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.report.decisions.strictPerformanceRegression, 'UNKNOWN');
  const serialized = JSON.stringify(first.report);
  for (const forbidden of ['C:\\Users', 'http://', 'https://', 'Bearer ', 'sk-proj-', 'private spoken words']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('persisted rehearsal evidence is byte-semantically equal to the current deterministic runner', async () => {
  const [persisted, current] = await Promise.all([
    json('ops/evidence/birdie-stream-rehearsal-pipeline-20260830.json'),
    runStreamRehearsalEvidence({ synthetic: true }),
  ]);
  assert.deepEqual(persisted, current.report);
  assert.equal(persisted.canonicalSha256, current.report.canonicalSha256);
});

test('pipeline refuses an implicit or non-synthetic execution mode', async () => {
  await assert.rejects(
    () => runStreamRehearsalEvidence(),
    /explicit --synthetic local fixture/,
  );
});
