import './stream-mode.css';
import { hasVisualProfile } from './birdie-visual-state.js';
import { RuntimeBridge } from './runtime-bridge.js';
import { evaluateStreamEvidence, resolveStreamRenderProfile } from './stream-evidence.js';
import { StaticPresenceRenderer } from './stream-static-renderer.js';
import {
  createPrivateSaleHandoff,
  PRIVATE_SALE_AUTHORIZATION_STATUS,
  PRIVATE_SALE_COMPLETED_KEY,
  PRIVATE_SALE_RUN_ID,
  stagePrivateSaleHandoff,
} from './stream-private-sale-contract.js';
import {
  DEFAULT_STREAM_CONFIG,
  isLoopbackQrPreview,
  resolveStreamConfig,
  resolveStreamDemoFixture,
  resolveStreamTimeline,
  streamDemoFrame,
  verifyStreamQrAsset,
} from './stream-mode-config.js';

const PRESENCE_COPY = Object.freeze({
  IDLE: 'Bereit für dein Kommando',
  SPEECH_DETECTED: 'Stimme erkannt',
  LISTENING: 'Ich höre zu',
  THINKING: 'Birdie denkt',
  SPEAKING: 'Birdie antwortet',
  WORKING: 'Birdie arbeitet',
  SUCCESS: 'Aktion abgeschlossen',
  ERROR: 'Lokaler Fehler',
  OFFLINE: 'Runtime offline',
});

const STREAM_PERFORMANCE_WARMUP_MS = 3_000;

