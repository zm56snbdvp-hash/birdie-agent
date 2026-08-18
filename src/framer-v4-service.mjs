import { createHash } from "node:crypto";

import {
  planFramerTextUpdate,
  planFramerCmsItemUpdate
} from "./framer-service.mjs";

const V4_VERSION = "FRAMER_V4_BRANCH_PREVIEW_V1";
const MAX_TEXT_LENGTH = 20_000;
const MAX_CMS_FIELDS = 30;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireConfig() {
  const projectUrl = process.env.FRAMER_PROJECT_URL;
  const apiKey = process.env.FRAMER_API_KEY;
  if (!projectUrl || !apiKey) {
    throw fail("FRAMER_NOT_CONFIGURED", "FRAMER_PROJECT_URL and FRAMER_API_KEY are required", 503);
  }
  return { projectUrl, apiKey };
}

function normalizeTextInput(input = {}) {
  const pageRef = String(input.pageRef || "").trim();
  const nodeId = String(input.nodeId || "").trim();
  const text = input.text;
  if (!pageRef) throw fail("FRAMER_PAGE_REF_REQUIRED", "pageRef is required");
  if (!nodeId) throw fail("FRAMER_TEXT_NODE_ID_REQUIRED", "nodeId is required");
  if (typeof text !== "string") throw fail("FRAMER_TEXT_REQUIRED", "text must be a string");
  if (text.length > MAX_TEXT_LENGTH) throw fail("FRAMER_TEXT_TOO_LONG", `text may contain at most ${MAX_TEXT_LENGTH} characters`);
  return { pageRef, nodeId, text };
}

function normalizeCmsInput(input = {}) {
  const collectionId = String(input.collectionId || "").trim();
  const itemId = String(input.itemId || "").trim();
  const fieldData = input.fieldData;
  if (!collectionId) throw fail("FRAMER_COLLECTION_ID_REQUIRED", "collectionId is required");
  if (!itemId) throw fail("FRAMER_ITEM_ID_REQUIRED", "itemId is required");
  if (!fieldData || typeof fieldData !== "object" || Array.isArray(fieldData)) {
    throw fail("FRAMER_FIELD_DATA_REQUIRED", "fieldData must be an object keyed by Framer field ID");
  }
  const fieldIds = Object.keys(fieldData);
  if (!fieldIds.length) throw fail("FRAMER_FIELD_DATA_EMPTY", "fieldData must include at least one field");
  if (fieldIds.length > MAX_CMS_FIELDS) throw fail("FRAMER_TOO_MANY_FIELDS", `A single CMS operation may change at most ${MAX_CMS_FIELDS} fields`);
  const slug = input.slug === undefined ? undefined : String(input.slug).trim();
  if (slug !== undefined && (!slug || slug.length > 200)) {
    throw fail("FRAMER_INVALID_SLUG", "slug must be a non-empty string up to 200 characters");
  }
  return { collectionId, itemId, fieldData, slug };
}

function textPlanPayload(input, baseHash) {
  return {
    version: V4_VERSION,
    kind: "TEXT",
    pageRef: input.pageRef,
    nodeId: input.nodeId,
    text: input.text,
    baseHash
  };
}

function cmsPlanPayload(input, baseHash) {
  return {
    version: V4_VERSION,
    kind: "CMS",
    collectionId: input.collectionId,
    itemId: input.itemId,
    fieldData: input.fieldData,
    slug: input.slug === undefined ? null : input.slug,
    baseHash
  };
}

function exactConfirmation(planHash) {
  return `APPLY_FRAMER_V4_BRANCH_PREVIEW:${planHash}`;
}

function requireBoundApproval(input, calculatedPlanHash) {
  const suppliedPlanHash = String(input.planHash || "").trim();
  const baseHash = String(input.baseHash || "").trim();
  if (!baseHash) throw fail("FRAMER_V4_BASE_HASH_REQUIRED", "baseHash is required");
  if (!suppliedPlanHash) throw fail("FRAMER_V4_PLAN_HASH_REQUIRED", "planHash is required");
  if (suppliedPlanHash !== calculatedPlanHash) {
    throw fail("FRAMER_V4_PLAN_HASH_MISMATCH", "The supplied planHash does not bind to this exact operation", 409);
  }
  if (input.confirmation !== exactConfirmation(calculatedPlanHash)) {
    throw fail(
      "FOUNDER_CONFIRMATION_REQUIRED",
      `Explicit confirmation required: ${exactConfirmation(calculatedPlanHash)}`,
      403
    );
  }
}

