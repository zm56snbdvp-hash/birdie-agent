import { MOMENT_STATUS, MOMENT_TYPE } from "../contracts.mjs";
import { productsForMoment } from "../commerce/catalog.mjs";

export class MomentAccessError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "MomentAccessError";
    this.code = code;
    this.status = status;
  }
}

const READY_FOR_PREVIEW = new Set([
  MOMENT_STATUS.PREVIEW_READY,
  MOMENT_STATUS.PURCHASED,
  MOMENT_STATUS.FULFILLED
]);

function requireAuth(userId) {
  if (typeof userId !== "string" || !userId.trim()) throw new MomentAccessError("AUTH_REQUIRED", 401);
  return userId.trim();
}

function ownerId(entity) { return entity?.userId ?? entity?.user_id ?? null; }
function momentType(moment) { return moment?.momentType ?? moment?.moment_type ?? null; }
function previewAsset(moment) { return moment?.previewAsset ?? moment?.preview_asset ?? null; }
function renderData(moment) { return moment?.renderData ?? moment?.render_data ?? {}; }

function assertOwner(entity, userId, code = "MOMENT_NOT_FOUND") {
  if (!entity || ownerId(entity) !== userId) throw new MomentAccessError(code, 404);
  return entity;
}

function scoreVsParLabel(value) {
  if (!Number.isInteger(value)) return null;
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

function summary(moment) {
  const data = renderData(moment);
  const type = momentType(moment);
  return Object.freeze({
    momentId: moment.id,
    roundId: moment.roundId ?? moment.round_id,
    momentType: type,
    title: type === MOMENT_TYPE.PERSONAL_BEST ? "Neue persönliche Bestleistung." : "Dein Birdie Moment ist fertig.",
    badge: type === MOMENT_TYPE.PERSONAL_BEST ? "PERSONAL BEST" : "ROUND EDITION",
    playerName: data.playerName,
    courseName: data.courseName,
    playedAt: data.playedAt,
    totalScore: data.totalScore,
    holesPlayed: data.holesPlayed,
    birdieCount: data.birdieCount,
    parCount: Number.isInteger(data.parCount) ? data.parCount : null,
    scoreVsPar: Number.isInteger(data.scoreVsPar) ? data.scoreVsPar : null,
    scoreVsParLabel: scoreVsParLabel(data.scoreVsPar),
    previousBest: type === MOMENT_TYPE.PERSONAL_BEST && Number.isInteger(data.previousBest) ? data.previousBest : null,
    improvement: type === MOMENT_TYPE.PERSONAL_BEST && Number.isInteger(data.improvement) ? data.improvement : null
  });
}

function selectHero(moments) {
  const ownedReady = (moments ?? []).filter((moment) =>
    READY_FOR_PREVIEW.has(moment?.status) && previewAsset(moment)
  );
  return ownedReady.find((moment) => momentType(moment) === MOMENT_TYPE.PERSONAL_BEST)
    ?? ownedReady.find((moment) => momentType(moment) === MOMENT_TYPE.ROUND)
    ?? null;
}

async function authorizedPreviewUrl(moment, assetGateway) {
  if (!assetGateway?.getAuthorizedPreviewUrl) {
    throw new MomentAccessError("PREVIEW_GATEWAY_NOT_CONFIGURED", 503);
  }
  const asset = previewAsset(moment);
  if (!asset) throw new MomentAccessError("MOMENT_NOT_READY", 409);
  const url = await assetGateway.getAuthorizedPreviewUrl({
    momentId: moment.id,
    previewAsset: asset,
    userId: ownerId(moment)
  });
  if (!url) throw new MomentAccessError("PREVIEW_URL_UNAVAILABLE", 503);
  return url;
}

export async function getPostRoundMomentOffer({ roundId, authenticatedUserId, repo, assetGateway }) {
  const userId = requireAuth(authenticatedUserId);
  const round = assertOwner(await repo.getRound(roundId), userId, "ROUND_NOT_FOUND");
  if (!(round.isCompleted === true || round.status === "completed")) {
    return { available: false, reason: "ROUND_NOT_COMPLETED" };
  }

  const moments = await repo.listMomentsForRound(roundId);
  const owned = (moments ?? []).filter((moment) => ownerId(moment) === userId);
  const hero = selectHero(owned);
  if (!hero) return { available: false, reason: "MOMENT_NOT_READY" };

  const info = summary(hero);
  return {
    available: true,
    offer: {
      kind: "BIRDIE_MOMENT_POST_ROUND_OFFER",
      momentId: hero.id,
      momentType: info.momentType,
      heading: info.title,
      previewUrl: await authorizedPreviewUrl(hero, assetGateway),
      summary: info,
      primaryCta: { label: "Moment ansehen", href: `/moments/${encodeURIComponent(hero.id)}` },
      secondaryCta: { label: "Später", action: "DISMISS" }
    }
  };
}

export async function getMomentDetail({ momentId, authenticatedUserId, repo, assetGateway }) {
  const userId = requireAuth(authenticatedUserId);
  const moment = assertOwner(await repo.getMoment(momentId), userId);
  if (!READY_FOR_PREVIEW.has(moment.status) || !previewAsset(moment)) {
    throw new MomentAccessError("MOMENT_NOT_READY", 409);
  }
  const info = summary(moment);
  return {
    kind: "BIRDIE_MOMENT_DETAIL",
    momentId: moment.id,
    status: moment.status,
    previewUrl: await authorizedPreviewUrl(moment, assetGateway),
    summary: info,
    products: productsForMoment(info.momentType).map((product) => ({
      sku: product.sku,
      fulfillmentType: product.fulfillmentType,
      amountMinor: product.amountMinor,
      currency: product.currency,
      format: product.format ?? null,
      ctaLabel: product.fulfillmentType === "DIGITAL" ? "Digitale Edition sichern" : "Premium Print bestellen"
    }))
  };
}
