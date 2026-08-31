import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_STREAM_CONFIG,
  STREAM_CLIP_30_PHASES,
  STREAM_CLIP_60_PHASES,
  STREAM_DEMO_DURATION_MS,
  STREAM_DEMO_PHASES,
  STREAM_ERROR_FIXTURE,
  STREAM_TIMELINES,
  decodeQrPayload,
  isPlaceholderCta,
  isCanonicalPublicHttpsUrl,
  inspectStreamQrAssetWithDependencies,
  isLoopbackQrPreview,
  resolveStreamConfig,
  resolveStreamDemoFixture,
  resolveStreamTimeline,
  sanitizeCtaUrl,
  sanitizeQrImage,
  sanitizeWallArtProductImage,
  sanitizeWallArtShopUrl,
  streamDemoFrame,
} from '../src/stream-mode-config.js';
import {
  evaluateStreamEvidence,
  resolveStreamRenderProfile,
} from '../src/stream-evidence.js';

test('stream demo is a deterministic 72-second voice-reactive loop', () => {
  assert.equal(STREAM_DEMO_DURATION_MS, 72_000);
  assert.equal(
    STREAM_DEMO_PHASES.reduce((total, phase) => total + phase.durationMs, 0),
    STREAM_DEMO_DURATION_MS,
  );

  assert.equal(streamDemoFrame(0).state, 'IDLE');
  assert.equal(streamDemoFrame(8_500).state, 'SPEECH_DETECTED');
  assert.equal(streamDemoFrame(12_000).state, 'LISTENING');
  assert.equal(streamDemoFrame(22_000).state, 'THINKING');
  assert.equal(streamDemoFrame(31_000).state, 'SPEAKING');
  assert.equal(streamDemoFrame(72_000).loopIndex, 1);
  assert.equal(streamDemoFrame(72_000).state, 'IDLE');
});

test('voice levels are bounded and directional', () => {
  const listening = streamDemoFrame(14_000);
  const speaking = streamDemoFrame(34_000);
  assert.ok(listening.inputLevel > 0 && listening.inputLevel <= 1);
  assert.equal(listening.outputLevel, 0);
  assert.equal(speaking.inputLevel, 0);
  assert.ok(speaking.outputLevel > 0 && speaking.outputLevel <= 1);
});

test('dedicated clip timelines close on exact 30- and 60-second boundaries', () => {
  assert.equal(STREAM_CLIP_30_PHASES.reduce((sum, phase) => sum + phase.durationMs, 0), 30_000);
  assert.equal(STREAM_CLIP_60_PHASES.reduce((sum, phase) => sum + phase.durationMs, 0), 60_000);
  assert.equal(resolveStreamTimeline('clip=30'), STREAM_TIMELINES.CLIP_30);
  assert.equal(resolveStreamTimeline('clip=60'), STREAM_TIMELINES.CLIP_60);
  assert.equal(streamDemoFrame(30_000, STREAM_TIMELINES.CLIP_30).loopIndex, 1);
  assert.equal(streamDemoFrame(60_000, STREAM_TIMELINES.CLIP_60).loopIndex, 1);
  for (const timeline of [STREAM_TIMELINES.CLIP_30, STREAM_TIMELINES.CLIP_60]) {
    const states = new Set(timeline.phases.map((phase) => phase.state));
    assert.ok(states.has('IDLE'));
    assert.ok(states.has('LISTENING'));
    assert.ok(states.has('SPEAKING'));
    assert.ok(states.has('SUCCESS'));
    assert.ok(timeline.phases.at(-1).durationMs >= 3_000);
  }
});

