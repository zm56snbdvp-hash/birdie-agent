import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { StaticPresenceRenderer } from '../src/stream-static-renderer.js';

test('static renderer reports only a RAF heartbeat and never claims rendered frames', () => {
  const originalGlobals = {
    HTMLCanvasElement: globalThis.HTMLCanvasElement,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window,
  };
  const windowListeners = new Map();
  const documentListeners = new Map();
  const frames = new Map();
  let nextFrameId = 0;

  class FakeCanvas {
    parentElement = { getBoundingClientRect: () => ({ width: 1280, height: 720 }) };
  }

  globalThis.HTMLCanvasElement = FakeCanvas;
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
  };
  globalThis.document = {
    hidden: false,
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    nextFrameId += 1;
    frames.set(nextFrameId, callback);
    return nextFrameId;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);

  try {
    const signals = [];
    const contexts = [];
    const renderer = new StaticPresenceRenderer(new FakeCanvas(), {
      onFrame: (signal) => signals.push(signal),
      onContextState: (...signal) => contexts.push(signal),
    });
    renderer.start();
    const callback = frames.get(renderer.frameRequest);
    assert.equal(typeof callback, 'function');
    callback(renderer.lastHeartbeatAt + 20);

    assert.equal(renderer.renderedFrameCount, 0);
    assert.equal(renderer.heartbeatFrameCount, 1);
    assert.equal(signals[0].metricKind, 'RAF_HEARTBEAT');
    assert.equal(signals[0].heartbeatCount, 1);
    assert.deepEqual(contexts[0], [
      'RAF_HEARTBEAT',
      'renderer=static;visual-performance=unproven',
    ]);

    renderer.dispose();
    assert.equal(windowListeners.has('resize'), false);
    assert.equal(documentListeners.has('visibilitychange'), false);
    assert.equal(renderer.frameRequest, 0);
  } finally {
    for (const [name, value] of Object.entries(originalGlobals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('stream runtime cleanup, stall telemetry and 720p text clamps stay explicit', async () => {
  const [streamSource, fieldSource, css] = await Promise.all([
    readFile(new URL('../src/stream-mode.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/birdie-field.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/stream-mode.css', import.meta.url), 'utf8'),
  ]);

  for (const listener of [
    'handleWindowError',
    'handleUnhandledRejection',
    'handleBeforeUnload',
    'handleQrImageError',
  ]) {
    assert.match(streamSource, new RegExp(`removeEventListener\\([^\\n]+${listener}`));
  }
  assert.match(streamSource, /metrics\.fps === 0/);
  assert.match(streamSource, /stateSamples\.values\.push\(metrics\.fps\)/);
  assert.match(streamSource, /visualPerformanceSignal = 'UNPROVEN_STATIC_CSS'/);
  assert.match(streamSource, /RAF \$\{Math\.round\(metrics\.heartbeatFps\)\} HZ/);
  assert.match(fieldSource, /const frameRate = 30/);
  assert.doesNotMatch(fieldSource, /quietState \? 40 : 60/);
  assert.match(streamSource, /renderScale: requestedProfile\.quality === 'LOW' \? 0\.5 : 0\.55/);

  const minimumReadableClamps = css.match(/font-size:\s*clamp\(/g) ?? [];
  assert.ok(minimumReadableClamps.length >= 15, 'all small stream labels use readable clamps');
  assert.match(css, /\.stream-footer[\s\S]*font-size:\s*clamp\(10px,/);
  assert.match(css, /\.stream-telemetry span,[\s\S]*font-size:\s*clamp\(10px,/);
  assert.match(css, /\.stream-cta-copy a[\s\S]*font-size:\s*clamp\(10px,/);
});