function branchIdentity(branch) {
  return {
    id: branch?.id || null,
    url: branch?.url || null,
    title: branch?.title || branch?.name || null,
    baseId: branch?.base?.id || null
  };
}

function assertBranchRuntime(framer) {
  for (const method of ["getActiveBranch", "getBranch", "createBranch", "publish"]) {
    if (typeof framer?.[method] !== "function") {
      throw fail(
        "FRAMER_V4_BRANCH_RUNTIME_UNAVAILABLE",
        `Safe V4 requires Framer branching method ${method}; refusing to write without it`,
        503
      );
    }
  }
}

async function assertPermission(framer, method) {
  if (typeof framer.isAllowedTo !== "function") return;
  const allowed = await framer.isAllowedTo(method);
  if (!allowed) throw fail("FRAMER_V4_PERMISSION_DENIED", `Framer permission denied for ${method}`, 403);
}

async function connectV4() {
  const { projectUrl, apiKey } = requireConfig();
  const { connect } = await import("framer-api");
  return connect(projectUrl, apiKey);
}

async function listPages(framer) {
  const pages = await framer.getNodesWithType("WebPageNode");
  return Array.isArray(pages) ? pages : [];
}

async function findPage(framer, ref) {
  const value = String(ref || "").trim();
  if (!value) return null;
  if (!value.startsWith("/") && typeof framer.getNode === "function") {
    const direct = await framer.getNode(value);
    if (direct && direct.id === value && typeof direct.path === "string") return direct;
  }
  const pages = await listPages(framer);
  return pages.find((page) => page?.id === value || page?.path === value) || null;
}

async function findTextNode(framer, pageRef, nodeId) {
  const page = await findPage(framer, pageRef);
  if (!page) throw fail("FRAMER_PAGE_NOT_FOUND", "Framer page not found", 404);
  const nodes = await page.getNodesWithType("TextNode");
  const node = (nodes || []).find((candidate) => candidate?.id === nodeId);
  if (!node) throw fail("FRAMER_TEXT_NODE_NOT_FOUND", "Text node was not found on the requested page", 404);
  return { page, node };
}

async function findCmsItem(framer, collectionId, itemId) {
  let collection = null;
  if (typeof framer.getCollection === "function") {
    collection = await framer.getCollection(collectionId);
  }
  if (!collection) {
    const collections = await framer.getCollections();
    collection = (collections || []).find((candidate) => candidate?.id === collectionId) || null;
  }
  if (!collection) throw fail("FRAMER_COLLECTION_NOT_FOUND", "Framer CMS collection not found", 404);
  const items = await collection.getItems();
  const item = (items || []).find((candidate) => candidate?.id === itemId);
  if (!item) throw fail("FRAMER_ITEM_NOT_FOUND", "Framer CMS item not found", 404);
  return { collection, item };
}

function textState(nodeId, text) {
  return hash({ id: nodeId, text: text ?? "" });
}

function cmsState(item) {
  return hash({
    id: item.id,
    slug: item.slug || "",
    fieldData: item.fieldData || {}
  });
}

