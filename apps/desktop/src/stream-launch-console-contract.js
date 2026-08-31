import {
  isRuntimeVerifiedStreamConfig,
  STREAM_TIMELINES,
  streamDemoFrame,
} from './stream-mode-config.js';

export const STREAM_LAUNCH_CONSOLE_SCHEMA_VERSION = 1;
const VERIFIED_LAUNCH_PREFLIGHTS = new WeakSet();

export const STREAM_LAUNCH_BASELINE = Object.freeze({
  sourceEvidenceId: 'birdie-stream-rehearsal-20260830T050017Z',
  activeStateP10Fps: 26,
  activeStateMinimumFps: 28,
  globalSafeHotkey: 'FAILED_OUTSIDE_OBS',
  globalStopHotkey: 'FAILED_OUTSIDE_OBS',
  audioContentReview: 'UNPROVEN',
  voiceEvidence: 'SYNTHETIC_ONLY',
});

export const PREFLIGHT_REASON_LABELS = Object.freeze({
  PREFLIGHT_INVALID: 'Preflight-Daten sind unvollständig oder widersprüchlich.',
  VIDEO_CONTRACT_INVALID: '1920 × 1080 bei 30 FPS ist nicht vollständig belegt.',
  ACTIVE_FPS_BELOW_GATE: 'Der aktive P10-Wert liegt unter dem 28-FPS-Gate.',
  AUDIO_CONTRACT_INVALID: 'Der stille 48-kHz-Audiovertrag ist verletzt.',
  AUDIO_CONTENT_UNPROVEN: 'Die aufgezeichnete Audiospur wurde noch nicht final abgehört.',
  VOICE_SYNTHETIC_ONLY: 'Voice ist synthetisch und kein Mikrofon-Nachweis.',
  CTA_QR_DRAFT: 'CTA bleibt Draft: lokales QR ist verifiziert, aber MKV-Scan und Freigabe fehlen.',
  PRIVACY_CONTRACT_INVALID: 'Capture- oder Output-Schutz ist nicht vollständig aktiv.',
  GLOBAL_HOTKEY_FAILED: 'Globaler SAFE-/Stop-Hotkey war außerhalb von OBS nicht zuverlässig.',
  PREVIEW_NOT_READY: 'Die lokale Stream-Vorschau ist noch nicht messbereit.',
  REHEARSAL_RUNNING: 'Die lokale Sequenz läuft noch.',
  REHEARSAL_NOT_RUN: 'Noch keine vollständige lokale 30-/60-Sekunden-Sequenz.',
  SAFE_MODE_ACTIVE: 'Lokaler SAFE-Modus ist aktiv.',
  PREVIEW_ERROR: 'Die lokale Vorschau meldet einen allowlisteten Fehlercode.',
  PREVIEW_STARTUP_SLOW: 'Der erste gerenderte Frame überschreitet 2500 ms.',
  PREVIEW_ASPECT_INVALID: 'Die lokale Vorschau ist nicht 16:9.',
  PREVIEW_LOOP_INCOMPLETE: 'Die gewählte Clip-Grenze ist noch nicht vollständig belegt.',
  PREVIEW_TIMELINE_MISMATCH: 'Die Preview-Timeline gehört nicht zum gewählten Clip-Preset.',
  PREVIEW_RUN_MISMATCH: 'Die Preview-Telemetrie gehört nicht zum aktuellen Rehearsal-Lauf.',
  PREVIEW_DURATION_INVALID: 'Die Rehearsal-Dauer ist nicht an die gewählte Clip-Grenze gebunden.',
  PREVIEW_STATE_MISSING: 'Mindestens ein geplanter synthetischer Zustand fehlt.',
  PREVIEW_FPS_UNPROVEN: 'Für mindestens einen Zustand fehlt eine FPS-Stichprobe.',
  PREVIEW_FPS_BELOW_GATE: 'Mindestens ein Zustand unterschreitet sein lokales FPS-Gate.',
  PREVIEW_FRAME_GAP_UNPROVEN: 'Für den maximalen lokalen Frame-Abstand fehlt eine Stichprobe.',
  PREVIEW_FRAME_GAP: 'Ein lokaler Frame-Abstand lag über 1000 ms.',
});

