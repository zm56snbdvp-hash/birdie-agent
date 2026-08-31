import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createStreamRehearsalReport,
  createSyntheticMarkerObservations,
  renderStreamRehearsalReportMarkdown,
} from '../apps/desktop/src/stream-rehearsal-evidence.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PATHS = Object.freeze({
  show: path.join(REPOSITORY_ROOT, 'ops', 'stream', 'birdie-stream-show-15min.json'),
  baseline: path.join(REPOSITORY_ROOT, 'ops', 'evidence', 'birdie-stream-general-rehearsal-20260830.json'),
  current: path.join(REPOSITORY_ROOT, 'ops', 'evidence', 'birdie-stream-launch-console-20260830.json'),
  outputJson: path.join(REPOSITORY_ROOT, 'ops', 'evidence', 'birdie-stream-rehearsal-pipeline-20260830.json'),
  outputMarkdown: path.join(REPOSITORY_ROOT, 'ops', 'evidence', 'birdie-stream-rehearsal-pipeline-20260830.md'),
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readJsonWithDigest(filePath) {
  const bytes = await readFile(filePath);
  return Object.freeze({ value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) });
}

export function extractGeneralRehearsalPerformance(evidence) {
  const browser = evidence?.browserEvidence ?? {};
  const stateP10 = Object.values(browser.stateP10Fps ?? {}).filter(Number.isFinite);
  return Object.freeze({
    sourceEvidenceId: evidence?.takeId,
    measurementMode: 'BASELINE_REPLAY',
    timeline: 'LOOP',
    producer: 'PARALLEL_LOCAL_BROWSER',
    sourceOwner: 'DIRECT_PAGE',
    comparisonFingerprintSha256: null,
    quietHostStatus: evidence?.hostPerformance?.status,
    durationMs: browser.durationMs,
    firstFrameMs: browser.firstFrameMs,
    fpsP10: stateP10.length ? Math.min(...stateP10) : null,
    p95FrameMs: browser.p95FrameMs,
    maxFrameGapMs: browser.maxFrameGapMs,
    errorCount: browser.errors,
    renderer: browser.renderer,
    viewport: browser.viewportCss === '1280x720' ? { width: 1280, height: 720 } : null,
  });
}

export function extractLaunchConsolePerformance(evidence) {
  const telemetry = evidence?.rehearsal?.telemetry ?? {};
  return Object.freeze({
    sourceEvidenceId: evidence?.evidenceId,
    measurementMode: 'REAL_BROWSER',
    timeline: telemetry.timeline,
    producer: 'OPERATOR_IFRAME',
    sourceOwner: 'OPERATOR_IFRAME',
    comparisonFingerprintSha256: null,
    quietHostStatus: 'UNKNOWN',
    durationMs: evidence?.rehearsal?.completedBoundaryMs,
    firstFrameMs: telemetry.firstFrameMs,
    fpsP10: telemetry.fpsP10,
    p95FrameMs: telemetry.p95FrameMs,
    maxFrameGapMs: telemetry.maxFrameGapMs,
    errorCount: telemetry.errorCount,
    renderer: telemetry.renderer,
    viewport: telemetry.viewport,
  });
}

export function extractGeneralRehearsalReference(evidence) {
  const obs = evidence?.obsEvidence ?? {};
  const timeline = Array.isArray(evidence?.sceneTimeline) ? evidence.sceneTimeline : [];
  const normalCues = timeline.filter((entry) => Number.isFinite(entry?.plannedSec)
    && Number.isFinite(entry?.actualSec)
    && !entry?.action
    && !entry?.method
    && entry?.status === 'PASS');
  const cueDriftsMs = normalCues.map((entry) => Math.round(Math.abs(entry.actualSec - entry.plannedSec) * 1_000));
  const clip30 = timeline.find((entry) => entry?.scene === '03_CLIP_30');
  const clip60 = timeline.find((entry) => entry?.scene === '04_CLIP_60');
  const returnMain = timeline.find((entry) => entry?.scene === '01_STREAM' && entry?.status === 'PASS' && entry?.plannedSec === 390);
  return Object.freeze({
    evidenceId: evidence?.takeId,
    hostStatus: evidence?.hostPerformance?.status,
    obs: Object.freeze({
      version: evidence?.configuration?.obsVersion,
      recordingDurationMs: evidence?.recordingDurationMs,
      framesOutput: obs.framesOutput,
      framesDrawn: obs.framesDrawn,
      framesAttempted: obs.framesAttempted,
      renderLagFrames: obs.renderLagFrames,
      renderLagPpm: Number.isFinite(obs.renderLagFrames) && Number.isFinite(obs.framesAttempted) && obs.framesAttempted > 0
        ? Math.round((obs.renderLagFrames / obs.framesAttempted) * 1_000_000)
        : null,
      encodingSkippedFrames: obs.encodingSkippedFrames,
      encodingAttemptedFrames: obs.encodingAttemptedFrames,
      encodingSkippedPpm: Number.isFinite(obs.encodingSkippedFrames) && Number.isFinite(obs.encodingAttemptedFrames) && obs.encodingAttemptedFrames > 0
        ? Math.round((obs.encodingSkippedFrames / obs.encodingAttemptedFrames) * 1_000_000)
        : null,
      networkDroppedFramesLocal: obs.externalStreamingStarted === false ? 'NOT_APPLICABLE' : 'UNKNOWN',
    }),
    scenes: Object.freeze({
      cueCount: timeline.length,
      passCount: timeline.filter((entry) => entry?.status === 'PASS').length,
      failCount: timeline.filter((entry) => entry?.status === 'FAIL').length,
      delayedCount: timeline.filter((entry) => entry?.status === 'PASS_WITH_DELAY').length,
      maximumNormalCueDriftMs: cueDriftsMs.length ? Math.max(...cueDriftsMs) : null,
      clip30HoldMs: Number.isFinite(clip30?.actualSec) && Number.isFinite(clip60?.actualSec)
        ? Math.round((clip60.actualSec - clip30.actualSec) * 1_000)
        : null,
      clip60HoldMs: Number.isFinite(clip60?.actualSec) && Number.isFinite(returnMain?.actualSec)
        ? Math.round((returnMain.actualSec - clip60.actualSec) * 1_000)
        : null,
      globalSafe: timeline.some((entry) => entry?.scene === '99_SAFE' && entry?.status === 'FAIL') ? 'FAIL' : 'UNKNOWN',
      focusedSafe: timeline.some((entry) => entry?.scene === '99_SAFE' && entry?.method?.includes('OBS focused') && entry?.status === 'PASS') ? 'PASS' : 'UNKNOWN',
      globalStop: timeline.some((entry) => entry?.action === 'stop recording' && entry?.status === 'FAIL') ? 'FAIL' : 'UNKNOWN',
      focusedStop: timeline.some((entry) => entry?.action === 'stop recording' && entry?.method?.includes('OBS focused') && entry?.status === 'PASS') ? 'PASS' : 'UNKNOWN',
    }),
    audio: Object.freeze({
      sampleRateHz: 48_000,
      channels: 2,
      codec: 'AAC',
      mixerVisibleSourcesMaximum: obs.mixerVisibleSourcesDuringTake,
      captureGraphContract: obs.mixerVisibleSourcesDuringTake === 0 ? 'PASS' : 'UNKNOWN',
    }),
  });
}

