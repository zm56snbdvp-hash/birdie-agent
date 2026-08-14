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
    throw new BirdieAppError(
      "INVALID_RESPONSE_ID",
      "responseId path segment is malformed",
      400
    );
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

export async function routeBirdieAppRequest({
  req,
  res,
  url,
  json,
  readBody,
  service,
  authenticateBirdie
}) {
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
    return false;
  }

  if (req.method === "GET" && url.pathname === `${PREFIX}/world`) {
    rejectQueryScope(url);
    const authContext = await authenticateBirdie(req);
    json(res, 200, resultBody(await service.getWorld(authContext)));
    return true;
  }

  if (req.method === "POST" && url.pathname === `${PREFIX}/responses/lease`) {
    const authContext = await authenticateBirdie(req);
    const body = await readBody(req);
    json(
      res,
      200,
      resultBody(await service.leaseNextResponse(authContext, body))
    );
    return true;
  }

  const responseId = responseMatch(url.pathname);
  if (req.method === "POST" && responseId) {
    const authContext = await authenticateBirdie(req);
    const body = await readBody(req);
    json(
      res,
      200,
      resultBody(
        await service.ackResponse(authContext, {
          ...body,
          responseId
        })
      )
    );
    return true;
  }

  json(res, 404, {
    success: false,
    error: "BIRDIE_APP_ROUTE_NOT_FOUND"
  });
  return true;
}
