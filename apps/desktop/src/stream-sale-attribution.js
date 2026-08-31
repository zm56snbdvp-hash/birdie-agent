export const STREAM_SALE_ATTRIBUTION_SCHEMA_VERSION = 1;

const REQUIRED_EVENT_TYPES = Object.freeze(['VIEW', 'CTA', 'LEAD', 'SALE']);
const REQUIRED_CONSENT_STATES = Object.freeze(['NOT_APPLICABLE', 'GRANTED']);
const EVENT_FIELDS = new Set([
  'eventId', 'sequenceId', 'occurredAtMs', 'type', 'sessionId', 'variantId', 'offerId',
  'campaignId', 'segmentId', 'synthetic', 'externalAction', 'consentState', 'amountTestCents',
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function finiteInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function safeId(value, fallback = 'UNKNOWN') {
  const normalized = String(value ?? fallback).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return normalized || fallback;
}

function unique(values) {
  return new Set(values).size === values.length;
}

function verdict(statuses) {
  if (statuses.includes('STOP')) return 'STOP';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

function violation(reasonId, event, eventIndex) {
  return Object.freeze({
    reasonId,
    eventIndex,
    eventId: safeId(event?.eventId),
    eventType: REQUIRED_EVENT_TYPES.includes(event?.type) ? event.type : 'UNKNOWN',
  });
}

function rateBasisPoints(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) : null;
}

function allowedIds(manifest, field) {
  return new Set(Array.isArray(manifest?.allowed?.[field]) ? manifest.allowed[field] : []);
}

export function validateSaleAttributionManifest(manifest) {
  const policy = manifest?.policy ?? {};
  const allowed = manifest?.allowed ?? {};
  const arrays = ['eventTypes', 'variantIds', 'offerIds', 'campaignIds', 'segmentIds', 'consentStates'];
  const checks = Object.freeze([
    Object.freeze({ id: 'schema', status: manifest?.schemaVersion === STREAM_SALE_ATTRIBUTION_SCHEMA_VERSION ? 'PASS' : 'STOP' }),
    Object.freeze({ id: 'scope', status: manifest?.scope === 'LOCAL_SYNTHETIC_ATTRIBUTION' ? 'PASS' : 'STOP' }),
    Object.freeze({ id: 'external-actions', status: manifest?.externalActions === 'LOCKED' ? 'PASS' : 'STOP' }),
    Object.freeze({ id: 'event-types', status: JSON.stringify(allowed.eventTypes) === JSON.stringify(REQUIRED_EVENT_TYPES) ? 'PASS' : 'STOP' }),
    Object.freeze({ id: 'consent-states', status: JSON.stringify(allowed.consentStates) === JSON.stringify(REQUIRED_CONSENT_STATES) ? 'PASS' : 'STOP' }),
    Object.freeze({
      id: 'allowlists',
      status: arrays.every((field) => Array.isArray(allowed[field]) && allowed[field].length > 0 && unique(allowed[field]) && allowed[field].every((id) => ID_PATTERN.test(id))) ? 'PASS' : 'STOP',
    }),
    Object.freeze({
      id: 'windows',
      status: ['viewToCtaMaxMs', 'ctaToLeadMaxMs', 'leadToSaleMaxMs'].every((field) => finiteInteger(policy[field], 1, 86_400_000) != null) ? 'PASS' : 'STOP',
    }),
    Object.freeze({
      id: 'fingerprint',
      status: /^[a-f0-9]{64}$/i.test(String(manifest?.comparisonFingerprintSha256)) ? 'PASS' : 'STOP',
    }),
  ]);
  return Object.freeze({
    status: checks.every((check) => check.status === 'PASS') ? 'PASS' : 'STOP',
    checks,
  });
}

export function evaluateSaleAttributionCorpus(manifest, events) {
  const manifestValidation = validateSaleAttributionManifest(manifest);
  if (manifestValidation.status !== 'PASS') {
    return Object.freeze({
      status: 'STOP',
      firstViolation: Object.freeze({ reasonId: 'ATTRIBUTION_MANIFEST_INVALID', eventIndex: null, eventId: 'UNKNOWN', eventType: 'UNKNOWN' }),
      metrics: null,
    });
  }
  const entries = Array.isArray(events) ? events : [];
  if (entries.length === 0) {
    return Object.freeze({
      status: 'UNKNOWN',
      firstViolation: Object.freeze({ reasonId: 'ATTRIBUTION_EVENTS_MISSING', eventIndex: null, eventId: 'UNKNOWN', eventType: 'UNKNOWN' }),
      metrics: null,
    });
  }

  const allowed = Object.freeze({
    eventTypes: allowedIds(manifest, 'eventTypes'),
    variantIds: allowedIds(manifest, 'variantIds'),
    offerIds: allowedIds(manifest, 'offerIds'),
    campaignIds: allowedIds(manifest, 'campaignIds'),
    segmentIds: allowedIds(manifest, 'segmentIds'),
    consentStates: allowedIds(manifest, 'consentStates'),
  });
  const seenEventIds = new Set();
  const seenSequenceIds = new Set();
  const sessions = new Map();
  let previousSequenceId = 0;
  let previousOccurredAtMs = -1;

  for (let eventIndex = 0; eventIndex < entries.length; eventIndex += 1) {
    const event = entries[eventIndex];
    const keys = event && typeof event === 'object' ? Object.keys(event) : [];
    if (!event || typeof event !== 'object' || keys.some((key) => !EVENT_FIELDS.has(key))) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_FIELD_NOT_ALLOWED', event, eventIndex), metrics: null });
    }
    if (!ID_PATTERN.test(event.eventId) || !ID_PATTERN.test(event.sessionId)) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_ID_INVALID', event, eventIndex), metrics: null });
    }
    if (seenEventIds.has(event.eventId)) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_DUPLICATE', event, eventIndex), metrics: null });
    }
    if (finiteInteger(event.sequenceId, 1, 1_000_000_000) == null || seenSequenceIds.has(event.sequenceId)) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('SEQUENCE_ID_INVALID_OR_DUPLICATE', event, eventIndex), metrics: null });
    }
    if (event.sequenceId <= previousSequenceId) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('SEQUENCE_OUT_OF_ORDER', event, eventIndex), metrics: null });
    }
    if (finiteInteger(event.occurredAtMs, 0, 86_400_000) == null) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_TIME_INVALID', event, eventIndex), metrics: null });
    }
    if (event.occurredAtMs < previousOccurredAtMs) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_TIME_OUT_OF_ORDER', event, eventIndex), metrics: null });
    }
    if (!allowed.eventTypes.has(event.type)
      || !allowed.variantIds.has(event.variantId)
      || !allowed.offerIds.has(event.offerId)
      || !allowed.campaignIds.has(event.campaignId)
      || !allowed.segmentIds.has(event.segmentId)
      || !allowed.consentStates.has(event.consentState)) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_ENUM_NOT_ALLOWED', event, eventIndex), metrics: null });
    }
    if (event.synthetic !== true || event.externalAction !== 'LOCKED') {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_EXTERNAL_OR_NON_SYNTHETIC', event, eventIndex), metrics: null });
    }
    const amount = finiteInteger(event.amountTestCents, 0, 1_000_000);
    if (amount == null || (event.type !== 'SALE' && amount !== 0)) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('EVENT_TEST_AMOUNT_INVALID', event, eventIndex), metrics: null });
    }
    if (event.type === 'LEAD' && event.consentState !== 'GRANTED') {
      return Object.freeze({ status: 'STOP', firstViolation: violation('LEAD_CONSENT_MISSING', event, eventIndex), metrics: null });
    }

    const session = sessions.get(event.sessionId) ?? {
      stageIndex: -1,
      variantId: event.variantId,
      offerId: event.offerId,
      campaignId: event.campaignId,
      timestamps: {},
    };
    if (session.variantId !== event.variantId || session.offerId !== event.offerId || session.campaignId !== event.campaignId) {
      return Object.freeze({ status: 'STOP', firstViolation: violation('SESSION_ATTRIBUTION_DRIFT', event, eventIndex), metrics: null });
    }
    const stageIndex = REQUIRED_EVENT_TYPES.indexOf(event.type);
    if (stageIndex !== session.stageIndex + 1) {
      const reasonId = stageIndex <= session.stageIndex ? 'FUNNEL_STAGE_DUPLICATE_OR_REVERSED' : 'FUNNEL_STAGE_SKIPPED';
      return Object.freeze({ status: 'STOP', firstViolation: violation(reasonId, event, eventIndex), metrics: null });
    }
    if (stageIndex > 0) {
      const previousType = REQUIRED_EVENT_TYPES[stageIndex - 1];
      const windowField = ['viewToCtaMaxMs', 'ctaToLeadMaxMs', 'leadToSaleMaxMs'][stageIndex - 1];
      if (event.occurredAtMs - session.timestamps[previousType] > manifest.policy[windowField]) {
        return Object.freeze({ status: 'STOP', firstViolation: violation('ATTRIBUTION_WINDOW_EXPIRED', event, eventIndex), metrics: null });
      }
    }

    session.stageIndex = stageIndex;
    session.timestamps[event.type] = event.occurredAtMs;
    sessions.set(event.sessionId, session);
    seenEventIds.add(event.eventId);
    seenSequenceIds.add(event.sequenceId);
    previousSequenceId = event.sequenceId;
    previousOccurredAtMs = event.occurredAtMs;
  }

  const counts = Object.fromEntries(REQUIRED_EVENT_TYPES.map((type) => [type, 0]));
  for (const event of entries) counts[event.type] += 1;
  const metrics = Object.freeze({
    eventCount: entries.length,
    sessionCount: sessions.size,
    counts: Object.freeze(counts),
    ratesBps: Object.freeze({
      ctaPerView: rateBasisPoints(counts.CTA, counts.VIEW),
      leadPerCta: rateBasisPoints(counts.LEAD, counts.CTA),
      salePerLead: rateBasisPoints(counts.SALE, counts.LEAD),
      salePerView: rateBasisPoints(counts.SALE, counts.VIEW),
    }),
    amountTestCents: entries.filter((event) => event.type === 'SALE').reduce((sum, event) => sum + event.amountTestCents, 0),
  });
  return Object.freeze({ status: 'PASS', firstViolation: null, metrics });
}

