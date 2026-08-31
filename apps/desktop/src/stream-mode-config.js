import jsQR from 'jsqr';

export const STREAM_DEMO_DURATION_MS = 72_000;
const RUNTIME_VERIFIED_STREAM_CONFIGS = new WeakSet();

export const STREAM_DEMO_PHASES = Object.freeze([
  { state: 'IDLE', durationMs: 8_000, copy: 'Bereit für dein Kommando' },
  { state: 'SPEECH_DETECTED', durationMs: 3_000, copy: 'Stimme erkannt' },
  { state: 'LISTENING', durationMs: 8_000, copy: 'Ich höre zu' },
  { state: 'THINKING', durationMs: 9_000, copy: 'Verstanden. Ich plane.' },
  { state: 'SPEAKING', durationMs: 10_000, copy: 'Birdie bestätigt die Aktion' },
  { state: 'SUCCESS', durationMs: 6_000, copy: 'Aktion ist bereit' },
  { state: 'IDLE', durationMs: 8_000, copy: 'Bereit für den nächsten Auftrag' },
  { state: 'LISTENING', durationMs: 8_000, copy: 'Zweites Kommando erkannt' },
  { state: 'WORKING', durationMs: 6_000, copy: 'Birdie führt lokal aus' },
  { state: 'SPEAKING', durationMs: 6_000, copy: 'Erledigt. Was kommt als Nächstes?' },
]);

export const STREAM_CLIP_30_PHASES = Object.freeze([
  { state: 'IDLE', durationMs: 4_000, copy: 'Sag es. Birdie macht es.' },
  { state: 'SPEECH_DETECTED', durationMs: 2_000, copy: 'Stimme erkannt' },
  { state: 'LISTENING', durationMs: 5_000, copy: 'Ich höre zu' },
  { state: 'THINKING', durationMs: 4_000, copy: 'Verstanden. Ich plane.' },
  { state: 'SPEAKING', durationMs: 5_000, copy: 'Birdie bestätigt die Aktion' },
  { state: 'SUCCESS', durationMs: 4_000, copy: 'Aktion abgeschlossen' },
  { state: 'IDLE', durationMs: 6_000, copy: 'Early Access über Link oder QR' },
]);

export const STREAM_CLIP_60_PHASES = Object.freeze([
  { state: 'IDLE', durationMs: 7_000, copy: 'Sag es. Birdie macht es.' },
  { state: 'SPEECH_DETECTED', durationMs: 3_000, copy: 'Stimme erkannt' },
  { state: 'LISTENING', durationMs: 7_000, copy: 'Ich höre zu' },
  { state: 'THINKING', durationMs: 7_000, copy: 'Verstanden. Ich plane.' },
  { state: 'WORKING', durationMs: 6_000, copy: 'Birdie führt lokal aus' },
  { state: 'SPEAKING', durationMs: 8_000, copy: 'Birdie bestätigt die Aktion' },
  { state: 'SUCCESS', durationMs: 6_000, copy: 'Aktion abgeschlossen' },
  { state: 'IDLE', durationMs: 16_000, copy: 'Early Access über Link oder QR' },
]);

export const STREAM_TIMELINES = Object.freeze({
  LOOP: Object.freeze({ id: 'LOOP', durationMs: STREAM_DEMO_DURATION_MS, phases: STREAM_DEMO_PHASES }),
  CLIP_30: Object.freeze({ id: 'CLIP_30', durationMs: 30_000, phases: STREAM_CLIP_30_PHASES }),
  CLIP_60: Object.freeze({ id: 'CLIP_60', durationMs: 60_000, phases: STREAM_CLIP_60_PHASES }),
});

export const STREAM_ERROR_FIXTURE = Object.freeze({
  id: 'ERROR',
  state: 'ERROR',
  copy: 'Synthetischer Demo-Fehler',
  code: 'SYNTHETIC_FIXTURE',
  badge: 'SYNTHETIC ERROR',
  startsLoop: false,
});

export const DEFAULT_STREAM_CONFIG = Object.freeze({
  brand: 'BIRDIE',
  eyebrow: 'VOICE-FIRST DESKTOP AGENT',
  headline: 'Sag es. Birdie macht es.',
  subline: 'Ein lokaler Agent, der auf Sprache reagiert und deinen PC verständlich steuert.',
  ctaLabel: 'EARLY ACCESS',
  ctaText: 'Birdie auf deinem PC testen',
  ctaUrl: 'https://example.com/birdie',
  ctaStatus: 'DRAFT',
  qrImage: '',
  qrTarget: '',
  qrSha256: '',
  qrScanVerified: false,
});

