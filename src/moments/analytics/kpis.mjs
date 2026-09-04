import { MOMENT_ANALYTICS_EVENT } from "./events.mjs";

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function distinctNonEmpty(values) {
  return new Set(values.filter((value) => value !== undefined && value !== null && value !== ""));
}

export function computeBirdieMomentsKpis({ completedRounds = 0, events = [] } = {}) {
  const byName = (name) => events.filter((event) => event?.name === name);
  const generatedEvents = byName(MOMENT_ANALYTICS_EVENT.MOMENT_GENERATED);
  const previewEvents = byName(MOMENT_ANALYTICS_EVENT.MOMENT_PREVIEW_VIEWED);
  const digitalEvents = byName(MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED);
  const printEvents = byName(MOMENT_ANALYTICS_EVENT.PRINT_PURCHASE_COMPLETED);
  const purchaseEvents = [...digitalEvents, ...printEvents];

  const generatedRoundIds = distinctNonEmpty(generatedEvents.map((event) => event?.payload?.roundId));
  const generatedMomentIds = distinctNonEmpty(generatedEvents.map((event) => event?.payload?.momentId));
  const previewMomentIds = distinctNonEmpty(previewEvents.map((event) => event?.payload?.momentId));
  const purchasedMomentIds = distinctNonEmpty(purchaseEvents.map((event) => event?.payload?.momentId));
  const buyerIds = distinctNonEmpty(purchaseEvents.map((event) => event?.payload?.userId));
  const printBuyerIds = distinctNonEmpty(printEvents.map((event) => event?.payload?.userId));

  const revenueMinor = purchaseEvents
    .reduce((sum, event) => sum + (Number.isInteger(event?.payload?.amountMinor) ? event.payload.amountMinor : 0), 0);

  return Object.freeze({
    completedRounds,
    generatedRounds: generatedRoundIds.size,
    generatedMoments: generatedEvents.length,
    previewedMoments: previewMomentIds.size,
    previewViews: previewEvents.length,
    purchasedMoments: purchasedMomentIds.size,
    buyers: buyerIds.size,
    purchases: purchaseEvents.length,
    digitalPurchases: digitalEvents.length,
    printPurchases: printEvents.length,
    revenueMinor,
    generationRate: safeDivide(generatedRoundIds.size, completedRounds),
    previewRate: safeDivide(previewMomentIds.size, generatedMomentIds.size),
    purchaseConversion: safeDivide(purchasedMomentIds.size, previewMomentIds.size),
    revenuePerCompletedRoundMinor: safeDivide(revenueMinor, completedRounds),
    printAttachRate: safeDivide(printBuyerIds.size, buyerIds.size)
  });
}
