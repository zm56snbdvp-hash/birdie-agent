import { evaluateSaleAttributionCorpus } from './stream-sale-attribution.js';

export const PRIVATE_SALE_RUN_ID = 'founder-private-20260831-001';
export const PRIVATE_SALE_AUTHORIZATION_STATUS = 'CONSUMED_WITH_HOLD';
export const PRIVATE_SALE_HANDOFF_KEY = 'birdie.privateSale.handoff.v1';
export const PRIVATE_SALE_COMPLETED_KEY = 'birdie.privateSale.completed.v1';
export const PRIVATE_SALE_HANDOFF_MAX_AGE_MS = 60_000;

export const PRIVATE_SALE_GATE_PROVENANCE = Object.freeze({
  showManifestSha256: '0b6d269455e793aeeab479235c7925e9891ae4d238e6532e24d4eca3d66baa64',
  attributionManifestSha256: 'c0f507e2f659b9bf2153067601f862b09082d5e7fac3f2480213b37695978129',
  comparisonFingerprintSha256: 'f9f2871040cad633320cd08a00d7fc2824638186dafe8b421615892fc9461662',
});

const TRUSTED_HANDOFF_PROOF = Symbol('birdie.privateSale.trustedHandoffProof');
const SAFE_NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const PRIVATE_EVENT_FIELDS = new Set([
  'eventId', 'sequenceId', 'occurredAtMs', 'type', 'sessionId', 'variantId', 'offerId',
  'campaignId', 'segmentId', 'synthetic', 'externalAction', 'consentState', 'amountTestCents',
]);

export const PRIVATE_SALE_VARIANTS = Object.freeze({
  PRODUCT: Object.freeze({
    offerId: 'product-offer-supervised-preview',
    campaignId: 'campaign-product',
    segmentId: 'product-cta',
    label: 'Birdie Produktvorschau',
  }),
  APP_DEMO: Object.freeze({
    offerId: 'app-demo-offer-private-session',
    campaignId: 'campaign-app-demo',
    segmentId: 'app-demo-cta',
    label: 'Birdie App-Demo',
  }),
  BIRDIEWORLD_HOTEL: Object.freeze({
    offerId: 'birdieworld-hotel-offer-private-concept-session',
    campaignId: 'campaign-birdieworld-hotel',
    segmentId: 'birdieworld-hotel-cta',
    label: 'BirdieWorld Hotel-Konzept',
  }),
});

function safeRunId(value) {
  const normalized = String(value ?? PRIVATE_SALE_RUN_ID).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
  return normalized || PRIVATE_SALE_RUN_ID;
}

function safeEvidenceText(value, fallback = 'REDACTED') {
  const normalized = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
  return normalized || fallback;
}

function redactPrivateSaleEvent(event = {}) {
  return Object.freeze({
    eventId: safeEvidenceText(event.eventId),
    sequenceId: Number.isInteger(event.sequenceId) ? event.sequenceId : null,
    occurredAtMs: Number.isInteger(event.occurredAtMs) ? event.occurredAtMs : null,
    type: ['VIEW', 'CTA', 'LEAD', 'SALE'].includes(event.type) ? event.type : 'REDACTED',
    sessionId: safeEvidenceText(event.sessionId),
    variantId: safeEvidenceText(event.variantId),
    offerId: safeEvidenceText(event.offerId),
    campaignId: safeEvidenceText(event.campaignId),
    segmentId: safeEvidenceText(event.segmentId),
    synthetic: event.synthetic === true,
    externalAction: event.externalAction === 'LOCKED' ? 'LOCKED' : 'REDACTED',
    consentState: ['NOT_APPLICABLE', 'GRANTED'].includes(event.consentState)
      ? event.consentState
      : 'REDACTED',
    amountTestCents: Number.isInteger(event.amountTestCents) ? event.amountTestCents : null,
  });
}

function stopProof(reasonId) {
  return Object.freeze({
    [TRUSTED_HANDOFF_PROOF]: false,
    status: 'STOP',
    reasonId,
    source: 'UNKNOWN',
    events: Object.freeze([]),
    gateProvenance: PRIVATE_SALE_GATE_PROVENANCE,
  });
}

