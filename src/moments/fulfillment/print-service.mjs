import { FULFILLMENT_TYPE, getProduct } from "../commerce/catalog.mjs";
import { MOMENT_STATUS } from "../contracts.mjs";
import { PrintFulfillmentError } from "./gelato-provider.mjs";

export function createPrintFulfillmentService({ provider, repo, assetUrlSigner, analytics = null }) {
  if (!provider || !repo || !assetUrlSigner) throw new Error("provider, repo and assetUrlSigner are required");

  async function createOrderForPaidPurchase(purchaseId) {
    const purchase = await repo.getPurchase(purchaseId);
    if (!purchase) throw new PrintFulfillmentError("PURCHASE_NOT_FOUND", "Purchase not found");
    const product = getProduct(purchase.productType);
    if (product.fulfillmentType !== FULFILLMENT_TYPE.PRINT) {
      throw new PrintFulfillmentError("PURCHASE_NOT_PRINT", "Purchase is not a print product");
    }
    if (!["PAID", "FULFILLING", "FULFILLED"].includes(purchase.fulfillmentStatus)) {
      throw new PrintFulfillmentError("PAYMENT_REQUIRED", "Print order requires verified paid purchase");
    }

    const moment = await repo.getMoment(purchase.momentId);
    if (!moment || moment.userId !== purchase.userId) {
      throw new PrintFulfillmentError("MOMENT_OWNERSHIP_MISMATCH", "Purchase/Moment ownership mismatch");
    }
    if (!moment.printAsset) throw new PrintFulfillmentError("PRINT_ASSET_NOT_READY", "Validated print master is required");
    if (!purchase.shippingAddress?.country) throw new PrintFulfillmentError("SHIPPING_ADDRESS_REQUIRED", "Shipping address is required");

    await provider.validateProduct({ country: purchase.shippingAddress.country });

    const claim = await repo.claimPrintOrder({
      purchaseId: purchase.id,
      momentId: moment.id,
      provider: provider.name,
      idempotencyKey: `birdie-moments:print:${purchase.id}`
    });
    const printOrder = claim.order;

    if (!claim.created && printOrder.providerOrderReference) {
      return { ok: true, duplicatePrevented: true, printOrder };
    }

    await repo.markPurchaseFulfillment({ purchaseId: purchase.id, status: "FULFILLING" });

    try {
      const printAssetUrl = await assetUrlSigner.signProviderAsset({
        assetReference: moment.printAsset,
        provider: provider.name,
        purchaseId: purchase.id,
        momentId: moment.id
      });

      const created = await provider.createOrder({
        internalOrderId: printOrder.id,
        purchaseId: purchase.id,
        momentId: moment.id,
        userId: purchase.userId,
        printAssetUrl,
        recipient: purchase.shippingAddress
      });

      const saved = await repo.attachProviderOrder({
        printOrderId: printOrder.id,
        providerOrderReference: created.providerOrderReference,
        status: created.status || "created"
      });
      await repo.markPurchaseFulfillment({
        purchaseId: purchase.id,
        status: "FULFILLING",
        reference: created.providerOrderReference
      });
      return { ok: true, duplicatePrevented: created.recovered === true, printOrder: saved };
    } catch (error) {
      await repo.markPrintOrderFailed?.({ printOrderId: printOrder.id, reason: error?.code || "PROVIDER_CREATE_FAILED" });
      await repo.markPurchaseFulfillment({ purchaseId: purchase.id, status: "FULFILLMENT_FAILED" });
      await analytics?.track?.("fulfillment_failed", { purchaseId: purchase.id, momentId: moment.id, provider: provider.name });
      return { ok: false, status: "FULFILLMENT_FAILED", reason: error?.code || "PROVIDER_CREATE_FAILED" };
    }
  }

  async function handleWebhook(rawEvent) {
    const event = await provider.handleWebhook(rawEvent);
    if (await repo.hasProcessedWebhook(provider.name, event.eventId)) {
      return { ok: true, duplicatePrevented: true };
    }
    if (!event.internalOrderId) throw new PrintFulfillmentError("WEBHOOK_ORDER_REFERENCE_MISSING", "Webhook has no internal order reference");

    const printOrder = await repo.getPrintOrder(event.internalOrderId);
    if (!printOrder) throw new PrintFulfillmentError("PRINT_ORDER_NOT_FOUND", "Print order not found");

    await repo.updatePrintOrderFromWebhook({
      printOrderId: printOrder.id,
      providerOrderReference: event.providerOrderReference,
      status: event.fulfillmentStatus,
      eventId: event.eventId
    });
    await repo.recordProcessedWebhook({ provider: provider.name, eventId: event.eventId, printOrderId: printOrder.id });

    if (["failed", "canceled"].includes(event.fulfillmentStatus)) {
      await repo.markPurchaseFulfillment({ purchaseId: printOrder.purchaseId, status: "FULFILLMENT_FAILED", reference: event.providerOrderReference });
      await analytics?.track?.("fulfillment_failed", { purchaseId: printOrder.purchaseId, provider: provider.name });
    }
    if (["printed", "shipped"].includes(event.fulfillmentStatus)) {
      await repo.markPurchaseFulfillment({ purchaseId: printOrder.purchaseId, status: "FULFILLED", reference: event.providerOrderReference });
      await repo.setMomentStatus?.(printOrder.momentId, MOMENT_STATUS.FULFILLED);
    }
    return { ok: true, duplicatePrevented: false, status: event.fulfillmentStatus };
  }

  return Object.freeze({ createOrderForPaidPurchase, handleWebhook });
}
