export const COMMERCE_CATEGORY = Object.freeze({
  BALLS: "BALLS",
  GLOVES: "GLOVES",
  TEES: "TEES",
  RANGEFINDER: "RANGEFINDER",
  TRAINING: "TRAINING"
});

export const PLAYER_FOCUS = Object.freeze({
  ESSENTIALS: "ESSENTIALS",
  DISTANCE: "DISTANCE",
  PRACTICE: "PRACTICE"
});

const CATEGORIES = new Set(Object.values(COMMERCE_CATEGORY));
const FOCUSES = new Set(Object.values(PLAYER_FOCUS));

export function validateAffiliateProduct(product) {
  const missing = [];
  if (!product?.id) missing.push("id");
  if (!product?.provider) missing.push("provider");
  if (!product?.title) missing.push("title");
  if (!CATEGORIES.has(product?.category)) missing.push("category");
  if (product?.active !== true) missing.push("active");
  if (product?.available !== true) missing.push("available");
  if (!Array.isArray(product?.regions) || product.regions.length === 0) missing.push("regions");
  if (!Number.isFinite(product?.price) || product.price < 0) missing.push("price");
  if (!isSafeHttpsUrl(product?.affiliateUrl)) missing.push("affiliate_url");

  return { valid: missing.length === 0, missing };
}

export function normalizePlayerContext(context = {}) {
  const focuses = Array.isArray(context.focuses)
    ? [...new Set(context.focuses.filter((focus) => FOCUSES.has(focus)))]
    : [];

  return {
    region: typeof context.region === "string" && context.region ? context.region.toUpperCase() : "DE",
    focuses,
    roundsPlayed: Number.isInteger(context.roundsPlayed) && context.roundsPlayed >= 0
      ? context.roundsPlayed
      : 0,
    recentRoundCompleted: context.recentRoundCompleted === true
  };
}

export function isSafeHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}
