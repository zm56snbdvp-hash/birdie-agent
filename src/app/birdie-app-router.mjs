import { BirdieAppError } from "./birdie-app-service.mjs";

const PREFIX = "/birdie-app/v1";

function resultBody(data) {
  return {
    success: true,
    source: "BIRDIE_WORLD_PROJECTION",
    data
  };
}

function responseMatch(pathname) {
  const match = pathname.match(/^\/birdie-app\/v1\/responses\/([^/]+)\/ack$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new BirdieAppError("INVALID_RESPONSE_ID", "responseId path segment is malformed", 400);
  }
}

function rejectQueryScope(url) {
  if (url.searchParams.has("birdieId")) {
    throw new BirdieAppError(
      "CLIENT_BIRDIE_ID_FORBIDDEN",
      "birdieId is derived exclusively from the authenticated session",
      403
    );
  }
}

function rejectBodyScope(input) {
  if (Object.prototype.hasOwnProperty.call(input || {}, "birdieId")) {
    throw new BirdieAppError(
      "CLIENT_BIRDIE_ID_FORBIDDEN",
      "birdieId is derived exclusively from the authenticated session",
      403
    );
  }
}

function actorFields(authContext) {
  return {
    authSubject: authContext.subject,
    authBirdieId: authContext.birdieId,
    source: "Birdie Agent BirdieWorld V1"
  };
}

async function birdieOSCharacterPost(payload) {
  const base = process.env.BIRDIE_OS_BASE;
  const apiKey = process.env.BIRDIE_OS_API_KEY;
  if (!base || !apiKey) throw new BirdieAppError("BIRDIE_OS_NOT_CONFIGURED", "BirdieOS is unavailable", 503);
  const target = new URL(base);
  target.searchParams.set("api_key", apiKey);
  const response = await fetch(target.toString(), {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { throw new BirdieAppError("BIRDIE_OS_INVALID_RESPONSE", "BirdieOS returned invalid JSON", 502); }
  if (!response.ok || !result?.success) {
    throw new BirdieAppError("BIRDIE_OS_CHARACTER_ERROR", result?.error || result?.message || `BirdieOS HTTP ${response.status}`, 502);
  }
  return result;
}

export async function routeBirdieAppRequest({
  req,
  res,
  url,
  json,
  readBody,
  service,
  coinService,
  authenticateBirdie
}) {
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;

  if (url.pathname === `${PREFIX}/character`) {
    rejectQueryScope(url);
    const authContext = await authenticateBirdie(req);
    if (req.method === "GET") {
      const result = await birdieOSCharacterPost({ action: "worldGetCharacter", ...actorFields(authContext) });
      json(res, 200, resultBody(result.data ?? null));
      return true;
    }
    if (req.method === "PUT" || req.method === "POST") {
      const body = await readBody(req);
      const result = await birdieOSCharacterPost({
        action: "worldSaveCharacter",
        character: body.character ?? body,
        ...actorFields(authContext)
      });
      json(res, 200, resultBody(result.data));
      return true;
    }
  }

  if (req.method === "GET" && url.pathname === `${PREFIX}/world`) {
    rejectQueryScope(url);
    const authContext = await authenticateBirdie(req);
    json(res, 200, resultBody(await service.getWorld(authContext)));
    return true;
  }

  if (req.method === "GET" && url.pathname === `${PREFIX}/coin/profile`) {
    const authContext = await authenticateBirdie(req);
    json(res, 200, resultBody(await coinService.getProfile(authContext.birdieId)));
    return true;
  }

  if (req.method === "GET" && url.pathname === `${PREFIX}/coin/ledger`) {
    const authContext = await authenticateBirdie(req);
    json(res, 200, resultBody(await coinService.getLedger(authContext.birdieId)));
    return true;
  }

  if (req.method === "GET" && url.pathname === `${PREFIX}/coin/rewards`) {
    await authenticateBirdie(req);
    json(res, 200, resultBody(await coinService.listRewards()));
    return true;
  }

  if (req.method === "POST" && url.pathname === `${PREFIX}/coin/instagram`) {
    const authContext = await authenticateBirdie(req);
    const body = await readBody(req);
    rejectBodyScope(body);
    json(res, 200, resultBody(await coinService.linkInstagramHandle(authContext.birdieId, body)));
    return true;
  }

  if (req.method === "POST" && url.pathname === `${PREFIX}/coin/claims`) {
    const authContext = await authenticateBirdie(req);
    const body = await readBody(req);
    rejectBodyScope(body);
    json(res, 200, resultBody(await coinService.createClaim({ ...body, birdieId: authContext.birdieId })));
    return true;
  }

  if (req.method === "POST" && url.pathname === `${PREFIX}/coin/redemptions`) {
    const authContext = await authenticateBirdie(req);
    const body = await readBody(req);
    rejectBodyScope(body);
    json(res, 200, resultBody(await coinService.createRedemption({ ...body, birdieId: authContext.birdieId })));
    return true;
  }

  if (req.method === "POST" && url.pathname === `${PREFIX}/responses/lease`) {
    const authContext = await authenticateBirdie(req);
    const body = await readBody(req);
    json(res, 200, resultBody(await service.leaseNextResponse(authContext, body)));
    return true;
  }

  const responseId = responseMatch(url.pathname);
  if (req.method === "POST" && responseId) {
    const authContext = await authenticateBirdie(req);
    const body = await readBody(req);
    json(res, 200, resultBody(await service.ackResponse(authContext, { ...body, responseId })));
    return true;
  }

  json(res, 404, { success: false, error: "BIRDIE_APP_ROUTE_NOT_FOUND" });
  return true;
}
