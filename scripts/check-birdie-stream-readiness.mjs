import { createHash } from 'node:crypto';
import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCanonicalPublicHttpsUrl,
  isPlaceholderCta,
  resolveStreamConfig,
} from '../apps/desktop/src/stream-mode-config.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_PATH = path.join(REPOSITORY_ROOT, 'ops', 'obs', 'birdie-stream-local.scene-plan.json');
const PUBLIC_ROOT = path.join(REPOSITORY_ROOT, 'apps', 'desktop', 'public');
const CONFIG_PATH = path.join(PUBLIC_ROOT, 'stream-mode.json');
const OBS_PATH = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe';

const EXPECTED_SCENES = Object.freeze({
  '00_START': Object.freeze(['SAFE_SLATE']),
  '01_STREAM': Object.freeze(['BIRDIE_STREAM_BROWSER']),
  '02_STREAM_BACKUP': Object.freeze(['BIRDIE_STREAM_BACKUP']),
  '03_CLIP_30': Object.freeze(['BIRDIE_STREAM_CLIP_30']),
  '04_CLIP_60': Object.freeze(['BIRDIE_STREAM_CLIP_60']),
  '05_QR_VERIFY': Object.freeze(['BIRDIE_STREAM_QR_VERIFY']),
  '09_BRB': Object.freeze(['SAFE_SLATE']),
  '10_END': Object.freeze(['SAFE_SLATE']),
  '99_SAFE': Object.freeze(['SAFE_SLATE']),
});

const EXPECTED_BROWSER_SOURCES = Object.freeze({
  BIRDIE_STREAM_BROWSER: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop',
    sceneBindings: Object.freeze(['01_STREAM']),
    shutdownWhenHidden: false,
    refreshWhenActive: false,
  }),
  BIRDIE_STREAM_BACKUP: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&renderer=backup&quality=low',
    sceneBindings: Object.freeze(['02_STREAM_BACKUP']),
    shutdownWhenHidden: false,
    refreshWhenActive: false,
  }),
  BIRDIE_STREAM_CLIP_30: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&clip=30',
    sceneBindings: Object.freeze(['03_CLIP_30']),
    shutdownWhenHidden: true,
    refreshWhenActive: true,
  }),
  BIRDIE_STREAM_CLIP_60: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&clip=60',
    sceneBindings: Object.freeze(['04_CLIP_60']),
    shutdownWhenHidden: true,
    refreshWhenActive: true,
  }),
  BIRDIE_STREAM_QR_VERIFY: Object.freeze({
    url: 'http://127.0.0.1:1421/?mode=stream&demo=loop&qrVerify=local',
    sceneBindings: Object.freeze(['05_QR_VERIFY']),
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

const REQUIRED_DENIED_SOURCE_TYPES = Object.freeze([
  'monitor_capture',
  'window_capture',
  'game_capture',
  'dshow_input',
  'ffmpeg_source',
  'wasapi_input_capture',
  'wasapi_output_capture',
]);

function check(id, passed, expected, observed) {
  return Object.freeze({ id, status: passed ? 'PASS' : 'STOP', expected, observed });
}

function exact(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceDefinitions(plan) {
  return [
    ...Object.values(plan.browserSources ?? {}),
    ...Object.values(plan.staticSources ?? {}),
  ];
}

function isCanonicalHttpsWithoutSecrets(value) {
  try {
    const candidate = String(value ?? '').trim();
    const url = new URL(candidate);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && candidate === url.href;
  } catch {
    return false;
  }
}

function hasSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    /secret|token|password|credential|api[_-]?key/i.test(key) || hasSensitiveKey(nested)
  ));
}

const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{16,}\b/,
  /\b(?:sk|rk|pk)[_-](?:live|test)[_-][A-Za-z0-9_-]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:bearer|token|secret|password|credential|api[_-]?key)\s*[:=]\s*\S+/i,
]);

function hasSensitiveValue(value) {
  if (typeof value === 'string') {
    return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) return value.some(hasSensitiveValue);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(hasSensitiveValue);
}

function isWithinRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateSourceContract(plan, checks) {
  const sources = sourceDefinitions(plan);
  const sourceByName = new Map(sources.map((source) => [source.name, source]));
  const allowedTypes = new Set(plan.sourceAllowlist ?? []);
  const deniedTypes = new Set(plan.sourceDenylist ?? []);

  checks.push(check('source-count', sources.length === 6 && sourceByName.size === 6, '6 unique sources', `${sources.length}/${sourceByName.size}`));
  checks.push(check('source-allow-deny-disjoint', [...allowedTypes].every((type) => !deniedTypes.has(type)), true, [...allowedTypes].filter((type) => deniedTypes.has(type))));
  checks.push(check('capture-source-denylist', REQUIRED_DENIED_SOURCE_TYPES.every((type) => deniedTypes.has(type)), REQUIRED_DENIED_SOURCE_TYPES, [...deniedTypes]));

  for (const source of sources) {
    const observedBindings = (plan.scenes ?? [])
      .filter((scene) => scene.sources?.includes(source.name))
      .map((scene) => scene.name);
    checks.push(check(`source-${source.name}-type`, allowedTypes.has(source.type) && !deniedTypes.has(source.type), 'allowlisted and not denied', source.type));
    checks.push(check(`source-${source.name}-safe`, source.audio === false && source.width === 1920 && source.height === 1080, 'audio=false, 1920x1080', { audio: source.audio, width: source.width, height: source.height }));
    checks.push(check(`source-${source.name}-bindings`, exact(source.sceneBindings, observedBindings), observedBindings, source.sceneBindings));
  }

  for (const [name, expectation] of Object.entries(EXPECTED_BROWSER_SOURCES)) {
    const source = sourceByName.get(name);
    checks.push(check(`browser-${name}`, source?.type === 'browser_source'
      && source.url === expectation.url
      && exact(source.sceneBindings, expectation.sceneBindings)
      && source.shutdownWhenHidden === expectation.shutdownWhenHidden
      && source.refreshWhenActive === expectation.refreshWhenActive,
    expectation, source));
  }

  const safeSlate = sourceByName.get('SAFE_SLATE');
  checks.push(check('safe-slate-source', safeSlate?.type === 'color_source_v3'
    && safeSlate.audio === false
    && safeSlate.shutdownWhenHidden === false
    && safeSlate.refreshWhenActive === false
    && exact(safeSlate.sceneBindings, ['00_START', '09_BRB', '10_END', '99_SAFE']),
  'typed inert color source', safeSlate));

  const allReferencesDefined = (plan.scenes ?? []).every((scene) => (
    (scene.sources ?? []).every((sourceName) => sourceByName.has(sourceName))
  ));
  checks.push(check('scene-references-defined', allReferencesDefined, true, allReferencesDefined));
}

