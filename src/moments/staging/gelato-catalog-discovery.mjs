const GELATO_PRODUCT_BASE = "https://product.gelatoapis.com";

export const BIRDIE_MOMENTS_GELATO_TARGET = Object.freeze({
  catalogUid: "posters",
  requiredAttributes: Object.freeze({
    PaperFormat: "A3",
    Orientation: "ver"
  })
});

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

async function jsonOrThrow(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return body;
}

export async function discoverGelatoA3PosterProducts({
  apiKey,
  fetchImpl = globalThis.fetch,
  target = BIRDIE_MOMENTS_GELATO_TARGET,
  limit = 200
}) {
  const key = requireText(apiKey, "Gelato API key");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  const headers = { "X-API-KEY": key, accept: "application/json" };
  const catalog = await jsonOrThrow(
    await fetchImpl(`${GELATO_PRODUCT_BASE}/v3/catalogs/${encodeURIComponent(target.catalogUid)}`, {
      headers
    }),
    "Gelato catalog"
  );

  const attributes = new Map(
    (catalog?.productAttributes ?? []).map((entry) => [
      entry.productAttributeUid,
      new Set((entry.values ?? []).map((value) => value.productAttributeValueUid))
    ])
  );

  for (const [attribute, value] of Object.entries(target.requiredAttributes)) {
    if (!attributes.get(attribute)?.has(value)) {
      throw new Error(`Gelato catalog ${target.catalogUid} does not expose ${attribute}=${value}`);
    }
  }

  const searchBody = {
    attributeFilters: Object.fromEntries(
      Object.entries(target.requiredAttributes).map(([attribute, value]) => [attribute, [value]])
    ),
    limit,
    offset: 0
  };
  const search = await jsonOrThrow(
    await fetchImpl(`${GELATO_PRODUCT_BASE}/v3/catalogs/${encodeURIComponent(target.catalogUid)}/products:search`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(searchBody)
    }),
    "Gelato product search"
  );

  const candidates = (search?.products ?? [])
    .filter((product) => {
      return Object.entries(target.requiredAttributes).every(
        ([attribute, value]) => String(product?.attributes?.[attribute]) === String(value)
      );
    })
    .map((product) => ({
      productUid: product.productUid,
      title: product.title ?? null,
      attributes: product.attributes ?? {}
    }))
    .sort((a, b) => String(a.productUid).localeCompare(String(b.productUid)));

  return Object.freeze({
    catalogUid: target.catalogUid,
    requiredAttributes: target.requiredAttributes,
    candidateCount: candidates.length,
    candidates
  });
}

export async function validateConfiguredGelatoA3Product({
  apiKey,
  productUid,
  fetchImpl = globalThis.fetch,
  target = BIRDIE_MOMENTS_GELATO_TARGET
}) {
  const key = requireText(apiKey, "Gelato API key");
  const uid = requireText(productUid, "Gelato product UID");
  const response = await fetchImpl(`${GELATO_PRODUCT_BASE}/v3/products/${encodeURIComponent(uid)}`, {
    headers: { "X-API-KEY": key, accept: "application/json" }
  });
  const product = await jsonOrThrow(response, "Gelato product validation");
  const matches = Object.entries(target.requiredAttributes).every(
    ([attribute, value]) => String(product?.attributes?.[attribute]) === String(value)
  );
  if (!matches || product?.isPrintable !== true) {
    throw new Error(`Gelato product ${uid} is not a printable A3 portrait poster`);
  }
  return Object.freeze({
    status: "READY",
    productUid: uid,
    attributes: product.attributes ?? {}
  });
}
