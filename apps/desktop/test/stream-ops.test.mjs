import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspectQrAsset,
  inspectStreamReadiness,
  inspectWallArtProductAsset,
  validateStreamOperations,
} from '../../../scripts/check-birdie-stream-readiness.mjs';
import { resolveStreamConfig } from '../src/stream-mode-config.js';

const EXPECTED_SCENES = Object.freeze({
  '00_START': ['SAFE_SLATE'],
  '01_STREAM': ['BIRDIE_STREAM_BROWSER'],
  '02_STREAM_BACKUP': ['BIRDIE_STREAM_BACKUP'],
  '03_CLIP_30': ['BIRDIE_STREAM_CLIP_30'],
  '04_CLIP_60': ['BIRDIE_STREAM_CLIP_60'],
  '05_QR_VERIFY': ['BIRDIE_STREAM_QR_VERIFY'],
  '09_BRB': ['SAFE_SLATE'],
  '10_END': ['SAFE_SLATE'],
  '99_SAFE': ['SAFE_SLATE'],
});

const EXPECTED_BROWSER_SOURCES = Object.freeze({
  BIRDIE_STREAM_BROWSER: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop',
    sceneBindings: ['01_STREAM'],
    shutdownWhenHidden: false,
    refreshWhenActive: false,
  }),
  BIRDIE_STREAM_BACKUP: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&renderer=backup&quality=low',
    sceneBindings: ['02_STREAM_BACKUP'],
    shutdownWhenHidden: false,
    refreshWhenActive: false,
  }),
  BIRDIE_STREAM_CLIP_30: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&clip=30',
    sceneBindings: ['03_CLIP_30'],
    shutdownWhenHidden: true,
    refreshWhenActive: true,
  }),
  BIRDIE_STREAM_CLIP_60: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&clip=60',
    sceneBindings: ['04_CLIP_60'],
    shutdownWhenHidden: true,
    refreshWhenActive: true,
  }),
  BIRDIE_STREAM_QR_VERIFY: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&qrVerify=local',
    sceneBindings: ['05_QR_VERIFY'],
    shutdownWhenHidden: true,
    refreshWhenActive: true,
  }),
});

const EXPECTED_HOTKEYS = Object.freeze({
  safeScene: 'Ctrl+Alt+Shift+F12',
  muteMicrophone: 'Ctrl+Alt+Shift+F11',
  stopRecording: 'Ctrl+Alt+Shift+F10',
  stopStreamingReserved: 'Ctrl+Alt+Shift+F9',
});

function sourceDefinitions(plan) {
  return [
    ...Object.values(plan.browserSources ?? {}),
    ...Object.values(plan.staticSources ?? {}),
  ];
}

