export class MomentAuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MomentAuthorizationError";
    this.code = code;
  }
}

export function assertAuthenticatedUser(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new MomentAuthorizationError("UNAUTHENTICATED", "Authenticated user is required");
  }
  return userId.trim();
}

export function assertOwnership(record, userId, recordName = "resource") {
  const actor = assertAuthenticatedUser(userId);
  if (!record || record.userId !== actor) {
    throw new MomentAuthorizationError("NOT_FOUND", `${recordName} not found`);
  }
  return record;
}

export function assertPaidPurchase(purchase, userId) {
  assertOwnership(purchase, userId, "purchase");
  if (!["PAID", "FULFILLING", "FULFILLED"].includes(purchase.fulfillmentStatus)) {
    throw new MomentAuthorizationError("PAYMENT_REQUIRED", "Verified payment is required");
  }
  return purchase;
}