function text(value, fallback, maxLength) {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || fallback).slice(0, maxLength);
}

export function sanitizeCtaUrl(value, fallback = DEFAULT_STREAM_CONFIG.ctaUrl) {
  try {
    const candidate = String(value ?? fallback).trim();
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('unsafe CTA URL');
    }
    return url.href;
  } catch {
    return fallback;
  }
}

export function displayCtaUrl(value) {
  const url = new URL(sanitizeCtaUrl(value));
  return `${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`;
}

export function sanitizeQrImage(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '';
  if (/[\\?#%\u0000-\u001f]/.test(candidate)) return '';
  if (/(^|\/)\.{1,2}(\/|$)/.test(candidate)) return '';
  // Raster-only keeps a configured QR inert: SVG may contain scripts, external
  // references or foreignObject content and is therefore not a stream asset.
  if (!/^\/[A-Za-z0-9/_-]+\.(?:png|webp)$/.test(candidate)) return '';
  return candidate.slice(0, 240);
}

export function isLoopbackQrPreview(locationLike, search = '') {
  const query = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const protocol = String(locationLike?.protocol ?? '').toLowerCase();
  const hostname = String(locationLike?.hostname ?? '').toLowerCase();
  const loopbackHost = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
  return protocol === 'http:'
    && loopbackHost
    && query.get('qrVerify') === 'local'
    && query.get('ctaTest') !== 'private';
}

function isReservedOrLocalHostname(hostname) {
  const normalized = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalized || !normalized.includes('.')) return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized) || normalized.includes(':')) return true;
  return ['example.com', 'example.org', 'example.net'].includes(normalized)
    || [
      '.example', '.example.com', '.example.org', '.example.net', '.invalid',
      '.localhost', '.test', '.internal', '.local', '.localdomain', '.home', '.lan',
    ].some((suffix) => normalized.endsWith(suffix));
}

export function isCanonicalPublicHttpsUrl(value) {
  try {
    const candidate = String(value ?? '').trim();
    const url = new URL(candidate);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && !isReservedOrLocalHostname(url.hostname)
      && candidate === url.href;
  } catch {
    return false;
  }
}

export function isPlaceholderCta(value) {
  try {
    const hostname = new URL(sanitizeCtaUrl(value)).hostname.toLowerCase();
    return isReservedOrLocalHostname(hostname);
  } catch {
    return true;
  }
}

export function resolveStreamConfig(raw = {}, search = '') {
  const query = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const ctaStatus = String(raw.ctaStatus ?? 'DRAFT').toUpperCase() === 'READY'
    ? 'READY'
    : 'DRAFT';
  const conversionOverridesIgnored = ctaStatus === 'READY'
    && ['ctaUrl', 'qr', 'ctaLabel', 'ctaText'].some((field) => query.has(field));
  const rawCtaUrl = ctaStatus === 'READY' ? raw.ctaUrl : query.get('ctaUrl') ?? raw.ctaUrl;
  const ctaUrl = sanitizeCtaUrl(rawCtaUrl);
  const rawQrTarget = raw.qrTarget;
  const qrTarget = sanitizeCtaUrl(rawQrTarget || ctaUrl, ctaUrl);
  const qrMatchesCta = qrTarget === ctaUrl;
  const qrImage = qrMatchesCta
    ? sanitizeQrImage(ctaStatus === 'READY' ? raw.qrImage : query.get('qr') ?? raw.qrImage)
    : '';
  const placeholderCta = isPlaceholderCta(ctaUrl);
  const ctaUrlCanonical = isCanonicalPublicHttpsUrl(rawCtaUrl);
  const qrTargetCanonical = isCanonicalPublicHttpsUrl(rawQrTarget);
  const qrSha256 = /^[a-f0-9]{64}$/i.test(String(raw.qrSha256 ?? ''))
    ? String(raw.qrSha256).toLowerCase()
    : '';
  const qrScanVerified = raw.qrScanVerified === true;
  const conversionDeclaredReady = ctaStatus === 'READY'
    && ctaUrlCanonical
    && qrTargetCanonical
    && !placeholderCta
    && Boolean(qrImage)
    && Boolean(qrSha256)
    && qrScanVerified
    && qrMatchesCta
    && !conversionOverridesIgnored;
  return Object.freeze({
    brand: text(query.get('brand') ?? raw.brand, DEFAULT_STREAM_CONFIG.brand, 28),
    eyebrow: text(query.get('eyebrow') ?? raw.eyebrow, DEFAULT_STREAM_CONFIG.eyebrow, 64),
    headline: text(query.get('headline') ?? raw.headline, DEFAULT_STREAM_CONFIG.headline, 72),
    subline: text(query.get('subline') ?? raw.subline, DEFAULT_STREAM_CONFIG.subline, 150),
    ctaLabel: text(ctaStatus === 'READY' ? raw.ctaLabel : query.get('ctaLabel') ?? raw.ctaLabel, DEFAULT_STREAM_CONFIG.ctaLabel, 32),
    ctaText: text(ctaStatus === 'READY' ? raw.ctaText : query.get('ctaText') ?? raw.ctaText, DEFAULT_STREAM_CONFIG.ctaText, 72),
    ctaUrl,
    ctaDisplayUrl: displayCtaUrl(ctaUrl),
    ctaStatus,
    qrImage,
    qrTarget,
    qrSha256,
    qrScanVerified,
    qrMatchesCta,
    placeholderCta,
    ctaUrlCanonical,
    qrTargetCanonical,
    conversionOverridesIgnored,
    conversionDeclaredReady,
    qrAssetHashVerified: false,
    qrPayloadVerified: false,
    qrPayloadStatus: 'NOT_CHECKED',
    qrRenderReady: false,
    qrRenderUrl: '',
    conversionReady: false,
  });
}

