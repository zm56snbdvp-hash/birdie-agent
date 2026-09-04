export const MOMENT_FAILURE_STAGE = Object.freeze({
  EVALUATION: "EVALUATION",
  RENDERING: "RENDERING",
  PAYMENT: "PAYMENT",
  DIGITAL_FULFILLMENT: "DIGITAL_FULFILLMENT",
  PRINT_FULFILLMENT: "PRINT_FULFILLMENT"
});

export function normalizeMomentFailure({ stage, error, context = {} }) {
  return Object.freeze({
    stage,
    code: error?.code ?? error?.name ?? "UNKNOWN_ERROR",
    message: String(error?.message ?? error ?? "Unknown Birdie Moments error"),
    roundId: context.roundId ?? null,
    momentId: context.momentId ?? null,
    purchaseId: context.purchaseId ?? null,
    productType: context.productType ?? context.sku ?? null,
    fulfillmentType: context.fulfillmentType ?? null
  });
}

/** Failure recording is best-effort and never changes the observed state transition. */
export async function recordMomentFailureSafely({ repo, analytics, stage, error, context = {} }) {
  const failure = normalizeMomentFailure({ stage, error, context });
  try { await repo?.recordMomentFailure?.(failure); } catch {}
  try {
    await analytics?.track?.(
      stage === MOMENT_FAILURE_STAGE.RENDERING ? "moment_generation_failed" : "fulfillment_failed",
      {
        roundId: failure.roundId,
        momentId: failure.momentId,
        purchaseId: failure.purchaseId,
        productType: failure.productType,
        fulfillmentType: failure.fulfillmentType,
        reason: failure.code
      }
    );
  } catch {}
  return failure;
}
