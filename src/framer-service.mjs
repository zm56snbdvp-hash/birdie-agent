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

function configuredCollectionAllowlist(env = process.env) {
  return String(env.FRAMER_CMS_WRITE_ALLOWLIST || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function itemHash(item) {
  return createHash("sha256").update(canonicalJson({
    id: item?.id || null,
    slug: item?.slug || null,
    fieldData: item?.fieldData || {}
  })).digest("hex");
}

function cmsError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function collectionIdentity(collection) {
  return {
    id: collection?.id || null,
    name: collection?.name || null,
    managedBy: collection?.managedBy || null,
    readonly: Boolean(collection?.readonly)
  };
}

export function getFramerCollectionWriteEligibility(collection, env = process.env) {
  if (!collection) {
    return {
      eligible: false,
      code: "FRAMER_COLLECTION_NOT_FOUND",
      status: 404,
      reason: "Framer CMS collection not found"
    };
  }

  // Framer now recommends managedBy + permission-aware checks instead of
  // relying on the deprecated readonly property. Birdie intentionally edits
  // only user-managed CMS collections and fails closed for every other owner.
  if (collection.managedBy !== "user") {
    return {
      eligible: false,
      code: "FRAMER_COLLECTION_NOT_USER_MANAGED",
      status: 403,
      reason: `Framer CMS collection is not user-managed: ${collection.managedBy || "unknown"}`
    };
  }

  // Keep readonly as a secondary compatibility guard while Framer completes
  // the transition to managedBy / granular permission checks.
  if (collection.readonly === true) {
    return {
      eligible: false,
      code: "FRAMER_COLLECTION_READ_ONLY",
      status: 403,
      reason: "Framer CMS collection is read-only"
    };
  }

  const allowlist = configuredCollectionAllowlist(env);
  if (!allowlist.length) {
    return {
      eligible: false,
      code: "FRAMER_CMS_WRITE_ALLOWLIST_EMPTY",
      status: 403,
      reason: "FRAMER_CMS_WRITE_ALLOWLIST must explicitly allow CMS collection IDs or names before writes are enabled"
    };
  }

  if (!allowlist.includes(collection.id) && !allowlist.includes(collection.name)) {
    return {
      eligible: false,
      code: "FRAMER_COLLECTION_NOT_ALLOWED",
      status: 403,
      reason: `Framer CMS collection is not write-allowlisted: ${collection.name || collection.id}`
    };
  }

  return {
    eligible: true,
    code: null,
    status: 200,
    reason: "USER_MANAGED_AND_ALLOWLISTED"
  };
}

function assertCollectionWritable(collection, env = process.env) {
  const eligibility = getFramerCollectionWriteEligibility(collection, env);
  if (!eligibility.eligible) {
    throw cmsError(eligibility.code, eligibility.reason, eligibility.status);
  }
}

function validateCmsUpdateInput({ collectionId, itemId, fieldData, slug }) {
  if (!collectionId || !String(collectionId).trim()) {
    throw cmsError("FRAMER_COLLECTION_ID_REQUIRED", "collectionId is required");
  }
  if (!itemId || !String(itemId).trim()) {
    throw cmsError("FRAMER_ITEM_ID_REQUIRED", "itemId is required");
  }
  if (!fieldData || typeof fieldData !== "object" || Array.isArray(fieldData)) {
    throw cmsError("FRAMER_FIELD_DATA_REQUIRED", "fieldData must be an object keyed by Framer field ID");
  }
  const fieldIds = Object.keys(fieldData);
  if (!fieldIds.length) throw cmsError("FRAMER_FIELD_DATA_EMPTY", "fieldData must include at least one field");
  if (fieldIds.length > 30) throw cmsError("FRAMER_TOO_MANY_FIELDS", "A single governed CMS update may change at most 30 fields");
  if (slug !== undefined && (!String(slug).trim() || String(slug).length > 200)) {
    throw cmsError("FRAMER_INVALID_SLUG", "slug must be a non-empty string up to 200 characters");
  }
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

async function findCollection(framer, collectionId) {
  const collections = await framer.getCollections();
  return collections.find((collection) => collection.id === collectionId) || null;
}

async function buildCmsPlan(framer, input, env = process.env) {
  validateCmsUpdateInput(input);
  const collection = await findCollection(framer, String(input.collectionId).trim());
  assertCollectionWritable(collection, env);

  const items = await collection.getItems();
  const item = items.find((candidate) => candidate.id === String(input.itemId).trim());
  if (!item) throw cmsError("FRAMER_ITEM_NOT_FOUND", "Framer CMS item not found", 404);

  const beforeFieldData = item.fieldData || {};
  const afterFieldData = { ...beforeFieldData, ...input.fieldData };
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
    collection: collectionIdentity(collection),
    item: {
      id: item.id,
      slug: beforeSlug
    },
    baseHash: itemHash(item),
    changes,
    changed: changes.length > 0,
    nextItem: {
      id: item.id,
      slug: afterSlug,
      fieldData: afterFieldData
    }
  };
}

export function isFramerConfigured() {
  return Boolean(process.env.FRAMER_PROJECT_URL && process.env.FRAMER_API_KEY);
}

export function getFramerCmsWritePolicy(env = process.env) {
  const allowlist = configuredCollectionAllowlist(env);
  return {
    mode: "ALLOWLIST_ONLY",
    writeEnabled: allowlist.length > 0,
    allowedCollections: allowlist,
    collectionOwnership: "USER_MANAGED_ONLY",
    permissionModel: "FRAMER_ENFORCED_FAIL_CLOSED",
    applyConfirmation: "APPLY_FRAMER_CMS_CHANGE",
    previewConfirmation: "PUBLISH_FRAMER_PREVIEW",
    productionConfirmation: "DEPLOY_FRAMER_PRODUCTION",
    optimisticLock: "SHA256_ITEM_STATE"
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
      cmsWritePolicy: getFramerCmsWritePolicy()
    };
  });
}

