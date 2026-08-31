import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  compareSyntheticAttribution,
  createSaleAttributionReport,
  evaluateSaleAttributionCorpus,
  validateSaleAttributionManifest,
} from '../src/stream-sale-attribution.js';
import { validateSaleShowVariants } from '../src/stream-sale-show-contract.js';
import { validateAttributionShowMapping } from '../src/stream-sale-show-contract.js';
import {
  consumePrivateSaleHandoff,
  createPrivateSaleHandoff,
  createPrivateSaleEvent,
  createPrivateSaleEvidence,
  markPrivateSaleCompleted,
  PRIVATE_SALE_AUTHORIZATION_STATUS,
  PRIVATE_SALE_GATE_PROVENANCE,
  PRIVATE_SALE_HANDOFF_KEY,
  PRIVATE_SALE_RUN_ID,
  stagePrivateSaleHandoff,
  validatePrivateSaleHandoff,
} from '../src/stream-private-sale-contract.js';
import {
  computeAttributionComparisonFingerprint,
  runStreamSaleAttribution,
} from '../../../scripts/run-birdie-stream-sale-attribution.mjs';

const repositoryRoot = new URL('../../..', import.meta.url);

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repositoryRoot), 'utf8'));
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'test-attribution',
    scope: 'LOCAL_SYNTHETIC_ATTRIBUTION',
    externalActions: 'LOCKED',
    eventSchema: { version: 1 },
    policy: {
      viewToCtaMaxMs: 100,
      ctaToLeadMaxMs: 100,
      leadToSaleMaxMs: 100,
    },
    allowed: {
      eventTypes: ['VIEW', 'CTA', 'LEAD', 'SALE'],
      variantIds: ['PRODUCT', 'APP_DEMO', 'BIRDIEWORLD_HOTEL'],
      offerIds: ['offer-test'],
      campaignIds: ['campaign-test'],
      segmentIds: ['segment-test'],
      consentStates: ['NOT_APPLICABLE', 'GRANTED'],
    },
    comparisonFingerprintSha256: 'a'.repeat(64),
    ...overrides,
  };
}

function completeFunnel() {
  return ['VIEW', 'CTA', 'LEAD', 'SALE'].map((type, index) => ({
    eventId: `event-${index + 1}`,
    sequenceId: index + 1,
    occurredAtMs: index * 50,
    type,
    sessionId: 'session-1',
    variantId: 'PRODUCT',
    offerId: 'offer-test',
    campaignId: 'campaign-test',
    segmentId: 'segment-test',
    synthetic: true,
    externalAction: 'LOCKED',
    consentState: ['LEAD', 'SALE'].includes(type) ? 'GRANTED' : 'NOT_APPLICABLE',
    amountTestCents: type === 'SALE' ? 4900 : 0,
  }));
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('three sale show variants are exact local draft-only 15-minute contracts', async () => {
  const shows = await json('ops/stream/birdie-stream-sale-shows.json');
  const result = validateSaleShowVariants(shows);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(shows.variants.map(({ id }) => id), ['PRODUCT', 'APP_DEMO', 'BIRDIEWORLD_HOTEL']);
  assert.equal(shows.variants.every(({ durationMs }) => durationMs === 900_000), true);
  assert.equal(shows.variants.reduce((sum, variant) => sum + variant.segments.length, 0), 18);
  assert.equal(shows.variants.reduce((sum, variant) => sum + variant.clips.length, 0), 15);
  assert.equal(shows.variants.every((variant) => variant.segments.every((segment) => (
    segment.ctaOffer.status === 'DRAFT' && segment.ctaOffer.action === 'NO_EXTERNAL_ACTION'
  ))), true);
});

test('sale show validator stops public output, offer, voice, clip, and fallback mutations', async (t) => {
  const shows = await json('ops/stream/birdie-stream-sale-shows.json');
  const mutations = [
    ['public output', (value) => { value.policy.publicTransmission = true; }],
    ['active CTA', (value) => { value.variants[0].segments[0].ctaOffer.status = 'READY'; }],
    ['CTA destination field', (value) => { value.variants[0].segments[0].ctaOffer.href = 'javascript:alert(1)'; }],
    ['non-synthetic voice', (value) => { value.variants[0].voiceCues[0].fixture = 'voice:microphone'; }],
    ['clip crossing scene', (value) => { value.variants[0].clips[3].endMs = 660_000; }],
    ['resumable fallback', (value) => { value.variants[0].failClosedFallback.resume = 'ALLOWED'; }],
    ['extra fallback action', (value) => { value.variants[0].failClosedFallback.actions.push('PUBLISH'); }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const candidate = structuredClone(shows);
      mutate(candidate);
      assert.equal(validateSaleShowVariants(candidate).status, 'STOP');
    });
  }
});