function validateStrictObsPlan(plan) {
  const issues = [];
  const add = (condition, id) => { if (!condition) issues.push(id); };
  const sceneByName = new Map((plan.scenes ?? []).map((scene) => [scene.name, scene]));
  const sources = sourceDefinitions(plan);
  const sourceByName = new Map(sources.map((source) => [source.name, source]));

  add(plan.profile?.video?.baseWidth === 1920, 'video.base-width');
  add(plan.profile?.video?.baseHeight === 1080, 'video.base-height');
  add(plan.profile?.video?.outputWidth === 1920, 'video.output-width');
  add(plan.profile?.video?.outputHeight === 1080, 'video.output-height');
  add(plan.profile?.video?.fps === 30, 'video.fps');
  add(plan.profile?.audio?.sampleRateHz === 48000, 'audio.sample-rate');
  add(plan.profile?.audio?.channels === 'stereo', 'audio.channels');
  add(plan.profile?.audio?.desktopAudio === false, 'audio.desktop-off');
  add(plan.profile?.audio?.browserAudio === false, 'audio.browser-off');
  add(plan.profile?.outputs?.recording === true, 'output.recording-on');
  add(plan.profile?.outputs?.recordingContainer === 'mkv', 'output.recording-container');
  for (const output of ['streaming', 'replayBuffer', 'virtualCamera']) {
    add(plan.profile?.outputs?.[output] === false, `output.${output}-off`);
  }

  for (const property of [
    'captureDesktop',
    'captureNotifications',
    'renderTranscripts',
    'renderDiagnostics',
    'openStreamingServiceConfig',
  ]) {
    add(plan.privacy?.[property] === false, `privacy.${property}-off`);
  }
  add(plan.optionalOperatorMicrophone?.enabled === false, 'audio.operator-mic-disabled');
  add(plan.optionalOperatorMicrophone?.startsMuted === true, 'audio.operator-mic-starts-muted');
  add(plan.optionalOperatorMicrophone?.monitoring === 'off', 'audio.operator-mic-monitoring-off');

  add(JSON.stringify(plan.hotkeys) === JSON.stringify(EXPECTED_HOTKEYS), 'hotkeys.exact-map');
  add(new Set(Object.values(plan.hotkeys ?? {})).size === Object.keys(EXPECTED_HOTKEYS).length, 'hotkeys.unique');
  add(plan.transitions?.type === 'cut' && plan.transitions?.durationMs === 0, 'transitions.cut-only');

  add(JSON.stringify((plan.scenes ?? []).map((scene) => scene.name)) === JSON.stringify(Object.keys(EXPECTED_SCENES)), 'scenes.exact-order');
  for (const [name, expectedSources] of Object.entries(EXPECTED_SCENES)) {
    add(JSON.stringify(sceneByName.get(name)?.sources) === JSON.stringify(expectedSources), `scene.${name}.isolated`);
  }

  add(sources.length === 6, 'sources.exact-count');
  add(sourceByName.size === sources.length, 'sources.unique-names');
  const allowedTypes = new Set(plan.sourceAllowlist ?? []);
  const deniedTypes = new Set(plan.sourceDenylist ?? []);
  add([...allowedTypes].every((type) => !deniedTypes.has(type)), 'sources.allow-deny-disjoint');
  for (const deniedType of [
    'monitor_capture',
    'window_capture',
    'game_capture',
    'dshow_input',
    'ffmpeg_source',
    'wasapi_input_capture',
    'wasapi_output_capture',
  ]) {
    add(deniedTypes.has(deniedType), `sources.deny-${deniedType}`);
  }
  for (const source of sources) {
    add(allowedTypes.has(source.type), `source.${source.name}.type-allowed`);
    add(!deniedTypes.has(source.type), `source.${source.name}.type-not-denied`);
    add(source.audio === false, `source.${source.name}.audio-off`);
    add(source.width === 1920 && source.height === 1080, `source.${source.name}.dimensions`);
    const observedBindings = (plan.scenes ?? [])
      .filter((scene) => scene.sources?.includes(source.name))
      .map((scene) => scene.name);
    add(JSON.stringify(source.sceneBindings) === JSON.stringify(observedBindings), `source.${source.name}.scene-bindings`);
  }
  for (const scene of plan.scenes ?? []) {
    for (const sourceName of scene.sources ?? []) {
      add(sourceByName.has(sourceName), `scene.${scene.name}.source-defined`);
    }
  }

  for (const [name, expectation] of Object.entries(EXPECTED_BROWSER_SOURCES)) {
    const source = sourceByName.get(name);
    add(source?.type === 'browser_source', `source.${name}.browser-type`);
    add(source?.url === expectation.url, `source.${name}.url`);
    add(JSON.stringify(source?.sceneBindings) === JSON.stringify(expectation.sceneBindings), `source.${name}.declared-binding`);
    add(source?.shutdownWhenHidden === expectation.shutdownWhenHidden, `source.${name}.shutdown-lifecycle`);
    add(source?.refreshWhenActive === expectation.refreshWhenActive, `source.${name}.refresh-lifecycle`);
  }
  const safeSlate = sourceByName.get('SAFE_SLATE');
  add(safeSlate?.type === 'color_source_v3', 'source.SAFE_SLATE.static-type');
  add(safeSlate?.shutdownWhenHidden === false && safeSlate?.refreshWhenActive === false, 'source.SAFE_SLATE.lifecycle');
  add(JSON.stringify(safeSlate?.sceneBindings) === JSON.stringify(['00_START', '09_BRB', '10_END', '99_SAFE']), 'source.SAFE_SLATE.declared-binding');

  return issues;
}

