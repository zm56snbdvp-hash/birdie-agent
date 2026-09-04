import { MOMENT_STATUS, MOMENT_TYPE } from "../contracts.mjs";

const MOMENT_LABEL = Object.freeze({
  [MOMENT_TYPE.ROUND]: "Round Card",
  [MOMENT_TYPE.PERSONAL_BEST]: "Personal Best"
});

function euro(amount) {
  if (!Number.isFinite(amount) || amount < 0) return null;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR"
  }).format(amount);
}

function renderData(moment) {
  return moment?.renderData ?? moment?.render_data ?? {};
}

function previewAsset(moment) {
  return moment?.previewAsset ?? moment?.preview_asset ?? null;
}

export function selectPrimaryPostRoundMoment(moments = []) {
  const ready = moments.filter((moment) =>
    moment &&
    moment.status === MOMENT_STATUS.PREVIEW_READY &&
    previewAsset(moment)
  );

  return ready.find((moment) => moment.momentType === MOMENT_TYPE.PERSONAL_BEST || moment.moment_type === MOMENT_TYPE.PERSONAL_BEST)
    ?? ready.find((moment) => moment.momentType === MOMENT_TYPE.ROUND || moment.moment_type === MOMENT_TYPE.ROUND)
    ?? null;
}

export function buildPostRoundUpsellViewModel(moment) {
  if (!moment || moment.status !== MOMENT_STATUS.PREVIEW_READY || !previewAsset(moment)) return null;
  const data = renderData(moment);
  const momentType = moment.momentType ?? moment.moment_type;

  return Object.freeze({
    kind: "BIRDIE_MOMENT_UPSELL",
    title: "Dein Birdie Moment ist fertig.",
    previewAsset: previewAsset(moment),
    courseName: data.courseName,
    totalScore: data.totalScore,
    momentType,
    momentLabel: MOMENT_LABEL[momentType] ?? "Birdie Moment",
    primaryAction: {
      label: "Moment ansehen",
      href: `/moments/${encodeURIComponent(moment.id)}`
    },
    secondaryAction: {
      label: "Später",
      action: "DISMISS"
    },
    dismissible: true
  });
}

export function buildMomentDetailViewModel(moment, pricing = {}) {
  const data = renderData(moment);
  const momentType = moment.momentType ?? moment.moment_type;
  const preview = previewAsset(moment);

  return Object.freeze({
    kind: "BIRDIE_MOMENT_DETAIL",
    momentId: moment.id,
    previewAsset: preview,
    momentType,
    momentLabel: MOMENT_LABEL[momentType] ?? "Birdie Moment",
    round: {
      courseName: data.courseName,
      playedAt: data.playedAt,
      totalScore: data.totalScore,
      holesPlayed: data.holesPlayed,
      birdieCount: data.birdieCount,
      scoreVsPar: Number.isFinite(data.scoreVsPar) ? data.scoreVsPar : null
    },
    personalBest: momentType === MOMENT_TYPE.PERSONAL_BEST && data.personalBestData
      ? {
          previousBestScore: data.personalBestData.previousBestScore,
          newBestScore: data.personalBestData.newBestScore,
          improvement: data.personalBestData.improvement
        }
      : null,
    products: [
      {
        productType: momentType === MOMENT_TYPE.PERSONAL_BEST ? "PERSONAL_BEST_DIGITAL" : "ROUND_CARD_DIGITAL",
        fulfillmentType: "DIGITAL",
        title: "Digitale Edition",
        price: euro(momentType === MOMENT_TYPE.PERSONAL_BEST ? pricing.personalBestDigital : pricing.roundDigital),
        ctaLabel: "Digitale Edition kaufen"
      },
      {
        productType: "PREMIUM_A3_PRINT",
        fulfillmentType: "PRINT",
        title: "Premium A3 Print",
        price: euro(pricing.premiumA3Print),
        ctaLabel: "Als Premium Print bestellen"
      }
    ],
    backAction: {
      label: "Zurück",
      href: "/"
    }
  });
}
