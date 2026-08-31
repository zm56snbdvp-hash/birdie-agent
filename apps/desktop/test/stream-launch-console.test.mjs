import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  STREAM_LAUNCH_BASELINE,
  buildLaunchPreflight,
  buildRehearsalMarkers,
  createOperatorEvidence,
  evaluateGateDecision,
  evaluateLocalRehearsal,
  formatOperatorTimecode,
  operatorRehearsalFrame,
  redactLocalTelemetry,
  shouldFinalizeRehearsal,
} from '../src/stream-launch-console-contract.js';
import { inspectStreamQrAssetWithDependencies, resolveStreamConfig } from '../src/stream-mode-config.js';

const repositoryRoot = new URL('../../..', import.meta.url);
const TEST_RUN_ID = 'local-test-0001';

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repositoryRoot), 'utf8'));
}

function goodTelemetry(preset = 'CLIP_30') {
  const required = preset === 'CLIP_60'
    ? ['IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'WORKING', 'SPEAKING', 'SUCCESS']
    : ['IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING', 'SUCCESS'];
  return {
    rehearsalRunId: TEST_RUN_ID,
    timeline: preset,
    renderer: 'WEBGL',
    quality: 'HIGH',
    presence: 'IDLE',
    runtime: 'DEMO',
    microphone: 'DEMO INPUT',
    viewport: { width: 1280, height: 720 },
    firstFrameMs: 220,
    configReadyMs: 18,
    fps: 30,
    fpsP10: 29,
    stateP10Fps: Object.fromEntries(required.map((state) => [state, 29])),
    p95FrameMs: 36,
    maxFrameGapMs: 80,
    loopCount: 1,
    observedStates: required,
    errorCount: 0,
    errorCodes: [],
    heapUsedMb: 42,
  };
}

function goodRawTelemetry(preset = 'CLIP_30', runId = TEST_RUN_ID) {
  const telemetry = goodTelemetry(preset);
  return {
    ...telemetry,
    rehearsalRunId: runId,
    profile: { quality: 'HIGH' },
    errors: 0,
    errorLog: [],
    fpsByPresence: Object.fromEntries(
      Object.entries(telemetry.stateP10Fps).map(([state, value]) => [state, { values: [value] }]),
    ),
    transitions: telemetry.observedStates.map((to) => ({ to })),
  };
}

test('30- and 60-second cue sheets derive exact canonical markers', () => {
  assert.deepEqual(
    buildRehearsalMarkers('CLIP_30').map(({ atMs, state }) => [atMs, state]),
    [
      [0, 'IDLE'], [4_000, 'SPEECH_DETECTED'], [6_000, 'LISTENING'],
      [11_000, 'THINKING'], [15_000, 'SPEAKING'], [20_000, 'SUCCESS'],
      [24_000, 'IDLE'], [30_000, 'COMPLETE'],
    ],
  );
  assert.deepEqual(
    buildRehearsalMarkers('CLIP_60').map(({ atMs, state }) => [atMs, state]),
    [
      [0, 'IDLE'], [7_000, 'SPEECH_DETECTED'], [10_000, 'LISTENING'],
      [17_000, 'THINKING'], [24_000, 'WORKING'], [30_000, 'SPEAKING'],
      [38_000, 'SUCCESS'], [44_000, 'IDLE'], [60_000, 'COMPLETE'],
    ],
  );
});

test('rehearsal frames close exactly at the selected real-time clip boundary', () => {
  assert.equal(operatorRehearsalFrame(29_999, 'CLIP_30').completed, false);
  assert.equal(operatorRehearsalFrame(30_000, 'CLIP_30').completed, true);
  assert.equal(operatorRehearsalFrame(30_000, 'CLIP_30').state, 'COMPLETE');
  assert.equal(operatorRehearsalFrame(60_000, 'CLIP_60').progress, 1);
  assert.equal(operatorRehearsalFrame(60_000, 'CLIP_60').timecode, '01:00');
  assert.equal(formatOperatorTimecode(11_999), '00:11');
});

test('completion waits one bounded grace window for the iframe loop boundary', () => {
  assert.equal(shouldFinalizeRehearsal(29_999, 'CLIP_30', { loopCount: 1 }), false);
  assert.equal(shouldFinalizeRehearsal(30_000, 'CLIP_30', { loopCount: 0 }), false);
  assert.equal(shouldFinalizeRehearsal(30_001, 'CLIP_30', { loopCount: 1 }), true);
  assert.equal(shouldFinalizeRehearsal(30_999, 'CLIP_30', { loopCount: 0 }), false);
  assert.equal(shouldFinalizeRehearsal(31_000, 'CLIP_30', { loopCount: 0 }), true);
});

test('current launch preflight stays STOP while the local preview remains separately operable', async () => {
  const plan = await json('ops/obs/birdie-stream-local.scene-plan.json');
  const config = resolveStreamConfig(await json('apps/desktop/public/stream-mode.json'));
  const result = buildLaunchPreflight({ plan, config });

  assert.equal(result.decision.state, 'STOP');
  assert.deepEqual(result.gates.map(({ id, status }) => [id, status]), [
    ['visual', 'STOP'],
    ['audio', 'HOLD'],
    ['voice', 'HOLD'],
    ['conversion', 'STOP'],
    ['privacy', 'PASS'],
    ['fallback', 'STOP'],
  ]);
  assert.deepEqual(result.decision.reasonIds, [
    'ACTIVE_FPS_BELOW_GATE',
    'AUDIO_CONTENT_UNPROVEN',
    'VOICE_SYNTHETIC_ONLY',
    'CTA_QR_DRAFT',
    'GLOBAL_HOTKEY_FAILED',
  ]);
});

test('diagnostic QR dependencies cannot mint a launch GO or unlock external actions', async () => {
  const plan = await json('ops/obs/birdie-stream-local.scene-plan.json');
  const config = await inspectStreamQrAssetWithDependencies(resolveStreamConfig({
    ctaLabel: 'EARLY ACCESS',
    ctaText: 'Birdie auf deinem PC testen',
    ctaUrl: 'https://birdieandbreakfast.de/pilot',
    ctaStatus: 'READY',
    qrImage: '/assets/birdie-pilot.png',
    qrTarget: 'https://birdieandbreakfast.de/pilot',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: true,
  }), {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
    qrDecoder: async () => ({ status: 'PASS' }),
    createObjectUrl: async () => 'blob:verified-test-qr',
  });
  const result = buildLaunchPreflight({
    plan,
    config,
    baseline: {
      ...STREAM_LAUNCH_BASELINE,
      activeStateP10Fps: 29,
      globalSafeHotkey: 'PASS',
      globalStopHotkey: 'PASS',
      audioContentReview: 'PASS',
      voiceEvidence: 'REAL_MIC_VERIFIED',
    },
  });
  assert.equal(result.decision.state, 'STOP');
  assert.equal(result.gates.find((gate) => gate.id === 'conversion').status, 'STOP');
  const evidence = createOperatorEvidence({
    livePreflight: result,
    rehearsal: {
      preset: 'CLIP_30',
      runId: TEST_RUN_ID,
      status: 'COMPLETE',
      elapsedMs: 30_000,
      decision: { state: 'GO', reasonIds: [] },
    },
    telemetry: goodRawTelemetry(),
  });
  assert.equal(evidence.externalActions, 'LOCKED');
  assert.equal(evidence.liveDecision.state, 'STOP');

  const forgedEvidence = createOperatorEvidence({
    livePreflight: { decision: { state: 'GO', reasonIds: [] }, gates: [] },
    rehearsal: {
      preset: 'CLIP_30', runId: TEST_RUN_ID, status: 'COMPLETE', elapsedMs: 30_000,
      decision: { state: 'GO', reasonIds: [] },
    },
    telemetry: goodRawTelemetry(),
  });
  assert.equal(forgedEvidence.liveDecision.state, 'STOP');

  const callerSpoof = buildLaunchPreflight({
    plan,
    config: { ...config },
    baseline: {
      ...STREAM_LAUNCH_BASELINE,
      activeStateP10Fps: 29,
      globalSafeHotkey: 'PASS',
      globalStopHotkey: 'PASS',
      audioContentReview: 'PASS',
      voiceEvidence: 'REAL_MIC_VERIFIED',
    },
  });
  assert.equal(callerSpoof.decision.state, 'STOP');
});

test('privacy, audio, output, and video mutations fail closed', async (t) => {
  const plan = await json('ops/obs/birdie-stream-local.scene-plan.json');
  const config = resolveStreamConfig(await json('apps/desktop/public/stream-mode.json'));
  const mutations = [
    {
      name: 'streaming enabled',
      mutate(value) { value.profile.outputs.streaming = true; },
      gate: 'privacy',
    },
    {
      name: 'desktop audio enabled',
      mutate(value) { value.profile.audio.desktopAudio = true; },
      gate: 'audio',
    },
    {
      name: 'wrong output width',
      mutate(value) { value.profile.video.outputWidth = 1280; },
      gate: 'visual',
    },
    {
      name: 'desktop capture enabled',
      mutate(value) { value.privacy.captureDesktop = true; },
      gate: 'privacy',
    },
  ];
  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const candidate = structuredClone(plan);
      mutation.mutate(candidate);
      const result = buildLaunchPreflight({ plan: candidate, config });
      assert.equal(result.decision.state, 'STOP');
      assert.equal(result.gates.find((gate) => gate.id === mutation.gate).status, 'STOP');
    });
  }
});

