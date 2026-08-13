import { createHash } from "node:crypto";

const FRAMER_RETRY_ATTEMPTS = 4;
const FRAMER_RETRY_DELAYS_MS = [250, 750, 1500];
const PAGE_TEXT_CONCURRENCY = 4;

let sharedFramer = null;
let sharedFramerPromise = null;
let framerQueue = Promise.resolve();
const pageRefCache = new Map();

function configError(name) {
  const error = new Error(`${name} is not configured`);
  error.code = "FRAMER_NOT_CONFIGURED";
  error.status = 503;
  return error;
}

function requireConfig() {
  const projectUrl = process.env.FRAMER_PROJECT_URL;
  const apiKey = process.env.FRAMER_API_KEY;
  if (!projectUrl) throw configError("FRAMER_PROJECT_URL");
  if (!apiKey) throw configError("FRAMER_API_KEY");
  return { projectUrl, apiKey };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stateHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function framerError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorStatus(error) {
  const status = Number(
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    0
  );
  return Number.isFinite(status) ? status : 0;
}

function isRetryableFramerError(error) {
  if (!error) return false;
  if (String(error.code || "").startsWith("FRAMER_") && Number(error.status) < 500) return false;
  const status = errorStatus(error);
  if (status === 429 || status >= 500) return true;
  const message = String(error.message || error).toLowerCase();
  return [
    "service unavailable",
    "temporarily unavailable",
    "websocket",
    "socket",
    "connection",
    "timed out",
    "timeout",
    "econnreset",
    "econnrefused",
    "closed"
  ].some((fragment) => message.includes(fragment));
}

function upstreamUnavailable(label, error) {
  const detail = String(error?.message || error || "unknown upstream error").slice(0, 300);
  return framerError(
    "FRAMER_UPSTREAM_UNAVAILABLE",
    `${label} is temporarily unavailable after ${FRAMER_RETRY_ATTEMPTS} attempts: ${detail}`,
    503
  );
}

async function disconnectSharedFramer() {
  const current = sharedFramer;
  sharedFramer = null;
  sharedFramerPromise = null;
  if (!current) return;
  try {
    await current.disconnect();
  } catch {
    // Best-effort cleanup only. A failed disconnect must not mask the upstream error.
  }
}

async function getSharedFramer() {
  if (sharedFramer) return sharedFramer;
  if (sharedFramerPromise) return sharedFramerPromise;

  const { projectUrl, apiKey } = requireConfig();
  sharedFramerPromise = (async () => {
    const { connect } = await import("framer-api");
    const framer = await connect(projectUrl, apiKey);
    sharedFramer = framer;
    sharedFramerPromise = null;
    return framer;
  })().catch((error) => {
    sharedFramerPromise = null;
    throw error;
  });

  return sharedFramerPromise;
}

async function retryCall(label, operation, attempts = FRAMER_RETRY_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableFramerError(error) || attempt === attempts) throw error;
      await sleep(FRAMER_RETRY_DELAYS_MS[Math.min(attempt - 1, FRAMER_RETRY_DELAYS_MS.length - 1)]);
    }
  }
  throw upstreamUnavailable(label, lastError);
}

function serializeFramer(operation) {
  const run = framerQueue.then(operation, operation);
  framerQueue = run.catch(() => undefined);
  return run;
}

async function withFramer(operation, label = "Framer operation") {
  return serializeFramer(async () => {
    let lastError;

    for (let attempt = 1; attempt <= FRAMER_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const framer = await getSharedFramer();
        return await operation(framer);
      } catch (error) {
        lastError = error;
        if (!isRetryableFramerError(error)) throw error;
        await disconnectSharedFramer();
        if (attempt < FRAMER_RETRY_ATTEMPTS) {
          await sleep(FRAMER_RETRY_DELAYS_MS[Math.min(attempt - 1, FRAMER_RETRY_DELAYS_MS.length - 1)]);
        }
      }
    }

    throw upstreamUnavailable(label, lastError);
  });
}

function collectionIdentity(collection) {
  return {
    id: collection?.id || null,
    name: collection?.name || null,
    managedBy: collection?.managedBy || null,
    readonly: Boolean(collection?.readonly)
  };
}

