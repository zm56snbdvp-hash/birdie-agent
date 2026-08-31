export const STREAM_REHEARSAL_EVIDENCE_SCHEMA_VERSION = 1;
export const STREAM_SHOW_DURATION_MS = 900_000;

const REQUIRED_SEGMENT_ROLES = Object.freeze([
  'HOOK', 'SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3', 'CTA', 'CLOSE',
]);
const REQUIRED_MARKER_KINDS = Object.freeze([
  'SCENE', 'AUDIO', 'VOICE', 'CTA', 'CLIP', 'FALLBACK', 'OPERATOR',
]);
const ALLOWED_AUDIO_FIXTURES = new Set([
  'audio:silent-48khz-stereo',
  'audio:silent-midroll-check',
  'audio:silent-final-check',
]);
const ALLOWED_VOICE_FIXTURES = new Set([
  'voice:synthetic-ui-loop',
  'voice:synthetic-success-cycle',
]);
const ALLOWED_CTA_FIXTURES = new Set(['cta:local-draft-verified-asset']);
const GATE_STATUSES = new Set(['PASS', 'STOP', 'UNKNOWN']);
const CLOCK_MODES = new Set(['REALTIME', 'SIMULATED']);
const PERFORMANCE_MODES = new Set(['REAL_BROWSER', 'BASELINE_REPLAY', 'SIMULATED']);
const PERFORMANCE_TIMELINES = new Set(['LOOP', 'CLIP_30', 'CLIP_60', 'SHOW_15']);
const PERFORMANCE_PRODUCERS = new Set(['PARALLEL_LOCAL_BROWSER', 'OPERATOR_IFRAME', 'OBS_BROWSER_SOURCE']);
const PERFORMANCE_SOURCE_OWNERS = new Set(['DIRECT_PAGE', 'OPERATOR_IFRAME', 'OBS_BROWSER_SOURCE']);

function finite(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, decimals = 1 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function unique(values) {
  return new Set(values).size === values.length;
}

function safeId(value, fallback = 'UNKNOWN', maximum = 96) {
  const normalized = String(value ?? fallback).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, maximum);
  return normalized || fallback;
}

function gate(id, status, observed, expected, reasonId = null) {
  const normalizedStatus = GATE_STATUSES.has(status) ? status : 'STOP';
  return Object.freeze({
    id,
    status: normalizedStatus,
    observed,
    expected,
    reasonId: normalizedStatus === 'PASS'
      ? null
      : (GATE_STATUSES.has(status) ? reasonId : 'GATE_STATUS_INVALID'),
  });
}

