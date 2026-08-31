export const STREAM_EVIDENCE_SCHEMA_VERSION = 1;

const ACTIVE_STATES = Object.freeze(['SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING', 'WORKING', 'SUCCESS']);
const TIMELINE_STATES = Object.freeze({
  LOOP: Object.freeze(['IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING', 'SUCCESS', 'IDLE', 'LISTENING', 'WORKING', 'SPEAKING']),
  CLIP_30: Object.freeze(['IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING', 'SUCCESS', 'IDLE']),
  CLIP_60: Object.freeze(['IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'WORKING', 'SPEAKING', 'SUCCESS', 'IDLE']),
});
const STREAM_SOAK_MINIMUM_MS = 600_000;
const STREAM_SOAK_MINIMUM_LOOPS = 8;

function gate(id, status, observed, expected) {
  return Object.freeze({ id, status, observed, expected });
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)];
}

export function resolveStreamRenderProfile(search = '', prefersReducedMotion = false) {
  const query = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const renderer = ['backup', 'static'].includes(String(query.get('renderer')).toLowerCase())
    ? 'STATIC'
    : 'WEBGL';
  const requestedQuality = String(query.get('quality') ?? 'auto').toLowerCase();
  const quality = renderer === 'STATIC'
    ? 'LOW'
    : requestedQuality === 'low' || (requestedQuality === 'auto' && prefersReducedMotion)
      ? 'LOW'
      : 'HIGH';
  return Object.freeze({
    renderer,
    quality,
    label: renderer === 'STATIC' ? 'STATIC BACKUP' : `${quality} WEBGL`,
    idleFpsMinimum: quality === 'LOW' ? 24 : 28,
    activeFpsMinimum: quality === 'LOW' ? 24 : 28,
    longFrameThresholdMs: quality === 'LOW' ? 60 : 55,
  });
}

function stateFpsLowerBound(fpsByPresence, state) {
  const sample = fpsByPresence?.[state];
  if (!sample) return null;
  const values = Array.isArray(sample.values)
    ? sample.values.filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  if (values.length) return percentile(values, 0.1);
  if (Number.isFinite(sample.minimum) && sample.minimum >= 0) return sample.minimum;
  return Number.isFinite(sample.average) && sample.average >= 0 ? sample.average : null;
}

function activeFpsAudit(fpsByPresence, requiredStates = ACTIVE_STATES) {
  const byState = Object.fromEntries(
    requiredStates.map((state) => [state, stateFpsLowerBound(fpsByPresence, state)]),
  );
  const missing = requiredStates.filter((state) => byState[state] == null);
  const values = Object.values(byState).filter(Number.isFinite);
  return Object.freeze({
    byState: Object.freeze(byState),
    lowerBound: values.length ? Math.min(...values) : null,
    missing: Object.freeze(missing),
  });
}

function auditTimeline(snapshot) {
  const expected = TIMELINE_STATES[snapshot.timeline] ?? TIMELINE_STATES.LOOP;
  const observed = (snapshot.transitions ?? []).map((entry) => entry.to);
  const required = [...new Set(expected)];
  const missing = required.filter((state) => !observed.includes(state));
  const collapsedLoopBoundary = expected.length > 1 && expected.at(-1) === expected[0];
  let cursor = 0;
  let violations = 0;
  for (const state of observed) {
    if (state !== expected[cursor]) {
      violations += 1;
      continue;
    }
    const matchedFinalState = cursor === expected.length - 1;
    cursor = matchedFinalState
      ? collapsedLoopBoundary ? 1 : 0
      : cursor + 1;
  }
  return Object.freeze({ missing: Object.freeze(missing), violations });
}