function exactGateProvenance(value) {
  return value?.showManifestSha256 === PRIVATE_SALE_GATE_PROVENANCE.showManifestSha256
    && value?.attributionManifestSha256 === PRIVATE_SALE_GATE_PROVENANCE.attributionManifestSha256
    && value?.comparisonFingerprintSha256 === PRIVATE_SALE_GATE_PROVENANCE.comparisonFingerprintSha256;
}

export function resolvePrivateSaleVariant(value) {
  return Object.hasOwn(PRIVATE_SALE_VARIANTS, value) ? value : 'PRODUCT';
}

export function createPrivateSaleManifest(variantValue) {
  const variantId = resolvePrivateSaleVariant(variantValue);
  const mapping = PRIVATE_SALE_VARIANTS[variantId];
  return Object.freeze({
    schemaVersion: 1,
    id: 'private-sale-e2e-v1',
    scope: 'LOCAL_SYNTHETIC_ATTRIBUTION',
    externalActions: 'LOCKED',
    eventSchema: Object.freeze({ version: 1, additionalFields: 'DENY', pii: 'DENY' }),
    policy: Object.freeze({ viewToCtaMaxMs: 120_000, ctaToLeadMaxMs: 300_000, leadToSaleMaxMs: 300_000 }),
    allowed: Object.freeze({
      eventTypes: Object.freeze(['VIEW', 'CTA', 'LEAD', 'SALE']),
      variantIds: Object.freeze([variantId]),
      offerIds: Object.freeze([mapping.offerId]),
      campaignIds: Object.freeze([mapping.campaignId]),
      segmentIds: Object.freeze([mapping.segmentId]),
      consentStates: Object.freeze(['NOT_APPLICABLE', 'GRANTED']),
    }),
    comparisonFingerprintSha256: PRIVATE_SALE_GATE_PROVENANCE.comparisonFingerprintSha256,
  });
}

export function createPrivateSaleEvent({
  type,
  sequenceId,
  occurredAtMs,
  variant: variantValue = 'PRODUCT',
  runId: runIdValue = PRIVATE_SALE_RUN_ID,
} = {}) {
  const variantId = resolvePrivateSaleVariant(variantValue);
  const mapping = PRIVATE_SALE_VARIANTS[variantId];
  const runId = safeRunId(runIdValue);
  const normalizedType = ['VIEW', 'CTA', 'LEAD', 'SALE'].includes(type) ? type : 'VIEW';
  return Object.freeze({
    eventId: `${runId}-${normalizedType.toLowerCase()}`,
    sequenceId,
    occurredAtMs,
    type: normalizedType,
    sessionId: runId,
    variantId,
    offerId: mapping.offerId,
    campaignId: mapping.campaignId,
    segmentId: mapping.segmentId,
    synthetic: true,
    externalAction: 'LOCKED',
    consentState: ['LEAD', 'SALE'].includes(normalizedType) ? 'GRANTED' : 'NOT_APPLICABLE',
    amountTestCents: normalizedType === 'SALE' ? 4_900 : 0,
  });
}

export function createPrivateSaleHandoff({
  nonce,
  variant: variantValue = 'PRODUCT',
  runId: runIdValue = PRIVATE_SALE_RUN_ID,
  createdAtEpochMs = Date.now(),
} = {}) {
  if (!SAFE_NONCE.test(String(nonce ?? ''))) throw new Error('private sale handoff nonce invalid');
  if (!Number.isInteger(createdAtEpochMs) || createdAtEpochMs < 0) {
    throw new Error('private sale handoff time invalid');
  }
  const variant = resolvePrivateSaleVariant(variantValue);
  const runId = safeRunId(runIdValue);
  return Object.freeze({
    schemaVersion: 1,
    source: 'STREAM_CTA_CLICK',
    externalActions: 'LOCKED',
    nonce: String(nonce),
    variant,
    runId,
    createdAtEpochMs,
    gateProvenance: PRIVATE_SALE_GATE_PROVENANCE,
    events: Object.freeze(['VIEW', 'CTA'].map((type, index) => createPrivateSaleEvent({
      type,
      sequenceId: index + 1,
      occurredAtMs: index,
      variant,
      runId,
    }))),
  });
}