function pageIdentity(page) {
  return {
    id: page?.id || null,
    name: page?.name || null,
    path: page?.path || "/",
    draft: Boolean(page?.draft),
    collectionId: page?.collectionId || null
  };
}

function rememberPage(page) {
  if (!page?.id) return;
  pageRefCache.set(String(page.id), String(page.id));
  if (page.path) pageRefCache.set(String(page.path), String(page.id));
}

async function listWebPages(framer) {
  const pages = await retryCall(
    "Framer web-page inventory",
    () => framer.getNodesWithType("WebPageNode")
  );
  const normalized = Array.isArray(pages) ? pages : [];
  normalized.forEach(rememberPage);
  return normalized;
}

async function findWebPage(framer, ref) {
  const value = String(ref || "").trim();
  if (!value) throw framerError("FRAMER_PAGE_REF_REQUIRED", "page ref is required");

  const cachedId = pageRefCache.get(value);
  if (cachedId) {
    const cachedNode = await retryCall(
      "Framer cached page read",
      () => framer.getNode(cachedId)
    );
    if (cachedNode && cachedNode.id === cachedId && typeof cachedNode.path === "string") {
      rememberPage(cachedNode);
      return cachedNode;
    }
    pageRefCache.delete(value);
  }

  if (!value.startsWith("/")) {
    const directNode = await retryCall(
      "Framer page ID read",
      () => framer.getNode(value)
    );
    if (directNode && directNode.id === value && typeof directNode.path === "string") {
      rememberPage(directNode);
      return directNode;
    }
  }

  const pages = await listWebPages(framer);
  return pages.find((page) => page.id === value || page.path === value) || null;
}

async function readTextNode(node) {
  const text = await retryCall(
    `Framer text read ${node?.id || "unknown"}`,
    () => node.getText()
  );
  return {
    id: node.id,
    name: node.name || null,
    text: text ?? "",
    locked: Boolean(node.locked),
    visible: node.visible !== false,
    stateHash: stateHash({ id: node.id, text: text ?? "" })
  };
}

async function pageTextSnapshot(page) {
  const textNodes = await retryCall(
    `Framer text-node inventory ${page?.path || page?.id || "page"}`,
    () => page.getNodesWithType("TextNode")
  );
  const nodes = Array.isArray(textNodes) ? textNodes : [];
  const texts = [];

  for (let index = 0; index < nodes.length; index += PAGE_TEXT_CONCURRENCY) {
    const chunk = nodes.slice(index, index + PAGE_TEXT_CONCURRENCY);
    const chunkTexts = await Promise.all(chunk.map(readTextNode));
    texts.push(...chunkTexts);
  }

  return texts;
}

async function findCollection(framer, ref) {
  const value = String(ref || "").trim();
  if (!value) throw framerError("FRAMER_COLLECTION_REF_REQUIRED", "collection ref is required");
  const collections = await retryCall(
    "Framer CMS collection inventory",
    () => framer.getCollections()
  );
  return (collections || []).find((collection) => collection.id === value || collection.name === value) || null;
}

function validateCmsPlanInput({ collectionId, itemId, fieldData, slug }) {
  if (!collectionId || !String(collectionId).trim()) {
    throw framerError("FRAMER_COLLECTION_ID_REQUIRED", "collectionId is required");
  }
  if (!itemId || !String(itemId).trim()) {
    throw framerError("FRAMER_ITEM_ID_REQUIRED", "itemId is required");
  }
  if (!fieldData || typeof fieldData !== "object" || Array.isArray(fieldData)) {
    throw framerError("FRAMER_FIELD_DATA_REQUIRED", "fieldData must be an object keyed by Framer field ID");
  }
  const fieldIds = Object.keys(fieldData);
  if (!fieldIds.length) throw framerError("FRAMER_FIELD_DATA_EMPTY", "fieldData must include at least one field");
  if (fieldIds.length > 30) throw framerError("FRAMER_TOO_MANY_FIELDS", "A single CMS plan may change at most 30 fields");
  if (slug !== undefined && (!String(slug).trim() || String(slug).length > 200)) {
    throw framerError("FRAMER_INVALID_SLUG", "slug must be a non-empty string up to 200 characters");
  }
}

export function isFramerConfigured() {
  return Boolean(process.env.FRAMER_PROJECT_URL && process.env.FRAMER_API_KEY);
}

