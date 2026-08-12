import { createHash } from "node:crypto";

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

async function withFramer(operation) {
  const { projectUrl, apiKey } = requireConfig();
  const { connect } = await import("framer-api");
  const framer = await connect(projectUrl, apiKey);
  try {
    return await operation(framer);
  } finally {
    await framer.disconnect();
  }
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

async function listWebPages(framer) {
  const pages = await framer.getNodesWithType("WebPageNode");
  return Array.isArray(pages) ? pages : [];
}

async function findWebPage(framer, ref) {
  const value = String(ref || "").trim();
  if (!value) throw framerError("FRAMER_PAGE_REF_REQUIRED", "page ref is required");
  const pages = await listWebPages(framer);
  return pages.find((page) => page.id === value || page.path === value) || null;
}

async function pageTextSnapshot(page) {
  const textNodes = await page.getNodesWithType("TextNode");
  const texts = await Promise.all((textNodes || []).map(async (node) => {
    const text = await node.getText();
    return {
      id: node.id,
      name: node.name || null,
      text: text ?? "",
      locked: Boolean(node.locked),
      visible: node.visible !== false,
      stateHash: stateHash({ id: node.id, text: text ?? "" })
    };
  }));
  return texts;
}

async function findCollection(framer, ref) {
  const value = String(ref || "").trim();
  if (!value) throw framerError("FRAMER_COLLECTION_REF_REQUIRED", "collection ref is required");
  const collections = await framer.getCollections();
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
    previewRequiresConfirmation: "PUBLISH_FRAMER_PREVIEW",
    productionRequiresConfirmation: "DEPLOY_FRAMER_PRODUCTION"
  };
}

export async function getFramerStatus() {
  return withFramer(async (framer) => {
    const [project, publishInfo, changedPaths] = await Promise.all([
      framer.getProjectInfo(),
      framer.getPublishInfo(),
      framer.getChangedPaths()
    ]);

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
  });
}

export async function listFramerSitePages() {
  return withFramer(async (framer) => {
    const pages = await listWebPages(framer);
    return Promise.all(pages.map(async (page) => {
      const textNodes = await page.getNodesWithType("TextNode");
      return {
        ...pageIdentity(page),
        textNodeCount: Array.isArray(textNodes) ? textNodes.length : 0
      };
    }));
  });
}

export async function getFramerSitePage(ref) {
  return withFramer(async (framer) => {
    const page = await findWebPage(framer, ref);
    if (!page) throw framerError("FRAMER_PAGE_NOT_FOUND", "Framer page not found", 404);
    return {
      page: pageIdentity(page),
      textNodes: await pageTextSnapshot(page)
    };
  });
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
    const textNodes = await page.getNodesWithType("TextNode");
    const node = (textNodes || []).find((candidate) => candidate.id === nodeId);
    if (!node) throw framerError("FRAMER_TEXT_NODE_NOT_FOUND", "Text node was not found on the requested page", 404);
    const before = await node.getText() ?? "";
    return {
      mode: "PLAN_ONLY",
      writePerformed: false,
      page: pageIdentity(page),
      node: { id: node.id, name: node.name || null },
      baseHash: stateHash({ id: node.id, text: before }),
      changed: before !== nextText,
      changes: before === nextText ? [] : [{ field: "text", before, after: nextText }]
    };
  });
}

export async function listFramerCmsCollections() {
  return withFramer(async (framer) => {
    const collections = await framer.getCollections();
    return Promise.all((collections || []).map(async (collection) => {
      const fields = await collection.getFields();
      const items = await collection.getItems();
      return {
        ...collectionIdentity(collection),
        itemCount: Array.isArray(items) ? items.length : 0,
        fields: (fields || []).map((field) => ({
          id: field?.id || null,
          name: field?.name || null,
          type: field?.type || field?.fieldType || null
        }))
      };
    }));
  });
}

export async function getFramerCmsCollection(ref) {
  return withFramer(async (framer) => {
    const collection = await findCollection(framer, ref);
    if (!collection) throw framerError("FRAMER_COLLECTION_NOT_FOUND", "Framer CMS collection not found", 404);
    const [fields, items] = await Promise.all([collection.getFields(), collection.getItems()]);
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
  });
}

export async function planFramerCmsItemUpdate(input = {}) {
  validateCmsPlanInput(input);
  return withFramer(async (framer) => {
    const collection = await findCollection(framer, String(input.collectionId).trim());
    if (!collection) throw framerError("FRAMER_COLLECTION_NOT_FOUND", "Framer CMS collection not found", 404);
    const items = await collection.getItems();
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
  });
}

export async function publishFramerPreview() {
  return withFramer(async (framer) => {
    const before = await framer.getChangedPaths();
    const result = await framer.publish();
    return {
      mode: "PREVIEW_ONLY",
      productionDeployed: false,
      changedPaths: before,
      deployment: result?.deployment || null,
      hostnames: result?.hostnames || null
    };
  });
}

export async function deployFramerProduction(deploymentId) {
  if (!deploymentId || !String(deploymentId).trim()) {
    const error = new Error("deploymentId is required");
    error.code = "INVALID_DEPLOYMENT_ID";
    error.status = 400;
    throw error;
  }

  return withFramer(async (framer) => {
    await framer.deploy(String(deploymentId).trim());
    return {
      mode: "PRODUCTION_DEPLOY",
      deployed: true,
      deploymentId: String(deploymentId).trim()
    };
  });
}
