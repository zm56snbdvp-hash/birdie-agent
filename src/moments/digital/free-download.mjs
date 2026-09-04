import { MOMENT_STATUS } from "../contracts.mjs";
import { getOwnedMomentForOwnedRound, MomentAccessError } from "../ui/access.mjs";

const DOWNLOADABLE_STATUS = new Set([
  MOMENT_STATUS.PREVIEW_READY,
  MOMENT_STATUS.PURCHASED,
  MOMENT_STATUS.FULFILLED
]);

export class FreeMomentDownloadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "FreeMomentDownloadError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Birdie Moments Digital v1 has no payment or entitlement gate.
 * Access is still private and requires:
 * - authenticated Site user
 * - Moment ownership
 * - source-round ownership
 * - ready private Digital master
 * - signed, short-lived read URL
 */
export async function getFreePrivateMomentDownload({
  authUserId,
  momentId,
  repo,
  assetSigner,
  expiresInSeconds = 300
}) {
  const { moment } = await getOwnedMomentForOwnedRound({
    momentId,
    authUserId,
    repo
  });

  if (!DOWNLOADABLE_STATUS.has(moment.status)) {
    throw new FreeMomentDownloadError(
      "DIGITAL_MOMENT_NOT_READY",
      "Digital Moment is not ready for download",
      409
    );
  }

  const assetRef = moment.digitalAsset ?? moment.digital_asset ?? null;
  if (!assetRef) {
    throw new FreeMomentDownloadError(
      "DIGITAL_ASSET_NOT_READY",
      "Digital asset is not ready",
      409
    );
  }

  if (typeof assetSigner?.createSignedReadUrl !== "function") {
    throw new FreeMomentDownloadError(
      "SIGNED_URL_UNAVAILABLE",
      "Private asset signer is unavailable",
      503
    );
  }

  const signedUrl = await assetSigner.createSignedReadUrl({
    assetRef,
    expiresInSeconds
  });

  if (typeof signedUrl !== "string" || !signedUrl) {
    throw new FreeMomentDownloadError(
      "SIGNED_URL_FAILED",
      "Digital download could not be authorized",
      503
    );
  }

  return {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'"
    },
    body: {
      momentId: moment.id,
      access: "FREE_PRIVATE",
      paymentRequired: false,
      entitlementRequired: false,
      downloadUrl: signedUrl,
      expiresInSeconds
    }
  };
}

export function isFreeMomentAccessError(error) {
  return error instanceof MomentAccessError || error instanceof FreeMomentDownloadError;
}