async function verifyStreamQrAssetInternal(
  config,
  {
    fetchImpl = globalThis.fetch,
    subtle = globalThis.crypto?.subtle,
    qrDecoder = decodeQrPayload,
    createObjectUrl = (bytes, resolvedConfig) => {
      if (typeof globalThis.URL?.createObjectURL !== 'function' || typeof globalThis.Blob !== 'function') return '';
      const mimeType = String(resolvedConfig?.qrImage ?? '').toLowerCase().endsWith('.webp')
        ? 'image/webp'
        : 'image/png';
      return globalThis.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    },
  } = {},
  { runtimeBrand = false, allowLocalPreview = false } = {},
) {
  let actualSha256 = '';
  let qrAssetHashVerified = false;
  let qrPayloadVerified = false;
  let qrPayloadStatus = 'NOT_CHECKED';
  let qrRenderReady = false;
  let qrRenderUrl = '';
  if (config?.qrImage && config?.qrSha256 && fetchImpl && subtle) {
    try {
      const response = await fetchImpl(config.qrImage, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`QR asset HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const digest = await subtle.digest('SHA-256', bytes);
      actualSha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      qrAssetHashVerified = actualSha256 === config.qrSha256;
      if (qrAssetHashVerified) {
        const decoded = await qrDecoder(bytes, config);
        qrPayloadVerified = decoded?.status === 'PASS';
        qrPayloadStatus = String(decoded?.status ?? 'ERROR');
        if (qrPayloadVerified && (config?.conversionDeclaredReady || allowLocalPreview)) {
          qrRenderUrl = await createObjectUrl(bytes, config);
          qrRenderReady = typeof qrRenderUrl === 'string' && qrRenderUrl.startsWith('blob:');
          if (!qrRenderReady) {
            qrRenderUrl = '';
            qrPayloadStatus = 'RENDER_UNAVAILABLE';
          }
        }
      } else {
        qrPayloadStatus = 'HASH_MISMATCH';
      }
    } catch {
      qrAssetHashVerified = false;
      qrPayloadVerified = false;
      qrPayloadStatus = 'ERROR';
      qrRenderReady = false;
      qrRenderUrl = '';
    }
  }
  const verifiedConfig = Object.freeze({
    ...config,
    actualQrSha256: actualSha256,
    qrAssetHashVerified,
    qrPayloadVerified,
    qrPayloadStatus,
    qrRenderReady,
    qrRenderUrl,
    conversionReady: Boolean(
      config?.conversionDeclaredReady && qrAssetHashVerified && qrPayloadVerified && qrRenderReady
    ),
  });
  if (runtimeBrand && verifiedConfig.conversionReady) RUNTIME_VERIFIED_STREAM_CONFIGS.add(verifiedConfig);
  return verifiedConfig;
}

export async function verifyStreamQrAsset(config, { allowLocalPreview = false } = {}) {
  return verifyStreamQrAssetInternal(config, {}, { runtimeBrand: true, allowLocalPreview });
}

export async function inspectStreamQrAssetWithDependencies(
  config,
  dependencies = {},
  { allowLocalPreview = false } = {},
) {
  return verifyStreamQrAssetInternal(config, dependencies, { runtimeBrand: false, allowLocalPreview });
}

export function isRuntimeVerifiedStreamConfig(config) {
  return Boolean(config?.conversionReady && RUNTIME_VERIFIED_STREAM_CONFIGS.has(config));
}

export async function decodeQrPayload(
  bytes,
  config,
  {
    BarcodeDetectorImpl = globalThis.BarcodeDetector,
    createImageBitmapImpl = globalThis.createImageBitmap,
    OffscreenCanvasImpl = globalThis.OffscreenCanvas,
    documentImpl = globalThis.document,
    BlobImpl = globalThis.Blob,
    jsQrImpl = jsQR,
  } = {},
) {
  if (typeof createImageBitmapImpl !== 'function' || typeof BlobImpl !== 'function') {
    return Object.freeze({ status: 'UNAVAILABLE' });
  }
  let bitmap = null;
  try {
    const mimeType = String(config?.qrImage ?? '').toLowerCase().endsWith('.webp')
      ? 'image/webp'
      : 'image/png';
    bitmap = await createImageBitmapImpl(new BlobImpl([bytes], { type: mimeType }));
    if (typeof BarcodeDetectorImpl === 'function') {
      const detector = new BarcodeDetectorImpl({ formats: ['qr_code'] });
      const results = await detector.detect(bitmap);
      if (!Array.isArray(results) || results.length === 0) return Object.freeze({ status: 'NOT_FOUND' });
      if (results.length !== 1 || results[0]?.format !== 'qr_code') {
        return Object.freeze({ status: 'AMBIGUOUS' });
      }
      return Object.freeze({
        status: results[0].rawValue === config?.qrTarget ? 'PASS' : 'MISMATCH',
      });
    }

    if (typeof jsQrImpl !== 'function') return Object.freeze({ status: 'UNAVAILABLE' });
    const width = Number(bitmap?.width);
    const height = Number(bitmap?.height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      return Object.freeze({ status: 'ERROR' });
    }
    const canvas = typeof OffscreenCanvasImpl === 'function'
      ? new OffscreenCanvasImpl(width, height)
      : documentImpl?.createElement?.('canvas');
    if (!canvas) return Object.freeze({ status: 'UNAVAILABLE' });
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext?.('2d', { willReadFrequently: true });
    if (!context) return Object.freeze({ status: 'UNAVAILABLE' });
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const result = jsQrImpl(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!result) return Object.freeze({ status: 'NOT_FOUND' });
    return Object.freeze({
      status: result.data === config?.qrTarget ? 'PASS' : 'MISMATCH',
    });
  } catch {
    return Object.freeze({ status: 'ERROR' });
  } finally {
    bitmap?.close?.();
  }
}

export function resolveStreamTimeline(search = '') {
  const query = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  if (query.get('clip') === '30') return STREAM_TIMELINES.CLIP_30;
  if (query.get('clip') === '60') return STREAM_TIMELINES.CLIP_60;
  return STREAM_TIMELINES.LOOP;
}

export function resolveStreamDemoFixture(search = '') {
  const query = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  return query.get('fixture') === 'error' ? STREAM_ERROR_FIXTURE : null;
}

export function streamDemoFrame(elapsedMs, timeline = STREAM_TIMELINES.LOOP) {
  const safeElapsed = Math.max(0, Number(elapsedMs) || 0);
  const loopIndex = Math.floor(safeElapsed / timeline.durationMs);
  const loopElapsedMs = safeElapsed % timeline.durationMs;
  let phaseStartMs = 0;
  let phase = timeline.phases.at(-1);

  for (const candidate of timeline.phases) {
    if (loopElapsedMs < phaseStartMs + candidate.durationMs) {
      phase = candidate;
      break;
    }
    phaseStartMs += candidate.durationMs;
  }

  const phaseProgress = Math.min(1, (loopElapsedMs - phaseStartMs) / phase.durationMs);
  const pulse = 0.5 + Math.sin(phaseProgress * Math.PI * 8) * 0.5;
  const inputActive = ['SPEECH_DETECTED', 'LISTENING'].includes(phase.state);
  const outputActive = phase.state === 'SPEAKING';

  return Object.freeze({
    ...phase,
    loopIndex,
    loopElapsedMs,
    phaseProgress,
    inputLevel: inputActive ? 0.28 + pulse * 0.68 : 0,
    outputLevel: outputActive ? 0.24 + pulse * 0.64 : 0,
    vadProbability: inputActive ? 0.92 : 0,
  });
}