test('synthetic error fixture is isolated from the normal demo loop', async () => {
  assert.equal(resolveStreamDemoFixture(''), null);
  assert.equal(resolveStreamDemoFixture('fixture=ERROR'), null);
  assert.equal(resolveStreamDemoFixture('fixture=error'), STREAM_ERROR_FIXTURE);
  assert.deepEqual(STREAM_ERROR_FIXTURE, {
    id: 'ERROR',
    state: 'ERROR',
    copy: 'Synthetischer Demo-Fehler',
    code: 'SYNTHETIC_FIXTURE',
    badge: 'SYNTHETIC ERROR',
    startsLoop: false,
  });

  const streamSource = await readFile(new URL('../src/stream-mode.js', import.meta.url), 'utf8');
  assert.match(streamSource, /if \(demoFixture\) \{[\s\S]*applyPresence\(demoFixture\.state, demoFixture\.copy\);[\s\S]*recordError\(demoFixture\.code\);[\s\S]*\} else \{[\s\S]*requestAnimationFrame\(runDemo\)/);
  assert.doesNotMatch(streamSource, /__birdieStream[\s\S]{0,200}(?:setPresence|injectFault)/);
});

test('CTA configuration is bounded and cannot put credentials or query secrets on screen', () => {
  const config = resolveStreamConfig({
    headline: '  Birdie\n\tLive  ',
    ctaUrl: 'https://user:secret@example.com/private?token=hidden#fragment',
    qrImage: 'https://tracker.example/qr.png',
  });
  assert.equal(config.headline, 'Birdie Live');
  assert.equal(config.ctaUrl, 'https://example.com/birdie');
  assert.equal(config.ctaDisplayUrl, 'example.com/birdie');
  assert.equal(config.qrImage, '');
  assert.equal(config.placeholderCta, true);
  assert.equal(config.conversionReady, false);
  assert.equal(sanitizeCtaUrl('javascript:alert(1)'), 'https://example.com/birdie');
  assert.equal(sanitizeCtaUrl('http://birdieandbreakfast.de/pilot'), 'https://example.com/birdie');
  assert.equal(sanitizeCtaUrl('https://birdieandbreakfast.de/pilot?token=secret'), 'https://example.com/birdie');
  assert.equal(sanitizeQrImage('/assets/birdie-qr.svg'), '');
  assert.equal(sanitizeQrImage('/assets/birdie-qr.png'), '/assets/birdie-qr.png');
  assert.equal(sanitizeQrImage('//remote.example/qr.png'), '');
  assert.equal(sanitizeQrImage('/assets/../private.svg'), '');
  assert.equal(sanitizeQrImage('/assets/%2e%2e/private.svg'), '');
  assert.equal(isPlaceholderCta('https://example.org/waitlist'), true);
  assert.equal(isPlaceholderCta('https://birdie.invalid/pilot'), true);
  assert.equal(isPlaceholderCta('https://pilot.example.com/birdie'), true);
  assert.equal(isPlaceholderCta('https://birdie.internal/pilot'), true);
  assert.equal(isPlaceholderCta('https://localhost/pilot'), true);
  assert.equal(isCanonicalPublicHttpsUrl('https://birdieandbreakfast.de/pilot'), true);
  assert.equal(isCanonicalPublicHttpsUrl('https://birdieandbreakfast.de/pilot?source=stream'), false);
});

test('wall-art showcase is opt-in and remains STOP without product and shop evidence', () => {
  assert.equal(sanitizeWallArtProductImage('https://cdn.example.org/art.png'), '');
  assert.equal(sanitizeWallArtProductImage('//cdn.example.org/art.png'), '');
  assert.equal(sanitizeWallArtProductImage('/assets/../private.png'), '');
  assert.equal(sanitizeWallArtProductImage('/assets/%2e%2e/private.png'), '');
  assert.equal(sanitizeWallArtProductImage('/assets//wall-art.png'), '');
  assert.equal(sanitizeWallArtProductImage('/assets/wall-art.svg'), '');
  assert.equal(sanitizeWallArtProductImage('/assets/wall-art.png'), '/assets/wall-art.png');
  assert.equal(sanitizeWallArtShopUrl('https://user:secret@example.com/private'), '');
  assert.equal(sanitizeWallArtShopUrl('https://birdieandbreakfast.de/pilot?source=stream'), '');
  assert.equal(sanitizeWallArtShopUrl('https://birdieandbreakfast.de/pilot'), 'https://birdieandbreakfast.de/pilot');

  const raw = {
    ctaUrl: 'https://birdieandbreakfast.de/pilot',
    ctaStatus: 'READY',
    qrImage: '/assets/birdie-pilot.png',
    qrTarget: 'https://birdieandbreakfast.de/pilot',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: true,
    wallArtTitle: '  Local\nWall Art  ',
    wallArtProductImage: '/assets/wall-art.png',
    wallArtProductImageSha256: 'b'.repeat(64),
    wallArtShopUrl: 'https://birdieandbreakfast.de/pilot',
    wallArtProductEvidenceStatus: 'READY',
    wallArtShopEvidenceStatus: 'READY',
    wallArtDecision: 'GO',
  };
  const defaultConfig = resolveStreamConfig(raw);
  assert.equal(defaultConfig.showcaseMode, 'DEFAULT');
  assert.equal(defaultConfig.conversionDeclaredReady, true);

  const showcase = resolveStreamConfig(
    raw,
    'showcase=wall-art&brand=FAKE&headline=Nur+49+EUR&subline=Jetzt+kaufen&wallArtProductImage=%2Fassets%2Freplacement.png&wallArtShopUrl=https%3A%2F%2Fattacker.example%2F&wallArtProductEvidenceStatus=READY&wallArtDecision=GO&conversionReady=true&priceText=49',
  );
  assert.equal(showcase.showcaseMode, 'WALL_ART');
  assert.equal(showcase.brand, DEFAULT_STREAM_CONFIG.brand);
  assert.equal(showcase.headline, DEFAULT_STREAM_CONFIG.headline);
  assert.equal(showcase.subline, DEFAULT_STREAM_CONFIG.subline);
  assert.equal(showcase.wallArtTitle, 'Local Wall Art');
  assert.equal(showcase.wallArtProductImage, '/assets/wall-art.png');
  assert.equal(showcase.wallArtProductImageSha256, 'b'.repeat(64));
  assert.equal(showcase.wallArtShopUrl, 'https://birdieandbreakfast.de/pilot');
  assert.equal(showcase.wallArtProductConfigured, true);
  assert.equal(showcase.wallArtShopTargetConfigured, true);
  assert.equal(showcase.wallArtProductEvidenceStatus, 'UNPROVEN');
  assert.equal(showcase.wallArtShopEvidenceStatus, 'UNPROVEN');
  assert.equal(showcase.wallArtDecision, 'STOP');
  assert.equal(showcase.wallArtQueryOverridesIgnored, true);
  assert.equal(showcase.wallArtEvidenceOverridesIgnored, true);
  assert.equal(showcase.conversionDeclaredReady, false);
  assert.equal(showcase.conversionReady, false);
  assert.equal('price' in showcase, false);
  assert.equal('priceText' in showcase, false);

  const publicDraft = resolveStreamConfig({
    wallArtProductImage: 'https://remote.example/art.png',
    wallArtShopUrl: 'https://user:secret@example.com/private?token=hidden',
  }, 'showcase=wall-art');
  assert.equal(publicDraft.wallArtProductImage, '');
  assert.equal(publicDraft.wallArtShopUrl, '');
  assert.equal(publicDraft.wallArtProductConfigured, false);
  assert.equal(publicDraft.wallArtShopTargetConfigured, false);
  assert.equal(publicDraft.wallArtDecision, 'STOP');
});

test('QR becomes conversion-ready only after canonical config and actual asset hash agree', async () => {
  const declared = resolveStreamConfig({
    ctaUrl: 'https://birdieandbreakfast.de/pilot',
    ctaStatus: 'READY',
    qrImage: '/assets/birdie-pilot.png',
    qrTarget: 'https://birdieandbreakfast.de/pilot',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: true,
  });
  assert.equal(declared.qrMatchesCta, true);
  assert.equal(declared.qrImage, '/assets/birdie-pilot.png');
  assert.equal(declared.conversionDeclaredReady, true);
  assert.equal(declared.qrAssetHashVerified, false);
  assert.equal(declared.conversionReady, false);

  const verified = await inspectStreamQrAssetWithDependencies(declared, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
    qrDecoder: async () => ({ status: 'PASS' }),
    createObjectUrl: async () => 'blob:verified-test-qr',
  });
  assert.equal(verified.actualQrSha256, 'a'.repeat(64));
  assert.equal(verified.qrAssetHashVerified, true);
  assert.equal(verified.qrPayloadVerified, true);
  assert.equal(verified.qrPayloadStatus, 'PASS');
  assert.equal(verified.qrRenderReady, true);
  assert.equal(verified.qrRenderUrl, 'blob:verified-test-qr');
  assert.equal(verified.conversionReady, true);

  const draft = resolveStreamConfig({
    ctaUrl: 'https://birdieandbreakfast.de/pilot',
    ctaStatus: 'DRAFT',
    qrImage: '/assets/birdie-pilot.png',
    qrTarget: 'https://birdieandbreakfast.de/pilot',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: false,
  });
  const draftDependencies = {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
    qrDecoder: async () => ({ status: 'PASS' }),
    createObjectUrl: async () => 'blob:draft-verification-only',
  };
  const draftRegular = await inspectStreamQrAssetWithDependencies(draft, draftDependencies);
  assert.equal(draftRegular.qrAssetHashVerified, true);
  assert.equal(draftRegular.qrPayloadVerified, true);
  assert.equal(draftRegular.qrRenderReady, false);
  assert.equal(draftRegular.qrRenderUrl, '');
  assert.equal(draftRegular.conversionReady, false);

  const draftPreview = await inspectStreamQrAssetWithDependencies(
    draft,
    draftDependencies,
    { allowLocalPreview: true },
  );
  assert.equal(draftPreview.conversionDeclaredReady, false);
  assert.equal(draftPreview.qrRenderReady, true);
  assert.equal(draftPreview.qrRenderUrl, 'blob:draft-verification-only');
  assert.equal(draftPreview.conversionReady, false);

  const draftPreviewWrongPayload = await inspectStreamQrAssetWithDependencies(
    draft,
    { ...draftDependencies, qrDecoder: async () => ({ status: 'MISMATCH' }) },
    { allowLocalPreview: true },
  );
  assert.equal(draftPreviewWrongPayload.qrPayloadStatus, 'MISMATCH');
  assert.equal(draftPreviewWrongPayload.qrRenderReady, false);
  assert.equal(draftPreviewWrongPayload.qrRenderUrl, '');

  const draftPreviewWrongHash = await inspectStreamQrAssetWithDependencies(
    draft,
    {
      ...draftDependencies,
      subtle: { digest: async () => new Uint8Array(32).fill(0xbb).buffer },
    },
    { allowLocalPreview: true },
  );
  assert.equal(draftPreviewWrongHash.qrPayloadStatus, 'HASH_MISMATCH');
  assert.equal(draftPreviewWrongHash.qrRenderReady, false);
  assert.equal(draftPreviewWrongHash.qrRenderUrl, '');

  const wrongPayload = await inspectStreamQrAssetWithDependencies(declared, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
    qrDecoder: async () => ({ status: 'MISMATCH' }),
  });
  assert.equal(wrongPayload.qrAssetHashVerified, true);
  assert.equal(wrongPayload.qrPayloadVerified, false);
  assert.equal(wrongPayload.qrPayloadStatus, 'MISMATCH');
  assert.equal(wrongPayload.conversionReady, false);

  const mismatchedHash = await inspectStreamQrAssetWithDependencies(declared, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    subtle: { digest: async () => new Uint8Array(32).fill(0xbb).buffer },
  });
  assert.equal(mismatchedHash.qrAssetHashVerified, false);
  assert.equal(mismatchedHash.qrPayloadStatus, 'HASH_MISMATCH');
  assert.equal(mismatchedHash.conversionReady, false);

  const mismatch = resolveStreamConfig({
    ctaUrl: 'https://birdieandbreakfast.de/pilot',
    ctaStatus: 'READY',
    qrImage: '/assets/birdie-pilot.png',
    qrTarget: 'https://birdieandbreakfast.de/other',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: true,
  });
  assert.equal(mismatch.qrMatchesCta, false);
  assert.equal(mismatch.qrImage, '');
  assert.equal(mismatch.conversionReady, false);

  const overridden = resolveStreamConfig({
    ctaUrl: 'https://birdieandbreakfast.de/pilot',
    ctaStatus: 'READY',
    qrImage: '/assets/birdie-pilot.png',
    qrTarget: 'https://birdieandbreakfast.de/pilot',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: true,
  }, 'ctaUrl=https://attacker.example/path&qr=/assets/replacement.png&ctaLabel=FREE&ctaText=Send%20credentials');
  assert.equal(overridden.ctaUrl, 'https://birdieandbreakfast.de/pilot');
  assert.equal(overridden.qrImage, '/assets/birdie-pilot.png');
  assert.equal(overridden.ctaLabel, 'EARLY ACCESS');
  assert.equal(overridden.ctaText, 'Birdie auf deinem PC testen');
  assert.equal(overridden.conversionOverridesIgnored, true);
  assert.equal(overridden.conversionDeclaredReady, false);
});