async function establishIsolatedBranch(framer, title) {
  assertBranchRuntime(framer);
  await assertPermission(framer, "createBranch");
  await assertPermission(framer, "publish");

  const main = await framer.getBranch("main");
  if (!main || typeof main.switch !== "function") {
    throw fail("FRAMER_V4_MAIN_BRANCH_UNAVAILABLE", "Main branch is unavailable or cannot be restored", 503);
  }

  const active = await framer.getActiveBranch();
  if (!active || active.base !== null) {
    throw fail("FRAMER_V4_MAIN_REQUIRED", "Safe V4 must start from main; refusing to branch from a branch", 409);
  }

  const branch = await framer.createBranch({ title });
  const branchId = branch?.id || null;
  if (!branchId || branchId === "main" || branch?.base === null) {
    throw fail("FRAMER_V4_BRANCH_ISOLATION_FAILED", "Framer did not return a verifiably isolated child branch", 503);
  }

  const activeAfterCreate = await framer.getActiveBranch();
  if (!activeAfterCreate || activeAfterCreate.id !== branchId || activeAfterCreate.base === null) {
    throw fail("FRAMER_V4_BRANCH_SWITCH_FAILED", "The created branch is not the active isolated branch", 503);
  }

  return { main, branch: activeAfterCreate };
}

async function publishActiveBranch(framer, expectedBranchId) {
  const active = await framer.getActiveBranch();
  if (!active || active.id !== expectedBranchId || active.base === null) {
    throw fail("FRAMER_V4_PREVIEW_BRANCH_GUARD", "Refusing publish because the active branch is not the isolated V4 branch", 409);
  }
  const result = await framer.publish();
  return {
    deployment: result?.deployment || null,
    hostnames: result?.hostnames || null
  };
}

function safeBranchTitle(kind, input = {}) {
  const requested = String(input.branchTitle || "").trim();
  if (requested) return requested.slice(0, 120);
  return `Birdie V4 ${kind} Preview ${new Date().toISOString().slice(0, 19)}`;
}

export function getFramerV4Policy() {
  return {
    version: V4_VERSION,
    mode: "APPLY_ON_ISOLATED_BRANCH_THEN_BRANCH_PREVIEW",
    productionDeployExposed: false,
    legacyPreviewDisabled: true,
    stalePlanProtection: "baseHash",
    approvalBinding: "planHash",
    branchRequired: true,
    startsFromMainRequired: true,
    readbackRequired: true,
    publishTarget: "ACTIVE_CHILD_BRANCH_ONLY",
    deployCalled: false
  };
}

export async function planFramerV4TextUpdate(input = {}) {
  const normalized = normalizeTextInput(input);
  const plan = await planFramerTextUpdate(normalized);
  const planHash = hash(textPlanPayload(normalized, plan.baseHash));
  return {
    ...plan,
    version: V4_VERSION,
    planHash,
    requiredConfirmation: exactConfirmation(planHash),
    executionTarget: "ISOLATED_BRANCH_PREVIEW"
  };
}

export async function planFramerV4CmsItemUpdate(input = {}) {
  const normalized = normalizeCmsInput(input);
  const plan = await planFramerCmsItemUpdate(normalized);
  const planHash = hash(cmsPlanPayload(normalized, plan.baseHash));
  return {
    ...plan,
    version: V4_VERSION,
    planHash,
    requiredConfirmation: exactConfirmation(planHash),
    executionTarget: "ISOLATED_BRANCH_PREVIEW"
  };
}

export async function applyFramerV4TextPreview(input = {}) {
  const normalized = normalizeTextInput(input);
  const baseHash = String(input.baseHash || "").trim();
  const calculatedPlanHash = hash(textPlanPayload(normalized, baseHash));
  requireBoundApproval(input, calculatedPlanHash);

  const framer = await connectV4();
  let main = null;
  let branch = null;
  let result = null;
  let operationError = null;

  try {
    ({ main, branch } = await establishIsolatedBranch(framer, safeBranchTitle("Text", input)));
    const { node } = await findTextNode(framer, normalized.pageRef, normalized.nodeId);
    if (node.locked) throw fail("FRAMER_V4_TARGET_LOCKED", "Text node is locked", 409);
    if (typeof node.setText !== "function") throw fail("FRAMER_V4_TEXT_WRITE_UNAVAILABLE", "Text node cannot be written by this runtime", 503);

    const before = await node.getText() ?? "";
    if (textState(node.id, before) !== baseHash) {
      throw fail("FRAMER_V4_STALE_PLAN", "Text node changed since PLAN_ONLY; re-plan before applying", 409);
    }

    if (before !== normalized.text) await node.setText(normalized.text);
    const after = await node.getText() ?? "";
    if (after !== normalized.text) throw fail("FRAMER_V4_READBACK_FAILED", "Text readback did not match the approved value", 502);

    const preview = await publishActiveBranch(framer, branch.id);
    result = {
      mode: "BRANCH_PREVIEW",
      writePerformed: before !== after,
      productionDeployed: false,
      planHash: calculatedPlanHash,
      baseHash,
      afterHash: textState(node.id, after),
      branch: branchIdentity(branch),
      preview
    };
  } catch (error) {
    operationError = error;
  } finally {
    if (main && typeof main.switch === "function") {
      try {
        await main.switch();
      } catch (restoreError) {
        if (!operationError) {
          operationError = fail(
            "FRAMER_V4_MAIN_RESTORE_FAILED",
            `Branch operation completed but restoring main failed: ${String(restoreError?.message || restoreError)}`,
            502
          );
        }
      }
    }
    try { await framer.disconnect(); } catch { /* best-effort cleanup */ }
  }

  if (operationError) throw operationError;
  return result;
}

