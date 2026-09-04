function authUserId(user) {
  return user?.id ?? user?.userId ?? null;
}

export function createCommerceRecommendationsHttpHandler({ authenticate, service, json }) {
  return async function recommendationsHandler(req, res) {
    const user = await authenticate(req);
    const userId = authUserId(user);
    if (!userId) return json(res, 401, { error: "AUTH_REQUIRED" });

    const url = req?.url instanceof URL
      ? req.url
      : new URL(req?.url || "/api/commerce/recommendations", "https://birdieworld.invalid");
    const requestedLimit = Number(url.searchParams.get("limit") || 3);
    const placement = url.searchParams.get("placement") || "for-your-game";

    const result = await service.getRecommendations({
      authUserId: userId,
      limit: Number.isInteger(requestedLimit) ? requestedLimit : 3,
      placement
    });

    if (typeof res?.setHeader === "function") res.setHeader("Cache-Control", "private, no-store");
    return json(res, 200, result);
  };
}

export function createCommerceOutboundHttpHandler({ authenticate, service }) {
  return async function outboundHandler(req, res, params = {}) {
    const user = await authenticate(req);
    const userId = authUserId(user);
    if (!userId) {
      res.statusCode = 401;
      return res.end?.("AUTH_REQUIRED");
    }

    const url = req?.url instanceof URL
      ? req.url
      : new URL(req?.url || "/api/commerce/out", "https://birdieworld.invalid");
    const productId = params.productId ?? req?.params?.productId ?? null;
    const placement = url.searchParams.get("placement") || "for-your-game";
    const result = await service.createOutboundClick({ authUserId: userId, productId, placement });

    res.statusCode = 302;
    if (typeof res?.setHeader === "function") {
      res.setHeader("Location", result.destinationUrl);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    }
    return res.end?.();
  };
}
