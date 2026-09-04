import { MOMENT_ANALYTICS_EVENT, emitMomentAnalytics } from "./events.mjs";

export async function trackMomentPreviewViewed({ analytics, moment }) {
  if (!moment) return { emitted: false };
  return emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.MOMENT_PREVIEW_VIEWED, {
    userId: moment.userId,
    roundId: moment.roundId,
    momentId: moment.id,
    momentType: moment.momentType,
    templateVersion: moment.templateVersion,
    status: moment.status
  });
}

export async function trackMomentOfferClosed({ analytics, moment }) {
  if (!moment) return { emitted: false };
  return emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.MOMENT_OFFER_CLOSED, {
    userId: moment.userId,
    roundId: moment.roundId,
    momentId: moment.id,
    momentType: moment.momentType,
    templateVersion: moment.templateVersion,
    status: moment.status
  });
}