export async function applyFramerV4CmsPreview(input = {}) {
  const normalized = normalizeCmsInput(input);
  const baseHash = String(input.baseHash || "").trim();
  const calculatedPlanHash = hash(cmsPlanPayload(normalized, baseHash));
  requireBoundApproval(input, calculatedPlanHash);

  const framer = await connectV4();
  let main = null;
  let branch = null;
  let result = null;
  let operationError = null;

  try {
    ({ main, branch } = await establishIsolatedBranch(framer, safeBranchTitle("CMS", input)));
    const { item } = await findCmsItem(framer, normalized.collectionId, normalized.itemId);
    if (typeof item.setAttributes !== "function") {
      throw fail("FRAMER_V4_CMS_WRITE_UNAVAILABLE", "CMS item cannot be written by this runtime", 503);
    }
    if (cmsState(item) !== baseHash) {
      throw fail("FRAMER_V4_STALE_PLAN", "CMS item changed since PLAN_ONLY; re-plan before applying", 409);
    }

    const beforeSlug = item.slug || "";
    const beforeFieldData = item.fieldData || {};
    const afterSlug = normalized.slug === undefined ? beforeSlug : normalized.slug;
    const afterFieldData = { ...beforeFieldData, ...normalized.fieldData };
    const changed = beforeSlug !== afterSlug || canonicalJson(beforeFieldData) !== canonicalJson(afterFieldData);

    if (changed) {
      await item.setAttributes({ slug: afterSlug, fieldData: afterFieldData });
    }

    const { item: readback } = await findCmsItem(framer, normalized.collectionId, normalized.itemId);
    if ((readback.slug || "") !== afterSlug) {
      throw fail("FRAMER_V4_READBACK_FAILED", "CMS slug readback did not match the approved value", 502);
    }
    for (const [fieldId, expected] of Object.entries(normalized.fieldData)) {
      if (canonicalJson(readback.fieldData?.[fieldId]) !== canonicalJson(expected)) {
        throw fail("FRAMER_V4_READBACK_FAILED", `CMS field ${fieldId} readback did not match the approved value`, 502);
      }
    }

    const preview = await publishActiveBranch(framer, branch.id);
    result = {
      mode: "BRANCH_PREVIEW",
      writePerformed: changed,
      productionDeployed: false,
      planHash: calculatedPlanHash,
      baseHash,
      afterHash: cmsState(readback),
      branch: branchIdentity(branch),
      preview
    };
  } catch (error) {
    operationError = error;
  } finally {
    if (main && typeof main.switch === "function") {
      try {
        await main.switch();
      } catch (restoreError) {
        if (!operationError) {
          operationError = fail(
            "FRAMER_V4_MAIN_RESTORE_FAILED",
            `Branch operation completed but restoring main failed: ${String(restoreError?.message || restoreError)}`,
            502
          );
        }
      }
    }
    try { await framer.disconnect(); } catch { /* best-effort cleanup */ }
  }

  if (operationError) throw operationError;
  return result;
}
