import { parseCsv } from "./csv.mjs";
import { mapAwinProduct } from "./awin.mjs";

const FEED_LIST_BASE = "https://productdata.awin.com/datafeed/list/apikey/";

export function createAwinFeedClient({ dataFeedApiKey, fetchImpl = globalThis.fetch }) {
  if (typeof dataFeedApiKey !== "string" || !dataFeedApiKey.trim()) {
    throw new TypeError("dataFeedApiKey is required");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");

  async function listFeeds() {
    const response = await fetchImpl(`${FEED_LIST_BASE}${encodeURIComponent(dataFeedApiKey.trim())}`, {
      headers: { Accept: "text/csv" }
    });
    const text = await responseText(response, "AWIN_FEED_LIST");
    return parseCsv(text).map(normalizeFeedListRow).filter(Boolean);
  }

  async function downloadRows(feed) {
    if (!isSafeFeedDownloadUrl(feed?.url)) throw awinError("AWIN_FEED_URL_INVALID", 502);
    const response = await fetchImpl(feed.url, { headers: { Accept: "text/csv,*/*" } });
    const text = await responseText(response, "AWIN_PRODUCT_FEED");
    return parseCsv(text);
  }

  return { listFeeds, downloadRows };
}

export function createAwinRemoteCatalogProvider({
  feedClient,
  advertiserIds,
  region = "DE",
  priorityByMerchant = {}
}) {
  if (!feedClient || typeof feedClient.listFeeds !== "function" || typeof feedClient.downloadRows !== "function") {
    throw new TypeError("feedClient.listFeeds and downloadRows are required");
  }
  const allowedAdvertisers = new Set((advertiserIds || []).map((value) => String(value)));
  if (allowedAdvertisers.size === 0) throw new TypeError("advertiserIds must not be empty");
  const cache = new Map();

  return {
    async listProducts() {
      const feeds = (await feedClient.listFeeds())
        .filter((feed) => allowedAdvertisers.has(feed.advertiserId))
        .filter((feed) => feed.membershipStatus === "Joined")
        .filter((feed) => !feed.primaryRegion || feed.primaryRegion.toUpperCase() === region.toUpperCase());

      const combined = [];
      for (const feed of feeds) {
        const cacheKey = `${feed.feedId}:${feed.advertiserId}`;
        const cached = cache.get(cacheKey);
        if (cached && cached.lastImported === feed.lastImported) {
          combined.push(...cached.products);
          continue;
        }

        const rows = await feedClient.downloadRows(feed);
        const products = rows
          .map((row) => mapAwinProduct(
            row?.merchant_id ? row : { ...row, merchant_id: feed.advertiserId, merchant_name: row?.merchant_name || feed.advertiserName },
            { region, priority: Number(priorityByMerchant[feed.advertiserId]) || 0 }
          ))
          .filter(Boolean);
        cache.set(cacheKey, { lastImported: feed.lastImported, products });
        combined.push(...products);
      }
      return dedupe(combined);
    }
  };
}

function normalizeFeedListRow(row) {
  const advertiserId = value(row, "Advertiser ID");
  const feedId = value(row, "Feed ID");
  const url = value(row, "URL");
  if (!advertiserId || !feedId || !url) return null;
  return {
    advertiserId,
    advertiserName: value(row, "Advertiser Name"),
    primaryRegion: value(row, "Primary Region"),
    membershipStatus: value(row, "Membership Status"),
    feedId,
    feedName: value(row, "Feed Name"),
    language: value(row, "Language"),
    vertical: value(row, "Vertical"),
    lastImported: value(row, "Last Imported"),
    url
  };
}

function value(row, key) {
  const direct = row?.[key];
  if (direct !== undefined) return String(direct).trim();
  const found = Object.entries(row || {}).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return found ? String(found[1]).trim() : "";
}

async function responseText(response, label) {
  if (!response || response.ok !== true) {
    throw awinError(`${label}_HTTP_${response?.status ?? "UNKNOWN"}`, 502);
  }
  return response.text();
}

function isSafeFeedDownloadUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["datafeed.api.productserve.com", "productdata.awin.com", "api.awin.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

function awinError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function dedupe(products) {
  const byId = new Map();
  for (const product of products) byId.set(product.id, product);
  return [...byId.values()];
}