function compareRate(id, current, baseline, allowanceBps) {
  if (current == null || baseline == null) return Object.freeze({ id, status: 'UNKNOWN', current, baseline, allowanceBps });
  return Object.freeze({
    id,
    status: current >= baseline - allowanceBps ? 'PASS' : 'STOP',
    current,
    baseline,
    deltaBps: current - baseline,
    allowanceBps,
  });
}

export function compareSyntheticAttribution(currentResult, baselineResult, {
  currentFingerprintSha256,
  baselineFingerprintSha256,
} = {}) {
  if (currentResult?.status === 'STOP' || baselineResult?.status === 'STOP') {
    return Object.freeze({ verdict: 'STOP', compatibility: 'STOP', gates: Object.freeze([]) });
  }
  if (currentResult?.status !== 'PASS' || baselineResult?.status !== 'PASS') {
    return Object.freeze({ verdict: 'UNKNOWN', compatibility: 'UNKNOWN', gates: Object.freeze([]) });
  }
  const fingerprintMatches = /^[a-f0-9]{64}$/i.test(String(currentFingerprintSha256))
    && currentFingerprintSha256 === baselineFingerprintSha256;
  const exposureMatches = currentResult.metrics.counts.VIEW === baselineResult.metrics.counts.VIEW;
  const compatibility = fingerprintMatches && exposureMatches ? 'PASS' : 'UNKNOWN';
  const gates = Object.freeze([
    compareRate('cta-per-view', currentResult.metrics.ratesBps.ctaPerView, baselineResult.metrics.ratesBps.ctaPerView, 500),
    compareRate('lead-per-cta', currentResult.metrics.ratesBps.leadPerCta, baselineResult.metrics.ratesBps.leadPerCta, 500),
    compareRate('sale-per-lead', currentResult.metrics.ratesBps.salePerLead, baselineResult.metrics.ratesBps.salePerLead, 500),
    compareRate('sale-per-view', currentResult.metrics.ratesBps.salePerView, baselineResult.metrics.ratesBps.salePerView, 250),
  ].map((entry) => compatibility === 'PASS' ? entry : Object.freeze({ ...entry, status: 'UNKNOWN' })));
  return Object.freeze({
    verdict: verdict([compatibility, ...gates.map((entry) => entry.status)]),
    compatibility,
    gates,
    current: currentResult.metrics,
    baseline: baselineResult.metrics,
  });
}