function createPrivateSaleNonce() {
  try {
    if (typeof window.crypto?.randomUUID === 'function') {
      return window.crypto.randomUUID().replaceAll('-', '');
    }
    if (typeof window.crypto?.getRandomValues !== 'function') return '';
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export function startStreamMode({ app, buildId }) {
  if (!app) throw new Error('stream root missing');
  const query = new URLSearchParams(window.location.search);
  const qrVerificationPreview = isLoopbackQrPreview(window.location, query);
  const rehearsalRunId = /^[A-Za-z0-9._-]{8,96}$/.test(String(query.get('rehearsalRunId') ?? ''))
    ? query.get('rehearsalRunId')
    : null;
  const startedAt = performance.now();
  const startedAtUtc = new Date().toISOString();
  const timeline = resolveStreamTimeline(query);
  const requestedProfile = resolveStreamRenderProfile(
    query,
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false,
  );

  app.innerHTML = `
    <main id="stream-viewport" aria-label="Birdie Stream Mode">
      <canvas id="stream-core" aria-label="Birdie startet"></canvas>
      <div id="stream-static-core" class="stream-static-core" aria-hidden="true">
        <div class="stream-static-contours">
          ${Array.from({ length: 9 }, (_, index) => `<i style="--stream-ring:${index}"></i>`).join('')}
        </div>
        <span class="stream-static-nucleus"></span>
      </div>
      <div class="stream-grid" aria-hidden="true"></div>
      <header class="stream-header">
        <div class="stream-brand-lockup">
          <span class="stream-brand-mark" aria-hidden="true"></span>
          <div><strong id="stream-brand">BIRDIE</strong><small id="stream-eyebrow">VOICE-FIRST DESKTOP AGENT</small></div>
        </div>
        <div id="stream-signal-badge" class="stream-signal-badge"><span></span><strong>DEMO LOOP</strong></div>
      </header>

      <section class="stream-message" aria-labelledby="stream-headline">
        <p class="stream-overline">BIRDIE // SYNTHETIC PRESENCE</p>
        <h1 id="stream-headline">Sag es. Birdie macht es.</h1>
        <p id="stream-subline">Ein lokaler Agent, der auf Sprache reagiert und deinen PC verständlich steuert.</p>
      </section>

      <section class="stream-voice" aria-live="polite">
        <div class="stream-voice-heading"><span>DEMO VOICE REACTION</span><strong id="stream-presence">IDLE</strong></div>
        <div id="stream-wave" class="stream-wave" aria-hidden="true">
          ${Array.from({ length: 18 }, (_, index) => `<i style="height:${28 + (index % 5) * 14}%"></i>`).join('')}
        </div>
        <p id="stream-presence-copy">Bereit für dein Kommando</p>
      </section>

      <section class="stream-telemetry" aria-label="Live-Status">
        <div><span>RUNTIME</span><strong id="stream-runtime">STARTING</strong></div>
        <div><span>MIC</span><strong id="stream-microphone">UNKNOWN</strong></div>
        <div><span>RENDER</span><strong id="stream-fps">-- FPS</strong></div>
        <div><span>START</span><strong id="stream-startup">-- MS</strong></div>
        <div><span>ERRORS</span><strong id="stream-errors">0</strong></div>
      </section>

      <aside class="stream-cta" aria-label="Stream Call to Action">
        <div class="stream-cta-copy">
          <small id="stream-cta-label">EARLY ACCESS</small>
          <strong id="stream-cta-text">Birdie auf deinem PC testen</strong>
          <a id="stream-cta-url" tabindex="-1">example.com/birdie</a>
        </div>
        <figure class="stream-qr">
          <img id="stream-qr-image" alt="Konfigurierter QR-Code" hidden />
          <div id="stream-qr-fallback" class="stream-qr-fallback" aria-label="QR-Platzhalter, nicht scannbar">
            <span></span><span></span><span></span><strong>DEMO</strong>
          </div>
          <figcaption id="stream-qr-verification" hidden>VERIFY ONLY</figcaption>
        </figure>
      </aside>

      <footer class="stream-footer">
        <span>LOCAL-FIRST</span><span id="stream-quality">${requestedProfile.label}</span><span id="stream-loop">LOOP 00 / ${timeline.durationMs / 1_000}S</span>
      </footer>
      <output id="stream-evidence" hidden aria-hidden="true"></output>
    </main>
  `;

  const $ = (selector) => app.querySelector(selector);
  const root = document.documentElement;
  const canvas = $('#stream-core');
  const metrics = {
    buildId,
    startedAtUtc,
    startedAt,
    timeline: timeline.id,
    rehearsalRunId,
    profile: requestedProfile,
    renderer: requestedProfile.renderer,
    firstFrameMs: null,
    configReadyMs: null,
    viewport: null,
    fps: 0,
    minFps: null,
    maxFps: 0,
    averageFps: 0,
    fpsSamples: 0,
    fpsByPresence: {},
    errors: 0,
    errorLog: [],
    transitions: [],
    transitionSequence: 0,
    frameIntervalsMs: [],
    maxFrameGapMs: 0,
    longFrames: 0,
    renderedFrames: 0,
    heartbeatFrames: 0,
    heartbeatFps: 0,
    heartbeatIntervalsMs: [],
    lastRenderedAtMs: null,
    lastHeartbeatAtMs: null,
    zeroFpsSamples: 0,
    consecutiveZeroFpsSamples: 0,
    maximumZeroFpsStreak: 0,
    currentRenderStalled: false,
    renderStalled: false,
    visualPerformanceSignal: 'WARMUP',
    firstVisualSignalMs: null,
    firstVisualSignalKind: null,
    fallbackActivations: 0,
    fallbackReason: null,
    maximumLoopDriftMs: 0,
    loopCount: 0,
    presence: 'OFFLINE',
    runtime: 'STARTING',
    microphone: 'UNKNOWN',
  };

  let currentConfig = resolveStreamConfig(DEFAULT_STREAM_CONFIG, query);
  let animationFrame = 0;
  let performanceFrame = 0;
  let bridge = null;
  let field = null;
  let activeProfile = requestedProfile;
  let fallbackScheduled = false;
  let disposed = false;
  let liveInputLevel = 0;
  let liveOutputLevel = 0;
  let liveInputUpdatedAt = 0;
  let liveOutputUpdatedAt = 0;

  function renderConfig(config) {
    const previousQrRenderUrl = currentConfig?.qrRenderUrl;
    currentConfig = config;
    if (previousQrRenderUrl && previousQrRenderUrl !== config.qrRenderUrl) {
      try { URL.revokeObjectURL(previousQrRenderUrl); } catch { /* local blob cleanup only */ }
    }
    $('#stream-brand').textContent = config.brand;
    $('#stream-eyebrow').textContent = config.eyebrow;
    $('#stream-headline').textContent = config.headline;
    $('#stream-subline').textContent = config.subline;
    $('#stream-cta-label').textContent = config.ctaLabel;
    $('#stream-cta-text').textContent = config.ctaText;
    const privateCtaVariant = ['PRODUCT', 'APP_DEMO', 'BIRDIEWORLD_HOTEL'].includes(query.get('variant'))
      ? query.get('variant')
      : 'PRODUCT';
    const privateCtaEnabled = query.get('ctaTest') === 'private';
    const ctaLink = $('#stream-cta-url');
    ctaLink.textContent = privateCtaEnabled ? 'LOCAL PRIVATE CTA TEST' : config.ctaDisplayUrl;
    ctaLink.removeAttribute('href');
    ctaLink.removeAttribute('aria-label');
    ctaLink.setAttribute('aria-disabled', 'true');
    ctaLink.tabIndex = -1;
    ctaLink.onclick = null;
    root.dataset.streamCtaTest = privateCtaEnabled ? 'private' : 'off';
    if (privateCtaEnabled) {
      let completed = false;
      try {
        completed = window.localStorage.getItem(PRIVATE_SALE_COMPLETED_KEY) === PRIVATE_SALE_RUN_ID;
      } catch { /* fail closed below */ }
      const authorized = PRIVATE_SALE_AUTHORIZATION_STATUS === 'GO' && !completed;
      $('#stream-cta-label').textContent = 'FOUNDER PRIVATE TEST · HOLD';
      $('#stream-cta-text').textContent = 'Run 1/1 verbraucht · neues Founder-GO erforderlich';
      if (authorized) {
        ctaLink.removeAttribute('aria-disabled');
        ctaLink.setAttribute('aria-label', 'Lokalen privaten CTA-Test einmalig öffnen');
        ctaLink.tabIndex = 0;
        ctaLink.onclick = (event) => {
          event.preventDefault();
          const nonce = createPrivateSaleNonce();
          if (!nonce) return;
          const handoff = createPrivateSaleHandoff({
            nonce,
            variant: privateCtaVariant,
            runId: PRIVATE_SALE_RUN_ID,
          });
          let staged;
          try {
            staged = stagePrivateSaleHandoff(window.localStorage, handoff);
          } catch {
            staged = { status: 'STOP' };
          }
          if (staged.status !== 'PASS') return;
          window.location.assign(`/?mode=private-sale&variant=${encodeURIComponent(privateCtaVariant)}&handoff=${encodeURIComponent(nonce)}`);
        };
      }
    }
    if (!privateCtaEnabled && config.conversionReady) {
      ctaLink.href = config.ctaUrl;
      ctaLink.removeAttribute('aria-disabled');
    }
    root.dataset.streamConversion = !privateCtaEnabled && config.conversionReady ? 'ready' : 'draft';

    const image = $('#stream-qr-image');
    const fallback = $('#stream-qr-fallback');
    const verificationLabel = $('#stream-qr-verification');
    const renderQr = !privateCtaEnabled
      && config.qrRenderReady
      && Boolean(config.qrRenderUrl)
      && (config.conversionReady || qrVerificationPreview);
    const verificationOnly = renderQr && !config.conversionReady;
    root.dataset.streamQrVerification = verificationOnly ? 'local' : 'off';
    image.hidden = !renderQr;
    fallback.hidden = renderQr;
    verificationLabel.hidden = !verificationOnly;
    if (renderQr) {
      image.src = config.qrRenderUrl;
      image.alt = verificationOnly
        ? 'Lokale QR-Verifikationsvorschau, nicht freigegeben'
        : 'Verifizierter Stream-QR-Code';
    } else {
      image.removeAttribute('src');
      image.alt = 'Konfigurierter QR-Code';
    }
  }

  function renderMetric(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function recordError(code) {
    metrics.errors += 1;
    metrics.errorLog.push(Object.freeze({
      code: String(code ?? 'LOCAL').slice(0, 24),
      atMs: Math.round(performance.now() - startedAt),
    }));
    if (metrics.errorLog.length > 64) metrics.errorLog.shift();
    root.dataset.streamHealth = 'error';
    document.body.dataset.streamErrors = String(metrics.errors);
    renderMetric('#stream-errors', String(metrics.errors));
    $('#stream-errors').dataset.code = String(code ?? 'LOCAL').slice(0, 24);
  }

  function applyPresence(value, copy = null) {
    const state = String(value ?? 'OFFLINE').toUpperCase();
    const normalized = hasVisualProfile(state) ? state : 'ERROR';
    if (metrics.presence !== normalized) {
      metrics.transitionSequence += 1;
      metrics.transitions.push(Object.freeze({
        sequence: metrics.transitionSequence,
        atMs: Math.round(performance.now() - startedAt),
        from: metrics.presence,
        to: normalized,
      }));
      if (metrics.transitions.length > 256) metrics.transitions.shift();
    }
    metrics.presence = normalized;
    root.dataset.streamPresence = normalized.toLowerCase();
    canvas.setAttribute('aria-label', `Birdie: ${normalized}`);
    renderMetric('#stream-presence', normalized);
    renderMetric('#stream-presence-copy', copy ?? PRESENCE_COPY[normalized]);
    field?.setPresence(normalized);
  }

  function renderWave(inputLevel = 0, outputLevel = 0) {
    const input = Math.max(0, Math.min(1, inputLevel));
    const output = Math.max(0, Math.min(1, outputLevel));
    const level = Math.max(input, output);
    root.style.setProperty('--stream-input', input.toFixed(3));
    root.style.setProperty('--stream-output', output.toFixed(3));
    root.style.setProperty('--stream-wave-scale', (0.12 + level * 0.88).toFixed(3));
    root.style.setProperty('--stream-wave-opacity', (0.32 + level * 0.62).toFixed(3));
  }

  function applyAudio({ inputLevel = 0, outputLevel = 0, vadProbability = 0 }) {
    field?.setInputAudio({ level: inputLevel, vadProbability });
    field?.setOutputAudio({ level: outputLevel });
    renderWave(inputLevel, outputLevel);
  }

  function setRuntime(value) {
    metrics.runtime = String(value ?? 'UNKNOWN').toUpperCase();
    root.dataset.streamRuntime = metrics.runtime.toLowerCase();
    renderMetric('#stream-runtime', metrics.runtime);
  }

  function setMicrophone(value) {
    metrics.microphone = String(value ?? 'UNKNOWN').toUpperCase();
    renderMetric('#stream-microphone', metrics.microphone);
  }

  const rendererCallbacks = {
    onReady({ width, height, pixelRatio }) {
      metrics.viewport = { width, height, pixelRatio };
      root.dataset.streamViewport = `${width}x${height}@${pixelRatio.toFixed(2)}`;
    },
    onFrame({ frameCount, heartbeatCount, intervalMs, metricKind = 'RENDERED_FRAME' }) {
      const signalAtMs = performance.now() - startedAt;
      if (metricKind === 'RAF_HEARTBEAT') {
        metrics.heartbeatFrames = heartbeatCount ?? metrics.heartbeatFrames;
        metrics.lastHeartbeatAtMs = signalAtMs;
        if (intervalMs > 0) {
          metrics.heartbeatIntervalsMs.push(Math.round(intervalMs * 10) / 10);
          if (metrics.heartbeatIntervalsMs.length > 1_024) {
            metrics.heartbeatIntervalsMs.shift();
          }
        }
        return;
      }
      metrics.renderedFrames = frameCount;
      metrics.lastRenderedAtMs = signalAtMs;
      if (intervalMs > 0) {
        metrics.frameIntervalsMs.push(Math.round(intervalMs * 10) / 10);
        if (metrics.frameIntervalsMs.length > 4_096) metrics.frameIntervalsMs.shift();
        metrics.maxFrameGapMs = Math.max(metrics.maxFrameGapMs, intervalMs);
        if (intervalMs > activeProfile.longFrameThresholdMs) metrics.longFrames += 1;
      }
    },
    onContextState(status) {
      if (status === 'RENDERED' || status === 'RAF_HEARTBEAT') {
        monitorPerformance.sample = {
          at: performance.now(),
          renderedFrames: field?.renderedFrameCount ?? 0,
          heartbeatFrames: field?.heartbeatFrameCount ?? 0,
        };
        const signalMs = performance.now() - startedAt;
        if (metrics.firstVisualSignalMs === null) {
          metrics.firstVisualSignalMs = signalMs;
          metrics.firstVisualSignalKind = status;
        }
        if (status === 'RENDERED' && metrics.firstFrameMs === null) {
          metrics.firstFrameMs = signalMs;
          renderMetric('#stream-startup', `${Math.round(signalMs)} MS`);
          document.body.dataset.streamReady = 'rendered';
          document.body.dataset.streamStartupMs = String(Math.round(signalMs));
          metrics.visualPerformanceSignal = 'WEBGL_RENDERED_FRAMES';
        } else if (status === 'RAF_HEARTBEAT') {
          renderMetric('#stream-startup', `RAF ${Math.round(signalMs)} MS`);
          document.body.dataset.streamReady = 'heartbeat-only';
          metrics.visualPerformanceSignal = 'UNPROVEN_STATIC_CSS';
        }
        renderMetric(
          '#stream-fps',
          status === 'RENDERED' ? `${activeProfile.renderer} WARMUP` : 'RAF WARMUP',
        );
      } else if (status === 'LOST' || status === 'SHADER_ERROR') {
        const code = status === 'LOST' ? 'WEBGL_CONTEXT' : 'WEBGL_SHADER';
        recordError(code);
        scheduleStaticFallback(code);
      }
    },
  };

  function installStaticRenderer(reason = null) {
    const previous = field;
    activeProfile = resolveStreamRenderProfile('renderer=backup', true);
    metrics.profile = activeProfile;
    metrics.renderer = 'STATIC';
    metrics.renderedFrames = 0;
    metrics.heartbeatFrames = 0;
    metrics.fps = 0;
    metrics.heartbeatFps = 0;
    metrics.minFps = null;
    metrics.maxFps = 0;
    metrics.averageFps = 0;
    metrics.fpsSamples = 0;
    metrics.fpsByPresence = {};
    metrics.frameIntervalsMs = [];
    metrics.heartbeatIntervalsMs = [];
    metrics.currentRenderStalled = false;
    metrics.renderStalled = false;
    metrics.visualPerformanceSignal = 'UNPROVEN_STATIC_CSS';
    if (reason) {
      metrics.fallbackActivations += 1;
      metrics.fallbackReason = reason;
    }
    root.dataset.streamRenderer = 'static';
    root.dataset.streamQuality = 'low';
    renderMetric('#stream-quality', reason ? 'STATIC FALLBACK' : activeProfile.label);
    monitorPerformance.sample = null;
    previous?.dispose();
    field = new StaticPresenceRenderer(canvas, rendererCallbacks);
    field.setPresence(metrics.presence);
    field.start();
  }

  function scheduleStaticFallback(reason) {
    if (fallbackScheduled || metrics.renderer === 'STATIC') return;
    fallbackScheduled = true;
    queueMicrotask(() => {
      if (!disposed) installStaticRenderer(reason);
    });
  }

  async function startRenderer() {
    root.dataset.streamQuality = requestedProfile.quality.toLowerCase();
    if (requestedProfile.renderer === 'STATIC') {
      installStaticRenderer();
      return;
    }
    root.dataset.streamRenderer = 'webgl';
    try {
      const { BirdieField } = await import('./birdie-field.js');
      if (disposed) return;
      field = new BirdieField(canvas, {
        ...rendererCallbacks,
        pixelRatioCap: 1,
        renderScale: requestedProfile.quality === 'LOW' ? 0.5 : 0.55,
        antialias: false,
        powerPreference: requestedProfile.quality === 'LOW' ? 'low-power' : 'high-performance',
      });
      if (requestedProfile.quality === 'LOW') field.setReducedMotion(true);
      field.setPresence(metrics.presence);
      field.start();
    } catch {
      if (disposed) return;
      recordError('WEBGL_INIT');
      installStaticRenderer('WEBGL_INIT');
    }
  }

  function monitorPerformance(now) {
    if (disposed) return;
    if (bridge) {
      let signalChanged = false;
      if (liveInputLevel > 0 && now - liveInputUpdatedAt > 160) {
        liveInputLevel = 0;
        signalChanged = true;
      }
      if (liveOutputLevel > 0 && now - liveOutputUpdatedAt > 160) {
        liveOutputLevel = 0;
        signalChanged = true;
      }
      if (signalChanged) renderWave(liveInputLevel, liveOutputLevel);
    }
    if (!monitorPerformance.sample) {
      performanceFrame = requestAnimationFrame(monitorPerformance);
      return;
    }
    const sample = monitorPerformance.sample;
    if (now - sample.at >= 1_000) {
      const renderedFrames = field?.renderedFrameCount ?? 0;
      const heartbeatFrames = field?.heartbeatFrameCount ?? 0;
      const elapsedSeconds = (now - sample.at) / 1_000;
      const fps = (renderedFrames - sample.renderedFrames) / elapsedSeconds;
      const heartbeatFps = (heartbeatFrames - sample.heartbeatFrames) / elapsedSeconds;
      metrics.fps = Math.round(fps * 10) / 10;
      metrics.heartbeatFps = Math.round(heartbeatFps * 10) / 10;
      const warm = now - startedAt >= STREAM_PERFORMANCE_WARMUP_MS;
      if (metrics.renderer === 'WEBGL') {
        metrics.minFps = metrics.minFps === null ? metrics.fps : Math.min(metrics.minFps, metrics.fps);
        metrics.maxFps = Math.max(metrics.maxFps, metrics.fps);
        metrics.averageFps = (
          (metrics.averageFps * metrics.fpsSamples + metrics.fps) / (metrics.fpsSamples + 1)
        );
        metrics.fpsSamples += 1;
        if (warm) {
          if (metrics.fps === 0) {
            metrics.zeroFpsSamples += 1;
            metrics.consecutiveZeroFpsSamples += 1;
          } else {
            metrics.consecutiveZeroFpsSamples = 0;
          }
          metrics.maximumZeroFpsStreak = Math.max(
            metrics.maximumZeroFpsStreak,
            metrics.consecutiveZeroFpsSamples,
          );
          metrics.currentRenderStalled = metrics.consecutiveZeroFpsSamples > 0;
          if (metrics.consecutiveZeroFpsSamples >= 2) metrics.renderStalled = true;
          metrics.visualPerformanceSignal = metrics.renderStalled
            ? 'WEBGL_STALL_DETECTED'
            : metrics.currentRenderStalled
              ? 'WEBGL_ZERO_FPS_SAMPLE'
              : 'WEBGL_RENDERED_FRAMES';
          const stateSamples = metrics.fpsByPresence[metrics.presence] ?? {
            samples: 0,
            minimum: metrics.fps,
            maximum: metrics.fps,
            average: 0,
            values: [],
          };
          stateSamples.minimum = Math.min(stateSamples.minimum, metrics.fps);
          stateSamples.maximum = Math.max(stateSamples.maximum, metrics.fps);
          stateSamples.average = (
            (stateSamples.average * stateSamples.samples + metrics.fps) / (stateSamples.samples + 1)
          );
          stateSamples.samples += 1;
          stateSamples.values.push(metrics.fps);
          if (stateSamples.values.length > 128) stateSamples.values.shift();
          metrics.fpsByPresence[metrics.presence] = stateSamples;
        }
        renderMetric('#stream-fps', `${Math.round(metrics.fps)} FPS`);
        document.body.dataset.streamFps = metrics.fps.toFixed(1);
        document.body.dataset.streamRenderStalled = String(metrics.renderStalled);
      } else {
        metrics.fps = 0;
        metrics.currentRenderStalled = false;
        metrics.renderStalled = false;
        metrics.visualPerformanceSignal = 'UNPROVEN_STATIC_CSS';
        renderMetric('#stream-fps', `RAF ${Math.round(metrics.heartbeatFps)} HZ`);
        document.body.dataset.streamFps = 'unproven';
        document.body.dataset.streamHeartbeatHz = metrics.heartbeatFps.toFixed(1);
      }
      monitorPerformance.sample = { at: now, renderedFrames, heartbeatFrames };
      publishEvidence();
    }
    performanceFrame = requestAnimationFrame(monitorPerformance);
  }

  function runDemo(now) {
    if (disposed) return;
    const elapsedMs = now - startedAt;
    const frame = streamDemoFrame(elapsedMs, timeline);
    if (frame.loopIndex > metrics.loopCount) {
      const expectedBoundary = frame.loopIndex * timeline.durationMs;
      metrics.maximumLoopDriftMs = Math.max(
        metrics.maximumLoopDriftMs,
        Math.abs(elapsedMs - expectedBoundary),
      );
    }
    metrics.loopCount = frame.loopIndex;
    document.body.dataset.streamLoopCount = String(frame.loopIndex);
    if (metrics.presence !== frame.state) applyPresence(frame.state, frame.copy);
    applyAudio(frame);
    const timelineLabel = timeline.id === 'LOOP' ? 'LOOP' : timeline.id.replace('_', ' ');
    renderMetric(
      '#stream-loop',
      `${timelineLabel} ${String(frame.loopIndex).padStart(2, '0')} / ${timeline.durationMs / 1_000}S`,
    );
    animationFrame = requestAnimationFrame(runDemo);
  }

  function startLiveRuntime() {
    $('#stream-signal-badge').querySelector('strong').textContent = 'LIVE SIGNAL';
    setRuntime('CONNECTING');
    bridge = new RuntimeBridge({
      onPresence(snapshot) { applyPresence(snapshot?.state); },
      onAudioInput(signal) {
        liveInputLevel = Math.max(0, Math.min(1, Number(signal?.level) || 0));
        liveInputUpdatedAt = performance.now();
        field?.setInputAudio(signal);
        renderWave(liveInputLevel, liveOutputLevel);
      },
      onAudioOutput(signal) {
        liveOutputLevel = Math.max(0, Math.min(1, Number(signal?.level) || 0));
        liveOutputUpdatedAt = performance.now();
        field?.setOutputAudio(signal);
        renderWave(liveInputLevel, liveOutputLevel);
      },
      onSnapshot(snapshot) { setMicrophone(snapshot?.microphoneState); },
      onStatus(status) {
        setRuntime(status);
        if (status === 'OFFLINE') applyPresence('OFFLINE');
      },
      onError() {
        setRuntime('OFFLINE');
        applyPresence('ERROR');
        recordError('RUNTIME_BRIDGE');
      },
    });
    void bridge.connect().catch(() => {
      if (disposed) return;
      setRuntime('OFFLINE');
      applyPresence('ERROR');
    });
  }

  async function loadConfig() {
    try {
      const response = await fetch('/stream-mode.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('config unavailable');
      const resolvedConfig = resolveStreamConfig(await response.json(), query);
      const verifiedConfig = await verifyStreamQrAsset(resolvedConfig, {
        allowLocalPreview: qrVerificationPreview,
      });
      if (!disposed) renderConfig(verifiedConfig);
      else if (verifiedConfig.qrRenderUrl) {
        try { URL.revokeObjectURL(verifiedConfig.qrRenderUrl); } catch { /* local blob cleanup only */ }
      }
    } catch {
      if (!disposed) {
        renderConfig(currentConfig);
        recordError('STREAM_CONFIG');
      }
    } finally {
      if (!disposed) {
        metrics.configReadyMs = performance.now() - startedAt;
        document.body.dataset.streamConfigReady = 'true';
        publishEvidence();
      }
    }
  }

  function snapshotMetrics() {
    const snapshot = {
      ...metrics,
      durationMs: performance.now() - startedAt,
      demoDurationMs: timeline.durationMs,
      profile: { ...activeProfile },
      fpsByPresence: structuredClone(metrics.fpsByPresence),
      errorLog: metrics.errorLog.map((entry) => ({ ...entry })),
      transitions: metrics.transitions.map((entry) => ({ ...entry })),
      frameIntervalsMs: [...metrics.frameIntervalsMs],
      config: {
        brand: currentConfig.brand,
        ctaLabel: currentConfig.ctaLabel,
        ctaDisplayUrl: currentConfig.ctaDisplayUrl,
        qrConfigured: query.get('ctaTest') !== 'private' && Boolean(currentConfig.qrImage),
        qrMatchesCta: currentConfig.qrMatchesCta,
        qrScanVerified: currentConfig.qrScanVerified,
        qrAssetHashVerified: currentConfig.qrAssetHashVerified,
        qrPayloadVerified: currentConfig.qrPayloadVerified,
        qrPayloadStatus: currentConfig.qrPayloadStatus,
        qrRenderReady: currentConfig.qrRenderReady,
        qrVerificationPreview: query.get('ctaTest') !== 'private'
          && qrVerificationPreview
          && currentConfig.qrRenderReady
          && !currentConfig.conversionReady
          && Boolean(currentConfig.qrRenderUrl),
        qrSha256: currentConfig.qrSha256,
        actualQrSha256: currentConfig.actualQrSha256,
        ctaStatus: currentConfig.ctaStatus,
        placeholderCta: currentConfig.placeholderCta,
        ctaUrlCanonical: currentConfig.ctaUrlCanonical,
        qrTargetCanonical: currentConfig.qrTargetCanonical,
        conversionOverridesIgnored: currentConfig.conversionOverridesIgnored,
        conversionDeclaredReady: currentConfig.conversionDeclaredReady,
        conversionReady: query.get('ctaTest') !== 'private' && currentConfig.conversionReady,
        privateCtaAuthorization: query.get('ctaTest') === 'private'
          ? PRIVATE_SALE_AUTHORIZATION_STATUS
          : 'NOT_APPLICABLE',
      },
    };
    return Object.freeze({ ...snapshot, evidence: evaluateStreamEvidence(snapshot) });
  }

  function publishEvidence() {
    const snapshot = snapshotMetrics();
    $('#stream-evidence').textContent = JSON.stringify({
      schemaVersion: snapshot.evidence.schemaVersion,
      buildId: snapshot.buildId,
      startedAtUtc: snapshot.startedAtUtc,
      timeline: snapshot.timeline,
      rehearsalRunId: snapshot.rehearsalRunId,
      profile: snapshot.profile,
      renderer: snapshot.renderer,
      fallbackActivations: snapshot.fallbackActivations,
      fallbackReason: snapshot.fallbackReason,
      durationMs: Math.round(snapshot.durationMs),
      firstFrameMs: snapshot.firstFrameMs == null ? null : Math.round(snapshot.firstFrameMs),
      configReadyMs: snapshot.configReadyMs == null ? null : Math.round(snapshot.configReadyMs),
      viewport: snapshot.viewport,
      fps: snapshot.fps,
      heartbeatFps: snapshot.heartbeatFps,
      fpsByPresence: snapshot.fpsByPresence,
      p95FrameMs: snapshot.evidence.p95FrameMs,
      maxFrameGapMs: Math.round(snapshot.maxFrameGapMs),
      longFrames: snapshot.longFrames,
      renderedFrames: snapshot.renderedFrames,
      heartbeatFrames: snapshot.heartbeatFrames,
      lastRenderedAtMs: snapshot.lastRenderedAtMs,
      lastHeartbeatAtMs: snapshot.lastHeartbeatAtMs,
      zeroFpsSamples: snapshot.zeroFpsSamples,
      maximumZeroFpsStreak: snapshot.maximumZeroFpsStreak,
      currentRenderStalled: snapshot.currentRenderStalled,
      renderStalled: snapshot.renderStalled,
      visualPerformanceSignal: snapshot.visualPerformanceSignal,
      firstVisualSignalMs: snapshot.firstVisualSignalMs,
      firstVisualSignalKind: snapshot.firstVisualSignalKind,
      errors: snapshot.errors,
      errorLog: snapshot.errorLog,
      transitionCount: snapshot.transitionSequence,
      loopCount: snapshot.loopCount,
      maximumLoopDriftMs: Math.round(snapshot.maximumLoopDriftMs),
      config: snapshot.config,
      verdict: snapshot.evidence,
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    cancelAnimationFrame(performanceFrame);
    bridge?.dispose();
    field?.dispose();
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    qrImage.removeEventListener('error', handleQrImageError);
    if (currentConfig?.qrRenderUrl) {
      try { URL.revokeObjectURL(currentConfig.qrRenderUrl); } catch { /* local blob cleanup only */ }
    }
    if (window.__birdieStream === streamApi) delete window.__birdieStream;
  }

  const handleWindowError = () => recordError('PAGE_ERROR');
  const handleUnhandledRejection = () => recordError('PROMISE_REJECTION');
  const handleBeforeUnload = () => dispose();
  const qrImage = $('#stream-qr-image');
  const handleQrImageError = () => {
    renderConfig(Object.freeze({
      ...currentConfig,
      conversionReady: false,
      qrRenderReady: false,
      qrRenderUrl: '',
      qrPayloadStatus: 'RENDER_ERROR',
    }));
    recordError('QR_ASSET');
  };
  let streamApi = null;

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('beforeunload', handleBeforeUnload, { once: true });
  qrImage.addEventListener('error', handleQrImageError);

  renderConfig(currentConfig);
  void startRenderer();
  performanceFrame = requestAnimationFrame(monitorPerformance);

  const tauriAvailable = Boolean(window.__TAURI_INTERNALS__);
  const demoMode = query.get('demo') === 'loop' || !tauriAvailable;
  if (demoMode) {
    const demoFixture = resolveStreamDemoFixture(query);
    $('#stream-signal-badge').querySelector('strong').textContent = demoFixture?.badge
      ?? (timeline.id === 'LOOP' ? 'DEMO LOOP' : `DEMO ${timeline.id.replace('_', ' ')}`);
    setRuntime('DEMO');
    setMicrophone('DEMO INPUT');
    if (demoFixture) {
      applyPresence(demoFixture.state, demoFixture.copy);
      recordError(demoFixture.code);
    } else {
      applyPresence('IDLE');
      animationFrame = requestAnimationFrame(runDemo);
    }
  } else {
    startLiveRuntime();
  }

  void loadConfig();

  streamApi = Object.freeze({
    getMetrics: snapshotMetrics,
    getEvidenceJson: () => JSON.stringify(snapshotMetrics(), null, 2),
    dispose,
  });
  window.__birdieStream = streamApi;
  publishEvidence();
  return streamApi;
}