const REASON_ORDER = Object.freeze(Object.keys(PREFLIGHT_REASON_LABELS));
const VALID_GATE_STATUSES = new Set(['PASS', 'HOLD', 'STOP']);
const VALID_DECISION_STATES = new Set(['GO', 'HOLD', 'STOP']);
const VALID_REHEARSAL_STATES = new Set(['IDLE', 'READY', 'RUNNING', 'COMPLETE', 'SAFE']);
const VALID_TIMELINES = new Set(['CLIP_30', 'CLIP_60']);
const VALID_RENDERERS = new Set(['WEBGL', 'STATIC']);
const VALID_QUALITIES = new Set(['HIGH', 'LOW']);
const VALID_PRESENCE = new Set([
  'IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING',
  'WORKING', 'SUCCESS', 'ERROR', 'OFFLINE',
]);
const VALID_RUNTIMES = new Set(['STARTING', 'DEMO', 'READY', 'DEGRADED', 'OFFLINE']);
const VALID_MICROPHONES = new Set(['DEMO INPUT', 'ENABLED', 'UNAVAILABLE', 'UNKNOWN']);
const ALLOWED_ERROR_CODES = new Set([
  'PAGE_ERROR', 'PROMISE_REJECTION', 'QR_ASSET', 'WEBGL_INIT', 'WEBGL_CONTEXT',
  'WEBGL_SHADER', 'RUNTIME_BRIDGE', 'STREAM_CONFIG', 'SYNTHETIC_FIXTURE', 'LOCAL_ERROR',
]);