test('decision priority and reason order are deterministic and fail closed', () => {
  const gates = [
    { id: 'b', status: 'HOLD', reasonIds: ['VOICE_SYNTHETIC_ONLY', 'CTA_QR_DRAFT'] },
    { id: 'a', status: 'STOP', reasonIds: ['GLOBAL_HOTKEY_FAILED', 'CTA_QR_DRAFT'] },
  ];
  const forward = evaluateGateDecision(gates);
  const reversed = evaluateGateDecision([...gates].reverse());
  assert.deepEqual(forward, reversed);
  assert.equal(forward.state, 'STOP');
  assert.deepEqual(forward.reasonIds, ['VOICE_SYNTHETIC_ONLY', 'CTA_QR_DRAFT', 'GLOBAL_HOTKEY_FAILED']);
  assert.deepEqual(evaluateGateDecision([{ id: 'x', status: 'MAYBE' }]), {
    state: 'STOP',
    reasonIds: ['PREFLIGHT_INVALID'],
  });
});

test('telemetry is allowlisted and strips URLs, paths, tokens, transcripts, and raw errors', () => {
  const raw = {
    buildId: 'sensitive-build',
    startedAtUtc: '2026-08-30T00:00:00Z',
    timeline: 'CLIP_30',
    renderer: 'WEBGL',
    profile: { quality: 'HIGH' },
    presence: 'LISTENING',
    runtime: 'DEMO',
    microphone: 'DEMO INPUT',
    viewport: { width: 1280, height: 720 },
    firstFrameMs: 201,
    fps: 30,
    maxFrameGapMs: 40,
    loopCount: 1,
    errors: 2,
    localHeapUsedMb: 41.25,
    config: { ctaUrl: 'https://user:pass@example.com/?token=secret' },
    transcript: 'private spoken words',
    diagnostic: 'C:\\Users\\person\\secrets.txt Bearer abc.def.ghi',
    errorLog: [
      { code: 'WEBGL_CONTEXT', detail: 'C:\\Users\\person\\stack.txt' },
      { code: 'token=https://example.com/?secret=yes' },
    ],
    transitions: [{ to: 'LISTENING' }, { to: 'PRIVATE_STATE' }],
    fpsByPresence: { LISTENING: { values: [29, 30] } },
    evidence: { p95FrameMs: 34, diagnostic: 'secret' },
  };
  const telemetry = redactLocalTelemetry(raw);
  const serialized = JSON.stringify(telemetry);
  assert.deepEqual(telemetry.errorCodes, ['WEBGL_CONTEXT', 'LOCAL_ERROR']);
  assert.deepEqual(telemetry.observedStates, ['LISTENING']);
  assert.equal(telemetry.fpsP10, 29);
  assert.equal(redactLocalTelemetry({ errors: 0, errorLog: [{ code: 'WEBGL_CONTEXT' }] }).errorCount, 1);
  for (const forbidden of ['sensitive-build', 'user:pass', 'token=', 'private spoken', 'Users', 'Bearer', 'secrets.txt']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('non-finite or impossible telemetry values are rejected', () => {
  const telemetry = redactLocalTelemetry({
    firstFrameMs: Number.POSITIVE_INFINITY,
    fps: Number.NaN,
    maxFrameGapMs: -1,
    localHeapUsedMb: -50,
    viewport: { width: 0, height: 720 },
  });
  assert.equal(telemetry.firstFrameMs, null);
  assert.equal(telemetry.fps, null);
  assert.equal(telemetry.maxFrameGapMs, null);
  assert.equal(telemetry.heapUsedMb, null);
  assert.equal(telemetry.viewport, null);
});

test('local rehearsal moves HOLD to GO only after complete clean evidence', () => {
  assert.equal(evaluateLocalRehearsal({ status: 'IDLE', preset: 'CLIP_30' }).state, 'HOLD');
  assert.equal(evaluateLocalRehearsal({
    status: 'RUNNING', preset: 'CLIP_30', runId: TEST_RUN_ID, elapsedMs: 0, telemetry: goodTelemetry(),
  }).state, 'HOLD');
  const complete = evaluateLocalRehearsal({
    status: 'COMPLETE', preset: 'CLIP_30', runId: TEST_RUN_ID, elapsedMs: 30_000,
    telemetry: goodRawTelemetry(),
  });
  assert.deepEqual(complete, { state: 'GO', reasonIds: [] });
});

test('local rehearsal names the first bounded performance or error failure', () => {
  const lowFps = goodTelemetry();
  lowFps.stateP10Fps.LISTENING = 23;
  const slow = evaluateLocalRehearsal({
    status: 'COMPLETE', preset: 'CLIP_30', runId: TEST_RUN_ID, elapsedMs: 30_000, telemetry: lowFps,
  });
  assert.equal(slow.state, 'STOP');
  assert.deepEqual(slow.reasonIds, ['PREVIEW_FPS_BELOW_GATE']);

  const error = { ...goodTelemetry(), errorCount: 1, errorCodes: ['WEBGL_CONTEXT'] };
  assert.deepEqual(evaluateLocalRehearsal({
    status: 'COMPLETE', preset: 'CLIP_30', runId: TEST_RUN_ID, elapsedMs: 30_000, telemetry: error,
  }), { state: 'STOP', reasonIds: ['PREVIEW_ERROR'] });
});

test('missing local samples remain HOLD rather than becoming false GO', () => {
  const incomplete = goodTelemetry();
  delete incomplete.stateP10Fps.SPEECH_DETECTED;
  const result = evaluateLocalRehearsal({
    status: 'COMPLETE', preset: 'CLIP_30', runId: TEST_RUN_ID, elapsedMs: 30_000, telemetry: incomplete,
  });
  assert.equal(result.state, 'HOLD');
  assert.deepEqual(result.reasonIds, ['PREVIEW_FPS_UNPROVEN']);

  const missingGap = goodTelemetry();
  delete missingGap.maxFrameGapMs;
  assert.deepEqual(evaluateLocalRehearsal({
    status: 'COMPLETE', preset: 'CLIP_30', runId: TEST_RUN_ID, elapsedMs: 30_000, telemetry: missingGap,
  }), { state: 'HOLD', reasonIds: ['PREVIEW_FRAME_GAP_UNPROVEN'] });
});

test('rehearsal telemetry is bound to the selected timeline and current run id', () => {
  const telemetry = { ...goodTelemetry('CLIP_30'), rehearsalRunId: 'local-run-0002' };
  assert.deepEqual(evaluateLocalRehearsal({
    status: 'COMPLETE', preset: 'CLIP_30', runId: 'local-run-0001', elapsedMs: 30_000, telemetry,
  }), { state: 'STOP', reasonIds: ['PREVIEW_RUN_MISMATCH'] });
  assert.deepEqual(evaluateLocalRehearsal({
    status: 'COMPLETE', preset: 'CLIP_60', runId: 'local-run-0002', elapsedMs: 60_000, telemetry,
  }).reasonIds.includes('PREVIEW_TIMELINE_MISMATCH'), true);
});

test('COMPLETE cannot be forged with a caller verdict, stale run, or invalid elapsed time', async () => {
  const plan = await json('ops/obs/birdie-stream-local.scene-plan.json');
  const config = resolveStreamConfig(await json('apps/desktop/public/stream-mode.json'));
  const livePreflight = buildLaunchPreflight({ plan, config });

  const invalidElapsed = createOperatorEvidence({
    livePreflight,
    rehearsal: {
      preset: 'CLIP_30', runId: TEST_RUN_ID, status: 'COMPLETE', elapsedMs: 0,
      decision: { state: 'GO', reasonIds: [] },
    },
    telemetry: goodRawTelemetry(),
  });
  assert.equal(invalidElapsed.rehearsal.decision, 'STOP');
  assert.deepEqual(invalidElapsed.rehearsal.decisionReasonIds, ['PREVIEW_DURATION_INVALID']);
  assert.equal(invalidElapsed.rehearsal.clockMode, 'UNPROVEN');

  const staleRun = createOperatorEvidence({
    livePreflight,
    rehearsal: {
      preset: 'CLIP_30', runId: 'local-test-0002', status: 'COMPLETE', elapsedMs: 30_000,
      decision: { state: 'GO', reasonIds: [] },
    },
    telemetry: goodRawTelemetry(),
  });
  assert.equal(staleRun.rehearsal.decision, 'STOP');
  assert.deepEqual(staleRun.rehearsal.decisionReasonIds, ['PREVIEW_RUN_MISMATCH']);
  assert.equal(staleRun.rehearsal.clockMode, 'UNPROVEN');
});

test('operator evidence round-trip contains only locked redacted local data', async () => {
  const plan = await json('ops/obs/birdie-stream-local.scene-plan.json');
  const config = resolveStreamConfig(await json('apps/desktop/public/stream-mode.json'));
  const rawTelemetry = {
    ...goodTelemetry(),
    profile: { quality: 'HIGH' },
    errors: 0,
    errorLog: [],
    rehearsalRunId: TEST_RUN_ID,
    fpsByPresence: Object.fromEntries(
      Object.entries(goodTelemetry().stateP10Fps).map(([state, value]) => [state, { values: [value] }]),
    ),
    transitions: goodTelemetry().observedStates.map((to) => ({ to })),
    secret: ['sk', 'proj', 'this-must-never-serialize'].join('-'),
    path: 'C:\\Users\\person\\private.txt',
  };
  const livePreflight = buildLaunchPreflight({ plan, config });
  const evidence = createOperatorEvidence({
    livePreflight,
    rehearsal: {
      preset: 'CLIP_30',
      runId: TEST_RUN_ID,
      status: 'COMPLETE',
      elapsedMs: 30_000,
      decision: { state: 'GO', reasonIds: [] },
    },
    telemetry: rawTelemetry,
  });
  const roundTrip = JSON.parse(JSON.stringify(evidence));
  assert.equal(roundTrip.schemaVersion, 1);
  assert.equal(roundTrip.scope, 'LOCAL_SYNTHETIC_REHEARSAL');
  assert.equal(roundTrip.externalActions, 'LOCKED');
  assert.equal(roundTrip.rehearsal.clockMode, 'LOCAL_MONOTONIC_RAF');
  assert.equal(roundTrip.rehearsal.plannedDurationMs, 30_000);
  assert.equal(JSON.stringify(roundTrip).includes('sk-proj'), false);
  assert.equal(JSON.stringify(roundTrip).includes('C:\\Users'), false);
});

test('redacted baseline is traceable to the existing general rehearsal without copying local paths', async () => {
  const evidence = await json('ops/evidence/birdie-stream-general-rehearsal-20260830.json');
  const stateP10 = Object.values(evidence.browserEvidence.stateP10Fps);
  assert.equal(STREAM_LAUNCH_BASELINE.sourceEvidenceId, evidence.takeId);
  assert.equal(STREAM_LAUNCH_BASELINE.activeStateP10Fps, Math.min(...stateP10));
  assert.equal(STREAM_LAUNCH_BASELINE.activeStateMinimumFps, 28);
  assert.equal(
    evidence.sceneTimeline.some((entry) => entry.method?.includes('targeted at Codex') && entry.status === 'FAIL'),
    true,
  );
  assert.match(evidence.obsEvidence.note, /not independently inspected/i);
  assert.equal(JSON.stringify(STREAM_LAUNCH_BASELINE).includes('C:/Users'), false);
});

test('operator UI stays isolated, local-only, accessible, and leaves headless default intact', async () => {
  const [mainSource, operatorSource, css] = await Promise.all([
    readFile(new URL('apps/desktop/src/main.js', repositoryRoot), 'utf8'),
    readFile(new URL('apps/desktop/src/stream-launch-console.js', repositoryRoot), 'utf8'),
    readFile(new URL('apps/desktop/src/stream-launch-console.css', repositoryRoot), 'utf8'),
  ]);
  assert.match(mainSource, /requestedMode === 'operator'/);
  assert.match(mainSource, /else startHeadless\(\)/);
  assert.match(operatorSource, /EXTERNAL ACTIONS[\s\S]*LOCKED/);
  assert.match(operatorSource, /NOT OBS EVIDENCE/);
  assert.match(operatorSource, /SYNTHETIC VOICE · NO MIC TEST/);
  assert.match(operatorSource, /role="progressbar"/);
  assert.match(operatorSource, /rehearsalStatus === 'RUNNING'\) return false/);
  assert.doesNotMatch(operatorSource, /@tauri-apps|invoke\(|child_process|obs-websocket|https?:\/\//);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /min-height:\s*max\(3cqw, 44px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