function verdict(gates) {
  if (gates.some((entry) => entry.status === 'STOP')) return 'STOP';
  if (gates.some((entry) => entry.status === 'UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

export function formatShowTimecode(valueMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(valueMs) || 0) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function validateRehearsalShowPlan(plan) {
  const segments = Array.isArray(plan?.segments) ? plan.segments : [];
  const markers = Array.isArray(plan?.markers) ? plan.markers : [];
  const clips = Array.isArray(plan?.clips) ? plan.clips : [];
  const segmentIds = segments.map((segment) => segment?.id);
  const markerIds = markers.map((marker) => marker?.id);
  const clipIds = clips.map((clip) => clip?.id);
  const segmentRoles = segments.map((segment) => segment?.role);
  const markerKinds = new Set(markers.map((marker) => marker?.kind));
  const audioMarkers = markers.filter((marker) => marker?.kind === 'AUDIO');
  const voiceMarkers = markers.filter((marker) => marker?.kind === 'VOICE');
  const ctaMarkers = markers.filter((marker) => marker?.kind === 'CTA');
  const segmentsContiguous = segments.length > 0
    && segments[0]?.startMs === 0
    && segments.at(-1)?.endMs === STREAM_SHOW_DURATION_MS
    && segments.every((segment, index) => (
      Number.isInteger(segment?.startMs)
      && Number.isInteger(segment?.endMs)
      && segment.startMs < segment.endMs
      && (index === 0 || segments[index - 1].endMs === segment.startMs)
    ));
  const markersMonotonic = markers.every((marker, index) => (
    Number.isInteger(marker?.atMs)
    && marker.atMs >= 0
    && marker.atMs <= STREAM_SHOW_DURATION_MS
    && (index === 0 || markers[index - 1].atMs < marker.atMs)
  ));
  const markerSegmentsKnown = markers.every((marker) => segmentIds.includes(marker?.segmentId));
  const clipsBounded = clips.every((clip) => (
    Number.isInteger(clip?.startMs)
    && Number.isInteger(clip?.endMs)
    && clip.startMs >= 0
    && clip.endMs <= STREAM_SHOW_DURATION_MS
    && clip.endMs > clip.startMs
    && clip.endMs - clip.startMs >= 15_000
    && clip.endMs - clip.startMs <= 60_000
  ));
  const gates = Object.freeze([
    gate('schema', plan?.schemaVersion === 1 ? 'PASS' : 'STOP', plan?.schemaVersion ?? null, 1, 'SHOW_SCHEMA_INVALID'),
    gate('scope', plan?.scope === 'LOCAL_SYNTHETIC_REHEARSAL' ? 'PASS' : 'STOP', plan?.scope ?? null, 'LOCAL_SYNTHETIC_REHEARSAL', 'SHOW_SCOPE_INVALID'),
    gate('duration', plan?.durationMs === STREAM_SHOW_DURATION_MS ? 'PASS' : 'STOP', plan?.durationMs ?? null, STREAM_SHOW_DURATION_MS, 'SHOW_DURATION_INVALID'),
    gate('segment-ids', segmentIds.length >= 6 && unique(segmentIds) && segmentIds.every(Boolean) ? 'PASS' : 'STOP', segmentIds.length, '>= 6 unique IDs', 'SHOW_SEGMENTS_INVALID'),
    gate('segment-roles', REQUIRED_SEGMENT_ROLES.every((role) => segmentRoles.includes(role)) ? 'PASS' : 'STOP', segmentRoles, REQUIRED_SEGMENT_ROLES, 'SHOW_ROLES_MISSING'),
    gate('segment-continuity', segmentsContiguous ? 'PASS' : 'STOP', segmentsContiguous, true, 'SHOW_SEGMENTS_NOT_CONTIGUOUS'),
    gate('marker-ids', markers.length > 0 && unique(markerIds) && markerIds.every(Boolean) ? 'PASS' : 'STOP', markerIds.length, '> 0 unique IDs', 'SHOW_MARKERS_INVALID'),
    gate('marker-order', markersMonotonic ? 'PASS' : 'STOP', markersMonotonic, true, 'SHOW_MARKERS_NOT_MONOTONIC'),
    gate('marker-segments', markerSegmentsKnown ? 'PASS' : 'STOP', markerSegmentsKnown, true, 'SHOW_MARKER_SEGMENT_UNKNOWN'),
    gate('marker-kinds', REQUIRED_MARKER_KINDS.every((kind) => markerKinds.has(kind)) ? 'PASS' : 'STOP', [...markerKinds], REQUIRED_MARKER_KINDS, 'SHOW_MARKER_KIND_MISSING'),
    gate(
      'audio-fixtures',
      audioMarkers.length > 0 && audioMarkers.every((marker) => ALLOWED_AUDIO_FIXTURES.has(marker?.fixture)) ? 'PASS' : 'STOP',
      audioMarkers.map((marker) => marker?.fixture ?? null),
      [...ALLOWED_AUDIO_FIXTURES],
      'SHOW_AUDIO_FIXTURE_NOT_SILENT',
    ),
    gate(
      'voice-fixtures',
      voiceMarkers.length > 0 && voiceMarkers.every((marker) => ALLOWED_VOICE_FIXTURES.has(marker?.fixture)) ? 'PASS' : 'STOP',
      voiceMarkers.map((marker) => marker?.fixture ?? null),
      [...ALLOWED_VOICE_FIXTURES],
      'SHOW_VOICE_FIXTURE_NOT_SYNTHETIC',
    ),
    gate(
      'cta-fixtures',
      ctaMarkers.length === 1 && ctaMarkers.every((marker) => ALLOWED_CTA_FIXTURES.has(marker?.fixture)) ? 'PASS' : 'STOP',
      ctaMarkers.map((marker) => marker?.fixture ?? null),
      [...ALLOWED_CTA_FIXTURES],
      'SHOW_CTA_FIXTURE_NOT_DRAFT',
    ),
    gate('fallback-volume', markers.filter((marker) => marker?.kind === 'FALLBACK').length >= 2 ? 'PASS' : 'STOP', markers.filter((marker) => marker?.kind === 'FALLBACK').length, '>= 2', 'SHOW_FALLBACKS_MISSING'),
    gate('clip-count', clips.length === 5 && unique(clipIds) && clipIds.every(Boolean) ? 'PASS' : 'STOP', clips.length, 5, 'SHOW_CLIPS_INVALID'),
    gate('clip-bounds', clipsBounded ? 'PASS' : 'STOP', clipsBounded, true, 'SHOW_CLIP_BOUNDS_INVALID'),
  ]);
  return Object.freeze({ status: verdict(gates), gates });
}

function stableIdOffset(id, seed) {
  let hash = Number(seed) >>> 0;
  for (const character of String(id)) hash = (Math.imul(hash, 33) ^ character.charCodeAt(0)) >>> 0;
  return (hash % 37) - 18;
}

export function createSyntheticMarkerObservations(plan, { seed = 20_260_830 } = {}) {
  const markers = Array.isArray(plan?.markers) ? plan.markers : [];
  return Object.freeze(markers.map((marker, index) => {
    const boundary = marker.atMs === 0 || marker.atMs === plan.durationMs;
    const driftMs = boundary ? 0 : stableIdOffset(marker.id, seed + index);
    return Object.freeze({
      markerId: marker.id,
      plannedAtMs: marker.atMs,
      observedAtMs: marker.atMs + driftMs,
      driftMs,
      status: 'PASS',
      source: 'SYNTHETIC_FIXTURE',
    });
  }));
}

export function evaluateMarkerObservations(plan, observations, {
  clockMode = 'SIMULATED',
  realtimeWitness = null,
} = {}) {
  const markers = Array.isArray(plan?.markers) ? plan.markers : [];
  const markerById = new Map(markers.map((marker) => [marker.id, marker]));
  const markerIds = new Set(markers.map((marker) => marker.id));
  const entries = Array.isArray(observations) ? observations : [];
  const ids = entries.map((entry) => entry?.markerId);
  const unknownIds = ids.filter((id) => !markerIds.has(id));
  const missingIds = [...markerIds].filter((id) => !ids.includes(id));
  const drifts = entries.map((entry) => finite(Math.abs(entry?.driftMs), { maximum: STREAM_SHOW_DURATION_MS, decimals: 0 })).filter((value) => value != null);
  const timeBindingValid = entries.every((entry) => {
    const marker = markerById.get(entry?.markerId);
    return Number.isInteger(marker?.atMs)
      && entry?.plannedAtMs === marker.atMs
      && Number.isInteger(entry?.observedAtMs)
      && Number.isInteger(entry?.driftMs)
      && entry.observedAtMs - entry.plannedAtMs === entry.driftMs;
  });
  const contractGates = Object.freeze([
    gate('marker-cardinality', entries.length === markers.length && unique(ids) ? 'PASS' : 'STOP', entries.length, markers.length, 'MARKER_CARDINALITY_INVALID'),
    gate('marker-known', unknownIds.length === 0 ? 'PASS' : 'STOP', unknownIds, [], 'MARKER_UNKNOWN'),
    gate('marker-complete', missingIds.length === 0 ? 'PASS' : 'STOP', missingIds, [], 'MARKER_MISSING'),
    gate('marker-status', entries.every((entry) => entry?.status === 'PASS') ? 'PASS' : 'STOP', entries.filter((entry) => entry?.status !== 'PASS').map((entry) => entry?.markerId), [], 'MARKER_FIXTURE_FAILED'),
    gate('marker-time-binding', timeBindingValid ? 'PASS' : 'STOP', timeBindingValid, true, 'MARKER_TIME_BINDING_INVALID'),
    gate('marker-drift', drifts.length === entries.length && drifts.every((value) => value <= 250) ? 'PASS' : 'STOP', drifts.length ? Math.max(...drifts) : null, '<= 250 ms', 'MARKER_DRIFT_HIGH'),
  ]);
  const normalizedClockMode = CLOCK_MODES.has(clockMode) ? clockMode : 'SIMULATED';
  const contractReplayVerdict = verdict(contractGates);
  const observedDurationMs = entries.length > 1
    ? Number(entries.at(-1)?.observedAtMs) - Number(entries[0]?.observedAtMs)
    : null;
  const projectedShowDurationMs = Number.isFinite(observedDurationMs) && Number.isInteger(markers.at(-1)?.atMs)
    ? observedDurationMs + (Number(plan?.durationMs) - markers.at(-1).atMs)
    : null;
  const realtimeProven = normalizedClockMode === 'REALTIME'
    && contractReplayVerdict === 'PASS'
    && entries.every((entry) => entry?.source === 'REALTIME_CAPTURE')
    && realtimeWitness?.source === 'PERFORMANCE_NOW'
    && Number.isInteger(realtimeWitness?.durationMs)
    && Number.isFinite(observedDurationMs)
    && Number.isFinite(projectedShowDurationMs)
    && Math.abs(realtimeWitness.durationMs - projectedShowDurationMs) <= 250
    && Math.abs(realtimeWitness.durationMs - Number(plan?.durationMs)) <= 250;
  return Object.freeze({
    clockMode: normalizedClockMode,
    contractReplayVerdict,
    realtimeDurationEvidence: 'UNKNOWN',
    realtimeWitnessConsistency: normalizedClockMode === 'REALTIME'
      ? realtimeProven ? 'PASS' : 'STOP'
      : 'UNKNOWN',
    gates: contractGates,
    trace: Object.freeze(entries.map((entry) => Object.freeze({
      markerId: String(entry?.markerId ?? 'UNKNOWN').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96),
      plannedAtMs: Number.isInteger(entry?.plannedAtMs) ? entry.plannedAtMs : null,
      observedAtMs: Number.isInteger(entry?.observedAtMs) ? entry.observedAtMs : null,
      driftMs: Number.isInteger(entry?.driftMs) ? entry.driftMs : null,
      status: entry?.status === 'PASS' ? 'PASS' : 'STOP',
      source: ['SYNTHETIC_FIXTURE', 'REALTIME_CAPTURE'].includes(entry?.source)
        ? entry.source
        : 'UNKNOWN',
    }))),
    timing: Object.freeze({
      markerCount: entries.length,
      maximumAbsoluteDriftMs: drifts.length ? Math.max(...drifts) : null,
      p95AbsoluteDriftMs: drifts.length ? percentile(drifts, 0.95) : null,
      plannedDurationMs: finite(plan?.durationMs, { maximum: STREAM_SHOW_DURATION_MS, decimals: 0 }),
      observedRealtimeDurationMs: normalizedClockMode === 'REALTIME' && Number.isFinite(observedDurationMs)
        ? finite(realtimeWitness?.durationMs, { maximum: STREAM_SHOW_DURATION_MS + 60_000, decimals: 0 })
        : null,
    }),
  });
}

export function normalizeRehearsalPerformance(raw = {}) {
  raw = raw ?? {};
  const mode = PERFORMANCE_MODES.has(raw.measurementMode) ? raw.measurementMode : 'SIMULATED';
  return Object.freeze({
    sourceEvidenceId: safeId(raw.sourceEvidenceId),
    measurementMode: mode,
    timeline: PERFORMANCE_TIMELINES.has(raw.timeline) ? raw.timeline : null,
    producer: PERFORMANCE_PRODUCERS.has(raw.producer) ? raw.producer : null,
    sourceOwner: PERFORMANCE_SOURCE_OWNERS.has(raw.sourceOwner) ? raw.sourceOwner : null,
    comparisonFingerprintSha256: /^[a-f0-9]{64}$/i.test(String(raw.comparisonFingerprintSha256))
      ? String(raw.comparisonFingerprintSha256).toLowerCase()
      : null,
    quietHostStatus: ['PASS', 'CONFOUNDED'].includes(raw.quietHostStatus) ? raw.quietHostStatus : 'UNKNOWN',
    durationMs: finite(raw.durationMs, { maximum: 86_400_000, decimals: 0 }),
    firstFrameMs: finite(raw.firstFrameMs, { maximum: 120_000, decimals: 0 }),
    fpsP10: finite(raw.fpsP10, { maximum: 240 }),
    p95FrameMs: finite(raw.p95FrameMs, { maximum: 120_000 }),
    maxFrameGapMs: finite(raw.maxFrameGapMs, { maximum: 120_000, decimals: 0 }),
    errorCount: finite(raw.errorCount, { maximum: 100_000, decimals: 0 }),
    renderer: ['WEBGL', 'STATIC'].includes(raw.renderer) ? raw.renderer : null,
    viewport: finite(raw.viewport?.width, { maximum: 16_384, decimals: 0 })
      && finite(raw.viewport?.height, { maximum: 16_384, decimals: 0 })
      ? Object.freeze({
        width: finite(raw.viewport.width, { maximum: 16_384, decimals: 0 }),
        height: finite(raw.viewport.height, { maximum: 16_384, decimals: 0 }),
      })
      : null,
  });
}

function compareLowerIsBetter(id, current, baseline, absoluteMaximum, regressionAllowance, baselineComparable) {
  if (current == null) return gate(id, 'UNKNOWN', current, 'current measurement required', `${id.toUpperCase()}_UNKNOWN`);
  if (current > absoluteMaximum) {
    return gate(id, 'STOP', { current, baseline: baselineComparable ? baseline : null }, `current <= ${absoluteMaximum}`, `${id.toUpperCase()}_ABSOLUTE_GATE_FAILED`);
  }
  if (!baselineComparable) {
    return gate(id, 'PASS', { current, baseline: null }, `current <= ${absoluteMaximum}; baseline delta intentionally not evaluated`, null);
  }
  if (baseline == null) return gate(id, 'UNKNOWN', { current, baseline }, 'baseline required for matched comparison', `${id.toUpperCase()}_BASELINE_UNKNOWN`);
  const passed = current <= baseline + regressionAllowance;
  return gate(id, passed ? 'PASS' : 'STOP', { current, baseline }, `current <= ${absoluteMaximum} and <= baseline + ${regressionAllowance}`, passed ? null : `${id.toUpperCase()}_REGRESSION`);
}

function compareFpsP10(current, baseline, baselineComparable) {
  if (current == null) return gate('fps-p10', 'UNKNOWN', { current, baseline: null }, 'current measurement required', 'FPS_P10_UNKNOWN');
  if (current < 28) return gate('fps-p10', 'STOP', { current, baseline: baselineComparable ? baseline : null }, 'current >= 28', 'FPS_P10_ABSOLUTE_GATE_FAILED');
  if (!baselineComparable) return gate('fps-p10', 'PASS', { current, baseline: null }, 'current >= 28; baseline delta intentionally not evaluated', null);
  if (baseline == null) return gate('fps-p10', 'UNKNOWN', { current, baseline }, 'baseline required for matched comparison', 'FPS_P10_BASELINE_UNKNOWN');
  const passed = current >= baseline - 2;
  return gate('fps-p10', passed ? 'PASS' : 'STOP', { current, baseline }, 'current >= 28 and >= baseline - 2', passed ? null : 'FPS_P10_REGRESSION');
}

function compareErrorCount(current, baseline, baselineComparable) {
  if (current == null) return gate('errors', 'UNKNOWN', { current, baseline: null }, 'current measurement required', 'ERROR_COUNT_UNKNOWN');
  if (current !== 0) return gate('errors', 'STOP', { current, baseline: baselineComparable ? baseline : null }, 'current = 0', 'ERROR_COUNT_ABSOLUTE_GATE_FAILED');
  if (!baselineComparable) return gate('errors', 'PASS', { current, baseline: null }, 'current = 0; baseline delta intentionally not evaluated', null);
  if (baseline == null) return gate('errors', 'UNKNOWN', { current, baseline }, 'baseline required for matched comparison', 'ERROR_COUNT_BASELINE_UNKNOWN');
  const passed = current <= baseline;
  return gate('errors', passed ? 'PASS' : 'STOP', { current, baseline }, 'current = 0 and <= baseline', passed ? null : 'ERROR_COUNT_REGRESSION');
}

export function compareRehearsalPerformance(currentRaw, baselineRaw) {
  const current = normalizeRehearsalPerformance(currentRaw);
  const baseline = normalizeRehearsalPerformance(baselineRaw);
  const realMeasurement = current.measurementMode === 'REAL_BROWSER'
    && ['REAL_BROWSER', 'BASELINE_REPLAY'].includes(baseline.measurementMode);
  const fingerprintMatches = current.comparisonFingerprintSha256 != null
    && current.comparisonFingerprintSha256 === baseline.comparisonFingerprintSha256;
  const comparabilityGates = [
    gate('measurement-mode', realMeasurement ? 'PASS' : 'UNKNOWN', { current: current.measurementMode, baseline: baseline.measurementMode }, 'REAL_BROWSER current + real/replayed baseline', 'PERFORMANCE_MODE_UNKNOWN'),
    gate('duration-comparability', current.durationMs != null && current.durationMs === baseline.durationMs ? 'PASS' : 'UNKNOWN', { current: current.durationMs, baseline: baseline.durationMs }, 'equal observation duration', 'DURATION_NOT_COMPARABLE'),
    gate('timeline-comparability', current.timeline != null && current.timeline === baseline.timeline ? 'PASS' : 'UNKNOWN', { current: current.timeline, baseline: baseline.timeline }, 'equal timeline ID', 'TIMELINE_NOT_COMPARABLE'),
    gate('producer-comparability', current.producer != null && current.producer === baseline.producer ? 'PASS' : 'UNKNOWN', { current: current.producer, baseline: baseline.producer }, 'equal producer ID', 'PRODUCER_NOT_COMPARABLE'),
    gate('source-owner-comparability', current.sourceOwner != null && current.sourceOwner === baseline.sourceOwner ? 'PASS' : 'UNKNOWN', { current: current.sourceOwner, baseline: baseline.sourceOwner }, 'equal source owner', 'SOURCE_OWNER_NOT_COMPARABLE'),
    gate('comparison-fingerprint', fingerprintMatches ? 'PASS' : 'UNKNOWN', { current: current.comparisonFingerprintSha256, baseline: baseline.comparisonFingerprintSha256 }, 'matching complete comparison fingerprint', 'FINGERPRINT_MISSING_OR_MISMATCHED'),
    gate('quiet-host', current.quietHostStatus === 'PASS' && baseline.quietHostStatus === 'PASS' ? 'PASS' : 'UNKNOWN', { current: current.quietHostStatus, baseline: baseline.quietHostStatus }, 'PASS for both runs', 'HOST_CONFOUNDED_OR_UNKNOWN'),
  ];
  const baselineComparable = verdict(comparabilityGates) === 'PASS';
  const metricGates = [
    compareLowerIsBetter('first-frame', current.firstFrameMs, baseline.firstFrameMs, 2_500, 250, baselineComparable),
    compareFpsP10(current.fpsP10, baseline.fpsP10, baselineComparable),
    compareLowerIsBetter('p95-frame', current.p95FrameMs, baseline.p95FrameMs, 55, 8, baselineComparable),
    compareLowerIsBetter('max-frame-gap', current.maxFrameGapMs, baseline.maxFrameGapMs, 1_000, 250, baselineComparable),
    compareErrorCount(current.errorCount, baseline.errorCount, baselineComparable),
  ];
  const gates = [...metricGates, ...comparabilityGates];
  return Object.freeze({
    verdict: verdict(gates),
    strictComparability: verdict(comparabilityGates),
    descriptiveMetricVerdict: verdict(metricGates),
    current,
    baseline,
    gates: Object.freeze(gates),
    comparableMetrics: Object.freeze([]),
    descriptiveMetrics: Object.freeze(['firstFrameMs', 'fpsP10', 'p95FrameMs', 'maxFrameGapMs', 'errorCount']),
    nonComparableMetrics: Object.freeze(['durationMs', 'timeline', 'producer', 'sourceOwner', 'comparisonFingerprint', 'quietHost', 'OBS dropped frames', 'audio content', 'real scene switches']),
  });
}

export function normalizeBaselineReference(raw = {}) {
  return Object.freeze({
    evidenceId: safeId(raw.evidenceId),
    hostStatus: ['PASS', 'CONFOUNDED'].includes(raw.hostStatus) ? raw.hostStatus : 'UNKNOWN',
    obs: Object.freeze({
      version: safeId(raw.obs?.version),
      recordingDurationMs: finite(raw.obs?.recordingDurationMs, { maximum: 86_400_000, decimals: 0 }),
      framesOutput: finite(raw.obs?.framesOutput, { maximum: 100_000_000, decimals: 0 }),
      framesDrawn: finite(raw.obs?.framesDrawn, { maximum: 100_000_000, decimals: 0 }),
      framesAttempted: finite(raw.obs?.framesAttempted, { maximum: 100_000_000, decimals: 0 }),
      renderLagFrames: finite(raw.obs?.renderLagFrames, { maximum: 100_000_000, decimals: 0 }),
      renderLagPpm: finite(raw.obs?.renderLagPpm, { maximum: 1_000_000, decimals: 0 }),
      encodingSkippedFrames: finite(raw.obs?.encodingSkippedFrames, { maximum: 100_000_000, decimals: 0 }),
      encodingAttemptedFrames: finite(raw.obs?.encodingAttemptedFrames, { maximum: 100_000_000, decimals: 0 }),
      encodingSkippedPpm: finite(raw.obs?.encodingSkippedPpm, { maximum: 1_000_000, decimals: 0 }),
      networkDroppedFramesLocal: raw.obs?.networkDroppedFramesLocal === 'NOT_APPLICABLE'
        ? 'NOT_APPLICABLE'
        : 'UNKNOWN',
      liveNetworkDroppedFrames: 'UNKNOWN',
    }),
    scenes: Object.freeze({
      cueCount: finite(raw.scenes?.cueCount, { maximum: 100_000, decimals: 0 }),
      passCount: finite(raw.scenes?.passCount, { maximum: 100_000, decimals: 0 }),
      failCount: finite(raw.scenes?.failCount, { maximum: 100_000, decimals: 0 }),
      delayedCount: finite(raw.scenes?.delayedCount, { maximum: 100_000, decimals: 0 }),
      maximumNormalCueDriftMs: finite(raw.scenes?.maximumNormalCueDriftMs, { maximum: 120_000, decimals: 0 }),
      clip30HoldMs: finite(raw.scenes?.clip30HoldMs, { maximum: 120_000, decimals: 0 }),
      clip60HoldMs: finite(raw.scenes?.clip60HoldMs, { maximum: 120_000, decimals: 0 }),
      globalSafe: raw.scenes?.globalSafe === 'FAIL' ? 'FAIL' : 'UNKNOWN',
      focusedSafe: raw.scenes?.focusedSafe === 'PASS' ? 'PASS' : 'UNKNOWN',
      globalStop: raw.scenes?.globalStop === 'FAIL' ? 'FAIL' : 'UNKNOWN',
      focusedStop: raw.scenes?.focusedStop === 'PASS' ? 'PASS' : 'UNKNOWN',
    }),
    audio: Object.freeze({
      sampleRateHz: finite(raw.audio?.sampleRateHz, { maximum: 384_000, decimals: 0 }),
      channels: finite(raw.audio?.channels, { maximum: 32, decimals: 0 }),
      codec: safeId(raw.audio?.codec),
      mixerVisibleSourcesMaximum: finite(raw.audio?.mixerVisibleSourcesMaximum, { maximum: 1_000, decimals: 0 }),
      captureGraphContract: raw.audio?.captureGraphContract === 'PASS' ? 'PASS' : 'UNKNOWN',
      decodedPcmInspection: 'UNKNOWN',
      humanListeningReview: 'UNKNOWN',
    }),
  });
}

export function createStreamRehearsalReport({
  plan,
  observations,
  clockMode = 'SIMULATED',
  currentPerformance,
  baselinePerformance,
  baselineReference,
  sourceDigests = {},
  liveDecision = 'STOP',
} = {}) {
  const planValidation = validateRehearsalShowPlan(plan);
  const planGateStatus = (id) => planValidation.gates.find((entry) => entry.id === id)?.status ?? 'STOP';
  const markerReplay = evaluateMarkerObservations(plan, observations, { clockMode });
  const performanceRegression = compareRehearsalPerformance(currentPerformance, baselinePerformance);
  const normalizedBaselineReference = normalizeBaselineReference(baselineReference);
  const pipelineStopped = planValidation.status === 'STOP'
    || markerReplay.contractReplayVerdict === 'STOP'
    || performanceRegression.verdict === 'STOP';
  const pipelineComplete = planValidation.status === 'PASS'
    && markerReplay.contractReplayVerdict === 'PASS'
    && performanceRegression.descriptiveMetricVerdict === 'PASS';
  const localPipeline = pipelineStopped ? 'STOP' : pipelineComplete ? 'PASS' : 'UNKNOWN';
  const normalizedLiveDecision = ['GO', 'HOLD', 'STOP'].includes(liveDecision) ? liveDecision : 'STOP';
  const unknowns = Object.freeze([
    'SHOW_15_REALTIME_DURATION',
    'STRICT_PERFORMANCE_COMPARISON_FINGERPRINT',
    'STRICT_PERFORMANCE_MATCHED_TIMELINE',
    'QUIET_HOST_CURRENT',
    'OBS_RENDER_DROPPED_FRAMES_CURRENT',
    'OBS_ENCODING_DROPPED_FRAMES_CURRENT',
    'NETWORK_DROPPED_FRAMES_LIVE',
    'AUDIO_CONTENT_LISTENING_CURRENT',
    'OBS_SCENE_SWITCHES_CURRENT',
    'REAL_MICROPHONE_CURRENT',
    'CTA_QR_PRODUCTION_CURRENT',
  ]);
  return Object.freeze({
    schemaVersion: STREAM_REHEARSAL_EVIDENCE_SCHEMA_VERSION,
    evidenceId: `stream-rehearsal-${String(plan?.id ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 72)}`,
    scope: 'LOCAL_SYNTHETIC_REHEARSAL',
    externalActions: 'LOCKED',
    sourceDigests: Object.freeze(Object.fromEntries(Object.entries(sourceDigests).map(([key, value]) => [
      String(key).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64),
      /^[a-f0-9]{64}$/i.test(String(value)) ? String(value).toLowerCase() : 'UNKNOWN',
    ]))),
    show: Object.freeze({
      id: String(plan?.id ?? 'UNKNOWN').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96),
      plannedDurationMs: finite(plan?.durationMs, { maximum: STREAM_SHOW_DURATION_MS, decimals: 0 }),
      plannedDurationTimecode: formatShowTimecode(plan?.durationMs),
      segmentCount: Array.isArray(plan?.segments) ? plan.segments.length : 0,
      markerCount: Array.isArray(plan?.markers) ? plan.markers.length : 0,
      clipCount: Array.isArray(plan?.clips) ? plan.clips.length : 0,
    }),
    planValidation,
    markerReplay,
    performanceRegression,
    baselineReference: normalizedBaselineReference,
    checks: Object.freeze({
      scenes: Object.freeze({ planContract: planValidation.status === 'PASS' ? 'PASS' : 'STOP', syntheticMarkers: markerReplay.contractReplayVerdict, actualObsSwitchesCurrent: 'UNKNOWN' }),
      audio: Object.freeze({ plannedCaptureContract: planGateStatus('audio-fixtures'), expectedContent: 'SILENCE', currentMixerEvidence: 'UNKNOWN', actualListeningCurrent: 'UNKNOWN', droppedSamplesCurrent: 'UNKNOWN' }),
      voice: Object.freeze({ syntheticUiMarkers: planGateStatus('voice-fixtures') === 'PASS' ? markerReplay.contractReplayVerdict : 'STOP', realMicrophone: 'UNKNOWN' }),
      cta: Object.freeze({ draftVisibility: planGateStatus('cta-fixtures'), productionDestination: 'STOP', qrScan: 'UNKNOWN' }),
      droppedFrames: Object.freeze({ localFrameGapMeasured: currentPerformance?.maxFrameGapMs != null ? 'PASS' : 'UNKNOWN', browserDroppedFramesCurrent: 'UNKNOWN', obsRenderDroppedFramesCurrent: 'UNKNOWN', obsEncodingDroppedFramesCurrent: 'UNKNOWN', networkDroppedFramesLocal: 'NOT_APPLICABLE', networkDroppedFramesLive: 'UNKNOWN' }),
    }),
    unknowns,
    decisions: Object.freeze({
      localPipeline,
      strictPerformanceRegression: performanceRegression.verdict,
      descriptivePerformanceMetrics: performanceRegression.descriptiveMetricVerdict,
      evidenceCompleteness: 'HOLD',
      supervisedLiveTest: normalizedLiveDecision === 'STOP' || localPipeline !== 'PASS' ? 'STOP' : 'HOLD',
      publication: 'LOCKED',
    }),
    shortformClips: Object.freeze((plan?.clips ?? []).map((clip) => Object.freeze({
      id: String(clip?.id ?? 'UNKNOWN').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64),
      startMs: finite(clip?.startMs, { maximum: STREAM_SHOW_DURATION_MS, decimals: 0 }),
      endMs: finite(clip?.endMs, { maximum: STREAM_SHOW_DURATION_MS, decimals: 0 }),
      durationMs: finite(Number(clip?.endMs) - Number(clip?.startMs), { maximum: 60_000, decimals: 0 }),
    }))),
    redaction: Object.freeze({
      version: 1,
      applied: true,
      excludes: Object.freeze(['absolute paths', 'raw URLs', 'credentials', 'transcripts', 'diagnostics', 'stacktraces', 'free-form errors']),
    }),
  });
}

