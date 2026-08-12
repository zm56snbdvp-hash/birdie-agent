import { createFamilyReadService } from "./family-service.mjs";
import { isFamilyAuthorized } from "./family-auth.mjs";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const ROUTES = Object.freeze({
  "/family/api/policy": async (service) => service.policy(),
  "/family/api/health": async (service) => service.health(),
  "/family/api/briefing": async (service) => service.briefing(),
  "/family/api/next-task": async (service) => service.nextTask()
});

export async function routeFamilyApiRequest({
  req,
  res,
  url,
  birdieOSGet,
  familyApiKey = process.env.BIRDIE_FAMILY_API_KEY
}) {
  if (!url.pathname.startsWith("/family/api/")) return false;

  const handler = ROUTES[url.pathname];
  if (!handler) {
    json(res, 404, { success: false, error: "FAMILY_RESOURCE_NOT_FOUND" });
    return true;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    json(res, 405, { success: false, error: "FAMILY_READ_ONLY" });
    return true;
  }

  if (!String(familyApiKey ?? "").trim()) {
    json(res, 503, { success: false, error: "FAMILY_ACCESS_NOT_CONFIGURED" });
    return true;
  }

  if (!isFamilyAuthorized(req, familyApiKey)) {
    json(res, 401, { success: false, error: "UNAUTHORIZED" });
    return true;
  }

  try {
    const service = createFamilyReadService({ birdieOSGet });
    const result = await handler(service);
    json(res, 200, { success: true, result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    json(res, status, {
      success: false,
      error: error?.code || "FAMILY_READ_FAILED"
    });
  }

  return true;
}
