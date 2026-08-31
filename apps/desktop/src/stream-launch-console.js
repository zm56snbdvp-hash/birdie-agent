import './stream-launch-console.css';
import obsPlan from '../../../ops/obs/birdie-stream-local.scene-plan.json';
import {
  DEFAULT_STREAM_CONFIG,
  resolveStreamConfig,
  verifyStreamQrAsset,
} from './stream-mode-config.js';
import {
  PREFLIGHT_REASON_LABELS,
  buildLaunchPreflight,
  buildRehearsalMarkers,
  createOperatorEvidence,
  evaluateLocalRehearsal,
  formatOperatorTimecode,
  operatorRehearsalFrame,
  redactLocalTelemetry,
  shouldFinalizeRehearsal,
} from './stream-launch-console-contract.js';

const PREVIEW_POLL_INTERVAL_MS = 250;

function previewUrl(preset, fixture = null, rehearsalRunId = null) {
  const query = new URLSearchParams({ mode: 'stream', demo: 'loop' });
  if (preset === 'CLIP_30') query.set('clip', '30');
  if (preset === 'CLIP_60') query.set('clip', '60');
  if (fixture === 'error') query.set('fixture', 'error');
  if (fixture === 'fallback') {
    query.set('renderer', 'backup');
    query.set('quality', 'low');
  }
  if (/^[A-Za-z0-9._-]{8,96}$/.test(String(rehearsalRunId ?? ''))) {
    query.set('rehearsalRunId', rehearsalRunId);
  }
  return `/?${query.toString()}`;
}

function text(element, value) {
  if (element) element.textContent = value;
}

