import { MOMENT_ANALYTICS_EVENT } from "./events.mjs";

function safeDivide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function computeBirdieMomentsKpis({ completedRounds = 0, events = [] } = {}) {
  const count = (name) => events.filter((event) => event?.name === name).length;
  const generated = count(MOMENT_ANALYTICS_EVENT.MOMENT_GENERATED);
  const previews = count(MOMENT_ANALYTICS_EVENT.MOMENT_PREVIEW_VIEWED);
  const digitalPurchases = count(MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED);
  const printPurchases = count(MOMENT_ANALYTICS_EVENT.PRINT_PURCHASE_COMPLETED);
  const purchases = digitalPurchases + printPurchases;

  const revenueMinor = events
    .filter((event) => [
      MOMENT_ANALYTICS_EVENT.DIGITAL_PURCHASE_COMPLETED,
      MOMENT_ANALYTICS_EVENT.PRINT_PURCHASE_COMPLETED
    ].includes(event?.name))
    .reduce((sum, event) => sum + (Number.isInteger(event?.payload?.amountMinor) ? event.payload.amountMinor : 0), 0);

  return Object.freeze({
    completedRounds,
    generatedMoments: generated,
    previewViews: previews,
    purchases,
    digitalPurchases,
    printPurchases,
    revenueMinor,
    generationRate: safeDivide(generated, completedRounds),
    previewRate: safeDivide(previews, generated),
    purchaseConversion: safeDivide(purchases, previews),
    revenuePerCompletedRoundMinor: safeDivide(revenueMinor, completedRounds),
    printAttachRate: safeDivide(printPurchases, purchases)
  });
}