export function createSaleAttributionReport({
  manifest,
  sourceDigests = {},
  showValidation = null,
  attributionShowMapping = null,
} = {}) {
  const manifestValidation = validateSaleAttributionManifest(manifest);
  const baseline = evaluateSaleAttributionCorpus(manifest, manifest?.corpora?.baseline?.events);
  const current = evaluateSaleAttributionCorpus(manifest, manifest?.corpora?.current?.events);
  const negativeFixtures = Object.freeze((manifest?.negativeFixtures ?? []).map((fixture) => {
    const result = evaluateSaleAttributionCorpus(manifest, fixture?.events);
    const expected = safeId(fixture?.expectedFirstViolation);
    return Object.freeze({
      id: safeId(fixture?.id),
      expectedFirstViolation: expected,
      observedFirstViolation: result.firstViolation?.reasonId ?? null,
      status: result.status === 'STOP' && result.firstViolation?.reasonId === expected ? 'PASS' : 'STOP',
    });
  }));
  const regression = compareSyntheticAttribution(current, baseline, {
    currentFingerprintSha256: manifest?.comparisonFingerprintSha256,
    baselineFingerprintSha256: manifest?.comparisonFingerprintSha256,
  });
  const fixtureStatus = negativeFixtures.length > 0 && negativeFixtures.every((fixture) => fixture.status === 'PASS') ? 'PASS' : 'STOP';
  const localStatuses = [
    manifestValidation.status,
    baseline.status,
    current.status,
    fixtureStatus,
    regression.verdict,
    showValidation?.status ?? 'UNKNOWN',
    attributionShowMapping?.status ?? 'UNKNOWN',
  ];
  const localSyntheticAttribution = localStatuses.includes('STOP')
    ? 'STOP'
    : localStatuses.every((status) => status === 'PASS') ? 'PASS' : 'UNKNOWN';
  return Object.freeze({
    schemaVersion: STREAM_SALE_ATTRIBUTION_SCHEMA_VERSION,
    evidenceId: `stream-sale-${safeId(manifest?.id)}`,
    scope: 'LOCAL_SYNTHETIC_ATTRIBUTION',
    externalActions: 'LOCKED',
    comparisonFingerprintSha256: /^[a-f0-9]{64}$/i.test(String(manifest?.comparisonFingerprintSha256))
      ? String(manifest.comparisonFingerprintSha256).toLowerCase()
      : 'UNKNOWN',
    sourceDigests: Object.freeze(Object.fromEntries(Object.entries(sourceDigests).map(([key, value]) => [
      safeId(key), /^[a-f0-9]{64}$/i.test(String(value)) ? String(value).toLowerCase() : 'UNKNOWN',
    ]))),
    manifestValidation,
    corpora: Object.freeze({ baseline, current }),
    negativeFixtures,
    regression,
    showContracts: Object.freeze({
      variants: showValidation?.status ?? 'UNKNOWN',
      attributionMapping: attributionShowMapping?.status ?? 'UNKNOWN',
    }),
    decisions: Object.freeze({
      localSyntheticAttribution,
      syntheticBaselineRegression: regression.verdict,
      realViewToSaleAttribution: 'UNKNOWN',
      supervisedPrivateTest: 'STOP',
      publicStream: 'STOP',
      publication: 'LOCKED',
    }),
    unknowns: Object.freeze([
      'REAL_VIEW_EVENTS', 'REAL_CTA_INTERACTIONS', 'REAL_CONSENTED_LEADS', 'REAL_SALES',
      'REAL_MONEY', 'REAL_NETWORK_ATTRIBUTION', 'PRODUCTION_CTA_DESTINATION',
    ]),
    redaction: Object.freeze({
      applied: true,
      excludes: Object.freeze(['PII', 'names', 'email', 'phone', 'IP', 'URLs', 'credentials', 'payment data', 'free-form text']),
    }),
  });
}

