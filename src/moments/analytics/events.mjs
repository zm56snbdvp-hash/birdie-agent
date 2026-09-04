export const MOMENT_ANALYTICS_EVENT = Object.freeze({
  MOMENT_GENERATED: "moment_generated",
  MOMENT_PREVIEW_VIEWED: "moment_preview_viewed",
  MOMENT_OFFER_CLOSED: "moment_offer_closed",
  DIGITAL_PURCHASE_STARTED: "digital_purchase_started",
  DIGITAL_PURCHASE_COMPLETED: "digital_purchase_completed",
  PRINT_PURCHASE_STARTED: "print_purchase_started",
  PRINT_PURCHASE_COMPLETED: "print_purchase_completed",
  MOMENT_GENERATION_FAILED: "moment_generation_failed",
  FULFILLMENT_FAILED: "fulfillment_failed"
});

const ALLOWED_EVENT_NAMES = new Set(Object.values(MOMENT_ANALYTICS_EVENT));
const ALLOWED_FIELDS = new Set([
  "userId",
  "roundId",
  "momentId",
  "momentType",
  "templateVersion",
  "productType",
  "fulfillmentType",
  "purchaseId",
  "amountMinor",
  "currency",
  "status",
  "reason"
]);

export function sanitizeMomentAnalyticsPayload(payload = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (value === undefined || value === null) continue;
    clean[key] = value;
  }
  return Object.freeze(clean);
}

export async function emitMomentAnalytics(analytics, eventName, payload = {}) {
  if (!ALLOWED_EVENT_NAMES.has(eventName)) {
    throw new Error(`Unsupported Birdie Moments analytics event: ${eventName}`);
  }
  if (!analytics?.track) return { emitted: false, eventName };

  const sanitized = sanitizeMomentAnalyticsPayload(payload);
  await analytics.track(eventName, sanitized);
  return { emitted: true, eventName, payload: sanitized };
}