test('attribution manifest and a complete local synthetic funnel pass', () => {
  const fixture = manifest();
  assert.equal(validateSaleAttributionManifest(fixture).status, 'PASS');
  const result = evaluateSaleAttributionCorpus(fixture, completeFunnel());
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.metrics.counts, { VIEW: 1, CTA: 1, LEAD: 1, SALE: 1 });
  assert.deepEqual(result.metrics.ratesBps, {
    ctaPerView: 10_000,
    leadPerCta: 10_000,
    salePerLead: 10_000,
    salePerView: 10_000,
  });
  assert.equal(result.metrics.amountTestCents, 4900);
});

test('attribution names the first duplicate, order, consent, lineage, window, and privacy violation', async (t) => {
  const fixture = manifest();
  const cases = [
    ['duplicate', (events) => { events[1].eventId = events[0].eventId; }, 'EVENT_DUPLICATE'],
    ['sequence', (events) => { events[2].sequenceId = 1; }, 'SEQUENCE_ID_INVALID_OR_DUPLICATE'],
    ['time order', (events) => { events[2].occurredAtMs = 10; }, 'EVENT_TIME_OUT_OF_ORDER'],
    ['consent', (events) => { events[2].consentState = 'NOT_APPLICABLE'; }, 'LEAD_CONSENT_MISSING'],
    ['sale without lead', (events) => { events.splice(2, 1); events[2].sequenceId = 3; }, 'FUNNEL_STAGE_SKIPPED'],
    ['expired window', (events) => { events[1].occurredAtMs = 101; events[2].occurredAtMs = 151; events[3].occurredAtMs = 201; }, 'ATTRIBUTION_WINDOW_EXPIRED'],
    ['session drift', (events) => { events[2].variantId = 'APP_DEMO'; }, 'SESSION_ATTRIBUTION_DRIFT'],
    ['PII field', (events) => { events[0].email = 'forbidden'; }, 'EVENT_FIELD_NOT_ALLOWED'],
    ['external event', (events) => { events[0].externalAction = 'SENT'; }, 'EVENT_EXTERNAL_OR_NON_SYNTHETIC'],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, () => {
      const events = structuredClone(completeFunnel());
      mutate(events);
      const result = evaluateSaleAttributionCorpus(fixture, events);
      assert.equal(result.status, 'STOP');
      assert.equal(result.firstViolation.reasonId, expected);
    });
  }
});

test('synthetic regression passes only with a matching fingerprint and equal exposure', () => {
  const passed = evaluateSaleAttributionCorpus(manifest(), completeFunnel());
  const regression = compareSyntheticAttribution(passed, passed, {
    currentFingerprintSha256: 'a'.repeat(64),
    baselineFingerprintSha256: 'a'.repeat(64),
  });
  assert.equal(regression.compatibility, 'PASS');
  assert.equal(regression.verdict, 'PASS');

  const incompatible = compareSyntheticAttribution(passed, passed, {
    currentFingerprintSha256: 'a'.repeat(64),
    baselineFingerprintSha256: 'b'.repeat(64),
  });
  assert.equal(incompatible.compatibility, 'UNKNOWN');
  assert.equal(incompatible.verdict, 'UNKNOWN');
  assert.equal(incompatible.gates.every(({ status }) => status === 'UNKNOWN'), true);
});

test('a same-fingerprint synthetic rate regression stops', () => {
  const fixture = manifest();
  const baseline = evaluateSaleAttributionCorpus(fixture, completeFunnel());
  const currentEvents = completeFunnel().slice(0, 3);
  const current = evaluateSaleAttributionCorpus(fixture, currentEvents);
  const regression = compareSyntheticAttribution(current, baseline, {
    currentFingerprintSha256: 'a'.repeat(64),
    baselineFingerprintSha256: 'a'.repeat(64),
  });
  assert.equal(regression.compatibility, 'PASS');
  assert.equal(regression.verdict, 'STOP');
  assert.equal(regression.gates.find(({ id }) => id === 'sale-per-lead').status, 'STOP');
});

