export const STREAM_SALE_SHOW_SCHEMA_VERSION = 1;
export const STREAM_SALE_SHOW_DURATION_MS = 900_000;

const REQUIRED_VARIANTS = Object.freeze(['PRODUCT', 'APP_DEMO', 'BIRDIEWORLD_HOTEL']);
const REQUIRED_ROLES = Object.freeze(['HOOK', 'SEGMENT_1', 'SEGMENT_2', 'SEGMENT_3', 'CTA', 'CLOSE']);
const ALLOWED_VOICE_STATES = new Set(['IDLE', 'SPEECH_DETECTED', 'LISTENING', 'THINKING', 'WORKING', 'SPEAKING', 'SUCCESS']);
const REQUIRED_FALLBACK_ACTIONS = Object.freeze([
  'SWITCH_VIA_FOCUSED_OBS_UI_TO_99_SAFE',
  'STOP_LOCAL_TAKE',
  'RECORD_REASON_AND_UNKNOWNS',
  'KEEP_EXTERNAL_ACTION_COUNT_ZERO',
]);
const REQUIRED_CTA_OFFER_FIELDS = Object.freeze([
  'action', 'ctaId', 'displayCopy', 'intent', 'offerId', 'status',
]);
const ALLOWED_CTA_INTENTS = new Set(['LOCAL_INTEREST_SIGNAL_ONLY', 'NO_CONVERSION_CLAIM']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function result(id, status, observed, expected) {
  return Object.freeze({ id, status, observed, expected });
}

function unique(values) {
  return new Set(values).size === values.length;
}

function sortedStrictlyBy(entries, field) {
  return entries.every((entry, index) => Number.isInteger(entry?.[field])
    && (index === 0 || entries[index - 1][field] < entry[field]));
}

function activeSceneAt(sceneCues, atMs) {
  return [...sceneCues].reverse().find((cue) => cue.atMs <= atMs)?.scene ?? null;
}

function validateVariant(variant, allowedScenes) {
  const segments = Array.isArray(variant?.segments) ? variant.segments : [];
  const sceneCues = Array.isArray(variant?.sceneCues) ? variant.sceneCues : [];
  const voiceCues = Array.isArray(variant?.voiceCues) ? variant.voiceCues : [];
  const clips = Array.isArray(variant?.clips) ? variant.clips : [];
  const fallback = variant?.failClosedFallback ?? {};
  const ctaIds = segments.map((segment) => segment?.ctaOffer?.ctaId);
  const offerIds = segments.map((segment) => segment?.ctaOffer?.offerId);
  const segmentsContiguous = segments.length === REQUIRED_ROLES.length
    && segments[0]?.startMs === 0
    && segments.at(-1)?.endMs === STREAM_SALE_SHOW_DURATION_MS
    && segments.every((segment, index) => Number.isInteger(segment.startMs)
      && Number.isInteger(segment.endMs)
      && segment.endMs > segment.startMs
      && segment.durationMs === segment.endMs - segment.startMs
      && (index === 0 || segments[index - 1].endMs === segment.startMs));
  const clipsBounded = clips.length === 5 && clips.every((clip) => Number.isInteger(clip?.startMs)
    && Number.isInteger(clip?.endMs)
    && clip.startMs >= 0
    && clip.endMs <= STREAM_SALE_SHOW_DURATION_MS
    && clip.endMs > clip.startMs
    && clip.endMs - clip.startMs >= 15_000
    && clip.endMs - clip.startMs <= 60_000
    && activeSceneAt(sceneCues, clip.startMs) === clip.scene
    && !sceneCues.some((cue) => cue.atMs > clip.startMs && cue.atMs < clip.endMs));
  const localDraftOffers = segments.every((segment) => {
    const offer = segment?.ctaOffer ?? {};
    const fields = Object.keys(offer).sort();
    return JSON.stringify(fields) === JSON.stringify(REQUIRED_CTA_OFFER_FIELDS)
      && offer.status === 'DRAFT'
      && offer.action === 'NO_EXTERNAL_ACTION'
      && ALLOWED_CTA_INTENTS.has(offer.intent)
      && typeof offer.displayCopy === 'string'
      && offer.displayCopy.length > 0
      && offer.displayCopy.length <= 96
      && !/(?:https?:\/\/|javascript:|data:|mailto:|tel:|\/\/[^\s])/i.test(offer.displayCopy)
      && ID_PATTERN.test(offer.ctaId)
      && ID_PATTERN.test(offer.offerId);
  });
  const checks = Object.freeze([
    result('duration', variant?.durationMs === STREAM_SALE_SHOW_DURATION_MS ? 'PASS' : 'STOP', variant?.durationMs ?? null, STREAM_SALE_SHOW_DURATION_MS),
    result('segment-roles', JSON.stringify(segments.map((segment) => segment?.role)) === JSON.stringify(REQUIRED_ROLES) ? 'PASS' : 'STOP', segments.map((segment) => segment?.role), REQUIRED_ROLES),
    result('segment-continuity', segmentsContiguous ? 'PASS' : 'STOP', segmentsContiguous, true),
    result('hook-reference', segments.some((segment) => segment.id === variant?.hook?.segmentId) ? 'PASS' : 'STOP', variant?.hook?.segmentId ?? null, 'known segment ID'),
    result('scene-order', sceneCues.length > 0 && sortedStrictlyBy(sceneCues, 'atMs') ? 'PASS' : 'STOP', sceneCues.length, '> 0 strictly ordered cues'),
    result('scene-allowlist', sceneCues.every((cue) => allowedScenes.has(cue?.scene)) && segments.every((segment) => allowedScenes.has(segment?.primaryScene)) ? 'PASS' : 'STOP', sceneCues.map((cue) => cue?.scene), [...allowedScenes]),
    result('voice-order', voiceCues.length === segments.length && sortedStrictlyBy(voiceCues, 'atMs') ? 'PASS' : 'STOP', voiceCues.length, `${segments.length} ordered cues`),
    result('voice-contract', voiceCues.every((cue) => cue?.fixture === 'voice:synthetic-ui-loop' && ALLOWED_VOICE_STATES.has(cue?.state)) ? 'PASS' : 'STOP', voiceCues.map((cue) => cue?.fixture), 'synthetic visual voice fixtures'),
    result('voice-references', segments.every((segment) => voiceCues.some((cue) => cue.id === segment.syntheticVoiceCueId)) ? 'PASS' : 'STOP', segments.map((segment) => segment?.syntheticVoiceCueId), 'known voice cue per segment'),
    result('draft-offers', localDraftOffers ? 'PASS' : 'STOP', localDraftOffers, true),
    result('cta-ids', unique(ctaIds) && unique(offerIds) ? 'PASS' : 'STOP', { cta: ctaIds.length, offers: offerIds.length }, 'unique per segment'),
    result('clip-contract', clipsBounded ? 'PASS' : 'STOP', clips.length, 'exactly 5 bounded, scene-stable clips'),
    result('clip-cta-reference', clips.every((clip) => ctaIds.includes(clip?.ctaId)) ? 'PASS' : 'STOP', clips.map((clip) => clip?.ctaId), 'known CTA IDs'),
    result('fallback-reference', segments.every((segment) => segment?.fallbackId === fallback?.id) ? 'PASS' : 'STOP', fallback?.id ?? null, 'single fallback referenced by every segment'),
    result('fallback-stop', JSON.stringify(fallback?.actions) === JSON.stringify(REQUIRED_FALLBACK_ACTIONS)
      && fallback?.resume === 'FORBIDDEN_IN_SAME_TAKE' ? 'PASS' : 'STOP', fallback?.actions ?? [], 'SAFE + local stop + zero external actions + no resume'),
  ]);
  return Object.freeze({
    id: String(variant?.id ?? 'UNKNOWN').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64),
    status: checks.every((check) => check.status === 'PASS') ? 'PASS' : 'STOP',
    checks,
  });
}

