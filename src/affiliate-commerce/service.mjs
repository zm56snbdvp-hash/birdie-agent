import { buildAffiliateClick, buildCommerceDisclosure } from "./click.mjs";
import { recommendAffiliateProducts } from "./recommend.mjs";
import { validateAffiliateProduct } from "./contracts.mjs";

function defaultClickIdFactory() {
  return globalThis.crypto?.randomUUID?.() ?? `click-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function publicRecommendation(product, placement) {
  return {
    id: product.id,
    provider: product.provider,
    title: product.title,
    category: product.category,
    price: product.price,
    currency: product.currency ?? "EUR",
    imageUrl: product.imageUrl ?? null,
    merchantName: product.merchantName ?? product.provider,
    brandName: product.brandName ?? null,
    recommendationScore: product.recommendationScore,
    outboundPath: `/api/commerce/out/${encodeURIComponent(product.id)}?placement=${encodeURIComponent(placement)}`
  };
}

export function createAffiliateCommerceService({
  catalogProvider,
  playerContextProvider,
  clickSink = null,
  clickIdFactory = defaultClickIdFactory,
  locale = "de-DE"
}) {
  if (!catalogProvider || typeof catalogProvider.listProducts !== "function") {
    throw new TypeError("catalogProvider.listProducts is required");
  }
  if (!playerContextProvider || typeof playerContextProvider.getContext !== "function") {
    throw new TypeError("playerContextProvider.getContext is required");
  }

  async function getRecommendations({ authUserId, limit = 3, placement = "for-your-game" }) {
    if (!authUserId) throw commerceError("AUTH_REQUIRED", 401);
    const [products, playerContext] = await Promise.all([
      catalogProvider.listProducts(),
      playerContextProvider.getContext(authUserId)
    ]);

    const recommendations = recommendAffiliateProducts({ products, playerContext, limit });
    return {
      placement,
      disclosure: buildCommerceDisclosure(locale),
      items: recommendations.map((product) => publicRecommendation(product, placement))
    };
  }

  async function createOutboundClick({ authUserId, productId, placement = "for-your-game" }) {
    if (!authUserId) throw commerceError("AUTH_REQUIRED", 401);
    if (!productId) throw commerceError("PRODUCT_ID_REQUIRED", 400);

    const [products, playerContext] = await Promise.all([
      catalogProvider.listProducts(),
      playerContextProvider.getContext(authUserId)
    ]);
    const product = Array.isArray(products) ? products.find((item) => item?.id === productId) : null;
    if (!product || !validateAffiliateProduct(product).valid) {
      throw commerceError("PRODUCT_NOT_AVAILABLE", 404);
    }

    const region = String(playerContext?.region || "DE").toUpperCase();
    const supported = product.regions.includes("ALL") || product.regions.map((x) => String(x).toUpperCase()).includes(region);
    if (!supported) throw commerceError("PRODUCT_NOT_AVAILABLE", 404);

    const clickId = await clickIdFactory({ authUserId, productId, placement });
    if (typeof clickId !== "string" || !clickId) throw commerceError("CLICK_ID_UNAVAILABLE", 503);

    const event = buildAffiliateClick({ product, userId: authUserId, placement, clickId });
    if (clickSink?.record) await clickSink.record(event);

    return {
      clickId,
      destinationUrl: event.destinationUrl
    };
  }

  return { getRecommendations, createOutboundClick };
}

function commerceError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