function validatePrivateSaleHandoffInternal(raw, {
  nonce,
  variant: variantValue = 'PRODUCT',
  runId: runIdValue = PRIVATE_SALE_RUN_ID,
  nowEpochMs = Date.now(),
  completedRunId = null,
} = {}, trusted = false) {
  if (completedRunId === safeRunId(runIdValue)) return stopProof('RUN_ALREADY_COMPLETED');
  let handoff;
  try {
    handoff = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return stopProof('HANDOFF_JSON_INVALID');
  }
  const variant = resolvePrivateSaleVariant(variantValue);
  const runId = safeRunId(runIdValue);
  const events = Array.isArray(handoff?.events) ? handoff.events : [];
  const exactEvents = events.length === 2
    && events[0]?.type === 'VIEW'
    && events[1]?.type === 'CTA'
    && events.every((event, index) => event?.sequenceId === index + 1
      && event?.occurredAtMs === index
      && event?.sessionId === runId
      && event?.variantId === variant
      && Object.keys(event).every((field) => PRIVATE_EVENT_FIELDS.has(field)));
  const ageMs = Number(nowEpochMs) - Number(handoff?.createdAtEpochMs);
  const valid = handoff?.schemaVersion === 1
    && handoff?.source === 'STREAM_CTA_CLICK'
    && handoff?.externalActions === 'LOCKED'
    && SAFE_NONCE.test(String(nonce ?? ''))
    && handoff?.nonce === nonce
    && handoff?.variant === variant
    && handoff?.runId === runId
    && Number.isFinite(ageMs)
    && ageMs >= 0
    && ageMs <= PRIVATE_SALE_HANDOFF_MAX_AGE_MS
    && exactGateProvenance(handoff?.gateProvenance)
    && exactEvents;
  if (!valid) return stopProof('HANDOFF_UNTRUSTED_OR_STALE');
  return Object.freeze({
    [TRUSTED_HANDOFF_PROOF]: trusted,
    status: 'PASS',
    reasonId: null,
    source: 'STREAM_CTA',
    runId,
    variant,
    createdAtEpochMs: handoff.createdAtEpochMs,
    expiresAtEpochMs: handoff.createdAtEpochMs + PRIVATE_SALE_HANDOFF_MAX_AGE_MS,
    events: Object.freeze(events.map((event) => Object.freeze({ ...event }))),
    gateProvenance: PRIVATE_SALE_GATE_PROVENANCE,
  });
}

export function validatePrivateSaleHandoff(raw, options = {}) {
  return validatePrivateSaleHandoffInternal(raw, options, false);
}

export function stagePrivateSaleHandoff(storage, handoff) {
  if (PRIVATE_SALE_AUTHORIZATION_STATUS !== 'GO') return stopProof('FOUNDER_GO_NOT_ACTIVE');
  try {
    if (storage.getItem(PRIVATE_SALE_COMPLETED_KEY) === handoff.runId) {
      return stopProof('RUN_ALREADY_COMPLETED');
    }
    storage.setItem(PRIVATE_SALE_HANDOFF_KEY, JSON.stringify(handoff));
    return Object.freeze({ status: 'PASS', reasonId: null });
  } catch {
    return stopProof('LOCAL_STORAGE_UNAVAILABLE');
  }
}

export function consumePrivateSaleHandoff(storage, options = {}) {
  try {
    if (PRIVATE_SALE_AUTHORIZATION_STATUS !== 'GO') {
      storage.removeItem(PRIVATE_SALE_HANDOFF_KEY);
      return stopProof('FOUNDER_GO_NOT_ACTIVE');
    }
    const completedRunId = storage.getItem(PRIVATE_SALE_COMPLETED_KEY);
    const raw = storage.getItem(PRIVATE_SALE_HANDOFF_KEY);
    storage.removeItem(PRIVATE_SALE_HANDOFF_KEY);
    if (raw) storage.setItem(PRIVATE_SALE_COMPLETED_KEY, safeRunId(options.runId));
    return validatePrivateSaleHandoffInternal(raw, { ...options, completedRunId }, true);
  } catch {
    return stopProof('LOCAL_STORAGE_UNAVAILABLE');
  }
}