test('QR verification preview is limited to exact loopback HTTP URLs', () => {
  assert.equal(isLoopbackQrPreview(
    new URL('http://127.0.0.1:1421/'),
    'mode=stream&qrVerify=local',
  ), true);
  assert.equal(isLoopbackQrPreview(
    new URL('http://localhost:1421/'),
    'qrVerify=local',
  ), true);
  assert.equal(isLoopbackQrPreview(
    new URL('http://[::1]:1421/'),
    'qrVerify=local',
  ), true);

  const denied = [
    ['https://birdie.example/', 'qrVerify=local'],
    ['http://192.168.1.10:1421/', 'qrVerify=local'],
    ['http://localhost.attacker.example/', 'qrVerify=local'],
    ['tauri://localhost/', 'qrVerify=local'],
    ['http://127.0.0.1:1421/', 'qrVerify=LOCAL'],
    ['http://127.0.0.1:1421/', 'qrVerify=local&ctaTest=private'],
  ];
  for (const [url, search] of denied) {
    assert.equal(isLoopbackQrPreview(new URL(url), search), false, `${url}?${search}`);
  }
});

test('QR decode uses native detection first and a local jsQR fallback without weakening failures', async () => {
  const config = { qrImage: '/assets/code.png', qrTarget: 'https://birdieandbreakfast.de/pilot' };
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal((await decodeQrPayload(bytes, config, {
    BarcodeDetectorImpl: undefined,
    createImageBitmapImpl: undefined,
  })).status, 'UNAVAILABLE');

  const fallbackBitmap = { width: 1, height: 1, close() {} };
  class FallbackCanvas {
    getContext() {
      return {
        drawImage() {},
        getImageData() { return { data: new Uint8ClampedArray(4) }; },
      };
    }
  }
  assert.equal((await decodeQrPayload(bytes, config, {
    BarcodeDetectorImpl: undefined,
    createImageBitmapImpl: async () => fallbackBitmap,
    OffscreenCanvasImpl: FallbackCanvas,
    jsQrImpl: () => ({ data: config.qrTarget }),
  })).status, 'PASS');
  assert.equal((await decodeQrPayload(bytes, config, {
    BarcodeDetectorImpl: undefined,
    createImageBitmapImpl: async () => fallbackBitmap,
    OffscreenCanvasImpl: FallbackCanvas,
    jsQrImpl: () => ({ data: 'https://wrong.example/path' }),
  })).status, 'MISMATCH');

  const bitmap = { closeCalled: false, close() { this.closeCalled = true; } };
  class MatchingDetector {
    async detect() { return [{ format: 'qr_code', rawValue: config.qrTarget }]; }
  }
  assert.equal((await decodeQrPayload(bytes, config, {
    BarcodeDetectorImpl: MatchingDetector,
    createImageBitmapImpl: async () => bitmap,
  })).status, 'PASS');
  assert.equal(bitmap.closeCalled, true);

  class WrongDetector {
    async detect() { return [{ format: 'qr_code', rawValue: 'https://wrong.example/path' }]; }
  }
  assert.equal((await decodeQrPayload(bytes, config, {
    BarcodeDetectorImpl: WrongDetector,
    createImageBitmapImpl: async () => ({ close() {} }),
  })).status, 'MISMATCH');

  class AmbiguousDetector {
    async detect() { return [{ format: 'qr_code', rawValue: config.qrTarget }, { format: 'qr_code', rawValue: config.qrTarget }]; }
  }
  assert.equal((await decodeQrPayload(bytes, config, {
    BarcodeDetectorImpl: AmbiguousDetector,
    createImageBitmapImpl: async () => ({ close() {} }),
  })).status, 'AMBIGUOUS');
});

