function requireConfirmation(body, expected) {
  if (body?.confirmation !== expected) {
    const error = new Error(`Explicit confirmation required: ${expected}`);
    error.code = "FOUNDER_CONFIRMATION_REQUIRED";
    error.status = 403;
    throw error;
  }
}

function writeJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res, allow) {
  res.writeHead(405, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    Allow: allow
  });
  res.end("Method Not Allowed");
}

export async function routeMetaPublicRequest({
  req,
  res,
  url,
  service,
  readRawBody
}) {
  if (url.pathname === "/meta/oauth/callback") {
    if (req.method !== "GET") {
      methodNotAllowed(res, "GET");
      return true;
    }
    const data = await service.completeOAuth(url.searchParams);
    writeJson(
      res,
      200,
      { success: true, source: "META_PAGE_OAUTH", data },
      {
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    );
    return true;
  }

  if (url.pathname !== "/meta/webhook") return false;

  if (req.method === "GET") {
    const challenge = service.verifyChallenge(url.searchParams);
    if (challenge === null) {
      res.writeHead(403, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end("Forbidden");
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(challenge);
    return true;
  }

  if (req.method === "POST") {
    if (typeof readRawBody !== "function") {
      throw new Error("readRawBody is required for signed Meta webhooks");
    }
    const rawBody = await readRawBody(req);
    const result = await service.ingestWebhook(
      rawBody,
      req.headers?.["x-hub-signature-256"]
    );
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ success: true, ...result }));
    return true;
  }

  methodNotAllowed(res, "GET, POST");
  return true;
}

export async function routeMetaGovernedRequest({
  req,
  res,
  url,
  json,
  readBody,
  service
}) {
  if (url.pathname === "/meta/oauth/start") {
    if (req.method !== "POST") {
      methodNotAllowed(res, "POST");
      return true;
    }
    const body = await readBody(req);
    requireConfirmation(body, "START_META_PAGE_OAUTH");
    const data = service.startOAuth();
    json(
      res,
      200,
      { success: true, source: "META_PAGE_OAUTH", data },
      { "Cache-Control": "no-store" }
    );
    return true;
  }

  if (url.pathname === "/meta/conversations") {
    if (req.method !== "GET") {
      methodNotAllowed(res, "GET");
      return true;
    }
    const data = await service.listInstagramConversations({
      limit: url.searchParams.get("limit") || 1,
      after: url.searchParams.get("after") || ""
    });
    json(
      res,
      200,
      { success: true, source: "META_INSTAGRAM_API", data },
      { "Cache-Control": "no-store" }
    );
    return true;
  }

  if (req.method === "POST" && url.pathname === "/meta/messages/private-reply") {
    const body = await readBody(req);
    requireConfirmation(body, "SEND_META_PRIVATE_REPLY");
    const data = await service.sendPrivateReply(body);
    json(res, 200, { success: true, source: "META_INSTAGRAM_API", data });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/meta/messages/send") {
    const body = await readBody(req);
    requireConfirmation(body, "SEND_META_RESPONSE_MESSAGE");
    const data = await service.sendResponseMessage(body);
    json(res, 200, { success: true, source: "META_INSTAGRAM_API", data });
    return true;
  }

  return false;
}