export function startStreamLaunchConsole({ app, buildId }) {
  if (!app) throw new Error('operator root missing');

  app.innerHTML = `
    <main id="operator-console" aria-label="Birdie lokale Stream Launch Console">
      <div class="operator-topography" aria-hidden="true">
        ${Array.from({ length: 7 }, (_, index) => `<i style="--operator-ring:${index}"></i>`).join('')}
      </div>

      <header class="operator-header">
        <div class="operator-brand">
          <span class="operator-brand-mark" aria-hidden="true"></span>
          <div><strong>BIRDIE</strong><small>LOCAL STREAM OPERATOR</small></div>
        </div>
        <div class="operator-lock"><span>EXTERNAL ACTIONS</span><strong>LOCKED</strong></div>
        <div id="operator-live-verdict" class="operator-verdict" data-state="STOP" aria-live="polite">
          <span>LIVE / PUBLISH</span><strong>STOP</strong>
        </div>
      </header>

      <section class="operator-layout">
        <aside class="operator-preflight" aria-labelledby="operator-preflight-title">
          <div class="operator-section-heading">
            <span>01</span><div><h1 id="operator-preflight-title">Preflight</h1><p>Letzte lokale Launch-Evidenz</p></div>
          </div>
          <div id="operator-preflight-gates" class="operator-gates"></div>
        </aside>

        <section class="operator-stage" aria-labelledby="operator-stage-title">
          <div class="operator-section-heading operator-stage-heading">
            <span>02</span><div><h2 id="operator-stage-title">Rehearsal Deck</h2><p>Same-origin Preview · nicht OBS-Evidenz</p></div>
            <div id="operator-rehearsal-verdict" class="operator-mini-verdict" data-state="HOLD" aria-live="polite">
              <span>LOCAL</span><strong>HOLD</strong>
            </div>
          </div>

          <div id="operator-preview-shell" class="operator-preview-shell" data-state="idle">
            <iframe
              id="operator-preview"
              title="Lokale Birdie Stream-Vorschau"
              src="${previewUrl('CLIP_30')}"
              tabindex="-1"
              aria-label="Lokale Stream-Vorschau, kein OBS-Nachweis"
            ></iframe>
            <div id="operator-safe-slate" class="operator-safe-slate" hidden>
              <span>LOCAL SAFE</span><strong>KEINE AUSSENAKTION</strong>
            </div>
            <div class="operator-preview-label"><span>LOCAL PREVIEW</span><strong>NOT OBS EVIDENCE</strong></div>
            <div class="operator-playhead-state">
              <span id="operator-timecode">00:00</span>
              <strong id="operator-state">IDLE</strong>
              <small id="operator-state-copy">Noch keine Generalprobe gestartet</small>
            </div>
          </div>

          <div class="operator-timeline-wrap">
            <div class="operator-timeline-meta">
              <span id="operator-preset-label">CLIP 30 · REALTIME</span>
              <strong id="operator-progress-label">0%</strong>
            </div>
            <div
              id="operator-progress"
              class="operator-progress"
              role="progressbar"
              aria-label="Fortschritt der lokalen Generalprobe"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="0"
            ><i></i></div>
            <ol id="operator-markers" class="operator-markers" aria-label="Synthetische Zeitmarken"></ol>
          </div>

          <div class="operator-controls" aria-label="Lokale Rehearsal-Steuerung">
            <button type="button" class="operator-primary" data-start-preset="CLIP_30">30 S STARTEN</button>
            <button type="button" data-start-preset="CLIP_60">60 S STARTEN</button>
            <button type="button" id="operator-fallback">FALLBACK</button>
            <button type="button" id="operator-error">ERROR TEST</button>
            <button type="button" id="operator-safe" class="operator-stop">LOCAL SAFE</button>
          </div>
        </section>

        <aside class="operator-rail" aria-label="Launch-Gründe und lokale Telemetrie">
          <section class="operator-reasons" aria-labelledby="operator-reasons-title">
            <div class="operator-section-heading"><span>03</span><div><h2 id="operator-reasons-title">Warum STOP?</h2><p>Keine automatische Aktion</p></div></div>
            <ol id="operator-reason-list"></ol>
          </section>

          <section class="operator-telemetry" aria-labelledby="operator-telemetry-title">
            <div class="operator-section-heading"><span>04</span><div><h2 id="operator-telemetry-title">Telemetry</h2><p>Local · redacted</p></div></div>
            <dl>
              <div><dt>START</dt><dd id="operator-startup">-- MS</dd></div>
              <div><dt>FPS / P10</dt><dd id="operator-fps">-- / --</dd></div>
              <div><dt>P95 FRAME</dt><dd id="operator-p95">-- MS</dd></div>
              <div><dt>MAX GAP</dt><dd id="operator-gap">-- MS</dd></div>
              <div><dt>HEAP</dt><dd id="operator-heap">-- MB</dd></div>
              <div><dt>ERRORS</dt><dd id="operator-errors">0</dd></div>
            </dl>
            <p id="operator-error-codes" class="operator-error-codes">CODES: NONE</p>
          </section>

          <section class="operator-conversion" aria-label="CTA und QR Status">
            <span>CTA / QR TARGET</span>
            <strong id="operator-cta-target">example.com/birdie</strong>
            <small id="operator-qr-state">DRAFT · NICHT SCANNBAR</small>
          </section>
        </aside>
      </section>

      <footer class="operator-footer">
        <span>LOCAL ONLY</span><span>SYNTHETIC VOICE · NO MIC TEST</span><span>STREAMING OFF</span>
        <strong id="operator-build">BUILD ${String(buildId ?? 'LOCAL').slice(0, 12)}</strong>
      </footer>
      <output id="operator-evidence" hidden aria-hidden="true"></output>
    </main>
  `;

  const $ = (selector) => app.querySelector(selector);
  const preview = $('#operator-preview');
  const previewShell = $('#operator-preview-shell');
  const safeSlate = $('#operator-safe-slate');
  const startedAt = performance.now();
  let config = resolveStreamConfig(DEFAULT_STREAM_CONFIG);
  let livePreflight = buildLaunchPreflight({ plan: obsPlan, config });
  let rehearsalStatus = 'IDLE';
  let rehearsalPreset = 'CLIP_30';
  let rehearsalStartedAt = null;
  let rehearsalElapsedMs = 0;
  let rehearsalRunId = null;
  let rehearsalSequence = 0;
  let latestRawTelemetry = null;
  let frozenRawTelemetry = null;
  let latestTelemetry = null;
  let rehearsalDecision = evaluateLocalRehearsal({
    status: rehearsalStatus,
    preset: rehearsalPreset,
    runId: rehearsalRunId,
    elapsedMs: rehearsalElapsedMs,
    telemetry: latestTelemetry,
  });
  let animationFrame = 0;
  let previewPollTimer = 0;
  let disposed = false;
  const localErrorLog = [];

  function scalePreview() {
    const scale = previewShell.clientWidth / 1_280;
    preview.style.transform = `scale(${Math.max(0.1, scale)})`;
  }

  const previewResizeObserver = new ResizeObserver(scalePreview);
  previewResizeObserver.observe(previewShell);
  scalePreview();

  function recordLocalError(code = 'LOCAL_ERROR') {
    localErrorLog.push(Object.freeze({ code, atMs: Math.round(performance.now() - startedAt) }));
    if (localErrorLog.length > 16) localErrorLog.shift();
  }

  function previewSnapshot() {
    try {
      const snapshot = preview.contentWindow?.__birdieStream?.getMetrics?.();
      if (!snapshot) return null;
      const heapUsedMb = Number.isFinite(performance.memory?.usedJSHeapSize)
        ? performance.memory.usedJSHeapSize / 1024 / 1024
        : null;
      return {
        ...snapshot,
        localHeapUsedMb: heapUsedMb,
        errors: (Number(snapshot.errors) || 0) + localErrorLog.length,
        errorLog: [...(snapshot.errorLog ?? []), ...localErrorLog],
      };
    } catch {
      recordLocalError('LOCAL_ERROR');
      return null;
    }
  }

  function renderPreflight() {
    const gatesRoot = $('#operator-preflight-gates');
    gatesRoot.replaceChildren();
    for (const gate of livePreflight.gates) {
      const item = document.createElement('article');
      item.className = 'operator-gate';
      item.dataset.status = gate.status;
      const heading = document.createElement('div');
      const label = document.createElement('strong');
      const status = document.createElement('span');
      const value = document.createElement('p');
      label.textContent = gate.label;
      status.textContent = gate.status;
      value.textContent = gate.value;
      heading.append(label, status);
      item.append(heading, value);
      gatesRoot.append(item);
    }

    const verdict = $('#operator-live-verdict');
    verdict.dataset.state = livePreflight.decision.state;
    text(verdict.querySelector('strong'), livePreflight.decision.state);
    document.documentElement.dataset.operatorLive = livePreflight.decision.state.toLowerCase();

    const reasonsRoot = $('#operator-reason-list');
    reasonsRoot.replaceChildren();
    for (const reasonId of livePreflight.decision.reasonIds.slice(0, 5)) {
      const item = document.createElement('li');
      const code = document.createElement('span');
      const copy = document.createElement('p');
      code.textContent = reasonId;
      copy.textContent = PREFLIGHT_REASON_LABELS[reasonId] ?? PREFLIGHT_REASON_LABELS.PREFLIGHT_INVALID;
      item.append(code, copy);
      reasonsRoot.append(item);
    }

    text($('#operator-cta-target'), livePreflight.gates.find((gate) => gate.id === 'conversion')?.value ?? 'TARGET REDACTED');
    text($('#operator-qr-state'), config.conversionReady
      ? 'READY · HASH + PAYLOAD VERIFIED'
      : `DRAFT · QR ${config.qrPayloadStatus ?? 'UNPROVEN'}`);
  }

  function renderMarkers(activeState = 'IDLE') {
    const markersRoot = $('#operator-markers');
    markersRoot.replaceChildren();
    for (const marker of buildRehearsalMarkers(rehearsalPreset)) {
      const item = document.createElement('li');
      item.dataset.active = String(marker.state === activeState);
      item.dataset.complete = String(marker.atMs <= rehearsalElapsedMs);
      const timecode = document.createElement('span');
      const state = document.createElement('strong');
      timecode.textContent = marker.timecode;
      state.textContent = marker.state.replace('SPEECH_DETECTED', 'VOICE');
      item.append(timecode, state);
      markersRoot.append(item);
    }
  }

  function renderTelemetry() {
    const telemetry = latestTelemetry;
    text($('#operator-startup'), telemetry?.firstFrameMs == null ? '-- MS' : `${telemetry.firstFrameMs} MS`);
    text($('#operator-fps'), telemetry?.fps == null
      ? '-- / --'
      : `${Math.round(telemetry.fps)} / ${telemetry.fpsP10 == null ? '--' : Math.round(telemetry.fpsP10)}`);
    text($('#operator-p95'), telemetry?.p95FrameMs == null ? '-- MS' : `${telemetry.p95FrameMs} MS`);
    text($('#operator-gap'), telemetry?.maxFrameGapMs == null ? '-- MS' : `${telemetry.maxFrameGapMs} MS`);
    text($('#operator-heap'), telemetry?.heapUsedMb == null ? '-- MB' : `${telemetry.heapUsedMb} MB`);
    text($('#operator-errors'), String(telemetry?.errorCount ?? 0));
    text($('#operator-error-codes'), telemetry?.errorCodes?.length
      ? `CODES: ${telemetry.errorCodes.join(' · ')}`
      : 'CODES: NONE');
    document.body.dataset.operatorErrors = String(telemetry?.errorCount ?? 0);
  }

  function evidenceSnapshot() {
    const rawTelemetry = frozenRawTelemetry ?? latestRawTelemetry;
    return createOperatorEvidence({
      livePreflight,
      rehearsal: {
        preset: rehearsalPreset,
        runId: rehearsalRunId,
        elapsedMs: rehearsalElapsedMs,
        status: rehearsalStatus,
        decision: rehearsalDecision,
      },
      telemetry: rawTelemetry,
    });
  }

  function publishEvidence() {
    const evidence = evidenceSnapshot();
    $('#operator-evidence').textContent = JSON.stringify(evidence);
    document.body.dataset.operatorReady = 'true';
    document.body.dataset.operatorRehearsal = rehearsalDecision.state.toLowerCase();
  }

  function renderRehearsal(frame = operatorRehearsalFrame(rehearsalElapsedMs, rehearsalPreset)) {
    if (rehearsalStatus === 'SAFE') {
      frame = {
        ...frame,
        state: 'SAFE',
        copy: 'Lokaler SAFE-Slate · keine OBS- oder Außenaktion',
        progress: 0,
      };
    }
    const verdict = $('#operator-rehearsal-verdict');
    verdict.dataset.state = rehearsalDecision.state;
    text(verdict.querySelector('strong'), rehearsalDecision.state);
    text($('#operator-timecode'), frame.timecode ?? formatOperatorTimecode(rehearsalElapsedMs));
    text($('#operator-state'), frame.state ?? rehearsalStatus);
    text($('#operator-state-copy'), frame.copy ?? PREFLIGHT_REASON_LABELS[rehearsalDecision.reasonIds[0]] ?? 'Lokale Generalprobe');
    text($('#operator-preset-label'), `${rehearsalPreset.replace('_', ' ')} · REALTIME`);
    const percent = Math.round((frame.progress ?? 0) * 100);
    text($('#operator-progress-label'), `${percent}%`);
    $('#operator-progress').setAttribute('aria-valuenow', String(percent));
    $('#operator-progress').style.setProperty('--operator-progress', `${percent}%`);
    $('#operator-preview-shell').dataset.state = rehearsalStatus.toLowerCase();
    renderMarkers(frame.state);
  }

  function pollPreview() {
    if (disposed) return;
    const snapshot = previewSnapshot();
    if (snapshot) {
      latestRawTelemetry = snapshot;
      if (!frozenRawTelemetry) latestTelemetry = redactLocalTelemetry(snapshot);
      rehearsalDecision = evaluateLocalRehearsal({
        status: rehearsalStatus,
        preset: rehearsalPreset,
        runId: rehearsalRunId,
        elapsedMs: rehearsalElapsedMs,
        telemetry: latestTelemetry,
      });
      renderTelemetry();
      renderRehearsal();
      publishEvidence();
    }
  }

  function finishRehearsal() {
    const snapshot = previewSnapshot();
    if (snapshot) {
      frozenRawTelemetry = snapshot;
      latestTelemetry = redactLocalTelemetry(snapshot);
    }
    rehearsalElapsedMs = rehearsalPreset === 'CLIP_60' ? 60_000 : 30_000;
    rehearsalStatus = 'COMPLETE';
    rehearsalDecision = evaluateLocalRehearsal({
      status: rehearsalStatus,
      preset: rehearsalPreset,
      runId: rehearsalRunId,
      elapsedMs: rehearsalElapsedMs,
      telemetry: latestTelemetry,
    });
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    renderTelemetry();
    renderRehearsal(operatorRehearsalFrame(rehearsalElapsedMs, rehearsalPreset));
    publishEvidence();
  }

  function animateRehearsal(now) {
    if (disposed || rehearsalStatus !== 'RUNNING' || rehearsalStartedAt == null) return;
    rehearsalElapsedMs = now - rehearsalStartedAt;
    const frame = operatorRehearsalFrame(rehearsalElapsedMs, rehearsalPreset);
    renderRehearsal(frame);
    if (frame.completed && shouldFinalizeRehearsal(
      rehearsalElapsedMs,
      rehearsalPreset,
      latestTelemetry,
    )) {
      finishRehearsal();
      return;
    }
    animationFrame = requestAnimationFrame(animateRehearsal);
  }

  function startRehearsal(preset) {
    if (!['CLIP_30', 'CLIP_60'].includes(preset) || rehearsalStatus === 'RUNNING') return false;
    cancelAnimationFrame(animationFrame);
    rehearsalPreset = preset;
    rehearsalSequence += 1;
    rehearsalRunId = `local-${Date.now().toString(36)}-${rehearsalSequence}`;
    rehearsalStatus = 'RUNNING';
    rehearsalElapsedMs = 0;
    rehearsalStartedAt = performance.now();
    frozenRawTelemetry = null;
    latestRawTelemetry = null;
    latestTelemetry = null;
    localErrorLog.length = 0;
    safeSlate.hidden = true;
    preview.hidden = false;
    preview.src = previewUrl(preset, null, rehearsalRunId);
    rehearsalDecision = evaluateLocalRehearsal({
      status: rehearsalStatus, preset, runId: rehearsalRunId, telemetry: null,
      elapsedMs: rehearsalElapsedMs,
    });
    renderTelemetry();
    renderRehearsal(operatorRehearsalFrame(0, preset));
    publishEvidence();
    animationFrame = requestAnimationFrame(animateRehearsal);
    return true;
  }

  function activateLocalFixture(fixture) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    rehearsalStartedAt = null;
    rehearsalElapsedMs = 0;
    rehearsalSequence += 1;
    rehearsalRunId = `fixture-${Date.now().toString(36)}-${rehearsalSequence}`;
    frozenRawTelemetry = null;
    latestRawTelemetry = null;
    latestTelemetry = null;
    localErrorLog.length = 0;
    if (fixture === 'safe') {
      rehearsalStatus = 'SAFE';
      try { preview.contentWindow?.__birdieStream?.dispose?.(); } catch { /* local teardown only */ }
      preview.src = 'about:blank';
      preview.hidden = true;
      safeSlate.hidden = false;
    } else {
      rehearsalStatus = 'READY';
      safeSlate.hidden = true;
      preview.hidden = false;
      preview.src = previewUrl(rehearsalPreset, fixture, rehearsalRunId);
    }
    rehearsalDecision = evaluateLocalRehearsal({
      status: rehearsalStatus,
      preset: rehearsalPreset,
      runId: rehearsalRunId,
      elapsedMs: rehearsalElapsedMs,
      telemetry: latestTelemetry,
    });
    renderTelemetry();
    renderRehearsal();
    publishEvidence();
  }

  async function loadConfig() {
    try {
      const response = await fetch('/stream-mode.json', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('config unavailable');
      config = await verifyStreamQrAsset(resolveStreamConfig(await response.json()));
    } catch {
      config = resolveStreamConfig(DEFAULT_STREAM_CONFIG);
      recordLocalError('STREAM_CONFIG');
    }
    livePreflight = buildLaunchPreflight({ plan: obsPlan, config });
    renderPreflight();
    publishEvidence();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    clearInterval(previewPollTimer);
    previewResizeObserver.disconnect();
    try { preview.contentWindow?.__birdieStream?.dispose?.(); } catch { /* local teardown only */ }
    window.removeEventListener('beforeunload', dispose);
    if (window.__birdieOperator === operatorApi) delete window.__birdieOperator;
  }

  for (const button of app.querySelectorAll('[data-start-preset]')) {
    button.addEventListener('click', () => startRehearsal(button.dataset.startPreset));
  }
  $('#operator-fallback').addEventListener('click', () => activateLocalFixture('fallback'));
  $('#operator-error').addEventListener('click', () => activateLocalFixture('error'));
  $('#operator-safe').addEventListener('click', () => activateLocalFixture('safe'));
  preview.addEventListener('load', () => setTimeout(pollPreview, 0));
  window.addEventListener('beforeunload', dispose, { once: true });

  const operatorApi = Object.freeze({
    start: startRehearsal,
    showFallback: () => activateLocalFixture('fallback'),
    showErrorFixture: () => activateLocalFixture('error'),
    activateSafe: () => activateLocalFixture('safe'),
    getEvidence: evidenceSnapshot,
    getEvidenceJson: () => JSON.stringify(evidenceSnapshot(), null, 2),
    dispose,
  });
  window.__birdieOperator = operatorApi;

  renderPreflight();
  renderMarkers();
  renderTelemetry();
  renderRehearsal();
  publishEvidence();
  previewPollTimer = window.setInterval(pollPreview, PREVIEW_POLL_INTERVAL_MS);
  void loadConfig();
  return operatorApi;
}
