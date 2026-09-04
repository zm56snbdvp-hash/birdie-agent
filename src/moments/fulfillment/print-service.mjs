import { FULFILLMENT_TYPE, getProduct } from "../commerce/catalog.mjs";
import { MOMENT_STATUS } from "../contracts.mjs";
import { PrintFulfillmentError } from "./gelato-provider.mjs";

const PRINT_ORDER_STATUS = Object.freeze({
  PENDING_SUBMISSION: "PENDING_SUBMISSION",
  SUBMITTED: "SUBMITTED",
  IN_PRODUCTION: "IN_PRODUCTION",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  FULFILLMENT_FAILED: "FULFILLMENT_FAILED",
  CANCELLED: "CANCELLED"
});

function value(record, camel, snake) { return record?.[camel] ?? record?.[snake] ?? null; }
function paymentStatus(purchase) { return value(purchase, "paymentStatus", "payment_status"); }
function fulfillmentStatus(purchase) { return value(purchase, "fulfillmentStatus", "fulfillment_status"); }
function productType(purchase) { return value(purchase, "productType", "product_type"); }
function shippingAddress(purchase) { return value(purchase, "shippingAddress", "shipping_address"); }
function momentId(purchase) { return value(purchase, "momentId", "moment_id"); }
function userId(purchase) { return value(purchase, "userId", "user_id"); }

function paidState(purchase) {
  const explicit = paymentStatus(purchase);
  if (explicit) return explicit === "PAID";
  // Transitional compatibility for pre-integration test/storage rows only.
  return ["PAID", "FULFILLING", "FULFILLED", "FULFILLMENT_FAILED"].includes(fulfillmentStatus(purchase));
}

function normalizedFulfillmentStatus(purchase) {
  const status = fulfillmentStatus(purchase);
  return status === "PAID" ? "AWAITING_ORDER" : status;
}

function mapProviderStatus(status) {
  switch (String(status ?? "").toLowerCase()) {
    case "created":
    case "uploading":
    case "passed":
    case "draft":
    case "pending_approval":
    case "pending_personalization":
    case "digitizing":
    case "not_connected":
    case "on_hold":
      return PRINT_ORDER_STATUS.SUBMITTED;
    case "in_production":
    case "printed":
      return PRINT_ORDER_STATUS.IN_PRODUCTION;
    case "shipped":
    case "in_transit":
      return PRINT_ORDER_STATUS.SHIPPED;
    case "delivered":
      return PRINT_ORDER_STATUS.DELIVERED;
    case "failed":
    case "refused":
    case "returned":
      return PRINT_ORDER_STATUS.FULFILLMENT_FAILED;
    case "canceled":
    case "cancelled":
      return PRINT_ORDER_STATUS.CANCELLED;
    default:
      return PRINT_ORDER_STATUS.SUBMITTED;
  }
}

function isTerminalFailure(status) {
  return status === PRINT_ORDER_STATUS.FULFILLMENT_FAILED || status === PRINT_ORDER_STATUS.CANCELLED;
}