export function validateStreamOperations(plan, rawConfig) {
  const config = resolveStreamConfig(rawConfig);
  const checks = [
    check('schema', plan.schemaVersion === 1, 1, plan.schemaVersion),
    check('purpose', plan.purpose === 'offline-demo-recording-only', 'offline-demo-recording-only', plan.purpose),
    check('profile-name', plan.profile?.name === 'Birdie-Stream-Local-1080p30', 'Birdie-Stream-Local-1080p30', plan.profile?.name),
    check('canvas', plan.profile?.video?.baseWidth === 1920 && plan.profile?.video?.baseHeight === 1080, '1920x1080', `${plan.profile?.video?.baseWidth}x${plan.profile?.video?.baseHeight}`),
    check('output', plan.profile?.video?.outputWidth === 1920 && plan.profile?.video?.outputHeight === 1080, '1920x1080', `${plan.profile?.video?.outputWidth}x${plan.profile?.video?.outputHeight}`),
    check('fps', plan.profile?.video?.fps === 30, 30, plan.profile?.video?.fps),
    check('audio-format', plan.profile?.audio?.sampleRateHz === 48_000 && plan.profile?.audio?.channels === 'stereo', '48000 Hz stereo', plan.profile?.audio),
    check('audio-capture-off', plan.profile?.audio?.desktopAudio === false && plan.profile?.audio?.browserAudio === false, false, plan.profile?.audio),
    check('recording', plan.profile?.outputs?.recording === true && plan.profile?.outputs?.recordingContainer === 'mkv', 'recording=true, MKV', plan.profile?.outputs),
    check('external-outputs-off', plan.profile?.outputs?.streaming === false && plan.profile?.outputs?.replayBuffer === false && plan.profile?.outputs?.virtualCamera === false, false, plan.profile?.outputs),
    check('scenes-exact', exact((plan.scenes ?? []).map((scene) => scene.name), Object.keys(EXPECTED_SCENES)), Object.keys(EXPECTED_SCENES), (plan.scenes ?? []).map((scene) => scene.name)),
    ...Object.entries(EXPECTED_SCENES).map(([name, sources]) => check(
      `scene-${name}`,
      exact((plan.scenes ?? []).find((scene) => scene.name === name)?.sources, sources),
      sources,
      (plan.scenes ?? []).find((scene) => scene.name === name)?.sources,
    )),
    check('operator-mic-safe', plan.optionalOperatorMicrophone?.enabled === false && plan.optionalOperatorMicrophone?.startsMuted === true && plan.optionalOperatorMicrophone?.monitoring === 'off', 'disabled/muted/monitoring off', plan.optionalOperatorMicrophone),
    check('cut-transition', plan.transitions?.type === 'cut' && plan.transitions?.durationMs === 0, 'cut/0ms', plan.transitions),
    check('hotkeys-exact', exact(plan.hotkeys, EXPECTED_HOTKEYS) && new Set(Object.values(plan.hotkeys ?? {})).size === Object.keys(EXPECTED_HOTKEYS).length, EXPECTED_HOTKEYS, plan.hotkeys),
    check('privacy', ['captureDesktop', 'captureNotifications', 'renderTranscripts', 'renderDiagnostics', 'openStreamingServiceConfig'].every((property) => plan.privacy?.[property] === false), 'all false', plan.privacy),
    check('public-config-no-secret-keys', !hasSensitiveKey(rawConfig), true, !hasSensitiveKey(rawConfig)),
    check('public-config-no-known-secret-patterns', !hasSensitiveValue(rawConfig), true, !hasSensitiveValue(rawConfig)),
    check('cta-canonical-https', isCanonicalHttpsWithoutSecrets(rawConfig?.ctaUrl), 'canonical HTTPS without query, fragment or credentials', rawConfig?.ctaUrl),
    check('qr-target-exact', rawConfig?.qrTarget === rawConfig?.ctaUrl && config.qrMatchesCta, rawConfig?.ctaUrl, rawConfig?.qrTarget),
  ];
  validateSourceContract(plan, checks);

  const stopCount = checks.filter((entry) => entry.status === 'STOP').length;
  const founderBlockers = [];
  if (isPlaceholderCta(config.ctaUrl)) founderBlockers.push('CTA_PLACEHOLDER');
  if (!isCanonicalPublicHttpsUrl(rawConfig?.ctaUrl)) founderBlockers.push('CTA_NOT_PUBLIC_CANONICAL_HTTPS');
  if (config.ctaStatus !== 'READY') founderBlockers.push('CTA_STATUS_DRAFT');
  if (!config.qrImage) founderBlockers.push('QR_NOT_CONFIGURED');
  if (!config.qrSha256) founderBlockers.push('QR_HASH_MISSING');
  if (!config.qrScanVerified) founderBlockers.push('QR_SCAN_UNVERIFIED');
  if (!config.conversionDeclaredReady) founderBlockers.push('CTA_QR_NOT_DECLARED_READY');
  founderBlockers.push(
    'QR_ASSET_HASH_UNPROVEN',
    'QR_PAYLOAD_RUNTIME_UNPROVEN',
    'OBS_SETUP_UNPROVEN',
    'TEN_MINUTE_SOAK_UNPROVEN',
    'OBS_MKV_UNPROVEN',
  );

  return Object.freeze({
    schemaVersion: 1,
    repositoryPlanStatus: stopCount === 0 ? 'PASS' : 'STOP',
    founderGo: 'STOP',
    checks: Object.freeze(checks),
    founderBlockers: Object.freeze(founderBlockers),
  });
}