export function renderSaleAttributionReportMarkdown(report) {
  const fixtureRows = report.negativeFixtures.map((fixture) => (
    `| ${fixture.id} | ${fixture.expectedFirstViolation} | ${fixture.observedFirstViolation} | ${fixture.status} |`
  )).join('\n');
  const regressionRows = report.regression.gates.map((entry) => (
    `| ${entry.id} | ${entry.baseline ?? 'UNKNOWN'} | ${entry.current ?? 'UNKNOWN'} | ${entry.deltaBps ?? 'UNKNOWN'} | ${entry.status} |`
  )).join('\n');
  return `# Birdie Stream-to-Sale — lokale Attribution Evidence\n\n`
    + `Scope: \`${report.scope}\` · External actions: \`${report.externalActions}\`\n\n`
    + `- Lokale synthetische Attribution: **${report.decisions.localSyntheticAttribution}**\n`
    + `- Synthetische Baseline-Regression: **${report.decisions.syntheticBaselineRegression}**\n`
    + `- Reale View→Sale-Attribution: **${report.decisions.realViewToSaleAttribution}**\n`
    + `- Beaufsichtigter privater Test: **${report.decisions.supervisedPrivateTest}**\n`
    + `- Öffentlicher Stream: **${report.decisions.publicStream}** · Veröffentlichung: **${report.decisions.publication}**\n\n`
    + `Showvarianten-Vertrag: **${report.showContracts.variants}** · Attribution↔Show-Mapping: **${report.showContracts.attributionMapping}**\n\n`
    + `## Synthetische Funnel\n\n`
    + `- Baseline: ${JSON.stringify(report.corpora.baseline.metrics)}\n`
    + `- Current: ${JSON.stringify(report.corpora.current.metrics)}\n\n`
    + `## Regression (Basispunkte)\n\n| Gate | Baseline | Current | Delta | Status |\n| --- | ---: | ---: | ---: | --- |\n${regressionRows}\n\n`
    + `## Negative Fixtures\n\n| Fixture | Erwartete erste Verletzung | Beobachtet | Status |\n| --- | --- | --- | --- |\n${fixtureRows}\n\n`
    + `Alle Events sind synthetisch, redigiert und lokal. Es wurden keine echten Views, Leads, Sales, Zahlungen oder Außenaktionen erzeugt.\n`;
}