test('render profiles make high, low and static thresholds explicit', () => {
  assert.deepEqual(resolveStreamRenderProfile(), {
    renderer: 'WEBGL', quality: 'HIGH', label: 'HIGH WEBGL',
    idleFpsMinimum: 28, activeFpsMinimum: 28, longFrameThresholdMs: 55,
  });
  assert.equal(resolveStreamRenderProfile('quality=low').quality, 'LOW');
  assert.equal(resolveStreamRenderProfile('', true).quality, 'LOW');
  assert.deepEqual(resolveStreamRenderProfile('renderer=backup'), {
    renderer: 'STATIC', quality: 'LOW', label: 'STATIC BACKUP',
    idleFpsMinimum: 24, activeFpsMinimum: 24, longFrameThresholdMs: 60,
  });
});

test('evidence separates demo readiness from unresolved conversion CTA', () => {
  const snapshot = {
    profile: resolveStreamRenderProfile(),
    timeline: 'LOOP',
    firstFrameMs: 320,
    configReadyMs: 410,
    durationMs: 72_000,
    viewport: { width: 1920, height: 1080, pixelRatio: 1 },
    errors: 0,
    loopCount: 1,
    transitionSequence: 10,
    maxFrameGapMs: 34,
    frameIntervalsMs: [16.7, 17, 20],
    longFrames: 0,
    transitions: [
      'IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING',
      'SUCCESS', 'IDLE', 'LISTENING', 'WORKING', 'SPEAKING',
    ].map((to, index) => ({ sequence: index + 1, to })),
    fpsByPresence: {
      IDLE: { average: 34, minimum: 33, values: [33, 34, 35] },
      SPEECH_DETECTED: { average: 40, minimum: 39, values: [39, 40] },
      LISTENING: { average: 50, minimum: 49, values: [49, 50] },
      THINKING: { average: 42, minimum: 41, values: [41, 42] },
      SPEAKING: { average: 49, minimum: 48, values: [48, 49] },
      WORKING: { average: 39, minimum: 38, values: [38, 39] },
      SUCCESS: { average: 36, minimum: 35, values: [35, 36] },
    },
    config: { conversionReady: false },
  };
  const draft = evaluateStreamEvidence(snapshot);
  assert.equal(draft.demoVerdict, 'PASS');
  assert.equal(draft.soakVerdict, 'UNPROVEN');
  assert.equal(draft.conversionVerdict, 'UNPROVEN');
  assert.equal(draft.gates.find((gate) => gate.id === 'cta-qr').status, 'UNPROVEN');

  const broken = evaluateStreamEvidence({ ...snapshot, errors: 1 });
  assert.equal(broken.demoVerdict, 'STOP');
  assert.equal(broken.soakVerdict, 'STOP');
  assert.equal(broken.conversionVerdict, 'STOP');

  const skipped = evaluateStreamEvidence({
    ...snapshot,
    transitions: snapshot.transitions.filter((entry) => entry.to !== 'THINKING'),
  });
  assert.equal(skipped.demoVerdict, 'STOP');
  assert.equal(skipped.gates.find((gate) => gate.id === 'state-coverage').status, 'STOP');
  assert.equal(skipped.gates.find((gate) => gate.id === 'transition-order').status, 'STOP');

  const clip60States = [
    'IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING',
    'WORKING', 'SPEAKING', 'SUCCESS', 'IDLE',
  ];
  const clip60WithPartialSecondLoop = evaluateStreamEvidence({
    ...snapshot,
    timeline: 'CLIP_60',
    durationMs: 72_000,
    loopCount: 1,
    transitionSequence: 10,
    transitions: [...clip60States, 'SPEECH_DETECTED', 'LISTENING']
      .map((to, index) => ({ sequence: index + 1, to })),
  });
  assert.equal(clip60WithPartialSecondLoop.gates.find((gate) => gate.id === 'transition-order').status, 'PASS');

  const clip60WrongOrder = evaluateStreamEvidence({
    ...snapshot,
    timeline: 'CLIP_60',
    loopCount: 1,
    transitions: clip60States.with(3, 'SPEAKING')
      .map((to, index) => ({ sequence: index + 1, to })),
  });
  assert.equal(clip60WrongOrder.gates.find((gate) => gate.id === 'transition-order').status, 'STOP');

  const { WORKING: omittedWorking, ...clip30FpsByPresence } = snapshot.fpsByPresence;
  assert.ok(omittedWorking);
  const clip30WithoutWorking = evaluateStreamEvidence({
    ...snapshot,
    timeline: 'CLIP_30',
    durationMs: 30_000,
    loopCount: 1,
    transitionSequence: 7,
    transitions: [
      'IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING', 'SUCCESS', 'IDLE',
    ].map((to, index) => ({ sequence: index + 1, to })),
    fpsByPresence: clip30FpsByPresence,
  });
  assert.equal(clip30WithoutWorking.gates.find((gate) => gate.id === 'active-fps').status, 'PASS');
  assert.deepEqual(
    Object.keys(clip30WithoutWorking.gates.find((gate) => gate.id === 'active-fps').observed.byState),
    ['SPEECH_DETECTED', 'LISTENING', 'THINKING', 'SPEAKING', 'SUCCESS'],
  );

  const clip60SoakTransitions = [
    ...clip60States,
    ...Array.from({ length: 7 }, () => clip60States.slice(1)).flat(),
  ].map((to, index) => ({ sequence: index + 1, to }));
  const clip60Soaked = evaluateStreamEvidence({
    ...snapshot,
    timeline: 'CLIP_60',
    durationMs: 600_000,
    loopCount: 8,
    transitionSequence: clip60SoakTransitions.length,
    transitions: clip60SoakTransitions,
  });
  assert.equal(clip60Soaked.gates.find((gate) => gate.id === 'transition-order').status, 'PASS');
  assert.equal(clip60Soaked.gates.find((gate) => gate.id === 'soak-transition-volume').status, 'PASS');

  const soakTransitions = Array.from({ length: 8 }, (_, loop) => snapshot.transitions.map((entry) => ({
    ...entry,
    sequence: loop * snapshot.transitions.length + entry.sequence,
  }))).flat();
  const soaked = evaluateStreamEvidence({
    ...snapshot,
    durationMs: 600_000,
    loopCount: 8,
    transitionSequence: soakTransitions.length,
    transitions: soakTransitions,
  });
  assert.equal(soaked.demoVerdict, 'PASS');
  assert.equal(soaked.soakVerdict, 'PASS');

  const forgedSoakVolume = evaluateStreamEvidence({
    ...snapshot,
    durationMs: 600_000,
    loopCount: 8,
    transitionSequence: soakTransitions.length,
    transitions: snapshot.transitions,
  });
  assert.equal(forgedSoakVolume.demoVerdict, 'STOP');
  assert.equal(forgedSoakVolume.soakVerdict, 'STOP');
  assert.equal(
    forgedSoakVolume.gates.find((gate) => gate.id === 'transition-sequence-integrity').observed.firstViolation.reason,
    'REPORTED_MISMATCH',
  );
  assert.deepEqual(
    forgedSoakVolume.gates.find((gate) => gate.id === 'soak-transition-volume').observed,
    { retained: snapshot.transitions.length, reportedSequence: soakTransitions.length },
  );

  for (const [reason, sequences] of [
    ['DUPLICATE', [1, 2, 2, 4, 5, 6, 7, 8, 9, 10]],
    ['GAP', [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]],
    ['NON_MONOTONIC', [1, 2, 1, 4, 5, 6, 7, 8, 9, 10]],
  ]) {
    const invalid = evaluateStreamEvidence({
      ...snapshot,
      transitionSequence: sequences.at(-1),
      transitions: snapshot.transitions.map((entry, index) => ({
        ...entry,
        sequence: sequences[index],
      })),
    });
    const sequenceGate = invalid.gates.find((gate) => gate.id === 'transition-sequence-integrity');
    assert.equal(sequenceGate.status, 'STOP', reason);
    assert.equal(sequenceGate.observed.firstViolation.reason, reason);
    assert.equal(invalid.demoVerdict, 'STOP');
  }

  assert.deepEqual(soaked.transitionWindow, {
    retained: soakTransitions.length,
    firstSequence: 1,
    lastSequence: soakTransitions.length,
    reportedSequence: soakTransitions.length,
    firstViolation: null,
  });

  const stalled = evaluateStreamEvidence({
    ...snapshot,
    renderStalled: true,
    fpsByPresence: {
      ...snapshot.fpsByPresence,
      LISTENING: { average: 45, minimum: 0, values: [45, 44, 0] },
    },
  });
  assert.equal(stalled.demoVerdict, 'STOP');
  assert.equal(stalled.gates.find((gate) => gate.id === 'render-stall').status, 'STOP');

  const staticBackup = evaluateStreamEvidence({
    ...snapshot,
    profile: resolveStreamRenderProfile('renderer=backup'),
    visualPerformanceSignal: undefined,
    firstFrameMs: 1,
    maxFrameGapMs: 1,
    frameIntervalsMs: [],
  });
  assert.equal(staticBackup.demoVerdict, 'UNPROVEN');
  assert.equal(staticBackup.gates.find((gate) => gate.id === 'first-frame').status, 'UNPROVEN');
  assert.equal(staticBackup.gates.find((gate) => gate.id === 'idle-fps').status, 'UNPROVEN');
  assert.equal(staticBackup.gates.find((gate) => gate.id === 'frame-gaps').status, 'UNPROVEN');

  const contradictoryRenderer = evaluateStreamEvidence({
    ...snapshot,
    renderer: 'WEBGL',
    profile: resolveStreamRenderProfile('renderer=backup'),
  });
  assert.equal(contradictoryRenderer.gates.find((gate) => gate.id === 'renderer-identity').status, 'STOP');
  assert.equal(contradictoryRenderer.demoVerdict, 'STOP');

  const contradictoryConversion = evaluateStreamEvidence({
    ...snapshot,
    config: { conversionReady: true, qrAssetHashVerified: false },
  });
  assert.equal(contradictoryConversion.gates.find((gate) => gate.id === 'cta-qr').status, 'STOP');
  assert.equal(contradictoryConversion.conversionVerdict, 'STOP');

  const verifiedHash = 'a'.repeat(64);
  const converted = evaluateStreamEvidence({
    ...snapshot,
    config: {
      conversionReady: true,
      conversionDeclaredReady: true,
      qrAssetHashVerified: true,
      qrPayloadVerified: true,
      qrPayloadStatus: 'PASS',
      qrRenderReady: true,
      qrMatchesCta: true,
      qrScanVerified: true,
      qrConfigured: true,
      ctaStatus: 'READY',
      placeholderCta: false,
      ctaUrlCanonical: true,
      qrTargetCanonical: true,
      conversionOverridesIgnored: false,
      qrSha256: verifiedHash,
      actualQrSha256: verifiedHash,
    },
  });
  assert.equal(converted.gates.find((gate) => gate.id === 'cta-qr').status, 'PASS');
  assert.equal(converted.conversionVerdict, 'PASS');
});

