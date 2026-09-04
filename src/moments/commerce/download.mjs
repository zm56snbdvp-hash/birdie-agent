import { getOwnedMoment } from "../ui/access.mjs";
import {
  FULFILLMENT_TYPE,
  PAYMENT_STATUS,
  MomentCommerceError,
  digitalProductTypeForMoment
} from "./contracts.mjs";

/**
 * Required repo contract:
 * - getMoment(momentId)
 * - getPurchaseForProduct({ userId, momentId, productType, fulfillmentType })
 *
 * Required asset signer contract:
 * - createSignedReadUrl({ assetRef, expiresInSeconds }) -> string
 */
export async function getDigitalDownload({
  authUserId,
  momentId,
  repo,
  assetSigner,
  expiresInSeconds = 300
}) {
  const moment = await getOwnedMoment({ momentId, authUserId, repo });
  const productType = digitalProductTypeForMoment(moment);
  const purchase = await repo.getPurchaseForProduct({
    userId: authUserId,
    momentId: moment.id,
    productType,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL
  });

  if (
    !purchase ||
    purchase.paymentStatus !== PAYMENT_STATUS.PAID ||
    !purchase.entitlementGrantedAt
  ) {
    throw new MomentCommerceError("DIGITAL_ENTITLEMENT_REQUIRED", "Paid digital entitlement required", 403);
  }

  const assetRef = moment.digitalAsset ?? moment.digital_asset ?? null;
  if (!assetRef) {
    throw new MomentCommerceError("DIGITAL_ASSET_NOT_READY", "Digital asset is not ready", 409);
  }

  const signedUrl = await assetSigner.createSignedReadUrl({
    assetRef,
    expiresInSeconds
  });

  if (typeof signedUrl !== "string" || !signedUrl) {
    throw new MomentCommerceError("SIGNED_URL_FAILED", "Digital download could not be authorized", 503);
  }

  return {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'"
    },
    body: {
      momentId: moment.id,
      purchaseId: purchase.id,
      downloadUrl: signedUrl,
      expiresInSeconds
    }
  };
}
