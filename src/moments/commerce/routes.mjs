import { startDigitalCheckout } from "./checkout.mjs";
import { getDigitalDownload } from "./download.mjs";
import { handlePaymentWebhook } from "./payment-webhook.mjs";

function errorResponse(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : 500,
    headers: { "Cache-Control": "private, no-store" },
    body: {
      error: error?.code || "BIRDIE_MOMENTS_COMMERCE_ERROR"
    }
  };
}

export async function handleDigitalCheckoutRequest(input) {
  try {
    const result = await startDigitalCheckout(input);
    return {
      status: result.status === "ALREADY_PURCHASED" ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
      body: result
    };
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleDigitalDownloadRequest(input) {
  try {
    return await getDigitalDownload(input);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * The framework adapter must pass the provider's raw request body and signature.
 * Parsing and trusting a client-authored JSON body before signature verification is forbidden.
 */
export async function handlePaymentWebhookRequest(input) {
  try {
    const result = await handlePaymentWebhook(input);
    return {
      status: 200,
      headers: { "Cache-Control": "no-store" },
      body: result
    };
  } catch (error) {
    return {
      status: Number.isInteger(error?.status) ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
      body: { error: error?.code || "PAYMENT_WEBHOOK_REJECTED" }
    };
  }
}