export function renderStreamRehearsalReportMarkdown(report) {
  const provenance = report.reportProvenance ?? {};
  const performanceRows = report.performanceRegression.gates.map((entry) => (
    `| ${entry.id} | ${entry.status} | \`${JSON.stringify(entry.observed)}\` | ${entry.expected} |`
  )).join('\n');
  const unknownRows = report.unknowns.map((id) => `- \`${id}\``).join('\n');
  const clipRows = report.shortformClips.map((clip) => (
    `| ${clip.id} | ${formatShowTimecode(clip.startMs)} | ${formatShowTimecode(clip.endMs)} | ${clip.durationMs / 1_000}s |`
  )).join('\n');
  return `# Birdie Stream Rehearsal Evidence\n\n`
    + `Evidence-ID: \`${report.evidenceId}\`\n\n`
    + `Scope: \`${report.scope}\` · External actions: \`${report.externalActions}\`\n\n`
    + `Report-Erzeugungszeit: **UNKNOWN** (\`${provenance.generatedAtReason ?? 'NOT_RECORDED'}\`). Vergleichs-Input: \`${provenance.inputEvidenceIds?.comparisonLaunchConsole ?? 'UNKNOWN'}\`, erfasst \`${provenance.inputCapturedAtUtc?.comparisonLaunchConsole ?? 'UNKNOWN'}\`. Dieser historische Input ist kein aktueller Host-/Browserstatus.\n\n`
    + `## Entscheidungen\n\n`
    + `- Lokale Pipeline: **${report.decisions.localPipeline}**\n`
    + `- Strikter Performance-Regressionsvergleich: **${report.decisions.strictPerformanceRegression}**\n`
    + `- Deskriptive Gates des historischen Vergleichs-Inputs: **${report.decisions.descriptivePerformanceMetrics}**\n`
    + `- Evidence-Vollständigkeit: **${report.decisions.evidenceCompleteness}**\n`
    + `- Beaufsichtigter Live-Test: **${report.decisions.supervisedLiveTest}**\n`
    + `- Veröffentlichung: **${report.decisions.publication}**\n\n`
    + `Die Marker wurden im Modus \`${report.markerReplay.clockMode}\` geprüft. Eine synthetische 15-Minuten-Timeline ist kein Echtzeit-Dauernachweis.\n\n`
    + `## Performance gegen Baseline\n\n`
    + `Der strikte Vergleich ist nur bei identischer Dauer, Timeline, Producer, Source-Owner, vollständigem Fingerprint und ruhigem Host gültig. Deltas des historischen Report-Inputs sind andernfalls nur deskriptiv; die \`current\`-Schlüssel in der Tabelle benennen lediglich den Vergleichsslot.\n\n`
    + `| Gate | Status | Beobachtet | Erwartet |\n| --- | --- | --- | --- |\n${performanceRows}\n\n`
    + `## Checks\n\n`
    + `- Szenenvertrag: **${report.checks.scenes.planContract}**; echte aktuelle OBS-Wechsel: **${report.checks.scenes.actualObsSwitchesCurrent}**.\n`
    + `- Geplanter Audio-Capture-Vertrag: **${report.checks.audio.plannedCaptureContract}**; tatsächliches aktuelles Abhören: **${report.checks.audio.actualListeningCurrent}**.\n`
    + `- Synthetische Voice-Marker: **${report.checks.voice.syntheticUiMarkers}**; echtes Mikrofon: **${report.checks.voice.realMicrophone}**.\n`
    + `- CTA-Draft sichtbar: **${report.checks.cta.draftVisibility}**; Production-Ziel: **${report.checks.cta.productionDestination}**.\n`
    + `- Aktuelle OBS Render-/Encoding-Drops: **${report.checks.droppedFrames.obsRenderDroppedFramesCurrent} / ${report.checks.droppedFrames.obsEncodingDroppedFramesCurrent}**.\n`
    + `- Netzwerk-Drops im lokalen Nicht-Stream: **${report.checks.droppedFrames.networkDroppedFramesLocal}**; für Live: **${report.checks.droppedFrames.networkDroppedFramesLive}**.\n\n`
    + `## Frühere OBS-Referenz (kein strikter Vergleich)\n\n`
    + `- Frames: ${report.baselineReference.obs.framesOutput} output / ${report.baselineReference.obs.framesDrawn} drawn / ${report.baselineReference.obs.framesAttempted} attempted.\n`
    + `- Render-Lag: ${report.baselineReference.obs.renderLagFrames} Frames (${report.baselineReference.obs.renderLagPpm} ppm); Encoding-Skips: ${report.baselineReference.obs.encodingSkippedFrames} Frames (${report.baselineReference.obs.encodingSkippedPpm} ppm).\n`
    + `- Szenen-Cues: ${report.baselineReference.scenes.passCount} PASS, ${report.baselineReference.scenes.delayedCount} delayed, ${report.baselineReference.scenes.failCount} FAIL; globale SAFE/Stop-Pfade: ${report.baselineReference.scenes.globalSafe}/${report.baselineReference.scenes.globalStop}.\n`
    + `- Audio: ${report.baselineReference.audio.sampleRateHz} Hz, ${report.baselineReference.audio.channels} Kanäle, Mixer-Maximum ${report.baselineReference.audio.mixerVisibleSourcesMaximum}; Decode/Hörprüfung: ${report.baselineReference.audio.decodedPcmInspection}/${report.baselineReference.audio.humanListeningReview}.\n\n`
    + `## Explizite UNKNOWNs\n\n${unknownRows}\n\n`
    + `## Shortform-Cues\n\n| Clip | Start | Ende | Länge |\n| --- | ---: | ---: | ---: |\n${clipRows}\n\n`
    + `Dieser Report ist lokal und redigiert. Er startet weder OBS noch Aufnahme, Stream, Upload oder Außenaktion.\n`;
}