export function createPrintFulfillmentService({
  provider,
  repo,
  assetUrlSigner,
  analytics = null,
  now = () => new Date().toISOString()
}) {
  if (!provider || !repo || !assetUrlSigner) throw new Error("provider, repo and assetUrlSigner are required");

  async function createOrderForPaidPurchase(purchaseId) {
    const purchase = await repo.getPurchase(purchaseId);
    if (!purchase) throw new PrintFulfillmentError("PURCHASE_NOT_FOUND", "Purchase not found");

    const product = getProduct(productType(purchase));
    if (product.fulfillmentType !== FULFILLMENT_TYPE.PRINT) {
      throw new PrintFulfillmentError("PURCHASE_NOT_PRINT", "Purchase is not a print product");
    }
    if (!paidState(purchase)) {
      throw new PrintFulfillmentError("PAYMENT_REQUIRED", "Print order requires verified paid purchase");
    }

    const currentFulfillmentStatus = normalizedFulfillmentStatus(purchase);
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

    const claim = await repo.claimPrintOrder({
      purchaseId: purchase.id,
      userId: ownedUserId,
      momentId: moment.id,
      provider: provider.name,
      status: PRINT_ORDER_STATUS.PENDING_SUBMISSION,
      idempotencyKey: `birdie-moments:print:${purchase.id}`,
      createdAt: now(),
      updatedAt: now()
    });
    const printOrder = claim.order;
    if (!printOrder?.id) throw new PrintFulfillmentError("PRINT_ORDER_CLAIM_FAILED", "Print order claim failed");

    const existingProviderRef = printOrder.providerOrderReference ?? printOrder.provider_order_reference;
    if (!claim.created && existingProviderRef) {
      return { ok: true, duplicatePrevented: true, printOrder };
    }

    // A UNIQUE purchase row prevents duplicate internal orders but not two workers
    // racing between provider search and provider create. Canonical runtime adapters
    // therefore provide claimPrintSubmission(), an atomic short lease. Direct legacy
    // unit fixtures without it retain backward compatibility; the production runtime
    // explicitly refuses to initialize without the lease capability.
    if (typeof repo.claimPrintSubmission === "function") {
      const lease = await repo.claimPrintSubmission({
        printOrderId: printOrder.id,
        purchaseId: purchase.id,
        leaseKey: `birdie-moments:print-submit:${printOrder.id}`,
        now: now(),
        leaseSeconds: 90
      });
      const acquired = lease === true || lease?.acquired === true;
      if (!acquired) {
        return { ok: true, duplicatePrevented: true, inProgress: true, printOrder };
      }
    }

    await repo.markPurchaseFulfillment({ purchaseId: purchase.id, status: "FULFILLING" });

    try {
      await provider.validateProduct({ country: address.country });
      const printAssetUrl = await assetUrlSigner.signProviderAsset({
        assetReference: printAsset,
        provider: provider.name,
        purchaseId: purchase.id,
        momentId: moment.id
      });
      if (!printAssetUrl) {
        throw new PrintFulfillmentError("PRINT_ASSET_URL_UNAVAILABLE", "Provider asset URL is unavailable");
      }

      const created = await provider.createOrder({
        internalOrderId: printOrder.id,
        purchaseId: purchase.id,
        momentId: moment.id,
        userId: ownedUserId,
        printAssetUrl,
        recipient: address
      });

      const orderStatus = mapProviderStatus(created.status);
      const saved = await repo.attachProviderOrder({
        printOrderId: printOrder.id,
        providerOrderReference: created.providerOrderReference,
        status: orderStatus,
        updatedAt: now()
      });
      await repo.markPurchaseFulfillment({
        purchaseId: purchase.id,
        status: "FULFILLING",
        reference: created.providerOrderReference
      });
      return {
        ok: true,
        duplicatePrevented: created.recovered === true,
        recoveredProviderOrder: created.recovered === true,
        printOrder: saved ?? printOrder
      };
    } catch (error) {
      await repo.markPrintOrderFailed?.({
        printOrderId: printOrder.id,
        purchaseId: purchase.id,
        reason: error?.code || "PROVIDER_CREATE_FAILED",
        updatedAt: now()
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
    if (!printOrder || (printOrder.provider ?? printOrder.provider_name) !== provider.name) {
      throw new PrintFulfillmentError("PRINT_ORDER_NOT_FOUND", "Print order not found");
    }

    const providerRef = printOrder.providerOrderReference
      ?? printOrder.provider_order_reference
      ?? event.providerOrderReference;
    if (!providerRef) {
      throw new PrintFulfillmentError("PRINT_PROVIDER_REFERENCE_MISSING", "Provider order reference is missing");
    }

    // Provider webhook is a signal, not fulfillment authority. Canonical runtime
    // requires getOrderStatus(); legacy direct fixtures may fall back to the event.
    let providerStatus;
    let verifiedProviderReference = providerRef;
    if (typeof provider.getOrderStatus === "function") {
      const verified = await provider.getOrderStatus(providerRef);
      if (verified.orderReferenceId && verified.orderReferenceId !== printOrder.id) {
        throw new PrintFulfillmentError(
          "PRINT_PROVIDER_INTEGRITY_MISMATCH",
          "Provider order belongs to a different internal order"
        );
      }
      providerStatus = verified.fulfillmentStatus;
      verifiedProviderReference = verified.providerOrderReference ?? providerRef;
    } else {
      providerStatus = event.claimedStatus ?? event.fulfillmentStatus;
    }

    const status = mapProviderStatus(providerStatus);
    await repo.updatePrintOrderFromWebhook({
      printOrderId: printOrder.id,
      providerOrderReference: verifiedProviderReference,
      status,
      providerStatus,
      eventId: event.eventId,
      updatedAt: now()
    });
    await repo.recordProcessedWebhook({
      provider: provider.name,
      eventId: event.eventId,
      printOrderId: printOrder.id,
      processedAt: now()
    });

    if (isTerminalFailure(status)) {
      await repo.markPurchaseFulfillment({
        purchaseId: printOrder.purchaseId,
        status: "FULFILLMENT_FAILED",
        reference: verifiedProviderReference
      });
      await analytics?.track?.("fulfillment_failed", {
        purchaseId: printOrder.purchaseId,
        provider: provider.name,
        reason: providerStatus ?? status
      });
    } else if ([PRINT_ORDER_STATUS.SUBMITTED, PRINT_ORDER_STATUS.IN_PRODUCTION, PRINT_ORDER_STATUS.SHIPPED].includes(status)) {
      await repo.markPurchaseFulfillment({
        purchaseId: printOrder.purchaseId,
        status: "FULFILLING",
        reference: verifiedProviderReference
      });
    } else if (status === PRINT_ORDER_STATUS.DELIVERED) {
      await repo.markPurchaseFulfillment({
        purchaseId: printOrder.purchaseId,
        status: "FULFILLED",
        reference: verifiedProviderReference
      });
      await repo.setMomentStatus?.(printOrder.momentId, MOMENT_STATUS.FULFILLED);
    }

    return {
      ok: true,
      duplicatePrevented: false,
      status,
      verifiedProviderStatus: providerStatus
    };
  }

  return Object.freeze({ createOrderForPaidPurchase, handleWebhook });
}
