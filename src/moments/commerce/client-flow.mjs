function checkoutStorageKey(momentId, sku) {
  return `birdie-moment-checkout:${momentId}:${sku}`;
}

function stableCheckoutKey(momentId, sku, createId) {
  if (typeof window === "undefined" || !window.sessionStorage) return createId();
  const storageKey = checkoutStorageKey(momentId, sku);
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const created = createId();
  window.sessionStorage.setItem(storageKey, created);
  return created;
}

export function clearCheckoutKey(momentId, sku) {
  if (typeof window !== "undefined" && window.sessionStorage) {
    window.sessionStorage.removeItem(checkoutStorageKey(momentId, sku));
  }
}

export async function beginMomentPurchase({
  momentId,
  sku,
  shippingAddress = null,
  fetchImpl = fetch,
  createId = () => crypto.randomUUID(),
  idempotencyKey = null
}) {
  const key = idempotencyKey ?? stableCheckoutKey(momentId, sku, createId);
  const response = await fetchImpl(`/api/moments/${encodeURIComponent(momentId)}/checkout`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku, idempotencyKey: key, shippingAddress })
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) {
    if (["PAYMENT_ATTEMPT_FAILED", "CHECKOUT_CREATION_FAILED", "INVALID_PROVIDER_CHECKOUT"].includes(payload?.error)) {
      clearCheckoutKey(momentId, sku);
    }
    throw new Error(payload?.error ?? "MOMENT_CHECKOUT_FAILED");
  }
  if (payload.data?.alreadyPurchased) {
    clearCheckoutKey(momentId, sku);
    return { alreadyPurchased: true, purchase: payload.data.purchase ?? null };
  }
  if (!payload.data?.checkoutUrl) throw new Error("CHECKOUT_URL_MISSING");
  return { alreadyPurchased: false, checkoutUrl: payload.data.checkoutUrl };
}

export async function loadDigitalEntitlement({ momentId, fetchImpl = fetch }) {
  const response = await fetchImpl(`/api/moments/${encodeURIComponent(momentId)}/digital-entitlement`, {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) return { entitled: false, purchase: null };
  return payload.data;
}

export async function requestDigitalDownload({ momentId, fetchImpl = fetch }) {
  const response = await fetchImpl(`/api/moments/${encodeURIComponent(momentId)}/digital-download`, {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success || !payload.data?.downloadUrl) {
    throw new Error(payload?.error ?? "DIGITAL_DOWNLOAD_FAILED");
  }
  return payload.data.downloadUrl;
}
