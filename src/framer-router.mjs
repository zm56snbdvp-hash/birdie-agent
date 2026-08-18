import {
  getFramerStatus,
  isFramerConfigured,
  getFramerPlanPolicy,
  listFramerSitePages,
  getFramerSitePage,
  planFramerTextUpdate,
  listFramerCmsCollections,
  getFramerCmsCollection,
  planFramerCmsItemUpdate,
  deployFramerProduction
} from "./framer-service.mjs";
import {
  getFramerV4Policy,
  planFramerV4TextUpdate,
  planFramerV4CmsItemUpdate,
  applyFramerV4TextPreview,
  applyFramerV4CmsPreview
} from "./framer-v4-service.mjs";

function requireConfirmation(body, expected) {
  if (body?.confirmation !== expected) {
    const error = new Error(`Explicit confirmation required: ${expected}`);
    error.code = "FOUNDER_CONFIRMATION_REQUIRED";
    error.status = 403;
    throw error;
  }
}

function unsafeLegacyPreviewDisabled() {
  const error = new Error(
    "Legacy /framer/preview is disabled because publishing main can reach Production when staging is unavailable. Use the governed V4 isolated-branch preview flow."
  );
  error.code = "FRAMER_UNSAFE_PREVIEW_DISABLED";
  error.status = 410;
  return error;
}

export async function routeFramerRequest({ req, res, url, json, readBody }) {
  if (req.method === "GET" && url.pathname === "/framer/config") {
    return json(res, 200, {
      success: true,
      configured: isFramerConfigured(),
      secretExposed: false,
      planPolicy: getFramerPlanPolicy(),
      v4Policy: getFramerV4Policy()
    });
  }

  if (req.method === "GET" && url.pathname === "/framer/status") {
    const data = await getFramerStatus();
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "GET" && url.pathname === "/framer/site/pages") {
    const data = await listFramerSitePages();
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "GET" && url.pathname === "/framer/site/page") {
    const data = await getFramerSitePage(url.searchParams.get("ref"));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/site/text-plan") {
    const data = await planFramerTextUpdate(await readBody(req));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "GET" && url.pathname === "/framer/cms/collections") {
    const data = await listFramerCmsCollections();
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "GET" && url.pathname === "/framer/cms/collection") {
    const data = await getFramerCmsCollection(url.searchParams.get("ref"));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/cms/plan") {
    const data = await planFramerCmsItemUpdate(await readBody(req));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "GET" && url.pathname === "/framer/v4/policy") {
    return json(res, 200, {
      success: true,
      source: "BIRDIEOS_GOVERNANCE",
      data: getFramerV4Policy()
    });
  }

  if (req.method === "POST" && url.pathname === "/framer/v4/site/text-plan") {
    const data = await planFramerV4TextUpdate(await readBody(req));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/v4/cms/plan") {
    const data = await planFramerV4CmsItemUpdate(await readBody(req));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/v4/site/text-apply-preview") {
    const data = await applyFramerV4TextPreview(await readBody(req));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/v4/cms/apply-preview") {
    const data = await applyFramerV4CmsPreview(await readBody(req));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/preview") {
    throw unsafeLegacyPreviewDisabled();
  }

  if (req.method === "POST" && url.pathname === "/framer/deploy") {
    const body = await readBody(req);
    requireConfirmation(body, "DEPLOY_FRAMER_PRODUCTION");
    const data = await deployFramerProduction(body.deploymentId);
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  return false;
}