function auditTransitionSequence(snapshot) {
  const transitions = Array.isArray(snapshot.transitions) ? snapshot.transitions : [];
  const reportedSequence = Number(snapshot.transitionSequence);
  let previous = 0;
  let firstViolation = null;
  for (let index = 0; index < transitions.length; index += 1) {
    const sequence = Number(transitions[index]?.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      firstViolation = Object.freeze({ index, reason: 'INVALID', expected: previous + 1, observed: sequence });
      break;
    }
    if (sequence !== previous + 1) {
      const reason = sequence === previous
        ? 'DUPLICATE'
        : sequence < previous ? 'NON_MONOTONIC' : 'GAP';
      firstViolation = Object.freeze({ index, reason, expected: previous + 1, observed: sequence });
      break;
    }
    previous = sequence;
  }
  if (!firstViolation && (!Number.isSafeInteger(reportedSequence) || reportedSequence < 0)) {
    firstViolation = Object.freeze({
      index: transitions.length,
      reason: 'REPORTED_INVALID',
      expected: previous,
      observed: reportedSequence,
    });
  }
  if (!firstViolation && reportedSequence !== previous) {
    firstViolation = Object.freeze({
      index: transitions.length,
      reason: 'REPORTED_MISMATCH',
      expected: previous,
      observed: reportedSequence,
    });
  }
  return Object.freeze({
    retained: transitions.length,
    firstSequence: transitions.length ? Number(transitions[0]?.sequence) : null,
    lastSequence: transitions.length ? Number(transitions.at(-1)?.sequence) : null,
    reportedSequence,
    firstViolation,
  });
}

