const AWIN_TRACKING_HOST_SUFFIX = ".awin1.com";
const CLICK_REF_RE = /^[A-Za-z0-9._:-]{1,96}$/;

export function isTrustedAwinTrackingUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "awin1.com" || host.endsWith(AWIN_TRACKING_HOST_SUFFIX));
  } catch {
    return false;
  }
}

/**
 * Adds BirdieWorld's random internal click id as Awin clickref2.
 * Awin documents clickref2-clickref6 as non-public click references: they are
 * available to the publisher in transaction reporting but are not forwarded
 * to the advertiser landing page.
 *
 * Consent is explicit. Missing consent is treated as false and sent as cons=0
 * rather than relying on Awin's default consent assumption.
 */
export function buildAwinAttributedDestination({ affiliateUrl, clickId, trackingConsent = false }) {
  if (!isTrustedAwinTrackingUrl(affiliateUrl)) {
    throw awinAttributionError("AWIN_TRACKING_URL_UNTRUSTED");
  }
  if (typeof clickId !== "string" || !CLICK_REF_RE.test(clickId)) {
    throw awinAttributionError("AWIN_CLICK_REF_INVALID");
  }

  const url = new URL(affiliateUrl);
  url.searchParams.set("clickref2", clickId);
  url.searchParams.set("cons", trackingConsent === true ? "1" : "0");
  return url.toString();
}

export function awinAdvertiserIdFromProvider(provider) {
  const match = /^awin:(\d+)$/.exec(String(provider || ""));
  return match ? match[1] : null;
}

function awinAttributionError(code) {
  const error = new Error(code);
  error.code = code;
  error.status = 502;
  return error;
}