export async function listFramerCmsCollections() {
  return withFramer(async (framer) => {
    const collections = await framer.getCollections();
    return Promise.all(collections.map(async (collection) => {
      const fields = await collection.getFields();
      return {
        ...collectionIdentity(collection),
        fields: fields.map((field) => ({
          id: field?.id || null,
          name: field?.name || null,
          type: field?.type || field?.fieldType || null
        }))
      };
    }));
  });
}

export async function getFramerCmsCollection(collectionId) {
  if (!collectionId || !String(collectionId).trim()) {
    throw cmsError("FRAMER_COLLECTION_ID_REQUIRED", "collectionId is required");
  }
  return withFramer(async (framer) => {
    const collection = await findCollection(framer, String(collectionId).trim());
    if (!collection) throw cmsError("FRAMER_COLLECTION_NOT_FOUND", "Framer CMS collection not found", 404);
    const [fields, items] = await Promise.all([collection.getFields(), collection.getItems()]);
    return {
      collection: collectionIdentity(collection),
      fields: fields.map((field) => ({
        id: field?.id || null,
        name: field?.name || null,
        type: field?.type || field?.fieldType || null
      })),
      items: items.map((item) => ({
        id: item.id,
        slug: item.slug || "",
        fieldData: item.fieldData || {},
        stateHash: itemHash(item)
      }))
    };
  });
}

export async function planFramerCmsItemUpdate(input) {
  return withFramer(async (framer) => {
    const plan = await buildCmsPlan(framer, input);
    return {
      mode: "PLAN_ONLY",
      writePerformed: false,
      ...plan,
      nextItem: undefined
    };
  });
}

export async function applyFramerCmsItemUpdate(input) {
  if (!input?.baseHash || !String(input.baseHash).trim()) {
    throw cmsError("FRAMER_BASE_HASH_REQUIRED", "baseHash from a fresh CMS plan is required");
  }

  return withFramer(async (framer) => {
    const plan = await buildCmsPlan(framer, input);
    if (plan.baseHash !== String(input.baseHash).trim()) {
      throw cmsError(
        "FRAMER_CMS_STATE_CHANGED",
        "Framer CMS item changed after the plan was created. Create a fresh plan before applying.",
        409
      );
    }

    if (!plan.changed) {
      return {
        mode: "APPLY",
        writePerformed: false,
        reason: "NO_CHANGES",
        collection: plan.collection,
        item: plan.item,
        baseHash: plan.baseHash,
        changes: []
      };
    }

    const collection = await findCollection(framer, String(input.collectionId).trim());
    assertCollectionWritable(collection);
    await collection.addItems([plan.nextItem]);

    const refreshedItems = await collection.getItems();
    const refreshed = refreshedItems.find((candidate) => candidate.id === String(input.itemId).trim());
    if (!refreshed) throw cmsError("FRAMER_ITEM_VERIFY_FAILED", "Updated Framer CMS item could not be re-read", 502);

    return {
      mode: "APPLY",
      writePerformed: true,
      collection: plan.collection,
      item: {
        id: refreshed.id,
        slug: refreshed.slug || ""
      },
      previousHash: plan.baseHash,
      newHash: itemHash(refreshed),
      changes: plan.changes,
      productionDeployed: false
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