export function validateSaleShowVariants(manifest) {
  const variants = Array.isArray(manifest?.variants) ? manifest.variants : [];
  const allowedScenes = new Set(Array.isArray(manifest?.allowedScenes) ? manifest.allowedScenes : []);
  const variantResults = Object.freeze(variants.map((variant) => validateVariant(variant, allowedScenes)));
  const definitionIds = variants.flatMap((variant) => [
    variant?.id,
    variant?.failClosedFallback?.id,
    ...(variant?.segments ?? []).flatMap((segment) => [segment?.id, segment?.ctaOffer?.ctaId, segment?.ctaOffer?.offerId]),
    ...(variant?.sceneCues ?? []).map((cue) => cue?.id),
    ...(variant?.voiceCues ?? []).map((cue) => cue?.id),
    ...(variant?.clips ?? []).map((clip) => clip?.id),
  ]);
  const serialized = JSON.stringify(manifest ?? {});
  const checks = Object.freeze([
    result('schema', manifest?.schemaVersion === STREAM_SALE_SHOW_SCHEMA_VERSION ? 'PASS' : 'STOP', manifest?.schemaVersion ?? null, STREAM_SALE_SHOW_SCHEMA_VERSION),
    result('scope', manifest?.scope === 'LOCAL_SYNTHETIC_DRAFT_ONLY' ? 'PASS' : 'STOP', manifest?.scope ?? null, 'LOCAL_SYNTHETIC_DRAFT_ONLY'),
    result('duration', manifest?.durationMs === STREAM_SALE_SHOW_DURATION_MS ? 'PASS' : 'STOP', manifest?.durationMs ?? null, STREAM_SALE_SHOW_DURATION_MS),
    result('variants', JSON.stringify(variants.map((variant) => variant?.id)) === JSON.stringify(REQUIRED_VARIANTS) ? 'PASS' : 'STOP', variants.map((variant) => variant?.id), REQUIRED_VARIANTS),
    result('policy', manifest?.policy?.publicTransmission === false
      && manifest?.policy?.externalAction === 'DENY'
      && manifest?.policy?.ctaStatus === 'DRAFT'
      && manifest?.policy?.offerStatus === 'DRAFT'
      && manifest?.policy?.paymentAction === 'NONE'
      && manifest?.policy?.microphone === 'NOT_TESTED' ? 'PASS' : 'STOP', manifest?.policy ?? null, 'local draft / no action / no payment / no mic claim'),
    result('definition-ids', definitionIds.every((id) => ID_PATTERN.test(id)) && unique(definitionIds) ? 'PASS' : 'STOP', definitionIds.length, 'globally unique safe IDs'),
    result('no-url-or-secret-shape', !/https?:\/\/|javascript:|data:|mailto:|tel:|\/\/[^\s]|www\.|@|sk-(?:proj|live|test)-|bearer\s/i.test(serialized) ? 'PASS' : 'STOP', 'redacted manifest', 'no URL, contact or credential shape'),
    result('variant-contracts', variantResults.every((entry) => entry.status === 'PASS') ? 'PASS' : 'STOP', variantResults.map(({ id, status }) => ({ id, status })), 'all PASS'),
  ]);
  return Object.freeze({
    status: checks.every((check) => check.status === 'PASS') ? 'PASS' : 'STOP',
    checks,
    variants: variantResults,
  });
}

