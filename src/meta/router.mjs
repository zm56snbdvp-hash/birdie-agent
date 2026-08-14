function requireConfirmation(body, expected) {
  if (body?.confirmation !== expected) {
    const error = new Error(`Explicit confirmation required: ${expected}`);
    error.code = "FOUNDER_CONFIRMATION_REQUIRED";
    error.status = 403;
    throw error;
  }
}

export async function routeMetaPublicRequest({
  req,
  res,
  url,
  service,
  readRawBody
}) {
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

  res.writeHead(405, {
    "Content-Type": "text/plain; charset=utf-8",
    Allow: "GET, POST"
  });
  res.end("Method Not Allowed");
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
