import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PRESENCE_STATES,
  VISUAL_PROFILES,
  MAX_DRAWING_BUFFER_PIXELS,
  approach,
  clamp01,
  computeCoreHeightRatio,
  computeViewport,
  deriveAudioReaction,
  getVisualProfile,
  hasVisualProfile,
  scheduleRenderFrame,
} from '../src/birdie-visual-state.js';

const canonicalStates = [
  'IDLE',
  'SPEECH_DETECTED',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'WORKING',
  'SUCCESS',
  'ERROR',
  'OFFLINE',
];

test('every canonical runtime state has a finite visual profile', () => {
  assert.deepEqual(PRESENCE_STATES, canonicalStates);
  assert.deepEqual(Object.keys(VISUAL_PROFILES), canonicalStates);

  for (const state of canonicalStates) {
    assert.equal(hasVisualProfile(state), true);
    for (const [key, value] of Object.entries(getVisualProfile(state))) {
      assert.equal(Number.isFinite(value), true, `${state}.${key} must be finite`);
      if (key === 'coreScale') {
        assert.ok(value >= 1 && value <= 1.15, `${state}.${key} is bounded`);
      } else {
        assert.equal(clamp01(value), value, `${state}.${key} is clamped`);
      }
    }
  }

  assert.equal(hasVisualProfile('FUTURE_UNKNOWN_STATE'), false);
  assert.equal(getVisualProfile('FUTURE_UNKNOWN_STATE'), VISUAL_PROFILES.OFFLINE);
});

test('the living core stays between 65 and 75 percent of screen height', () => {
  for (const state of canonicalStates) {
    const idleRatio = computeCoreHeightRatio(state, 0);
    const peakRatio = computeCoreHeightRatio(state, 1);
    assert.ok(idleRatio >= 0.65 && idleRatio <= 0.75, `${state} idle ratio`);
    assert.ok(peakRatio >= 0.65 && peakRatio <= 0.75, `${state} peak ratio`);
  }
});

test('viewport math is aspect-correct and caps rendering cost', () => {
  const cases = [
    [1366, 768],
    [1920, 1080],
    [3440, 1440],
    [3840, 2160],
    [5120, 1440],
    [7680, 2160],
  ];
  for (const [width, height] of cases) {
    const viewport = computeViewport(width, height, 2.5);
    const expectedPixelRatio = Math.min(
      1.75,
      2.5,
      Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (width * height)),
    );
    assert.equal(viewport.width, width);
    assert.equal(viewport.height, height);
    assert.equal(viewport.cssPixels, width * height);
    assert.ok(
      viewport.drawingBufferPixels <= MAX_DRAWING_BUFFER_PIXELS + 1,
    );
    assert.equal(viewport.aspect, width / height);
    assert.equal(viewport.cameraHalfWidth, viewport.cameraHalfHeight * viewport.aspect);
    assert.equal(viewport.pixelRatio, expectedPixelRatio);
    assert.equal(viewport.coreHorizontalFit, 1);
  }
  assert.equal(computeViewport(3440, 1440, 3, true).pixelRatio, 1.25);
  assert.ok(computeViewport(3840, 2160, 3, true).pixelRatio < 1.15);
  const portrait = computeViewport(1080, 1920, 2);
  assert.ok(portrait.coreHorizontalFit > 0 && portrait.coreHorizontalFit < 1);
  assert.deepEqual(computeViewport(Number.NaN, -4, 0), {
    width: 1,
    height: 1,
    cssPixels: 1,
    drawingBufferPixels: 1,
    aspect: 1,
    pixelRatio: 1,
    cameraHalfHeight: 2.5,
    cameraHalfWidth: 2.5,
    coreHorizontalFit: 1,
  });
});