export function validateAttributionShowMapping(attribution, shows) {
  const showValidation = validateSaleShowVariants(shows);
  if (showValidation.status !== 'PASS') {
    const checks = Object.freeze([
      result('show-contract', 'STOP', showValidation.status, 'PASS'),
      result('variant-allowlist', 'STOP', null, 'valid show contract'),
      result('segment-allowlist', 'STOP', null, 'valid show contract'),
      result('offer-allowlist', 'STOP', null, 'valid show contract'),
      result('primary-mapping', 'STOP', null, 'valid show contract'),
      result('positive-event-mapping', 'STOP', null, 'valid show contract'),
    ]);
    return Object.freeze({ status: 'STOP', checks });
  }
  const variants = Array.isArray(shows?.variants) ? shows.variants : [];
  const showVariantIds = variants.map((variant) => variant.id);
  const showSegmentIds = variants.flatMap((variant) => variant.segments.map((segment) => segment.id));
  const showOfferIds = variants.flatMap((variant) => variant.segments.map((segment) => segment.ctaOffer.offerId));
  const mapping = attribution?.attributionMapping ?? {};
  const allowed = attribution?.allowed ?? {};
  const positiveEvents = [
    ...(attribution?.corpora?.baseline?.events ?? []),
    ...(attribution?.corpora?.current?.events ?? []),
  ];
  const mappingValid = variants.every((variant) => {
    const expected = mapping[variant.id];
    const primarySegment = variant.segments.find((segment) => segment.role === 'CTA');
    return expected
      && primarySegment?.id === expected.primarySegmentId
      && primarySegment?.ctaOffer?.offerId === expected.primaryOfferId
      && allowed.campaignIds?.includes(expected.campaignId);
  });
  const positiveEventsMapped = positiveEvents.every((event) => {
    const expected = mapping[event.variantId];
    return expected
      && event.segmentId === expected.primarySegmentId
      && event.offerId === expected.primaryOfferId
      && event.campaignId === expected.campaignId;
  });
  const checks = Object.freeze([
    result('show-contract', showValidation.status, showValidation.status, 'PASS'),
    result('variant-allowlist', JSON.stringify(allowed.variantIds) === JSON.stringify(showVariantIds) ? 'PASS' : 'STOP', allowed.variantIds ?? null, showVariantIds),
    result('segment-allowlist', JSON.stringify(allowed.segmentIds) === JSON.stringify(showSegmentIds) ? 'PASS' : 'STOP', allowed.segmentIds?.length ?? null, showSegmentIds.length),
    result('offer-allowlist', JSON.stringify(allowed.offerIds) === JSON.stringify(showOfferIds) ? 'PASS' : 'STOP', allowed.offerIds?.length ?? null, showOfferIds.length),
    result('primary-mapping', mappingValid ? 'PASS' : 'STOP', Object.keys(mapping), showVariantIds),
    result('positive-event-mapping', positiveEventsMapped ? 'PASS' : 'STOP', positiveEvents.length, 'all positive events match variant primary CTA/offer/campaign'),
  ]);
  return Object.freeze({
    status: checks.every((check) => check.status === 'PASS') ? 'PASS' : 'STOP',
    checks,
  });
}