async function fixtures() {
  return Promise.all([
    readFile(new URL('../../../ops/obs/birdie-stream-local.scene-plan.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../public/stream-mode.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
}

test('OBS plan is a privacy-safe, offline-only 1080p30 contract', async () => {
  const [plan, config] = await fixtures();
  const result = validateStreamOperations(plan, config);
  assert.equal(result.repositoryPlanStatus, 'PASS');
  assert.equal('demoPlanStatus' in result, false);
  assert.equal(result.founderGo, 'STOP');
  assert.deepEqual(result.founderBlockers, [
    'CTA_STATUS_DRAFT',
    'QR_SCAN_UNVERIFIED',
    'CTA_QR_NOT_DECLARED_READY',
    'WALL_ART_PRODUCT_ASSET_MISSING',
    'WALL_ART_PRODUCT_EVIDENCE_UNPROVEN',
    'WALL_ART_SHOP_TARGET_MISSING',
    'WALL_ART_SHOP_EVIDENCE_UNPROVEN',
    'WALL_ART_PRICE_UNKNOWN',
    'WALL_ART_QR_TARGET_UNPROVEN',
    'QR_ASSET_HASH_UNPROVEN',
    'QR_PAYLOAD_RUNTIME_UNPROVEN',
    'OBS_SETUP_UNPROVEN',
    'TEN_MINUTE_SOAK_UNPROVEN',
    'OBS_MKV_UNPROVEN',
  ]);
  assert.equal(result.checks.every((entry) => entry.status === 'PASS'), true);
  assert.equal(plan.sourceDenylist.includes('monitor_capture'), true);
  assert.equal(plan.profile.outputs.streaming, false);
  assert.deepEqual(validateStrictObsPlan(plan), []);
});

test('preflight stops unsafe output and source mutations', async () => {
  const [plan, config] = await fixtures();
  const unsafe = structuredClone(plan);
  unsafe.profile.outputs.streaming = true;
  unsafe.scenes.find((scene) => scene.name === '01_STREAM').sources.push('DESKTOP_CAPTURE');
  const result = validateStreamOperations(unsafe, config);
  assert.equal(result.repositoryPlanStatus, 'STOP');
  assert.equal(result.checks.find((entry) => entry.id === 'external-outputs-off').status, 'STOP');
  assert.equal(result.checks.find((entry) => entry.id === 'scene-01_STREAM').status, 'STOP');
});

test('OBS plan binds deterministic 30s and 60s clip sources to isolated scenes', async () => {
  const [plan] = await fixtures();
  for (const [name, expectation] of Object.entries(EXPECTED_BROWSER_SOURCES)) {
    const source = Object.values(plan.browserSources).find((entry) => entry.name === name);
    assert.ok(source, `${name} must be declared`);
    assert.equal(source.type, 'browser_source');
    assert.equal(source.url, expectation.url);
    assert.deepEqual(source.sceneBindings, expectation.sceneBindings);
    assert.equal(source.shutdownWhenHidden, expectation.shutdownWhenHidden);
    assert.equal(source.refreshWhenActive, expectation.refreshWhenActive);
    assert.equal(source.audio, false);
  }
});

test('product preflight rejects privacy, audio, output, hotkey, source, and lifecycle drift', async (t) => {
  const [plan, config] = await fixtures();
  const mutations = [
    {
      name: 'desktop capture privacy',
      mutate: (candidate) => { candidate.privacy.captureDesktop = true; },
      expectedIssue: 'privacy.captureDesktop-off',
    },
    {
      name: 'browser source audio',
      mutate: (candidate) => { candidate.browserSources.clip30.audio = true; },
      expectedIssue: 'source.BIRDIE_STREAM_CLIP_30.audio-off',
    },
    {
      name: 'recording disabled',
      mutate: (candidate) => { candidate.profile.outputs.recording = false; },
      expectedIssue: 'output.recording-on',
    },
    {
      name: 'external output enabled',
      mutate: (candidate) => { candidate.profile.outputs.virtualCamera = true; },
      expectedIssue: 'output.virtualCamera-off',
    },
    {
      name: 'duplicate emergency hotkey',
      mutate: (candidate) => { candidate.hotkeys.stopRecording = candidate.hotkeys.safeScene; },
      expectedIssue: 'hotkeys.unique',
    },
    {
      name: 'capture source type',
      mutate: (candidate) => { candidate.browserSources.main.type = 'window_capture'; },
      expectedIssue: 'source.BIRDIE_STREAM_BROWSER.type-allowed',
    },
    {
      name: 'undeclared scene source',
      mutate: (candidate) => { candidate.scenes[1].sources = ['UNKNOWN_SOURCE']; },
      expectedIssue: 'scene.01_STREAM.source-defined',
    },
    {
      name: 'source binding drift',
      mutate: (candidate) => { candidate.browserSources.backup.sceneBindings = ['01_STREAM']; },
      expectedIssue: 'source.BIRDIE_STREAM_BACKUP.scene-bindings',
    },
    {
      name: 'persistent source shutdown',
      mutate: (candidate) => { candidate.browserSources.main.shutdownWhenHidden = true; },
      expectedIssue: 'source.BIRDIE_STREAM_BROWSER.shutdown-lifecycle',
    },
    {
      name: 'clip source does not refresh',
      mutate: (candidate) => { candidate.browserSources.clip60.refreshWhenActive = false; },
      expectedIssue: 'source.BIRDIE_STREAM_CLIP_60.refresh-lifecycle',
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const candidate = structuredClone(plan);
      mutation.mutate(candidate);
      assert.ok(validateStrictObsPlan(candidate).includes(mutation.expectedIssue));
      assert.equal(validateStreamOperations(candidate, config).repositoryPlanStatus, 'STOP');
    });
  }
});

test('public config preflight rejects raw URL secrets, reserved READY hosts, secret keys, and known credential patterns', async () => {
  const [plan, config] = await fixtures();
  for (const mutation of [
    { ...config, ctaUrl: 'http://birdieandbreakfast.de/pilot', qrTarget: 'http://birdieandbreakfast.de/pilot' },
    { ...config, ctaUrl: 'https://birdieandbreakfast.de/pilot?token=secret', qrTarget: 'https://birdieandbreakfast.de/pilot?token=secret' },
    { ...config, apiToken: 'must-never-appear' },
    { ...config, headline: `apiKey=${['sk', 'live', '0123456789abcdef'].join('-')}` },
    { ...config, headline: ['sk', 'proj', '0123456789abcdefghijklmnop'].join('-') },
    { ...config, ctaText: 'eyJ0123456789abc.eyJ0123456789def.eyJ0123456789ghi' },
  ]) {
    assert.equal(validateStreamOperations(plan, mutation).repositoryPlanStatus, 'STOP');
  }

  const reservedReady = validateStreamOperations(plan, {
    ...config,
    ctaUrl: 'https://birdie.invalid/pilot',
    qrTarget: 'https://birdie.invalid/pilot',
    ctaStatus: 'READY',
    qrImage: '/assets/birdie.png',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: true,
  });
  assert.equal(reservedReady.founderGo, 'STOP');
  assert.ok(reservedReady.founderBlockers.includes('CTA_NOT_PUBLIC_CANONICAL_HTTPS'));
});

test('QR artifact inspection stops a missing local raster despite plausible metadata', async () => {
  const config = resolveStreamConfig({
    ctaUrl: 'https://birdieandbreakfast.de/pilot',
    qrTarget: 'https://birdieandbreakfast.de/pilot',
    ctaStatus: 'READY',
    qrImage: '/assets/does-not-exist.png',
    qrSha256: 'a'.repeat(64),
    qrScanVerified: true,
  });
  assert.equal(config.conversionDeclaredReady, true);
  const evidence = await inspectQrAsset(config);
  assert.equal(evidence.status, 'STOP');
  assert.match(evidence.reason, /unreadable/);
});

test('QR evidence rejects a symlink or junction that resolves outside the public root', async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'birdie-stream-qr-'));
  const publicRoot = path.join(temporaryRoot, 'public');
  const outsideRoot = path.join(temporaryRoot, 'outside');
  const assetLink = path.join(publicRoot, 'assets');
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  try {
    await Promise.all([
      mkdir(publicRoot, { recursive: true }),
      mkdir(outsideRoot, { recursive: true }),
    ]);
    await writeFile(path.join(outsideRoot, 'birdie.png'), bytes);
    await symlink(outsideRoot, assetLink, process.platform === 'win32' ? 'junction' : 'dir');
    const evidence = await inspectQrAsset({
      qrImage: '/assets/birdie.png',
      qrSha256: createHash('sha256').update(bytes).digest('hex'),
    }, { publicRoot });
    assert.equal(evidence.status, 'STOP');
    assert.match(evidence.reason, /outside public root/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('wall-art readiness accepts only local hashed raster bytes and never implies shop evidence', async () => {
  const [plan, config] = await fixtures();
  const current = validateStreamOperations(plan, config);
  assert.equal(current.repositoryPlanStatus, 'PASS');
  assert.ok(current.founderBlockers.includes('WALL_ART_PRODUCT_ASSET_MISSING'));
  assert.ok(current.founderBlockers.includes('WALL_ART_SHOP_TARGET_MISSING'));
  assert.ok(current.founderBlockers.includes('WALL_ART_PRICE_UNKNOWN'));
  assert.ok(current.founderBlockers.includes('WALL_ART_QR_TARGET_UNPROVEN'));

  const missing = await inspectWallArtProductAsset(resolveStreamConfig({
    wallArtTitle: 'BirdieWorld Wall Art',
    wallArtProductImage: '/assets/does-not-exist.png',
    wallArtProductImageSha256: 'a'.repeat(64),
  }, 'showcase=wall-art'));
  assert.equal(missing.status, 'STOP');
  assert.match(missing.reason, /unreadable/);

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'birdie-stream-wall-art-'));
  const publicRoot = path.join(temporaryRoot, 'public');
  const assetDirectory = path.join(publicRoot, 'assets');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(path.join(assetDirectory, 'wall-art.png'), bytes);
    await writeFile(path.join(assetDirectory, 'truncated.png'), bytes.subarray(0, 8));
    const resolved = resolveStreamConfig({
      wallArtTitle: 'BirdieWorld Wall Art',
      wallArtProductImage: '/assets/wall-art.png',
      wallArtProductImageSha256: sha256,
      wallArtShopUrl: config.ctaUrl,
      ctaUrl: config.ctaUrl,
      qrTarget: config.qrTarget,
    }, 'showcase=wall-art');
    const productAsset = await inspectWallArtProductAsset(resolved, { publicRoot });
    assert.equal(productAsset.status, 'PASS');
    assert.equal(productAsset.actualSha256, sha256);

    const truncatedBytes = bytes.subarray(0, 8);
    const truncated = await inspectWallArtProductAsset(resolveStreamConfig({
      wallArtTitle: 'Truncated fixture',
      wallArtProductImage: '/assets/truncated.png',
      wallArtProductImageSha256: createHash('sha256').update(truncatedBytes).digest('hex'),
    }, 'showcase=wall-art'), { publicRoot });
    assert.equal(truncated.status, 'STOP');
    assert.equal(truncated.signatureValid, false);

    const configured = validateStreamOperations(plan, {
      ...config,
      wallArtTitle: 'BirdieWorld Wall Art',
      wallArtProductImage: '/assets/wall-art.png',
      wallArtProductImageSha256: sha256,
      wallArtShopUrl: config.ctaUrl,
    });
    assert.equal(configured.repositoryPlanStatus, 'PASS');
    assert.equal(configured.founderGo, 'STOP');
    assert.ok(configured.founderBlockers.includes('WALL_ART_PRODUCT_EVIDENCE_UNPROVEN'));
    assert.ok(configured.founderBlockers.includes('WALL_ART_SHOP_EVIDENCE_UNPROVEN'));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('wall-art preflight rejects unsafe targets, partial metadata, price, and READY claims', async () => {
  const [plan, config] = await fixtures();
  const mutations = [
    { expected: 'wall-art-product-metadata-safe', value: { ...config, wallArtTitle: 'Partial only' } },
    { expected: 'wall-art-product-metadata-safe', value: { ...config, wallArtTitle: 'Remote', wallArtProductImage: 'https://cdn.example/art.png', wallArtProductImageSha256: 'a'.repeat(64) } },
    { expected: 'wall-art-shop-target-safe', value: { ...config, wallArtShopUrl: 'https://user:secret@example.org/product' } },
    { expected: 'wall-art-shop-target-safe', value: { ...config, wallArtShopUrl: `${config.ctaUrl}?source=stream` } },
    { expected: 'wall-art-evidence-locked', value: { ...config, wallArtProductEvidenceStatus: 'READY' } },
    { expected: 'wall-art-evidence-locked', value: { ...config, wallArtDecision: 'GO' } },
    { expected: 'wall-art-no-price-claim', value: { ...config, wallArtPriceText: '49 EUR' } },
  ];
  for (const mutation of mutations) {
    const result = validateStreamOperations(plan, mutation.value);
    assert.equal(result.repositoryPlanStatus, 'STOP');
    assert.equal(result.checks.find((entry) => entry.id === mutation.expected).status, 'STOP');
    assert.equal(result.founderGo, 'STOP');
  }
});

test('operational readiness verifies local QR bytes but remains STOP while payload, scan, OBS, and soak are unproven', async () => {
  const result = await inspectStreamReadiness();
  assert.equal(result.repositoryPlanStatus, 'PASS');
  assert.equal(result.founderGo, 'STOP');
  assert.equal(result.obsSetupApplied, 'UNPROVEN');
  assert.equal(result.runtimeSoakEvidence, 'UNPROVEN');
  assert.equal(result.obsRecordingEvidence, 'UNPROVEN');
  assert.equal(result.qrAssetEvidence.status, 'PASS');
  assert.equal(result.qrAssetEvidence.actualSha256, result.qrAssetEvidence.declaredSha256);
  assert.equal(result.qrPayloadEvidence.status, 'UNPROVEN');
  assert.ok(result.founderBlockers.includes('QR_PAYLOAD_RUNTIME_UNPROVEN'));
  assert.equal(result.wallArtEvidence.decision, 'STOP');
  assert.equal(result.wallArtEvidence.productAsset.status, 'UNPROVEN');
  assert.equal(result.wallArtEvidence.shopTarget.status, 'UNPROVEN');
  assert.equal(result.wallArtEvidence.price.status, 'UNKNOWN');
  assert.equal(result.wallArtEvidence.qrTarget.status, 'UNPROVEN');
});
