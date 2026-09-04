import { MOMENT_ANALYTICS_EVENT, emitMomentAnalytics } from "./events.mjs";

export async function trackMomentPreviewViewed({ analytics, moment }) {
  if (!moment) return { emitted: false };
  return emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.MOMENT_PREVIEW_VIEWED, {
    userId: moment.userId ?? moment.user_id,
    roundId: moment.roundId ?? moment.round_id,
    momentId: moment.id,
    momentType: moment.momentType ?? moment.moment_type,
    templateVersion: moment.templateVersion ?? moment.template_version,
    status: moment.status
  });
}

export async function trackMomentOfferClosed({ analytics, moment }) {
  if (!moment) return { emitted: false };
  return emitMomentAnalytics(analytics, MOMENT_ANALYTICS_EVENT.MOMENT_OFFER_CLOSED, {
    userId: moment.userId ?? moment.user_id,
    roundId: moment.roundId ?? moment.round_id,
    momentId: moment.id,
    momentType: moment.momentType ?? moment.moment_type,
    templateVersion: moment.templateVersion ?? moment.template_version,
    status: moment.status
  });
}