export async function runStreamRehearsalEvidence({
  synthetic = false,
  write = false,
  paths = DEFAULT_PATHS,
} = {}) {
  if (!synthetic) {
    throw new Error('Only the explicit --synthetic local fixture is supported by this command.');
  }
  const [show, baseline, current] = await Promise.all([
    readJsonWithDigest(paths.show),
    readJsonWithDigest(paths.baseline),
    readJsonWithDigest(paths.current),
  ]);
  const observations = createSyntheticMarkerObservations(show.value);
  const report = createStreamRehearsalReport({
    plan: show.value,
    observations,
    clockMode: 'SIMULATED',
    currentPerformance: extractLaunchConsolePerformance(current.value),
    baselinePerformance: extractGeneralRehearsalPerformance(baseline.value),
    baselineReference: extractGeneralRehearsalReference(baseline.value),
    sourceDigests: {
      showPlan: show.sha256,
      performanceBaseline: baseline.sha256,
      currentLaunchConsole: current.sha256,
    },
    liveDecision: current.value?.decisions?.livePublish ?? 'STOP',
  });
  const reportWithProvenance = Object.freeze({
    ...report,
    reportProvenance: Object.freeze({
      generatedAtUtc: null,
      generatedAtReason: 'OMITTED_FOR_DETERMINISTIC_REPLAY',
      comparisonInputStatus: 'HISTORICAL_REPORT_INPUT_NOT_CURRENT_HOST_STATUS',
      inputEvidenceIds: Object.freeze({
        performanceBaseline: baseline.value?.takeId ?? null,
        comparisonLaunchConsole: current.value?.evidenceId ?? null,
      }),
      inputCapturedAtUtc: Object.freeze({
        performanceBaseline: baseline.value?.recordingStartUtc ?? null,
        comparisonLaunchConsole: current.value?.capturedUtc ?? null,
      }),
    }),
  });
  const canonicalSha256 = sha256(Buffer.from(stableJson(reportWithProvenance), 'utf8'));
  const finalReport = Object.freeze({ ...reportWithProvenance, canonicalSha256 });
  const markdown = renderStreamRehearsalReportMarkdown(finalReport);
  if (write) {
    await Promise.all([
      writeFile(paths.outputJson, `${JSON.stringify(finalReport, null, 2)}\n`, 'utf8'),
      writeFile(paths.outputMarkdown, markdown, 'utf8'),
    ]);
  }
  return Object.freeze({ report: finalReport, markdown, paths });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const synthetic = process.argv.includes('--synthetic');
  const write = process.argv.includes('--write');
  try {
    const { report, paths } = await runStreamRehearsalEvidence({ synthetic, write });
    process.stdout.write(`${JSON.stringify({
      evidenceId: report.evidenceId,
      canonicalSha256: report.canonicalSha256,
      localPipeline: report.decisions.localPipeline,
      performanceRegression: report.decisions.strictPerformanceRegression,
      descriptivePerformanceMetrics: report.decisions.descriptivePerformanceMetrics,
      evidenceCompleteness: report.decisions.evidenceCompleteness,
      supervisedLiveTest: report.decisions.supervisedLiveTest,
      publication: report.decisions.publication,
      unknowns: report.unknowns,
      wrote: write ? {
        json: path.relative(REPOSITORY_ROOT, paths.outputJson).replaceAll('\\', '/'),
        markdown: path.relative(REPOSITORY_ROOT, paths.outputMarkdown).replaceAll('\\', '/'),
      } : false,
    }, null, 2)}\n`);
    process.exitCode = report.decisions.localPipeline === 'PASS'
      && report.decisions.comparablePerformanceRegression !== 'STOP' ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Birdie rehearsal evidence failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
