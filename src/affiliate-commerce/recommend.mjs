import {
  COMMERCE_CATEGORY,
  PLAYER_FOCUS,
  normalizePlayerContext,
  validateAffiliateProduct
} from "./contracts.mjs";

const FOCUS_WEIGHTS = Object.freeze({
  [PLAYER_FOCUS.ESSENTIALS]: {
    [COMMERCE_CATEGORY.BALLS]: 40,
    [COMMERCE_CATEGORY.GLOVES]: 32,
    [COMMERCE_CATEGORY.TEES]: 24
  },
  [PLAYER_FOCUS.DISTANCE]: {
    [COMMERCE_CATEGORY.RANGEFINDER]: 44,
    [COMMERCE_CATEGORY.TRAINING]: 34
  },
  [PLAYER_FOCUS.PRACTICE]: {
    [COMMERCE_CATEGORY.TRAINING]: 42,
    [COMMERCE_CATEGORY.BALLS]: 18
  }
});

export function recommendAffiliateProducts({ products, playerContext, limit = 3 }) {
  const context = normalizePlayerContext(playerContext);
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 0), 6) : 3;
  if (!Array.isArray(products) || safeLimit === 0) return [];

  const ranked = products
    .filter((product) => validateAffiliateProduct(product).valid)
    .filter((product) => supportsRegion(product, context.region))
    .map((product) => ({ product, score: scoreProduct(product, context) }))
    .sort(compareRanked);

  return diversifyProviders(ranked, safeLimit).map(({ product, score }) => ({
    ...product,
    recommendationScore: score
  }));
}

function supportsRegion(product, region) {
  return product.regions.includes("ALL") || product.regions.map((x) => x.toUpperCase()).includes(region);
}

function scoreProduct(product, context) {
  let score = Number.isFinite(product.priority) ? product.priority : 0;

  for (const focus of context.focuses) {
    score += FOCUS_WEIGHTS[focus]?.[product.category] ?? 0;
  }

  if (context.recentRoundCompleted && product.category === COMMERCE_CATEGORY.BALLS) score += 12;
  if (context.roundsPlayed >= 5 && product.category === COMMERCE_CATEGORY.GLOVES) score += 8;
  if (context.roundsPlayed >= 10 && product.category === COMMERCE_CATEGORY.BALLS) score += 6;

  return score;
}

function compareRanked(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.product.price !== b.product.price) return a.product.price - b.product.price;
  return a.product.id.localeCompare(b.product.id);
}

function diversifyProviders(ranked, limit) {
  const selected = [];
  const deferred = [];
  const providerCounts = new Map();

  for (const entry of ranked) {
    const count = providerCounts.get(entry.product.provider) ?? 0;
    if (count === 0 || selected.length + deferred.length >= ranked.length) {
      selected.push(entry);
      providerCounts.set(entry.product.provider, count + 1);
    } else {
      deferred.push(entry);
    }
    if (selected.length >= limit) return selected.slice(0, limit);
  }

  for (const entry of deferred) {
    selected.push(entry);
    if (selected.length >= limit) break;
  }

  return selected.slice(0, limit);
}