function finiteNumber(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, decimals = 1 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function orderedReasonIds(reasonIds = []) {
  const input = new Set(reasonIds.filter((reasonId) => REASON_ORDER.includes(reasonId)));
  return Object.freeze(REASON_ORDER.filter((reasonId) => input.has(reasonId)));
}

function makeGate(id, label, status, value, reasonIds = []) {
  const normalizedStatus = VALID_GATE_STATUSES.has(status) ? status : 'STOP';
  const normalizedReasons = VALID_GATE_STATUSES.has(status)
    ? orderedReasonIds(reasonIds)
    : orderedReasonIds(['PREFLIGHT_INVALID']);
  return Object.freeze({ id, label, status: normalizedStatus, value, reasonIds: normalizedReasons });
}

export function evaluateGateDecision(gates = []) {
  if (!Array.isArray(gates) || gates.length === 0) {
    return Object.freeze({ state: 'STOP', reasonIds: orderedReasonIds(['PREFLIGHT_INVALID']) });
  }
  let invalid = false;
  const normalized = gates.map((gate) => {
    if (!gate || typeof gate.id !== 'string' || !VALID_GATE_STATUSES.has(gate.status)) {
      invalid = true;
      return { status: 'STOP', reasonIds: ['PREFLIGHT_INVALID'] };
    }
    return gate;
  });
  const reasonIds = normalized.flatMap((gate) => gate.reasonIds ?? []);
  if (invalid) reasonIds.push('PREFLIGHT_INVALID');
  const state = normalized.some((gate) => gate.status === 'STOP')
    ? 'STOP'
    : normalized.some((gate) => gate.status === 'HOLD') ? 'HOLD' : 'GO';
  return Object.freeze({ state, reasonIds: orderedReasonIds(reasonIds) });
}

function safeTargetLabel(value) {
  const candidate = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?:\/[a-z0-9._~!$&'()*+,;=:@%/-]*)?$/i.test(candidate)) {
    return 'TARGET REDACTED';
  }
  if (candidate.includes('..') || candidate.length > 96) return 'TARGET REDACTED';
  return candidate;
}

export function buildLaunchPreflight({ plan, config, baseline = STREAM_LAUNCH_BASELINE } = {}) {
  if (!plan || !config || !baseline) {
    const invalid = [makeGate(
      'preflight', 'PREFLIGHT', 'STOP', 'INVALID', ['PREFLIGHT_INVALID'],
    )];
    return Object.freeze({ gates: Object.freeze(invalid), decision: evaluateGateDecision(invalid) });
  }

  const video = plan.profile?.video;
  const videoContractValid = video?.baseWidth === 1920
    && video?.baseHeight === 1080
    && video?.outputWidth === 1920
    && video?.outputHeight === 1080
    && video?.fps === 30;
  const observedP10 = finiteNumber(baseline.activeStateP10Fps, { maximum: 240 });
  const minimumP10 = finiteNumber(baseline.activeStateMinimumFps, { maximum: 240 });
  const visualReasons = [];
  if (!videoContractValid) visualReasons.push('VIDEO_CONTRACT_INVALID');
  if (observedP10 == null || minimumP10 == null) visualReasons.push('PREFLIGHT_INVALID');
  else if (observedP10 < minimumP10) visualReasons.push('ACTIVE_FPS_BELOW_GATE');
  const visualStatus = visualReasons.length === 0
    ? 'PASS'
    : visualReasons.includes('PREFLIGHT_INVALID') || !videoContractValid ? 'STOP' : 'STOP';

  const audio = plan.profile?.audio;
  const operatorMicrophone = plan.optionalOperatorMicrophone;
  const audioContractValid = audio?.sampleRateHz === 48_000
    && audio?.channels === 'stereo'
    && audio?.desktopAudio === false
    && audio?.browserAudio === false
    && operatorMicrophone?.enabled === false
    && operatorMicrophone?.startsMuted === true
    && operatorMicrophone?.monitoring === 'off';
  const audioReasons = [];
  if (!audioContractValid) audioReasons.push('AUDIO_CONTRACT_INVALID');
  if (baseline.audioContentReview !== 'PASS') audioReasons.push('AUDIO_CONTENT_UNPROVEN');
  const audioStatus = !audioContractValid ? 'STOP' : audioReasons.length ? 'HOLD' : 'PASS';

  const voiceStatus = baseline.voiceEvidence === 'REAL_MIC_VERIFIED' ? 'PASS' : 'HOLD';
  const declaredHash = String(config.qrSha256 ?? '').toLowerCase();
  const actualHash = String(config.actualQrSha256 ?? '').toLowerCase();
  const conversionReady = isRuntimeVerifiedStreamConfig(config)
    && config.conversionReady === true
    && config.conversionDeclaredReady === true
    && config.ctaStatus === 'READY'
    && config.placeholderCta === false
    && config.qrMatchesCta === true
    && config.qrScanVerified === true
    && config.qrAssetHashVerified === true
    && config.qrPayloadVerified === true
    && config.qrPayloadStatus === 'PASS'
    && config.qrRenderReady === true
    && config.ctaUrlCanonical === true
    && config.qrTargetCanonical === true
    && config.conversionOverridesIgnored === false
    && /^[a-f0-9]{64}$/.test(declaredHash)
    && declaredHash === actualHash;

  const outputs = plan.profile?.outputs;
  const privacy = plan.privacy;
  const privacyContractValid = outputs?.streaming === false
    && outputs?.replayBuffer === false
    && outputs?.virtualCamera === false
    && ['captureDesktop', 'captureNotifications', 'renderTranscripts', 'renderDiagnostics', 'openStreamingServiceConfig']
      .every((key) => privacy?.[key] === false);

  const sceneNames = new Set((plan.scenes ?? []).map((scene) => scene?.name));
  const fallbackContractValid = sceneNames.has('02_STREAM_BACKUP')
    && sceneNames.has('99_SAFE')
    && plan.hotkeys?.safeScene === 'Ctrl+Alt+Shift+F12'
    && plan.hotkeys?.stopRecording === 'Ctrl+Alt+Shift+F10';
  const globalHotkeysValid = baseline.globalSafeHotkey === 'PASS'
    && baseline.globalStopHotkey === 'PASS';

  const gates = Object.freeze([
    makeGate(
      'visual',
      'BILD / PERFORMANCE',
      visualStatus,
      videoContractValid && observedP10 != null && minimumP10 != null
        ? `1920 × 1080 @ 30 · P10 ${observedP10}/${minimumP10} FPS`
        : 'VIDEO CONTRACT INVALID',
      visualReasons,
    ),
    makeGate(
      'audio',
      'AUDIO',
      audioStatus,
      audioContractValid ? '48 KHZ · CAPTURE OFF' : 'AUDIO CONTRACT INVALID',
      audioReasons,
    ),
    makeGate(
      'voice',
      'VOICE',
      voiceStatus,
      voiceStatus === 'PASS' ? 'REAL MIC VERIFIED' : 'SYNTHETIC · NO MIC TEST',
      voiceStatus === 'PASS' ? [] : ['VOICE_SYNTHETIC_ONLY'],
    ),
    makeGate(
      'conversion',
      'CTA / QR',
      conversionReady ? 'PASS' : 'STOP',
      `${config.ctaStatus === 'READY' ? 'READY' : 'DRAFT'} · ${safeTargetLabel(config.ctaDisplayUrl)}`,
      conversionReady ? [] : ['CTA_QR_DRAFT'],
    ),
    makeGate(
      'privacy',
      'DATENSCHUTZ',
      privacyContractValid ? 'PASS' : 'STOP',
      privacyContractValid ? 'CAPTURE OFF · OUTPUTS LOCKED' : 'PRIVACY CONTRACT INVALID',
      privacyContractValid ? [] : ['PRIVACY_CONTRACT_INVALID'],
    ),
    makeGate(
      'fallback',
      'FALLBACK / SAFE',
      !fallbackContractValid || !globalHotkeysValid ? 'STOP' : 'PASS',
      fallbackContractValid ? 'BACKUP + 99_SAFE CONFIGURED' : 'FALLBACK CONTRACT INVALID',
      !fallbackContractValid ? ['PREFLIGHT_INVALID'] : globalHotkeysValid ? [] : ['GLOBAL_HOTKEY_FAILED'],
    ),
  ]);

  const preflight = Object.freeze({ gates, decision: evaluateGateDecision(gates) });
  VERIFIED_LAUNCH_PREFLIGHTS.add(preflight);
  return preflight;
}

export function formatOperatorTimecode(valueMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(valueMs) || 0) / 1_000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function resolveTimeline(preset) {
  return VALID_TIMELINES.has(preset) ? STREAM_TIMELINES[preset] : null;
}

export function buildRehearsalMarkers(preset) {
  const timeline = resolveTimeline(preset);
  if (!timeline) return Object.freeze([]);
  let offsetMs = 0;
  const markers = timeline.phases.map((phase, index) => {
    const marker = Object.freeze({
      index,
      atMs: offsetMs,
      timecode: formatOperatorTimecode(offsetMs),
      state: phase.state,
      copy: phase.copy,
    });
    offsetMs += phase.durationMs;
    return marker;
  });
  markers.push(Object.freeze({
    index: markers.length,
    atMs: timeline.durationMs,
    timecode: formatOperatorTimecode(timeline.durationMs),
    state: 'COMPLETE',
    copy: 'Clip-Grenze erreicht',
  }));
  return Object.freeze(markers);
}

export function operatorRehearsalFrame(elapsedMs, preset) {
  const timeline = resolveTimeline(preset);
  if (!timeline) {
    return Object.freeze({ preset: null, completed: false, state: 'ERROR', elapsedMs: 0 });
  }
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const completed = elapsed >= timeline.durationMs;
  const frame = streamDemoFrame(
    completed ? Math.max(0, timeline.durationMs - 1) : elapsed,
    timeline,
  );
  return Object.freeze({
    preset,
    completed,
    durationMs: timeline.durationMs,
    elapsedMs: Math.min(elapsed, timeline.durationMs),
    timecode: formatOperatorTimecode(Math.min(elapsed, timeline.durationMs)),
    state: completed ? 'COMPLETE' : frame.state,
    copy: completed ? 'Clip-Grenze erreicht' : frame.copy,
    inputLevel: completed ? 0 : frame.inputLevel,
    outputLevel: completed ? 0 : frame.outputLevel,
    progress: Math.min(1, elapsed / timeline.durationMs),
  });
}

export function shouldFinalizeRehearsal(elapsedMs, preset, telemetry, graceMs = 1_000) {
  const timeline = resolveTimeline(preset);
  if (!timeline) return true;
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed < timeline.durationMs) return false;
  if (Number(telemetry?.loopCount) >= 1) return true;
  return elapsed >= timeline.durationMs + Math.max(0, Number(graceMs) || 0);
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function sanitizeEnum(value, allowed, fallback) {
  const normalized = String(value ?? '').toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function stateP10Samples(fpsByPresence) {
  const output = {};
  for (const state of VALID_PRESENCE) {
    const values = Array.isArray(fpsByPresence?.[state]?.values)
      ? fpsByPresence[state].values
        .map((value) => finiteNumber(value, { maximum: 240 }))
        .filter((value) => value != null)
      : [];
    const p10 = percentile(values, 0.1);
    if (p10 != null) output[state] = p10;
  }
  return Object.freeze(output);
}

export function redactLocalTelemetry(snapshot = {}) {
  const viewportWidth = finiteNumber(snapshot.viewport?.width, { maximum: 16_384, decimals: 0 });
  const viewportHeight = finiteNumber(snapshot.viewport?.height, { maximum: 16_384, decimals: 0 });
  const errorCodes = [...new Set((snapshot.errorLog ?? []).map((entry) => {
    const code = String(entry?.code ?? '').toUpperCase();
    return ALLOWED_ERROR_CODES.has(code) ? code : 'LOCAL_ERROR';
  }))].slice(0, 12);
  const transitions = Array.isArray(snapshot.transitions) ? snapshot.transitions : [];
  const observedStates = [...new Set(transitions.map((entry) => (
    sanitizeEnum(entry?.to, VALID_PRESENCE, null)
  )).filter(Boolean))];
  const stateP10Fps = stateP10Samples(snapshot.fpsByPresence);
  const p10Values = Object.values(stateP10Fps);
  const reportedErrorCount = finiteNumber(snapshot.errors, { maximum: 100_000, decimals: 0 });
  return Object.freeze({
    rehearsalRunId: /^[A-Za-z0-9._-]{8,96}$/.test(String(snapshot.rehearsalRunId ?? ''))
      ? String(snapshot.rehearsalRunId)
      : null,
    timeline: sanitizeEnum(snapshot.timeline, VALID_TIMELINES, null),
    renderer: sanitizeEnum(snapshot.renderer, VALID_RENDERERS, null),
    quality: sanitizeEnum(snapshot.profile?.quality, VALID_QUALITIES, null),
    presence: sanitizeEnum(snapshot.presence, VALID_PRESENCE, 'OFFLINE'),
    runtime: sanitizeEnum(snapshot.runtime, VALID_RUNTIMES, 'OFFLINE'),
    microphone: sanitizeEnum(snapshot.microphone, VALID_MICROPHONES, 'UNKNOWN'),
    viewport: viewportWidth && viewportHeight
      ? Object.freeze({ width: viewportWidth, height: viewportHeight })
      : null,
    firstFrameMs: finiteNumber(snapshot.firstFrameMs, { maximum: 120_000, decimals: 0 }),
    configReadyMs: finiteNumber(snapshot.configReadyMs, { maximum: 120_000, decimals: 0 }),
    fps: finiteNumber(snapshot.fps, { maximum: 240 }),
    fpsP10: p10Values.length ? Math.min(...p10Values) : null,
    stateP10Fps,
    p95FrameMs: finiteNumber(snapshot.evidence?.p95FrameMs, { maximum: 120_000 }),
    maxFrameGapMs: finiteNumber(snapshot.maxFrameGapMs, { maximum: 120_000, decimals: 0 }),
    loopCount: finiteNumber(snapshot.loopCount, { maximum: 100_000, decimals: 0 }) ?? 0,
    observedStates: Object.freeze(observedStates),
    errorCount: Math.max(reportedErrorCount ?? 0, errorCodes.length),
    errorCodes: Object.freeze(errorCodes),
    heapUsedMb: finiteNumber(snapshot.localHeapUsedMb, { maximum: 1_048_576 }),
  });
}

export function evaluateLocalRehearsal({
  status = 'IDLE',
  preset = 'CLIP_30',
  runId = null,
  elapsedMs = null,
  telemetry = null,
} = {}) {
  if (!VALID_REHEARSAL_STATES.has(status) || !VALID_TIMELINES.has(preset)) {
    return Object.freeze({ state: 'STOP', reasonIds: orderedReasonIds(['PREFLIGHT_INVALID']) });
  }
  if (!telemetry) {
    return Object.freeze({ state: 'HOLD', reasonIds: orderedReasonIds(['PREVIEW_NOT_READY']) });
  }
  if (telemetry.errorCount > 0) {
    return Object.freeze({ state: 'STOP', reasonIds: orderedReasonIds(['PREVIEW_ERROR']) });
  }
  if (status === 'SAFE') {
    return Object.freeze({ state: 'HOLD', reasonIds: orderedReasonIds(['SAFE_MODE_ACTIVE']) });
  }
  if (status === 'RUNNING') {
    return Object.freeze({ state: 'HOLD', reasonIds: orderedReasonIds(['REHEARSAL_RUNNING']) });
  }
  if (status !== 'COMPLETE') {
    return Object.freeze({ state: 'HOLD', reasonIds: orderedReasonIds(['REHEARSAL_NOT_RUN']) });
  }

  const reasons = [];
  const timeline = resolveTimeline(preset);
  if (telemetry.timeline !== preset) reasons.push('PREVIEW_TIMELINE_MISMATCH');
  if (runId == null || telemetry.rehearsalRunId !== runId) reasons.push('PREVIEW_RUN_MISMATCH');
  if (!timeline || !Number.isFinite(Number(elapsedMs))
    || Number(elapsedMs) < timeline.durationMs
    || Number(elapsedMs) > timeline.durationMs + 1_000) {
    reasons.push('PREVIEW_DURATION_INVALID');
  }
  if (telemetry.firstFrameMs == null) reasons.push('PREVIEW_NOT_READY');
  else if (telemetry.firstFrameMs > 2_500) reasons.push('PREVIEW_STARTUP_SLOW');
  const aspect = telemetry.viewport?.width > 0 && telemetry.viewport?.height > 0
    ? telemetry.viewport.width / telemetry.viewport.height
    : null;
  if (aspect == null) reasons.push('PREVIEW_NOT_READY');
  else if (Math.abs(aspect - 16 / 9) > 0.002) reasons.push('PREVIEW_ASPECT_INVALID');
  if (telemetry.loopCount < 1) reasons.push('PREVIEW_LOOP_INCOMPLETE');

  const requiredStates = [...new Set(timeline.phases.map((phase) => phase.state))];
  const missingStates = requiredStates.filter((state) => !telemetry.observedStates.includes(state));
  if (missingStates.length) reasons.push('PREVIEW_STATE_MISSING');
  const requiredFpsStates = requiredStates.filter((state) => state !== 'IDLE' || requiredStates.includes('IDLE'));
  const missingFps = requiredFpsStates.filter((state) => telemetry.stateP10Fps[state] == null);
  if (missingFps.length) reasons.push('PREVIEW_FPS_UNPROVEN');
  const fpsMinimum = telemetry.quality === 'LOW' ? 24 : 28;
  if (requiredFpsStates.some((state) => (
    telemetry.stateP10Fps[state] != null && telemetry.stateP10Fps[state] < fpsMinimum
  ))) reasons.push('PREVIEW_FPS_BELOW_GATE');
  if (telemetry.maxFrameGapMs == null) {
    reasons.push('PREVIEW_FRAME_GAP_UNPROVEN');
  } else if (telemetry.maxFrameGapMs > 1_000) {
    reasons.push('PREVIEW_FRAME_GAP');
  }

  const hardStops = new Set([
    'PREVIEW_STARTUP_SLOW', 'PREVIEW_ASPECT_INVALID', 'PREVIEW_STATE_MISSING',
    'PREVIEW_TIMELINE_MISMATCH', 'PREVIEW_RUN_MISMATCH',
    'PREVIEW_DURATION_INVALID',
    'PREVIEW_FPS_BELOW_GATE', 'PREVIEW_FRAME_GAP',
  ]);
  const state = reasons.some((reason) => hardStops.has(reason)) ? 'STOP' : reasons.length ? 'HOLD' : 'GO';
  return Object.freeze({ state, reasonIds: orderedReasonIds(reasons) });
}

export function createOperatorEvidence({ livePreflight, rehearsal, telemetry }) {
  const decision = livePreflight?.decision;
  const trustedPreflight = VERIFIED_LAUNCH_PREFLIGHTS.has(livePreflight);
  const safeLiveState = trustedPreflight && VALID_DECISION_STATES.has(decision?.state) ? decision.state : 'STOP';
  const safeTelemetry = telemetry ? redactLocalTelemetry(telemetry) : null;
  const safePreset = VALID_TIMELINES.has(rehearsal?.preset) ? rehearsal.preset : null;
  const safeRunId = /^[A-Za-z0-9._-]{8,96}$/.test(String(rehearsal?.runId ?? ''))
    ? String(rehearsal.runId)
    : null;
  const evaluatedRehearsal = evaluateLocalRehearsal({
    status: rehearsal?.status,
    preset: safePreset,
    runId: safeRunId,
    elapsedMs: rehearsal?.elapsedMs,
    telemetry: safeTelemetry,
  });
  const safeRehearsalState = evaluatedRehearsal.state;
  return Object.freeze({
    schemaVersion: STREAM_LAUNCH_CONSOLE_SCHEMA_VERSION,
    scope: 'LOCAL_SYNTHETIC_REHEARSAL',
    externalActions: 'LOCKED',
    liveDecision: Object.freeze({
      state: safeLiveState,
      reasonIds: orderedReasonIds(trustedPreflight ? decision?.reasonIds : ['PREFLIGHT_INVALID']),
    }),
    preflight: Object.freeze((trustedPreflight ? livePreflight?.gates ?? [] : []).map((gate) => Object.freeze({
      id: gate.id,
      status: VALID_GATE_STATUSES.has(gate.status) ? gate.status : 'STOP',
      reasonIds: orderedReasonIds(gate.reasonIds),
    }))),
    rehearsal: Object.freeze({
      preset: safePreset,
      runId: safeRunId,
      state: VALID_REHEARSAL_STATES.has(rehearsal?.status) ? rehearsal.status : 'IDLE',
      decision: safeRehearsalState,
      decisionReasonIds: evaluatedRehearsal.reasonIds,
      plannedDurationMs: resolveTimeline(rehearsal?.preset)?.durationMs ?? null,
      elapsedMs: finiteNumber(rehearsal?.elapsedMs, { maximum: 600_000, decimals: 0 }) ?? 0,
      clockMode: safeRehearsalState === 'GO' && safeRunId && safeTelemetry?.rehearsalRunId === safeRunId
        ? 'LOCAL_MONOTONIC_RAF'
        : 'UNPROVEN',
      markers: buildRehearsalMarkers(rehearsal?.preset).map(({ atMs, state }) => ({ atMs, state })),
    }),
    telemetry: safeTelemetry,
    redaction: Object.freeze({ version: 1, applied: true }),
  });
}