function isRasterSignatureValid(extension, bytes) {
  if (extension === '.png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (extension === '.webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

export async function inspectQrAsset(config, { publicRoot = PUBLIC_ROOT } = {}) {
  if (!config.qrImage || !config.qrSha256) {
    return Object.freeze({ status: 'UNPROVEN', actualSha256: '', reason: 'QR asset or declared SHA-256 missing' });
  }
  const publicRootPath = path.resolve(publicRoot);
  const assetPath = path.resolve(publicRootPath, config.qrImage.slice(1));
  if (!isWithinRoot(assetPath, publicRootPath)) {
    return Object.freeze({ status: 'STOP', actualSha256: '', reason: 'QR asset escapes public root' });
  }
  try {
    const [realPublicRoot, realAssetPath] = await Promise.all([
      realpath(publicRootPath),
      realpath(assetPath),
    ]);
    if (!isWithinRoot(realAssetPath, realPublicRoot)) {
      return Object.freeze({ status: 'STOP', actualSha256: '', reason: 'QR asset resolves outside public root' });
    }
    const bytes = await readFile(realAssetPath);
    const extension = path.extname(assetPath).toLowerCase();
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    const signatureValid = isRasterSignatureValid(extension, bytes);
    return Object.freeze({
      status: signatureValid && actualSha256 === config.qrSha256 ? 'PASS' : 'STOP',
      actualSha256,
      declaredSha256: config.qrSha256,
      signatureValid,
      relativePath: config.qrImage,
      reason: signatureValid ? 'hash compared with local raster bytes' : 'invalid raster signature',
    });
  } catch (error) {
    return Object.freeze({ status: 'STOP', actualSha256: '', reason: `QR asset unreadable: ${error.code ?? 'ERROR'}` });
  }
}

export async function inspectStreamReadiness() {
  const [plan, rawConfig] = await Promise.all([
    readFile(PLAN_PATH, 'utf8').then(JSON.parse),
    readFile(CONFIG_PATH, 'utf8').then(JSON.parse),
  ]);
  let obsInstalled = true;
  try { await access(OBS_PATH); } catch { obsInstalled = false; }
  const result = validateStreamOperations(plan, rawConfig);
  const qrAssetEvidence = await inspectQrAsset(resolveStreamConfig(rawConfig));
  const founderBlockers = result.founderBlockers.filter((blocker) => blocker !== 'QR_ASSET_HASH_UNPROVEN');
  if (qrAssetEvidence.status !== 'PASS') founderBlockers.unshift(`QR_ASSET_${qrAssetEvidence.status}`);
  if (!obsInstalled) founderBlockers.push('OBS_NOT_INSTALLED');
  return Object.freeze({
    ...result,
    founderGo: 'STOP',
    founderBlockers: Object.freeze([...new Set(founderBlockers)]),
    qrAssetEvidence,
    qrPayloadEvidence: Object.freeze({
      status: 'UNPROVEN',
      reason: 'QR payload must be decoded in the local WebView and exactly match the configured CTA target',
    }),
    obsInstalled,
    obsSetupApplied: 'UNPROVEN',
    runtimeSoakEvidence: 'UNPROVEN',
    obsRecordingEvidence: 'UNPROVEN',
    note: 'Read-only repository preflight; it never starts OBS or opens streaming-service configuration.',
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await inspectStreamReadiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const planOnly = process.argv.includes('--plan-only');
  process.exitCode = planOnly
    ? result.repositoryPlanStatus === 'PASS' ? 0 : 1
    : result.founderGo === 'GO' ? 0 : 1;
}