test('attribution report never turns synthetic funnels into a real-sale claim', () => {
  const fixture = {
    ...manifest(),
    corpora: {
      baseline: { events: completeFunnel() },
      current: { events: completeFunnel() },
    },
    negativeFixtures: [{
      id: 'duplicate-event',
      expectedFirstViolation: 'EVENT_DUPLICATE',
      events: completeFunnel().map((event, index) => index === 1 ? { ...event, eventId: 'event-1' } : event),
    }],
  };
  const report = createSaleAttributionReport({ manifest: fixture });
  assert.deepEqual(report.decisions, {
    localSyntheticAttribution: 'UNKNOWN',
    syntheticBaselineRegression: 'PASS',
    realViewToSaleAttribution: 'UNKNOWN',
    supervisedPrivateTest: 'STOP',
    publicStream: 'STOP',
    publication: 'LOCKED',
  });
  assert.equal(report.externalActions, 'LOCKED');
  assert.equal(report.unknowns.includes('REAL_SALES'), true);
});

test('missing attribution corpus or show evidence can never become local PASS', () => {
  const fixture = {
    ...manifest(),
    corpora: { baseline: { events: completeFunnel() } },
    negativeFixtures: [{
      id: 'duplicate-event',
      expectedFirstViolation: 'EVENT_DUPLICATE',
      events: completeFunnel().map((event, index) => index === 1 ? { ...event, eventId: 'event-1' } : event),
    }],
  };
  const missingCurrent = createSaleAttributionReport({ manifest: fixture });
  assert.equal(missingCurrent.corpora.current.status, 'UNKNOWN');
  assert.notEqual(missingCurrent.decisions.localSyntheticAttribution, 'PASS');

  fixture.corpora.current = { events: completeFunnel() };
  const missingShowProof = createSaleAttributionReport({ manifest: fixture });
  assert.equal(missingShowProof.decisions.localSyntheticAttribution, 'UNKNOWN');
});

test('versioned attribution corpus maps exactly to the three show variants and replays every fixture', async () => {
  const [fixture, shows] = await Promise.all([
    json('ops/stream/birdie-stream-attribution-fixtures.json'),
    json('ops/stream/birdie-stream-sale-shows.json'),
  ]);
  assert.equal(validateSaleAttributionManifest(fixture).status, 'PASS');
  assert.equal(validateAttributionShowMapping(fixture, shows).status, 'PASS');
  assert.equal(computeAttributionComparisonFingerprint(fixture), fixture.comparisonFingerprintSha256);
  const report = createSaleAttributionReport({
    manifest: fixture,
    showValidation: validateSaleShowVariants(shows),
    attributionShowMapping: validateAttributionShowMapping(fixture, shows),
  });
  assert.equal(report.decisions.localSyntheticAttribution, 'PASS');
  assert.equal(report.decisions.syntheticBaselineRegression, 'PASS');
  assert.deepEqual(report.corpora.baseline.metrics.counts, { VIEW: 3, CTA: 3, LEAD: 2, SALE: 1 });
  assert.deepEqual(report.corpora.current.metrics.counts, { VIEW: 3, CTA: 3, LEAD: 2, SALE: 2 });
  assert.equal(report.negativeFixtures.length, 9);
  assert.equal(report.negativeFixtures.every(({ status }) => status === 'PASS'), true);
});

test('attribution show mapping fails closed without dereferencing malformed STOP variants', async (t) => {
  const [fixture, shows] = await Promise.all([
    json('ops/stream/birdie-stream-attribution-fixtures.json'),
    json('ops/stream/birdie-stream-sale-shows.json'),
  ]);
  const mutations = [
    ['missing segments', (value) => { delete value.variants[0].segments; }],
    ['null segments', (value) => { value.variants[0].segments = null; }],
    ['missing CTA offer', (value) => { delete value.variants[0].segments[4].ctaOffer; }],
    ['null variant', (value) => { value.variants[0] = null; }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const candidate = structuredClone(shows);
      mutate(candidate);
      assert.equal(validateSaleShowVariants(candidate).status, 'STOP');
      let mapping;
      assert.doesNotThrow(() => {
        mapping = validateAttributionShowMapping(fixture, candidate);
      });
      assert.equal(mapping.status, 'STOP');
      assert.equal(mapping.checks.find(({ id }) => id === 'show-contract')?.status, 'STOP');
      assert.equal(mapping.checks.every(({ status }) => status === 'STOP'), true);
    });
  }
});