test('frame scheduler carries refresh remainder instead of collapsing 40/60 fps to 30', () => {
  function simulate(frameRate) {
    let lastFrameAt = 0;
    let rendered = 0;
    const deltas = [];
    for (let tick = 1; tick <= 60; tick += 1) {
      const frame = scheduleRenderFrame(lastFrameAt, tick * (1_000 / 60), frameRate);
      if (frame.shouldRender) {
        rendered += 1;
        lastFrameAt = frame.lastFrameAt;
        deltas.push(frame.deltaSeconds);
      }
    }
    return { rendered, deltas };
  }

  assert.ok(simulate(40).rendered >= 39);
  assert.ok(simulate(60).rendered >= 59);
  assert.ok(simulate(30).rendered >= 29);
  for (const delta of simulate(40).deltas) {
    assert.ok(Math.abs(delta - 1 / 40) < 1e-9, `scheduled delta was ${delta}`);
  }

  const recovered = scheduleRenderFrame(25, 225, 40);
  assert.equal(recovered.shouldRender, true);
  assert.equal(recovered.lastFrameAt, 225);
  assert.equal(recovered.deltaSeconds, 0.05, 'long scheduled gaps are safely capped');
});

test('audio reactivity is clamped and directionally gated by presence state', () => {
  assert.deepEqual(
    deriveAudioReaction('LISTENING', {
      inputEnvelope: 2,
      outputEnvelope: 1,
      vadProbability: 4,
    }),
    { input: 1, output: 0, energy: 1, attention: 1, direction: -1 },
  );
  assert.deepEqual(
    deriveAudioReaction('SPEAKING', {
      inputEnvelope: -1,
      outputEnvelope: 0.7,
      vadProbability: 0.8,
    }),
    { input: 0, output: 0.7, energy: 0.7, attention: 0, direction: 1 },
  );
  assert.deepEqual(
    deriveAudioReaction('IDLE', {
      inputEnvelope: 0.5,
      outputEnvelope: 0.9,
      vadProbability: 0.8,
    }),
    { input: 0.04, output: 0, energy: 0.04, attention: 0, direction: 0 },
  );
  assert.equal(approach(0, 1, 0.25, 0.1), 0.25);
  assert.equal(approach(1, 0, 0.25, 0.1), 0.9);
});

test('desktop alpha is headless, hidden-first, transparent, and click-through', async () => {
  const [configSource, css, rendererSource, mainSource, rustSource] = await Promise.all([
    readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/birdie-field.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
  ]);
  const config = JSON.parse(configSource);
  const window = config.app.windows.find(({ label }) => label === 'core');

  assert.equal(window.transparent, true);
  assert.equal(window.decorations, false);
  assert.equal(window.alwaysOnTop, false);
  assert.equal(window.skipTaskbar, true);
  assert.equal(window.visible, false);
  assert.equal(window.width, 1);
  assert.equal(window.height, 1);
  assert.match(css, /visibility:\s*hidden/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(rendererSource, /ResizeObserver/);
  assert.match(rendererSource, /renderer\.setSize\(viewport\.width, viewport\.height/);
  assert.doesNotMatch(rendererSource, /setSize\(220,\s*220/);
  assert.match(rendererSource, /uAttention/);
  assert.match(rendererSource, /colorspace_fragment/);
  assert.match(rendererSource, /onShaderError/);
  assert.match(rustSource, /primary_monitor\(\)/);
  assert.match(rustSource, /set_ignore_cursor_events\(true\)/);
  assert.match(rustSource, /desktop_set_interaction_mode/);
  assert.match(rustSource, /force_overlay_fail_closed/);
  assert.match(rustSource, /reset_overlay_after_page_load/);
  assert.match(rustSource, /\.on_page_load\(/);
  assert.match(rustSource, /\.on_window_event\(/);
  assert.doesNotMatch(rustSource, /RegisterHotKey/);
  assert.doesNotMatch(rustSource, /"Birdie bedienen"/);
  assert.doesNotMatch(mainSource, /field-chrome|module-rail|command-form/);
  assert.match(mainSource, /headless/);
  assert.match(mainSource, /desktop\.app\.open/);
});