export function markPrivateSaleCompleted(storage, runIdValue = PRIVATE_SALE_RUN_ID) {
  try {
    storage.removeItem(PRIVATE_SALE_HANDOFF_KEY);
    storage.setItem(PRIVATE_SALE_COMPLETED_KEY, safeRunId(runIdValue));
    return Object.freeze({ status: 'PASS', reasonId: null });
  } catch {
    return Object.freeze({ status: 'STOP', reasonId: 'LOCAL_STORAGE_UNAVAILABLE' });
  }
}

export function createPrivateSaleEvidence({
  events = [],
  variant: variantValue = 'PRODUCT',
  runId: runIdValue = PRIVATE_SALE_RUN_ID,
  navigationProof = null,
  aborted = false,
} = {}) {
  const variant = resolvePrivateSaleVariant(variantValue);
  const runId = safeRunId(runIdValue);
  const evaluation = evaluateSaleAttributionCorpus(createPrivateSaleManifest(variant), events);
  const completeTypes = ['VIEW', 'CTA', 'LEAD', 'SALE'];
  const exactPath = JSON.stringify(events.map((event) => event.type)) === JSON.stringify(completeTypes);
  const handoffEventsBound = JSON.stringify(navigationProof?.events ?? [])
    === JSON.stringify(events.slice(0, 2));
  const sourceVerified = navigationProof?.[TRUSTED_HANDOFF_PROOF] === true
    && navigationProof?.status === 'PASS'
    && navigationProof?.source === 'STREAM_CTA'
    && navigationProof?.runId === runId
    && navigationProof?.variant === variant
    && handoffEventsBound
    && exactGateProvenance(navigationProof?.gateProvenance);
  const privateE2E = !aborted && exactPath && sourceVerified && evaluation.status === 'PASS' ? 'PASS' : 'STOP';
  const removedFieldCount = events.reduce((count, event) => (
    count + Math.max(0, Object.keys(event ?? {}).filter((field) => !PRIVATE_EVENT_FIELDS.has(field)).length)
  ), 0);
  return Object.freeze({
    schemaVersion: 1,
    evidenceId: `private-sale-${runId}`,
    runId,
    runCounter: privateE2E === 'PASS' ? '1/1' : '0/1',
    scope: 'PRIVATE_LOCAL_CTA_E2E',
    founderAuthorization: 'ONE_SUPERVISED_PRIVATE_RUN',
    variant,
    source: sourceVerified ? 'STREAM_CTA' : 'UNKNOWN',
    sourceProof: Object.freeze({
      status: sourceVerified ? 'PASS' : 'STOP',
      reasonId: sourceVerified ? null : (navigationProof?.reasonId ?? 'HANDOFF_PROOF_MISSING'),
    }),
    gateProvenance: PRIVATE_SALE_GATE_PROVENANCE,
    externalActions: 'LOCKED',
    events: Object.freeze(events.map(redactPrivateSaleEvent)),
    evaluation,
    checks: Object.freeze({
      streamCtaNavigation: sourceVerified ? 'PASS' : 'STOP',
      gateProvenance: sourceVerified ? 'PASS' : 'STOP',
      exactFunnelOrder: exactPath ? 'PASS' : 'STOP',
      consentBeforeLead: events.some((event) => event.type === 'LEAD' && event.consentState === 'GRANTED') ? 'PASS' : 'STOP',
      syntheticTestValueOnly: events.some((event) => event.type === 'SALE' && event.amountTestCents === 4_900) ? 'PASS' : 'STOP',
      externalActionCount: 0,
      realMoneyMoved: 'NOT_APPLICABLE',
    }),
    decisions: Object.freeze({
      privateCtaEndToEnd: privateE2E,
      realLead: 'NOT_APPLICABLE',
      realSale: 'NOT_APPLICABLE',
      publicStream: 'STOP',
      publication: 'LOCKED',
    }),
    redaction: Object.freeze({
      applied: true,
      removedFieldCount,
      excludes: Object.freeze(['PII', 'URLs', 'credentials', 'payment data', 'messages', 'free-form lead data']),
    }),
  });
}