export function getFramerPlanPolicy() {
  return {
    mode: "READ_AND_PLAN_ONLY",
    siteInventory: true,
    cmsInventory: true,
    textPlan: true,
    cmsPlan: true,
    writeSurfaceExposed: false,
    connectionMode: "SHARED_LONG_LIVED_SERIALIZED",
    retryAttempts: FRAMER_RETRY_ATTEMPTS,
    pageRefCache: true,
    pageTextConcurrency: PAGE_TEXT_CONCURRENCY,
    previewRequiresConfirmation: "PUBLISH_FRAMER_PREVIEW",
    productionRequiresConfirmation: "DEPLOY_FRAMER_PRODUCTION"
  };
}

export async function getFramerStatus() {
  return withFramer(async (framer) => {
    const project = await retryCall("Framer project info", () => framer.getProjectInfo());
    const publishInfo = await retryCall("Framer publish info", () => framer.getPublishInfo());
    const changedPaths = await retryCall("Framer changed paths", () => framer.getChangedPaths());

    return {
      configured: true,
      project: {
        id: project?.id || null,
        name: project?.name || null
      },
      publishInfo,
      changedPaths,
      planPolicy: getFramerPlanPolicy()
    };
  }, "Framer status read");
}

export async function listFramerSitePages() {
  return withFramer(async (framer) => {
    const pages = await listWebPages(framer);
    const result = [];
    for (const page of pages) {
      const textNodes = await retryCall(
        `Framer page text-node count ${page?.path || page?.id || "page"}`,
        () => page.getNodesWithType("TextNode")
      );
      result.push({
        ...pageIdentity(page),
        textNodeCount: Array.isArray(textNodes) ? textNodes.length : 0
      });
    }
    return result;
  }, "Framer site inventory");
}

export async function getFramerSitePage(ref) {
  return withFramer(async (framer) => {
    const page = await findWebPage(framer, ref);
    if (!page) throw framerError("FRAMER_PAGE_NOT_FOUND", "Framer page not found", 404);
    return {
      page: pageIdentity(page),
      textNodes: await pageTextSnapshot(page)
    };
  }, `Framer page read ${String(ref || "").trim() || "unknown"}`);
}

export async function planFramerTextUpdate(input = {}) {
  const pageRef = String(input.pageRef || "").trim();
  const nodeId = String(input.nodeId || "").trim();
  const nextText = input.text;
  if (!pageRef) throw framerError("FRAMER_PAGE_REF_REQUIRED", "pageRef is required");
  if (!nodeId) throw framerError("FRAMER_TEXT_NODE_ID_REQUIRED", "nodeId is required");
  if (typeof nextText !== "string") throw framerError("FRAMER_TEXT_REQUIRED", "text must be a string");
  if (nextText.length > 20_000) throw framerError("FRAMER_TEXT_TOO_LONG", "text may contain at most 20000 characters");

  return withFramer(async (framer) => {
    const page = await findWebPage(framer, pageRef);
    if (!page) throw framerError("FRAMER_PAGE_NOT_FOUND", "Framer page not found", 404);
    const textNodes = await retryCall(
      `Framer text-node inventory ${pageRef}`,
      () => page.getNodesWithType("TextNode")
    );
    const node = (textNodes || []).find((candidate) => candidate.id === nodeId);
    if (!node) throw framerError("FRAMER_TEXT_NODE_NOT_FOUND", "Text node was not found on the requested page", 404);
    const before = await retryCall(`Framer text read ${nodeId}`, () => node.getText()) ?? "";
    return {
      mode: "PLAN_ONLY",
      writePerformed: false,
      page: pageIdentity(page),
      node: { id: node.id, name: node.name || null },
      baseHash: stateHash({ id: node.id, text: before }),
      changed: before !== nextText,
      changes: before === nextText ? [] : [{ field: "text", before, after: nextText }]
    };
  }, `Framer text plan ${pageRef}:${nodeId}`);
}

