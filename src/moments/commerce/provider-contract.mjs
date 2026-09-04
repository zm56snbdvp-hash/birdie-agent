/**
 * PaymentProvider contract for Birdie Moments v1.
 *
 * provider.name: stable identifier for the existing BirdieWorld real-money provider.
 * provider.createCheckoutSession(input):
 *   -> { checkoutReference, redirectUrl }
 * provider.verifyWebhook({ rawBody, headers }):
 *   -> {
 *        eventId,
 *        type: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'IGNORED',
 *        checkoutReference,
 *        paymentReference,
 *        amountMinor,
 *        currency,
 *        metadata,
 *        failureCode?
 *      }
 *
 * verifyWebhook MUST verify the provider signature before returning an event.
 */
export function assertPaymentProvider(provider) {
  if (
    !provider?.name ||
    typeof provider.createCheckoutSession !== "function" ||
    typeof provider.verifyWebhook !== "function"
  ) {
    throw new TypeError("PaymentProvider is not configured");
  }
  return provider;
}