test('stream mode is optional and preserves the default headless contract', async () => {
  const [mainSource, streamSource, fieldSource, staticSource, css, packageSource, publicConfig, viteConfig] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/stream-mode.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/birdie-field.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/stream-static-renderer.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/stream-mode.css', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../public/stream-mode.json', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageSource);
  const config = JSON.parse(publicConfig);

  assert.match(mainSource, /requestedMode === 'stream'/);
  assert.match(mainSource, /else startHeadless\(\)/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /\.stream-wall-art-product[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /data-stream-renderer="static"/);
  assert.match(streamSource, /scheduleStaticFallback\(code\)/);
  assert.match(streamSource, /isLoopbackQrPreview\(window\.location, query\)/);
  assert.match(streamSource, /query\.get\('showcase'\) === 'wall-art'/);
  assert.match(streamSource, /STREAMING OFF/);
  assert.match(streamSource, /RUNTIME SIGNAL/);
  assert.doesNotMatch(streamSource, /LIVE SIGNAL/);
  assert.match(streamSource, /SHOP TARGET UNPROVEN/);
  assert.match(css, /data-stream-showcase="wall-art"\] \.stream-telemetry[\s\S]*?grid-template-columns:\s*repeat\(5,/);
  assert.match(streamSource, /config\.conversionReady \|\| qrVerificationPreview/);
  assert.match(streamSource, /const verificationOnly = renderQr && !config\.conversionReady/);
  assert.match(streamSource, /!privateCtaEnabled[\s\S]{0,120}config\.qrRenderReady[\s\S]{0,120}qrVerificationPreview/);
  assert.doesNotMatch(streamSource, /if \(!privateCtaEnabled && \(config\.conversionReady \|\| qrVerificationPreview\)\)[\s\S]{0,80}ctaLink\.href/);
  assert.match(streamSource, /await import\('\.\/birdie-field\.js'\)/);
  assert.ok(streamSource.indexOf("requestedProfile.renderer === 'STATIC'") < streamSource.indexOf("await import('./birdie-field.js')"));
  assert.match(streamSource, /field\?\.renderedFrameCount/);
  assert.match(fieldSource, /this\.renderedFrameCount \+= 1/);
  assert.doesNotMatch(fieldSource, /this\.renderedFrameCount \+= 1;[\s\S]{0,200}renderer\.render/);
  assert.match(staticSource, /STATIC_FRAME_INTERVAL_MS/);
  assert.match(packageJson.scripts.stream, /127\.0\.0\.1/);
  assert.match(packageJson.scripts.stream, /--strictPort/);
  assert.doesNotMatch(packageJson.scripts.stream, /--open/);
  assert.match(viteConfig, /git', \['rev-parse', '--short=12', 'HEAD'\]/);
  assert.match(viteConfig, /stream-\$\{status \? 'dirty' : 'clean'\}/);
  assert.match(viteConfig, /process\.env\.BIRDIE_DESKTOP_BUILD_ID/);
  assert.match(viteConfig, /hmr:\s*\{\s*overlay:\s*false\s*\}/);
  assert.equal(Object.keys(config).some((key) => /secret|token|password/i.test(key)), false);
  assert.equal(config.wallArtProductImage, '');
  assert.equal(config.wallArtShopUrl, '');
  assert.equal(config.wallArtProductEvidenceStatus, 'UNPROVEN');
  assert.equal(config.wallArtShopEvidenceStatus, 'UNPROVEN');
  assert.equal(Object.keys(config).some((key) => /price/i.test(key)), false);
});
