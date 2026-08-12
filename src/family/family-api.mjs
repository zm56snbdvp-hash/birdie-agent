import { createFamilyReadService } from "./family-service.mjs";
import { isFamilyAuthorized } from "./family-auth.mjs";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

const FAMILY_SERVER = "https://birdie-agent-893591677320.europe-west3.run.app";

const FAMILY_OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Birdie Family Read-Only API",
    version: "1.0.0",
    description: "Strict read-only, sanitized BirdieOS access for Birdie Family. No write operations are exposed."
  },
  servers: [{ url: FAMILY_SERVER }],
  paths: {
    "/family/api/policy": { get: { operationId: "getFamilyPolicy", summary: "Get Birdie Family access policy", responses: { "200": { description: "Family policy" } } } },
    "/family/api/health": { get: { operationId: "getFamilyHealth", summary: "Get sanitized BirdieOS health", responses: { "200": { description: "Sanitized health" } } } },
    "/family/api/briefing": { get: { operationId: "getFamilyBriefing", summary: "Get sanitized BirdieOS live briefing", responses: { "200": { description: "Sanitized briefing" } } } },
    "/family/api/next-task": { get: { operationId: "getFamilyNextTask", summary: "Get sanitized current BirdieOS next task", responses: { "200": { description: "Sanitized next task" } } } }
  },
  components: { securitySchemes: { FamilyBearer: { type: "http", scheme: "bearer" } } },
  security: [{ FamilyBearer: [] }]
};

const FAMILY_PRIVACY_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Birdie Family – Datenschutz</title></head><body style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.55"><h1>Birdie Family – Datenschutz</h1><p>Birdie Family ist eine read-only Schnittstelle von Birdie & Breakfast. Sie stellt ausschließlich bereinigte Unternehmensinformationen aus BirdieOS bereit.</p><h2>Verarbeitete Daten</h2><p>Bei der Nutzung können technische Verbindungsdaten verarbeitet werden, die für den sicheren API-Betrieb erforderlich sind. Birdie Family speichert über diese Schnittstelle keine Chat-Inhalte in BirdieOS und führt keine Schreiboperationen aus.</p><h2>Ausgeschlossene Daten</h2><p>Finanz-, Bank-, Steuer-, Zahlungs-, Mail-, Credential-, Secret-, Token-, Audit- und private Kontaktdaten werden serverseitig aus Family-Antworten entfernt oder redigiert.</p><h2>Zweck</h2><p>Die Schnittstelle dient ausschließlich dem read-only Zugriff auf freigegebene Birdie-&-Breakfast-Unternehmensinformationen für autorisierte Family-Nutzer.</p><h2>Sicherheit</h2><p>Der Zugriff ist über einen separaten Family-Schlüssel geschützt. Der Family-Zugang besitzt keine Berechtigung für BirdieOS-Schreibvorgänge, Mail-Aktionen, Coin-Buchungen, Veröffentlichungen, Deployments oder externe Account-Änderungen.</p><p>Stand: 12.08.2026</p></body></html>`;

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
  if (url.pathname === "/family/privacy") {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); json(res, 405, { success: false, error: "FAMILY_READ_ONLY" }); return true; }
    html(res, 200, FAMILY_PRIVACY_HTML);
    return true;
  }

  if (url.pathname === "/family/openapi.json") {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); json(res, 405, { success: false, error: "FAMILY_READ_ONLY" }); return true; }
    json(res, 200, FAMILY_OPENAPI);
    return true;
  }

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
