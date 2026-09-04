import { COMMERCE_CATEGORY, isSafeHttpsUrl } from "../contracts.mjs";

const CATEGORY_RULES = [
  { category: COMMERCE_CATEGORY.RANGEFINDER, patterns: [/range\s?finder/i, /golf\s?gps/i, /distance\s?finder/i] },
  { category: COMMERCE_CATEGORY.GLOVES, patterns: [/golf\s?glove/i, /handschuh/i] },
  { category: COMMERCE_CATEGORY.BALLS, patterns: [/golf\s?balls?/i, /golfb[aä]lle?/i] },
  { category: COMMERCE_CATEGORY.TEES, patterns: [/golf\s?tees?/i, /golftee/i] },
  { category: COMMERCE_CATEGORY.TRAINING, patterns: [/training/i, /swing\s?trainer/i, /speed\s?trainer/i, /practice/i, /trainingshilfe/i] }
];

export function inferGolfCommerceCategory(row = {}) {
  const haystack = [
    row.product_name,
    row.merchant_category,
    row.category_name,
    row.merchant_product_category_path,
    row.product_type,
    row.keywords
  ].filter(Boolean).join(" | ");

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) return rule.category;
  }
  return null;
}

export function mapAwinProduct(row, { region = "DE", priority = 0, categoryResolver = inferGolfCommerceCategory } = {}) {
  const category = categoryResolver(row);
  const affiliateUrl = row?.aw_deep_link;
  const price = parsePrice(row?.search_price ?? row?.store_price);
  const available = isAwinProductAvailable(row);
  const merchantId = clean(row?.merchant_id) || "unknown";
  const awinProductId = clean(row?.aw_product_id) || clean(row?.merchant_product_id);

  if (!category || !awinProductId || !isSafeHttpsUrl(affiliateUrl) || price === null) return null;

  return {
    id: `awin:${merchantId}:${awinProductId}`,
    provider: `awin:${merchantId}`,
    title: clean(row?.product_name) || "Golf product",
    category,
    price,
    currency: clean(row?.currency) || "EUR",
    active: isForSale(row),
    available,
    regions: [String(region).toUpperCase()],
    affiliateUrl,
    imageUrl: safeOptionalHttps(row?.aw_image_url) || safeOptionalHttps(row?.merchant_image_url),
    merchantName: clean(row?.merchant_name) || `Awin ${merchantId}`,
    brandName: clean(row?.brand_name) || null,
    priority,
    sourceUpdatedAt: clean(row?.last_updated) || null
  };
}

export function createAwinCatalogProvider({ loadRows, feeds, region = "DE", priorityByMerchant = {} }) {
  if (typeof loadRows !== "function") throw new TypeError("loadRows is required");
  if (!Array.isArray(feeds)) throw new TypeError("feeds must be an array");

  return {
    async listProducts() {
      const all = [];
      for (const feed of feeds) {
        const rows = await loadRows(feed);
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const merchantId = clean(row?.merchant_id) || clean(feed?.merchantId);
          const mapped = mapAwinProduct(
            merchantId && !row?.merchant_id ? { ...row, merchant_id: merchantId } : row,
            { region, priority: Number(priorityByMerchant[merchantId]) || 0 }
          );
          if (mapped) all.push(mapped);
        }
      }
      return dedupeById(all);
    }
  };
}

function parsePrice(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isForSale(row) {
  if (row?.is_for_sale === undefined || row?.is_for_sale === null || row?.is_for_sale === "") return true;
  return truthyFeedValue(row.is_for_sale);
}

function isAwinProductAvailable(row) {
  if (!isForSale(row)) return false;
  if (row?.in_stock !== undefined && row?.in_stock !== null && row?.in_stock !== "") {
    return truthyFeedValue(row.in_stock);
  }
  const status = clean(row?.stock_status)?.toLowerCase();
  if (!status) return true;
  if (["out of stock", "out_of_stock", "unavailable", "sold out"].includes(status)) return false;
  return true;
}

function truthyFeedValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "in stock", "in_stock", "available"].includes(normalized);
}

function safeOptionalHttps(value) {
  return isSafeHttpsUrl(value) ? value : null;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function dedupeById(products) {
  const byId = new Map();
  for (const product of products) byId.set(product.id, product);
  return [...byId.values()];
}
