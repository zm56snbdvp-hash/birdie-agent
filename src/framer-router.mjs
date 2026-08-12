import {
  getFramerStatus,
  isFramerConfigured,
  getFramerCmsWritePolicy,
  listFramerCmsCollections,
  getFramerCmsCollection,
  planFramerCmsItemUpdate,
  applyFramerCmsItemUpdate,
  publishFramerPreview,
  deployFramerProduction
} from "./framer-service.mjs";

function requireConfirmation(body, expected) {
  if (body?.confirmation !== expected) {
    const error = new Error(`Explicit confirmation required: ${expected}`);
    error.code = "FOUNDER_CONFIRMATION_REQUIRED";
    error.status = 403;
    throw error;
  }
}

export async function routeFramerRequest({ req, res, url, json, readBody }) {
  if (req.method === "GET" && url.pathname === "/framer/config") {
    return json(res, 200, {
      success: true,
      configured: isFramerConfigured(),
      secretExposed: false,
      cmsWritePolicy: getFramerCmsWritePolicy()
    });
  }

  if (req.method === "GET" && url.pathname === "/framer/status") {
    const data = await getFramerStatus();
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "GET" && url.pathname === "/framer/cms/collections") {
    const data = await listFramerCmsCollections();
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "GET" && url.pathname.startsWith("/framer/cms/collections/")) {
    const collectionId = decodeURIComponent(url.pathname.slice("/framer/cms/collections/".length));
    const data = await getFramerCmsCollection(collectionId);
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/cms/plan") {
    const data = await planFramerCmsItemUpdate(await readBody(req));
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/cms/apply") {
    const body = await readBody(req);
    requireConfirmation(body, "APPLY_FRAMER_CMS_CHANGE");
    const data = await applyFramerCmsItemUpdate(body);
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/preview") {
    const body = await readBody(req);
    requireConfirmation(body, "PUBLISH_FRAMER_PREVIEW");
    const data = await publishFramerPreview();
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  if (req.method === "POST" && url.pathname === "/framer/deploy") {
    const body = await readBody(req);
    requireConfirmation(body, "DEPLOY_FRAMER_PRODUCTION");
    const data = await deployFramerProduction(body.deploymentId);
    return json(res, 200, { success: true, source: "FRAMER_SERVER_API", data });
  }

  return false;
}