test('stream-to-sale runner is deterministic, local-only, and requires explicit synthetic mode', async () => {
  const first = await runStreamSaleAttribution({ synthetic: true });
  const second = await runStreamSaleAttribution({ synthetic: true });
  assert.equal(first.report.canonicalSha256, second.report.canonicalSha256);
  assert.match(first.report.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.report.decisions.realViewToSaleAttribution, 'UNKNOWN');
  assert.equal(first.report.decisions.supervisedPrivateTest, 'STOP');
  const serialized = JSON.stringify(first.report);
  for (const forbidden of ['C:\\Users', 'http://', 'https://', 'Bearer ', 'sk-proj-', 'DENIED_FIXTURE_FIELD']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  await assert.rejects(() => runStreamSaleAttribution(), /explicit --synthetic local attribution fixture/);
});

test('locked private CTA keeps a valid synthetic funnel separate from trusted navigation proof', () => {
  const nonce = '0123456789abcdef0123456789abcdef';
  const handoff = createPrivateSaleHandoff({ nonce, createdAtEpochMs: 1_000 });
  const storage = memoryStorage();
  assert.equal(stagePrivateSaleHandoff(storage, handoff, { authorizationStatus: 'GO' }).status, 'STOP');
  const navigationProof = validatePrivateSaleHandoff(handoff, { nonce, nowEpochMs: 1_010 });
  assert.deepEqual(Object.getOwnPropertySymbols(navigationProof), []);
  const events = [
    ...navigationProof.events,
    ...['LEAD', 'SALE'].map((type, index) => createPrivateSaleEvent({
      type,
      sequenceId: index + 3,
      occurredAtMs: (index + 2) * 100,
      variant: 'PRODUCT',
      runId: PRIVATE_SALE_RUN_ID,
    })),
  ];
  const evidence = createPrivateSaleEvidence({
    events,
    variant: 'PRODUCT',
    runId: PRIVATE_SALE_RUN_ID,
    navigationProof,
  });
  assert.equal(navigationProof.status, 'PASS');
  assert.equal(evidence.evaluation.status, 'PASS');
  assert.equal(evidence.sourceProof.status, 'STOP');
  assert.equal(evidence.runCounter, '0/1');
  assert.equal(evidence.decisions.privateCtaEndToEnd, 'STOP');
  assert.equal(evidence.decisions.realLead, 'NOT_APPLICABLE');
  assert.equal(evidence.decisions.realSale, 'NOT_APPLICABLE');
  assert.equal(evidence.decisions.publicStream, 'STOP');
  assert.equal(evidence.checks.externalActionCount, 0);
  assert.equal(evidence.checks.realMoneyMoved, 'NOT_APPLICABLE');
  assert.equal(evidence.events.at(-1).amountTestCents, 4_900);

  const forgedProof = Object.freeze({
    ...navigationProof,
    [Symbol('birdie.privateSale.trustedHandoffProof')]: true,
  });
  const forgedEvidence = createPrivateSaleEvidence({
    events,
    variant: 'PRODUCT',
    runId: PRIVATE_SALE_RUN_ID,
    navigationProof: forgedProof,
  });
  assert.equal(forgedEvidence.sourceProof.status, 'STOP');
  assert.equal(forgedEvidence.decisions.privateCtaEndToEnd, 'STOP');

  const originalWeakSetHas = WeakSet.prototype.has;
  try {
    WeakSet.prototype.has = () => true;
    const prototypePatchedEvidence = createPrivateSaleEvidence({
      events,
      variant: 'PRODUCT',
      runId: PRIVATE_SALE_RUN_ID,
      navigationProof,
    });
    assert.equal(prototypePatchedEvidence.sourceProof.status, 'STOP');
    assert.equal(prototypePatchedEvidence.decisions.privateCtaEndToEnd, 'STOP');
  } finally {
    WeakSet.prototype.has = originalWeakSetHas;
  }

});

test('private CTA evidence fails closed without stream navigation, consented lead, or exact order', () => {
  const events = ['VIEW', 'CTA', 'SALE'].map((type, index) => createPrivateSaleEvent({
    type,
    sequenceId: index + 1,
    occurredAtMs: index * 100,
  }));
  const evidence = createPrivateSaleEvidence({ events });
  assert.equal(evidence.decisions.privateCtaEndToEnd, 'STOP');
  assert.equal(evidence.checks.streamCtaNavigation, 'STOP');
  assert.equal(evidence.checks.exactFunnelOrder, 'STOP');
  assert.equal(evidence.checks.consentBeforeLead, 'STOP');
});

test('private CTA handoff is one-shot, bound to gates, and direct query claims stay STOP', async () => {
  assert.equal(PRIVATE_SALE_AUTHORIZATION_STATUS, 'CONSUMED_WITH_HOLD');
  const storage = memoryStorage();
  const nonce = 'abcdef0123456789abcdef0123456789';
  const handoff = createPrivateSaleHandoff({ nonce, createdAtEpochMs: 10_000 });
  assert.equal(stagePrivateSaleHandoff(storage, handoff).status, 'STOP');
  assert.equal(stagePrivateSaleHandoff(storage, handoff, { authorizationStatus: 'GO' }).status, 'STOP');
  storage.setItem(PRIVATE_SALE_HANDOFF_KEY, JSON.stringify(handoff));
  assert.equal(consumePrivateSaleHandoff(storage, {
    nonce,
    nowEpochMs: 10_005,
    authorizationStatus: 'GO',
  }).reasonId, 'FOUNDER_GO_NOT_ACTIVE');
  assert.equal(storage.getItem(PRIVATE_SALE_HANDOFF_KEY), null);
  assert.equal(validatePrivateSaleHandoff(handoff, {
    nonce,
    nowEpochMs: 10_010,
    completedRunId: PRIVATE_SALE_RUN_ID,
  }).reasonId, 'RUN_ALREADY_COMPLETED');

  const directEvents = ['VIEW', 'CTA', 'LEAD', 'SALE'].map((type, index) => createPrivateSaleEvent({
    type, sequenceId: index + 1, occurredAtMs: index,
  }));
  const forged = createPrivateSaleEvidence({
    events: directEvents,
    navigationProof: { status: 'PASS', source: 'STREAM_CTA', gateProvenance: PRIVATE_SALE_GATE_PROVENANCE },
  });
  assert.equal(forged.decisions.privateCtaEndToEnd, 'STOP');
  assert.equal(forged.checks.streamCtaNavigation, 'STOP');

  assert.equal(markPrivateSaleCompleted(storage).status, 'PASS');
  assert.equal(stagePrivateSaleHandoff(storage, handoff, { authorizationStatus: 'GO' }).status, 'STOP');

  const [showBytes, attributionBytes] = await Promise.all([
    readFile(new URL('ops/stream/birdie-stream-sale-shows.json', repositoryRoot)),
    readFile(new URL('ops/stream/birdie-stream-attribution-fixtures.json', repositoryRoot)),
  ]);
  assert.equal(createHash('sha256').update(showBytes).digest('hex'), PRIVATE_SALE_GATE_PROVENANCE.showManifestSha256);
  assert.equal(createHash('sha256').update(attributionBytes).digest('hex'), PRIVATE_SALE_GATE_PROVENANCE.attributionManifestSha256);
});

test('private CTA STOP evidence redacts unknown fields and unsafe values', () => {
  const event = {
    ...createPrivateSaleEvent({ type: 'VIEW', sequenceId: 1, occurredAtMs: 0 }),
    email: 'person@example.test',
    sessionId: 'https://secret.example/path?token=value',
  };
  const evidence = createPrivateSaleEvidence({ events: [event] });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.decisions.privateCtaEndToEnd, 'STOP');
  assert.equal(evidence.evaluation.firstViolation.reasonId, 'EVENT_FIELD_NOT_ALLOWED');
  assert.equal(evidence.redaction.removedFieldCount, 1);
  assert.equal(serialized.includes('person@example.test'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('token=value'), false);
});

test('private CTA review ledger validates every artifact and preserves historical STOP/public lock', async () => {
  const [ledger, authorization] = await Promise.all([
    json('ops/evidence/birdie-stream-private-cta-e2e-20260831-ledger.json'),
    json('ops/evidence/birdie-stream-cta-only-authorization-20260831.json'),
  ]);
  assert.equal(ledger.schemaVersion, 4);
  assert.equal(ledger.recordScope, 'HISTORICAL_RUN_REVIEW_ONLY');
  assert.equal(ledger.runId, PRIVATE_SALE_RUN_ID);
  assert.equal(ledger.runCounter, '1/1');
  assert.equal(ledger.reviewStatus, 'STOP');
  assert.equal(ledger.decisions.privateLocalCtaEndToEnd, 'STOP');
  assert.equal(ledger.decisions.publicStream, 'STOP');
  assert.equal(ledger.decisions.newPrivateRun, 'OUT_OF_SCOPE_SEE_SEPARATE_AUTHORIZATION_RECEIPT');
  assert.equal(ledger.checks.applicationEnforcedNavigationProvenanceAtExecution, 'STOP');
  assert.equal(ledger.checks.oneShotReplayProtectionAtExecution, 'STOP');
  assert.equal(ledger.checks.executedBuildBinding, 'STOP');
  assert.equal(ledger.checks.postRunContractFixBrowserE2E, 'NOT_EXECUTED_SEE_SEPARATE_AUTHORIZATION_RECEIPT');
  assert.equal(ledger.postRunTestEvidence.buildBinding, 'INCOMPLETE');
  assert.equal(ledger.postRunTestEvidence.browserE2E, 'NOT_EXECUTED');
  assert.equal(ledger.relatedAuthorizationReceipt.includedInThisHistoricalLedger, false);

  assert.equal(authorization.schemaVersion, 1);
  assert.equal(authorization.authorization.scope, 'CTA_ONLY_LOCAL_BROWSER_E2E');
  assert.equal(authorization.authorization.status, 'AUTHORIZED_PENDING_EXECUTION');
  assert.equal(authorization.explicitlyExcludedScopes['15_MIN_OBS_RECORDING'], 'STOP');
  assert.equal(authorization.externalActions, 'LOCKED');
  assert.equal(authorization.preExecutionEvidence.status, 'PENDING');
  assert.equal(authorization.decisionEffect.liveGate, 'NO_EFFECT_STOP');
  assert.equal(authorization.decisionEffect.publicationGate, 'NO_EFFECT_LOCKED');
  for (const artifact of ledger.artifacts) {
    const bytes = await readFile(new URL(artifact.relativePath, repositoryRoot));
    assert.equal(bytes.length, artifact.bytes, artifact.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.id);
  }
});

test('private CTA UI is same-origin, payment-free, and routed without changing the headless default', async () => {
  const [mainSource, streamSource, privateSource, css] = await Promise.all([
    readFile(new URL('apps/desktop/src/main.js', repositoryRoot), 'utf8'),
    readFile(new URL('apps/desktop/src/stream-mode.js', repositoryRoot), 'utf8'),
    readFile(new URL('apps/desktop/src/stream-private-sale.js', repositoryRoot), 'utf8'),
    readFile(new URL('apps/desktop/src/stream-private-sale.css', repositoryRoot), 'utf8'),
  ]);
  assert.match(mainSource, /requestedMode === 'private-sale'/);
  assert.match(mainSource, /else startHeadless\(\)/);
  assert.match(streamSource, /\/\?mode=private-sale&variant=/);
  assert.match(streamSource, /ctaTest.*private/);
  assert.doesNotMatch(streamSource, /source=stream-cta/);
  assert.match(streamSource, /removeAttribute\('href'\)/);
  assert.match(streamSource, /image\.removeAttribute\('src'\)/);
  assert.match(privateSource, /consumePrivateSaleHandoff/);
  assert.doesNotMatch(privateSource, /query\.get\('source'\)/);
  assert.match(privateSource, /NO NETWORK · NO PII · NO MONEY/);
  assert.match(privateSource, /EXTERNAL ACTIONS/);
  assert.doesNotMatch(privateSource, /https?:\/\/|fetch\(|XMLHttpRequest|WebSocket|@tauri-apps|invoke\(|payment|checkout/i);
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /visibility:\s*visible/);
  assert.match(css, /#app\s*\{[\s\S]*pointer-events:\s*auto/);
});