export async function listFramerCmsCollections() {
  return withFramer(async (framer) => {
    const collections = await retryCall("Framer CMS collections", () => framer.getCollections());
    const result = [];
    for (const collection of collections || []) {
      const fields = await retryCall(
        `Framer CMS fields ${collection?.id || collection?.name || "collection"}`,
        () => collection.getFields()
      );
      const items = await retryCall(
        `Framer CMS items ${collection?.id || collection?.name || "collection"}`,
        () => collection.getItems()
      );
      result.push({
        ...collectionIdentity(collection),
        itemCount: Array.isArray(items) ? items.length : 0,
        fields: (fields || []).map((field) => ({
          id: field?.id || null,
          name: field?.name || null,
          type: field?.type || field?.fieldType || null
        }))
      });
    }
    return result;
  }, "Framer CMS inventory");
}

export async function getFramerCmsCollection(ref) {
  return withFramer(async (framer) => {
    const collection = await findCollection(framer, ref);
    if (!collection) throw framerError("FRAMER_COLLECTION_NOT_FOUND", "Framer CMS collection not found", 404);
    const fields = await retryCall(
      `Framer CMS fields ${collection.id || collection.name || "collection"}`,
      () => collection.getFields()
    );
    const items = await retryCall(
      `Framer CMS items ${collection.id || collection.name || "collection"}`,
      () => collection.getItems()
    );
    return {
      collection: collectionIdentity(collection),
      fields: (fields || []).map((field) => ({
        id: field?.id || null,
        name: field?.name || null,
        type: field?.type || field?.fieldType || null
      })),
      items: (items || []).map((item) => ({
        id: item.id,
        slug: item.slug || "",
        fieldData: item.fieldData || {},
        stateHash: stateHash({ id: item.id, slug: item.slug || "", fieldData: item.fieldData || {} })
      }))
    };
  }, `Framer CMS collection read ${String(ref || "").trim() || "unknown"}`);
}

export async function planFramerCmsItemUpdate(input = {}) {
  validateCmsPlanInput(input);
  return withFramer(async (framer) => {
    const collection = await findCollection(framer, String(input.collectionId).trim());
    if (!collection) throw framerError("FRAMER_COLLECTION_NOT_FOUND", "Framer CMS collection not found", 404);
    const items = await retryCall(`Framer CMS items ${collection.id}`, () => collection.getItems());
    const item = (items || []).find((candidate) => candidate.id === String(input.itemId).trim());
    if (!item) throw framerError("FRAMER_ITEM_NOT_FOUND", "Framer CMS item not found", 404);

    const beforeFieldData = item.fieldData || {};
    const beforeSlug = item.slug || "";
    const afterSlug = input.slug === undefined ? beforeSlug : String(input.slug).trim();
    const changes = [];
    for (const fieldId of Object.keys(input.fieldData)) {
      const before = beforeFieldData[fieldId];
      const after = input.fieldData[fieldId];
      if (canonicalJson(before) !== canonicalJson(after)) {
        changes.push({ fieldId, before: before ?? null, after });
      }
    }
    if (beforeSlug !== afterSlug) changes.push({ fieldId: "$slug", before: beforeSlug, after: afterSlug });

    return {
      mode: "PLAN_ONLY",
      writePerformed: false,
      collection: collectionIdentity(collection),
      item: { id: item.id, slug: beforeSlug },
      baseHash: stateHash({ id: item.id, slug: beforeSlug, fieldData: beforeFieldData }),
      changed: changes.length > 0,
      changes
    };
  }, `Framer CMS plan ${String(input.collectionId).trim()}:${String(input.itemId).trim()}`);
}

export async function publishFramerPreview() {
  return withFramer(async (framer) => {
    const before = await retryCall("Framer changed paths before preview", () => framer.getChangedPaths());
    const result = await retryCall("Framer preview publish", () => framer.publish());
    return {
      mode: "PREVIEW_ONLY",
      productionDeployed: false,
      changedPaths: before,
      deployment: result?.deployment || null,
      hostnames: result?.hostnames || null
    };
  }, "Framer preview publish");
}

export async function deployFramerProduction(deploymentId) {
  if (!deploymentId || !String(deploymentId).trim()) {
    const error = new Error("deploymentId is required");
    error.code = "INVALID_DEPLOYMENT_ID";
    error.status = 400;
    throw error;
  }

  return withFramer(async (framer) => {
    await retryCall("Framer production deploy", () => framer.deploy(String(deploymentId).trim()));
    return {
      mode: "PRODUCTION_DEPLOY",
      deployed: true,
      deploymentId: String(deploymentId).trim()
    };
  }, "Framer production deploy");
}
