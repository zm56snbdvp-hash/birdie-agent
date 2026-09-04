import { isSafeHttpsUrl } from "./contracts.mjs";

export function buildAffiliateClick({ product, userId = null, placement, clickId, occurredAt = new Date().toISOString() }) {
  if (!product?.id) throw new TypeError("product.id is required");
  if (!product?.provider) throw new TypeError("product.provider is required");
  if (!placement) throw new TypeError("placement is required");
  if (!clickId) throw new TypeError("clickId is required");
  if (!isSafeHttpsUrl(product?.affiliateUrl)) throw new TypeError("safe https affiliateUrl is required");

  return {
    clickId,
    productId: product.id,
    provider: product.provider,
    category: product.category ?? null,
    placement,
    userId,
    occurredAt,
    destinationUrl: product.affiliateUrl
  };
}

export function buildCommerceDisclosure(locale = "de-DE") {
  if (locale.toLowerCase().startsWith("de")) {
    return "Partnerlink: BirdieWorld kann bei einem Kauf eine Provision erhalten. Für dich ändert sich der Preis nicht.";
  }
  return "Partner link: BirdieWorld may earn a commission from qualifying purchases at no extra cost to you.";
}
