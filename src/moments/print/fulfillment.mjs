import { MomentCommerceError } from "../commerce/contracts.mjs";
import { assertPrintPurchaseReady, internalPrintOrderKey, PRINT_ORDER_STATUS, validateShippingAddress } from "./contracts.mjs";

/**
 * Required print provider contract:
 * - name: stable provider name
 * - validateProduct({ productType, printAsset, format })
 * - createOrder({ idempotencyKey, productType, printAsset, format, recipient, address, metadata })
 * - getOrderStatus(providerOrderId)
 * - handleWebhook({ rawBody, signature }) -> verified normalized event
 */
export async function submitPaidPrintOrder({ purchaseId, repo, printProvider, now = () => new Date().toISOString() }) {
  const purchase = await repo.getPurchase(purchaseId);
  if (!purchase) throw new MomentCommerceError("PURCHASE_NOT_FOUND", "Print purchase not found", 404);
  const moment = await repo.getMoment(purchase.momentId);
  const printAsset = assertPrintPurchaseReady(purchase, moment);
  const address = validateShippingAddress(purchase.shippingAddress ?? purchase.shipping_address);
  const key = internalPrintOrderKey(purchase.id);

  const existing = await repo.getPrintOrderByPurchaseId(purchase.id);
  if (existing?.providerOrderId) {
    return { submitted: true, duplicate: true, order: existing };
  }

  const order = existing ?? await repo.ensurePrintOrder({
    purchaseId: purchase.id,
    userId: purchase.userId,
    momentId: purchase.momentId,
    productType: purchase.productType,
    providerName: printProvider.name,
    status: PRINT_ORDER_STATUS.PENDING_SUBMISSION,
    recipientName: address.recipientName,
    address,
    printAsset,
    internalOrderKey: key,
    createdAt: now(),
    updatedAt: now()
  });

  try {
    await printProvider.validateProduct({ productType: purchase.productType, printAsset, format: "A3_PORTRAIT_300DPI" });
    const providerOrder = await printProvider.createOrder({
      idempotencyKey: key,
      productType: purchase.productType,
      printAsset,
      format: "A3_PORTRAIT_300DPI",
      recipient: address.recipientName,
      address,
      metadata: { purchase_id: purchase.id, moment_id: purchase.momentId, user_id: purchase.userId }
    });
    if (!providerOrder?.id) throw new Error("Print provider returned no order id");

    const submittedAt = now();
    const stored = await repo.markPrintOrderSubmitted({
      orderId: order.id,
      providerOrderId: providerOrder.id,
      status: PRINT_ORDER_STATUS.SUBMITTED,
      fulfillmentStatus: "SUBMITTED",
      updatedAt: submittedAt
    });
    return { submitted: true, duplicate: false, order: stored ?? { ...order, providerOrderId: providerOrder.id, status: PRINT_ORDER_STATUS.SUBMITTED } };
  } catch (error) {
    await repo.markPrintOrderFailed?.({
      orderId: order.id,
      purchaseId: purchase.id,
      status: PRINT_ORDER_STATUS.FULFILLMENT_FAILED,
      fulfillmentStatus: "FULFILLMENT_FAILED",
      failureCode: error?.code ?? "PRINT_PROVIDER_ERROR",
      failureMessage: String(error?.message ?? error),
      updatedAt: now()
    });
    return { submitted: false, duplicate: false, status: PRINT_ORDER_STATUS.FULFILLMENT_FAILED, error };
  }
}
