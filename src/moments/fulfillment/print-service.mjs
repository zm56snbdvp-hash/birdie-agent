import { FULFILLMENT_TYPE, getProduct } from "../commerce/catalog.mjs";
import { MOMENT_STATUS } from "../contracts.mjs";
import { PrintFulfillmentError } from "./gelato-provider.mjs";

function value(record, camel, snake) {
  return record?.[camel] ?? record?.[snake] ?? null;
}

function paymentStatus(purchase) {
  return value(purchase, "paymentStatus", "payment_status");
}

function fulfillmentStatus(purchase) {
  return value(purchase, "fulfillmentStatus", "fulfillment_status");
}

function productType(purchase) {
  return value(purchase, "productType", "product_type");
}

function shippingAddress(purchase) {
  return value(purchase, "shippingAddress", "shipping_address");
}

function momentId(purchase) {
  return value(purchase, "momentId", "moment_id");
}

function userId(purchase) {
  return value(purchase, "userId", "user_id");
}

export function createPrintFulfillmentService({ provider, repo, assetUrlSigner, analytics = null }) {
  if (!provider || !repo || !assetUrlSigner) throw new Error("provider, repo and assetUrlSigner are required");

  async function createOrderForPaidPurchase(purchaseId) {
    const purchase = await repo.getPurchase(purchaseId);
    if (!purchase) throw new PrintFulfillmentError("PURCHASE_NOT_FOUND", "Purchase not found");

    const product = getProduct(productType(purchase));
    if (product.fulfillmentType !== FULFILLMENT_TYPE.PRINT) {
      throw new PrintFulfillmentError("PURCHASE_NOT_PRINT", "Purchase is not a print product");
    }
    if (paymentStatus(purchase) !== "PAID") {
      throw new PrintFulfillmentError("PAYMENT_REQUIRED", "Print order requires verified paid purchase");
    }

    const currentFulfillmentStatus = fulfillmentStatus(purchase);
    if (!["AWAITING_ORDER", "FULFILLING", "FULFILLED", "FULFILLMENT_FAILED"].includes(currentFulfillmentStatus)) {
      throw new PrintFulfillmentError(
        "PRINT_PURCHASE_NOT_READY",
        `Print purchase cannot be fulfilled from ${currentFulfillmentStatus || "UNKNOWN"}`
      );
    }

    const ownedMomentId = momentId(purchase);
    const ownedUserId = userId(purchase);
    const moment = await repo.getMoment(ownedMomentId);
    if (!moment || (moment.userId ?? moment.user_id) !== ownedUserId) {
      throw new PrintFulfillmentError("MOMENT_OWNERSHIP_MISMATCH", "Purchase/Moment ownership mismatch");
    }

    const printAsset = moment.printAsset ?? moment.print_asset;
    if (!printAsset) throw new PrintFulfillmentError("PRINT_ASSET_NOT_READY", "Validated print master is required");

    const address = shippingAddress(purchase);
    if (!address?.country) throw new PrintFulfillmentError("SHIPPING_ADDRESS_REQUIRED", "Shipping address is required");

    await provider.validateProduct({ country: address.country });

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

    // A retry after FULFILLMENT_FAILED intentionally reuses the exact same
    // internal print-order claim. The provider adapter performs a remote
    // orderReferenceId lookup before any create call, covering crash/retry gaps.
    await repo.markPurchaseFulfillment({ purchaseId: purchase.id, status: "FULFILLING" });

    try {
      const printAssetUrl = await assetUrlSigner.signProviderAsset({
        assetReference: printAsset,
        provider: provider.name,
        purchaseId: purchase.id,
        momentId: moment.id
      });

      const created = await provider.createOrder({
        internalOrderId: printOrder.id,
        purchaseId: purchase.id,
        momentId: moment.id,
        userId: ownedUserId,
        printAssetUrl,
        recipient: address
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
      await repo.markPrintOrderFailed?.({
        printOrderId: printOrder.id,
        reason: error?.code || "PROVIDER_CREATE_FAILED"
      });
      await repo.markPurchaseFulfillment({ purchaseId: purchase.id, status: "FULFILLMENT_FAILED" });
      await analytics?.track?.("fulfillment_failed", {
        purchaseId: purchase.id,
        momentId: moment.id,
        provider: provider.name,
        reason: error?.code || "PROVIDER_CREATE_FAILED"
      });
      return { ok: false, status: "FULFILLMENT_FAILED", reason: error?.code || "PROVIDER_CREATE_FAILED" };
    }
  }

  async function handleWebhook(rawEvent) {
    const event = await provider.handleWebhook(rawEvent);
    if (await repo.hasProcessedWebhook(provider.name, event.eventId)) {
      return { ok: true, duplicatePrevented: true };
    }
    if (!event.internalOrderId) {
      throw new PrintFulfillmentError("WEBHOOK_ORDER_REFERENCE_MISSING", "Webhook has no internal order reference");
    }

    const printOrder = await repo.getPrintOrder(event.internalOrderId);
    if (!printOrder) throw new PrintFulfillmentError("PRINT_ORDER_NOT_FOUND", "Print order not found");

    await repo.updatePrintOrderFromWebhook({
      printOrderId: printOrder.id,
      providerOrderReference: event.providerOrderReference,
      status: event.fulfillmentStatus,
      eventId: event.eventId
    });
    await repo.recordProcessedWebhook({
      provider: provider.name,
      eventId: event.eventId,
      printOrderId: printOrder.id
    });

    if (["failed", "canceled"].includes(event.fulfillmentStatus)) {
      await repo.markPurchaseFulfillment({
        purchaseId: printOrder.purchaseId,
        status: "FULFILLMENT_FAILED",
        reference: event.providerOrderReference
      });
      await analytics?.track?.("fulfillment_failed", {
        purchaseId: printOrder.purchaseId,
        provider: provider.name,
        reason: event.fulfillmentStatus
      });
    }

    if (["printed", "shipped", "delivered"].includes(event.fulfillmentStatus)) {
      await repo.markPurchaseFulfillment({
        purchaseId: printOrder.purchaseId,
        status: "FULFILLED",
        reference: event.providerOrderReference
      });
      await repo.setMomentStatus?.(printOrder.momentId, MOMENT_STATUS.FULFILLED);
    }

    return { ok: true, duplicatePrevented: false, status: event.fulfillmentStatus };
  }

  return Object.freeze({ createOrderForPaidPurchase, handleWebhook });
}
