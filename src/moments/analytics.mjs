export const MOMENT_ANALYTICS_EVENT = Object.freeze({
  GENERATED: "moment_generated",
  PREVIEW_VIEWED: "moment_preview_viewed",
  OFFER_CLOSED: "moment_offer_closed",
  DIGITAL_STARTED: "digital_purchase_started",
  DIGITAL_COMPLETED: "digital_purchase_completed",
  PRINT_STARTED: "print_purchase_started",
  PRINT_COMPLETED: "print_purchase_completed",
  GENERATION_FAILED: "moment_generation_failed",
  FULFILLMENT_FAILED: "fulfillment_failed"
});

const ALLOWED = new Set(Object.values(MOMENT_ANALYTICS_EVENT));
const FORBIDDEN_KEYS = /card|iban|secret|token|client_secret|payment_method|cvv|cvc/i;

export function createMomentAnalytics(sink) {
  return Object.freeze({
    async track(event, properties = {}) {
      if (!ALLOWED.has(event)) throw new Error(`Unsupported Birdie Moments analytics event: ${event}`);
      for (const key of Object.keys(properties)) {
        if (FORBIDDEN_KEYS.test(key)) throw new Error(`Sensitive analytics key rejected: ${key}`);
      }
      return sink.track(event, properties);
    }
  });
}
