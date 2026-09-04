import { MomentCommerceError } from "../commerce/contracts.mjs";
import { MOMENT_FAILURE_STAGE, recordMomentFailureSafely } from "../failures.mjs";
import { PRINT_ORDER_STATUS } from "./contracts.mjs";

const STATUS_MAP = Object.freeze({
  ORDER_ACCEPTED: PRINT_ORDER_STATUS.SUBMITTED,
  IN_PRODUCTION: PRINT_ORDER_STATUS.IN_PRODUCTION,
  SHIPPED: PRINT_ORDER_STATUS.SHIPPED,
  DELIVERED: PRINT_ORDER_STATUS.DELIVERED,
  FAILED: PRINT_ORDER_STATUS.FULFILLMENT_FAILED,
  CANCELLED: PRINT_ORDER_STATUS.CANCELLED
});

export async function handlePrintProviderWebhook({
  rawBody,
  signature,
  repo,
  printProvider,
  analytics,
  now = () => new Date().toISOString()
}) {
  const event = await printProvider.handleWebhook({ rawBody, signature });
  if (!event?.id || !event?.providerOrderId || !event?.type) {
    throw new MomentCommerceError("INVALID_PRINT_PROVIDER_EVENT", "Verified print provider event is incomplete", 400);
  }

  const order = await repo.getPrintOrderByProviderOrderId(printProvider.name, event.providerOrderId);
  if (!order) throw new MomentCommerceError("PRINT_ORDER_NOT_FOUND", "Print order not found", 404);

  const claimed = await repo.claimPrintProviderEvent({
    providerName: printProvider.name,
    providerEventId: event.id,
    providerOrderId: event.providerOrderId,
    eventType: event.type,
    processedAt: now()
  });
  if (claimed?.duplicate === true) return { processed: true, duplicate: true };

  const status = STATUS_MAP[event.type];
  if (!status) return { processed: false, ignored: true, eventType: event.type };

  const result = await repo.updatePrintOrderStatus({
    orderId: order.id,
    purchaseId: order.purchaseId,
    status,
    fulfillmentStatus: status,
    trackingReference: event.trackingReference ?? null,
    failureCode: event.failureCode ?? null,
    failureMessage: event.failureMessage ?? null,
    updatedAt: now()
  });

  if (status === PRINT_ORDER_STATUS.FULFILLMENT_FAILED) {
    await recordMomentFailureSafely({
      repo,
      analytics,
      stage: MOMENT_FAILURE_STAGE.PRINT_FULFILLMENT,
      error: Object.assign(new Error(event.failureMessage ?? "Print provider reported fulfillment failure"), {
        code: event.failureCode ?? "PRINT_PROVIDER_FAILED"
      }),
      context: {
        momentId: order.momentId,
        purchaseId: order.purchaseId,
        productType: order.productType,
        fulfillmentType: "PRINT"
      }
    });
  }

  return { processed: true, duplicate: false, status, order: result ?? order };
}