export function evaluateStreamEvidence(snapshot) {
  const profile = snapshot.profile ?? resolveStreamRenderProfile();
  const expectedTimelineStates = TIMELINE_STATES[snapshot.timeline] ?? TIMELINE_STATES.LOOP;
  const requiredActiveStates = [...new Set(
    expectedTimelineStates.filter((state) => ACTIVE_STATES.includes(state)),
  )];
  const viewport = snapshot.viewport ?? null;
  const aspect = viewport?.width > 0 && viewport?.height > 0
    ? viewport.width / viewport.height
    : null;
  const idleFps = stateFpsLowerBound(snapshot.fpsByPresence, 'IDLE');
  const activeFps = activeFpsAudit(snapshot.fpsByPresence, requiredActiveStates);
  const completedLoop = Number(snapshot.loopCount) >= 1;
  const completedSoak = Number(snapshot.durationMs) >= STREAM_SOAK_MINIMUM_MS
    && Number(snapshot.loopCount) >= STREAM_SOAK_MINIMUM_LOOPS;
  const p95FrameMs = percentile(snapshot.frameIntervalsMs ?? [], 0.95);
  const intervalCount = snapshot.frameIntervalsMs?.length ?? 0;
  const longFrameRate = intervalCount > 0 ? (Number(snapshot.longFrames) || 0) / intervalCount : null;
  const timelineAudit = auditTimeline(snapshot);
  const transitionSequenceAudit = auditTransitionSequence(snapshot);
  const expectedTransitionsPerLoop = expectedTimelineStates.length;
  const collapsedLoopBoundary = expectedTimelineStates.length > 1
    && expectedTimelineStates.at(-1) === expectedTimelineStates[0];
  const observedLoopCount = Math.max(0, Number(snapshot.loopCount) || 0);
  const expectedTransitionVolume = observedLoopCount > 0
    ? expectedTransitionsPerLoop
      + Math.max(0, observedLoopCount - 1) * (expectedTransitionsPerLoop - Number(collapsedLoopBoundary))
    : 0;
  const retainedTransitionVolume = Array.isArray(snapshot.transitions)
    ? snapshot.transitions.length
    : 0;
  const snapshotRenderer = String(snapshot.renderer ?? '').toUpperCase();
  const profileRenderer = String(profile.renderer ?? '').toUpperCase();
  const validRenderers = new Set(['WEBGL', 'STATIC']);
  const rendererIdentityContradictory = !validRenderers.has(profileRenderer)
    || (snapshotRenderer !== ''
      && (!validRenderers.has(snapshotRenderer) || snapshotRenderer !== profileRenderer));
  const staticVisualUnproven = snapshotRenderer === 'STATIC'
    || profileRenderer === 'STATIC'
    || snapshot.visualPerformanceSignal === 'UNPROVEN_STATIC_CSS';
  const config = snapshot.config ?? {};
  const declaredQrHash = String(config.qrSha256 ?? '').toLowerCase();
  const actualQrHash = String(config.actualQrSha256 ?? '').toLowerCase();
  const conversionEvidenceReady = config.conversionReady === true
    && config.conversionDeclaredReady === true
    && config.qrAssetHashVerified === true
    && config.qrPayloadVerified === true
    && config.qrPayloadStatus === 'PASS'
    && config.qrRenderReady === true
    && config.qrMatchesCta === true
    && config.qrScanVerified === true
    && config.qrConfigured === true
    && config.ctaStatus === 'READY'
    && config.placeholderCta === false
    && config.ctaUrlCanonical === true
    && config.qrTargetCanonical === true
    && config.conversionOverridesIgnored === false
    && /^[a-f0-9]{64}$/.test(declaredQrHash)
    && actualQrHash === declaredQrHash;
  const conversionEvidenceContradictory = config.conversionReady === true
    && !conversionEvidenceReady;
  const gates = [
    gate(
      'renderer-identity',
      rendererIdentityContradictory ? 'STOP' : 'PASS',
      Object.freeze({ snapshot: snapshotRenderer || null, profile: profileRenderer || null }),
      'snapshot renderer absent or equal to a known profile renderer',
    ),
    gate(
      'first-frame',
      staticVisualUnproven || snapshot.firstFrameMs == null
        ? 'UNPROVEN'
        : snapshot.firstFrameMs <= 2_500 ? 'PASS' : 'STOP',
      snapshot.firstFrameMs,
      '<= 2500 ms',
    ),
    gate(
      'config-ready',
      snapshot.configReadyMs == null ? 'UNPROVEN' : snapshot.configReadyMs <= 3_000 ? 'PASS' : 'STOP',
      snapshot.configReadyMs,
      '<= 3000 ms',
    ),
    gate(
      'aspect-ratio',
      aspect == null ? 'UNPROVEN' : Math.abs(aspect - 16 / 9) <= 0.002 ? 'PASS' : 'STOP',
      aspect,
      '16:9 +/- 0.002',
    ),
    gate(
      'render-errors',
      Number(snapshot.errors) === 0 ? 'PASS' : 'STOP',
      Number(snapshot.errors) || 0,
      '0',
    ),
    gate(
      'full-loop',
      completedLoop ? 'PASS' : 'UNPROVEN',
      Number(snapshot.loopCount) || 0,
      '>= 1',
    ),
    gate(
      'state-coverage',
      timelineAudit.missing.length > 0
        ? completedLoop ? 'STOP' : 'UNPROVEN'
        : completedLoop ? 'PASS' : 'UNPROVEN',
      timelineAudit.missing,
      'no missing timeline states',
    ),
    gate(
      'transition-order',
      timelineAudit.violations > 0 ? 'STOP' : completedLoop ? 'PASS' : 'UNPROVEN',
      timelineAudit.violations,
      '0',
    ),
    gate(
      'transition-sequence-integrity',
      transitionSequenceAudit.firstViolation
        ? 'STOP'
        : completedLoop ? 'PASS' : 'UNPROVEN',
      transitionSequenceAudit,
      'contiguous unique sequence IDs starting at 1, with reportedSequence equal to the retained last ID',
    ),
    gate(
      'idle-fps',
      staticVisualUnproven
        ? 'UNPROVEN'
        : idleFps == null ? 'UNPROVEN' : idleFps >= profile.idleFpsMinimum ? 'PASS' : 'STOP',
      idleFps,
      `state p10 >= ${profile.idleFpsMinimum}`,
    ),
    gate(
      'active-fps',
      staticVisualUnproven
        ? 'UNPROVEN'
        : activeFps.missing.length > 0
          ? completedLoop ? 'STOP' : 'UNPROVEN'
          : activeFps.lowerBound >= profile.activeFpsMinimum ? 'PASS' : 'STOP',
      activeFps,
      `every active state p10 >= ${profile.activeFpsMinimum}`,
    ),
    gate(
      'render-stall',
      snapshot.renderStalled ? 'STOP' : staticVisualUnproven ? 'UNPROVEN' : completedLoop ? 'PASS' : 'UNPROVEN',
      Boolean(snapshot.renderStalled),
      false,
    ),
    gate(
      'frame-gaps',
      Number(snapshot.maxFrameGapMs) > 1_000
        ? 'STOP'
        : staticVisualUnproven || intervalCount === 0
          ? 'UNPROVEN'
          : completedLoop ? 'PASS' : 'UNPROVEN',
      Number(snapshot.maxFrameGapMs) || 0,
      '<= 1000 ms',
    ),
    gate(
      'p95-frame-time',
      staticVisualUnproven || p95FrameMs == null
        ? 'UNPROVEN'
        : p95FrameMs <= profile.longFrameThresholdMs ? 'PASS' : 'STOP',
      p95FrameMs,
      `<= ${profile.longFrameThresholdMs} ms`,
    ),
    gate(
      'long-frame-rate',
      staticVisualUnproven || longFrameRate == null
        ? 'UNPROVEN'
        : longFrameRate <= 0.1 ? 'PASS' : 'STOP',
      longFrameRate,
      '<= 0.1',
    ),
    gate(
      'soak-duration',
      Number(snapshot.durationMs) >= STREAM_SOAK_MINIMUM_MS ? 'PASS' : 'UNPROVEN',
      Math.round(Number(snapshot.durationMs) || 0),
      `>= ${STREAM_SOAK_MINIMUM_MS} ms`,
    ),
    gate(
      'soak-loops',
      Number(snapshot.loopCount) >= STREAM_SOAK_MINIMUM_LOOPS ? 'PASS' : 'UNPROVEN',
      Number(snapshot.loopCount) || 0,
      `>= ${STREAM_SOAK_MINIMUM_LOOPS}`,
    ),
    gate(
      'soak-transition-volume',
      Number(snapshot.loopCount) < STREAM_SOAK_MINIMUM_LOOPS
        ? 'UNPROVEN'
        : retainedTransitionVolume >= expectedTransitionVolume ? 'PASS' : 'STOP',
      Object.freeze({
        retained: retainedTransitionVolume,
        reportedSequence: Number(snapshot.transitionSequence) || 0,
      }),
      `>= ${expectedTransitionVolume} retained transition records for ${observedLoopCount} completed loops`,
    ),
    gate(
      'cta-qr',
      conversionEvidenceReady ? 'PASS' : conversionEvidenceContradictory ? 'STOP' : 'UNPROVEN',
      Object.freeze({
        conversionReady: Boolean(config.conversionReady),
        conversionDeclaredReady: Boolean(config.conversionDeclaredReady),
        qrAssetHashVerified: Boolean(config.qrAssetHashVerified),
        qrPayloadVerified: Boolean(config.qrPayloadVerified),
        qrPayloadStatus: String(config.qrPayloadStatus ?? 'UNKNOWN'),
        qrRenderReady: Boolean(config.qrRenderReady),
        qrHashMatches: Boolean(declaredQrHash && actualQrHash === declaredQrHash),
      }),
      'real CTA + matching local QR',
    ),
  ];
  const soakGateIds = new Set(['soak-duration', 'soak-loops', 'soak-transition-volume']);
  const coreGates = gates.filter((entry) => entry.id !== 'cta-qr' && !soakGateIds.has(entry.id));
  const coreHasStop = coreGates.some((entry) => entry.status === 'STOP');
  const demoVerdict = coreHasStop
    ? 'STOP'
    : coreGates.every((entry) => entry.status === 'PASS') ? 'PASS' : 'UNPROVEN';
  const soakGates = gates.filter((entry) => soakGateIds.has(entry.id));
  const soakVerdict = coreHasStop || soakGates.some((entry) => entry.status === 'STOP')
    ? 'STOP'
    : completedSoak && soakGates.every((entry) => entry.status === 'PASS') && demoVerdict === 'PASS'
      ? 'PASS'
      : 'UNPROVEN';
  const conversionGate = gates.find((entry) => entry.id === 'cta-qr');
  const conversionVerdict = demoVerdict === 'STOP' || conversionGate?.status === 'STOP'
    ? 'STOP'
    : demoVerdict === 'PASS' && conversionEvidenceReady ? 'PASS' : 'UNPROVEN';
  return Object.freeze({
    schemaVersion: STREAM_EVIDENCE_SCHEMA_VERSION,
    demoVerdict,
    soakVerdict,
    conversionVerdict,
    p95FrameMs,
    longFrameRate,
    transitionWindow: transitionSequenceAudit,
    gates: Object.freeze(gates),
  });
}
