import { MOMENT_STATUS, MOMENT_TYPE } from "../contracts.mjs";

const MOMENT_LABEL = Object.freeze({
  [MOMENT_TYPE.ROUND]: "Round Card",
  [MOMENT_TYPE.PERSONAL_BEST]: "Personal Best"
});

const COLLECTION_VISIBLE_STATUS = new Set([
  MOMENT_STATUS.PREVIEW_READY,
  MOMENT_STATUS.PURCHASED,
  MOMENT_STATUS.FULFILLED
]);

export const BIRDIE_MOMENT_A4_PRINT_TARGET = Object.freeze({
  productType: "PRINT_A4_BIRDIE_MOMENT",
  title: "A4 Birdie Moment Print",
  targetPriceEur: 19.9,
  shippingScope: "Deutschland",
  shippingIncluded: true,
  economicsStatus: "UNPROVEN",
  availability: "PREPARATION"
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

function momentTypeOf(moment) {
  return moment?.momentType ?? moment?.moment_type;
}

function roundIdOf(moment) {
  return moment?.roundId ?? moment?.round_id;
}

function createdAtOf(moment) {
  return moment?.createdAt ?? moment?.created_at ?? renderData(moment)?.playedAt ?? "";
}

export function selectPrimaryPostRoundMoment(moments = []) {
  const ready = moments.filter((moment) =>
    moment &&
    COLLECTION_VISIBLE_STATUS.has(moment.status) &&
    previewAsset(moment)
  );

  return ready.find((moment) => momentTypeOf(moment) === MOMENT_TYPE.PERSONAL_BEST)
    ?? ready.find((moment) => momentTypeOf(moment) === MOMENT_TYPE.ROUND)
    ?? null;
}

export function buildPostRoundUpsellViewModel(moment) {
  if (!moment || !COLLECTION_VISIBLE_STATUS.has(moment.status) || !previewAsset(moment)) return null;
  const data = renderData(moment);
  const momentType = momentTypeOf(moment);

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

export function buildMomentDetailViewModel(moment) {
  const data = renderData(moment);
  const momentType = momentTypeOf(moment);
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
    digital: {
      access: "FREE_PRIVATE",
      title: "Digitaler Birdie Moment",
      price: "Kostenlos",
      collectionHref: "/moments",
      downloadHref: `/moments/${encodeURIComponent(moment.id)}/download`,
      ctaLabel: "Kostenlos herunterladen",
      paymentRequired: false,
      entitlementRequired: false
    },
    physicalUpsell: {
      productType: BIRDIE_MOMENT_A4_PRINT_TARGET.productType,
      title: BIRDIE_MOMENT_A4_PRINT_TARGET.title,
      targetPrice: `${euro(BIRDIE_MOMENT_A4_PRINT_TARGET.targetPriceEur)} inkl. Versand Deutschland`,
      shippingScope: BIRDIE_MOMENT_A4_PRINT_TARGET.shippingScope,
      shippingIncluded: true,
      economicsStatus: BIRDIE_MOMENT_A4_PRINT_TARGET.economicsStatus,
      availability: BIRDIE_MOMENT_A4_PRINT_TARGET.availability,
      productionClaim: false,
      ctaEnabled: false,
      ctaLabel: "Print in Vorbereitung"
    },
    backAction: {
      label: "Zur Collection",
      href: "/moments"
    }
  });
}

function buildCollectionItem(moment) {
  const data = renderData(moment);
  const momentType = momentTypeOf(moment);
  return Object.freeze({
    momentId: moment.id,
    roundId: roundIdOf(moment),
    momentType,
    momentLabel: MOMENT_LABEL[momentType] ?? "Birdie Moment",
    previewAsset: previewAsset(moment),
    courseName: data.courseName,
    playedAt: data.playedAt,
    totalScore: data.totalScore,
    holesPlayed: data.holesPlayed,
    detailHref: `/moments/${encodeURIComponent(moment.id)}`,
    downloadHref: `/moments/${encodeURIComponent(moment.id)}/download`
  });
}

export function buildMomentCollectionViewModel(moments = []) {
  const byRound = new Map();

  for (const moment of moments) {
    if (!moment || !COLLECTION_VISIBLE_STATUS.has(moment.status) || !previewAsset(moment)) continue;
    const roundId = roundIdOf(moment);
    if (!roundId) continue;
    const group = byRound.get(roundId) ?? [];
    group.push(moment);
    byRound.set(roundId, group);
  }

  const selected = [...byRound.values()]
    .map((group) => selectPrimaryPostRoundMoment(group))
    .filter(Boolean)
    .sort((a, b) => String(createdAtOf(b)).localeCompare(String(createdAtOf(a))));

  return Object.freeze({
    kind: "BIRDIE_MOMENT_COLLECTION",
    title: "Deine Birdie Moments",
    access: "PRIVATE_OWNER_ONLY",
    items: selected.map(buildCollectionItem)
  });
}
