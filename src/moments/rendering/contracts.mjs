import { MOMENT_TYPE, TEMPLATE_VERSION } from "../contracts.mjs";

export const RENDER_TARGET = Object.freeze({
  PREVIEW: "PREVIEW",
  DIGITAL: "DIGITAL",
  PRINT_A3: "PRINT_A3"
});

export const RENDER_TARGETS = Object.freeze({
  [RENDER_TARGET.PREVIEW]: Object.freeze({
    width: 1080,
    height: 1350,
    mimeType: "image/svg+xml",
    safeMarginPx: 54,
    suffix: "preview"
  }),
  [RENDER_TARGET.DIGITAL]: Object.freeze({
    width: 2160,
    height: 2700,
    mimeType: "image/svg+xml",
    safeMarginPx: 108,
    suffix: "digital"
  }),
  [RENDER_TARGET.PRINT_A3]: Object.freeze({
    width: 3508,
    height: 4961,
    mimeType: "image/svg+xml",
    dpi: 300,
    safeMarginPx: 95,
    suffix: "print-a3"
  })
});

export class MomentRenderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MomentRenderError";
    this.code = code;
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MomentRenderError("INVALID_RENDER_DATA", `${field} must be a non-empty string`);
  }
  return value.trim();
}

export function validateMomentRenderData(data) {
  requireString(data?.internalRoundId, "internalRoundId");
  requireString(data?.playerName, "playerName");
  requireString(data?.courseName, "courseName");
  requireString(data?.playedAt, "playedAt");

  if (!Number.isFinite(data?.totalScore) || data.totalScore <= 0) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "totalScore must be a positive number");
  }
  if (![9, 18].includes(data?.holesPlayed)) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "holesPlayed must be 9 or 18");
  }
  if (!Number.isInteger(data?.birdieCount) || data.birdieCount < 0) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "birdieCount must be a non-negative integer");
  }
  if (!Object.values(MOMENT_TYPE).includes(data?.momentType)) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "momentType is unsupported");
  }

  const expectedTemplate = data.momentType === MOMENT_TYPE.PERSONAL_BEST
    ? TEMPLATE_VERSION.PERSONAL_BEST
    : TEMPLATE_VERSION.ROUND;
  if (data.templateVersion !== expectedTemplate) {
    throw new MomentRenderError(
      "TEMPLATE_VERSION_MISMATCH",
      `Expected ${expectedTemplate}, got ${data.templateVersion}`
    );
  }

  if (data.momentType === MOMENT_TYPE.PERSONAL_BEST) {
    const pb = data.personalBestData;
    if (
      !pb ||
      !Number.isFinite(pb.previousBestScore) ||
      !Number.isFinite(pb.newBestScore) ||
      !Number.isFinite(pb.strokesImproved) ||
      pb.newBestScore >= pb.previousBestScore ||
      pb.strokesImproved <= 0 ||
      pb.strokesImproved !== pb.previousBestScore - pb.newBestScore
    ) {
      throw new MomentRenderError(
        "INVALID_PERSONAL_BEST_DATA",
        "Personal Best render data must contain a proven lower score and positive exact strokesImproved"
      );
    }
  }

  return true;
}

export function resolveRenderTarget(target) {
  const config = RENDER_TARGETS[target];
  if (!config) {
    throw new MomentRenderError("UNKNOWN_RENDER_TARGET", `Unknown render target ${target}`);
  }
  return config;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function compactDisplayText(value, maxLength) {
  const normalized = String(value).trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function formatPlayedAt(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  return String(value);
}

export function formatScoreVsPar(value) {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

export function assetFileName(renderData, target) {
  const config = resolveRenderTarget(target);
  const safeRound = renderData.internalRoundId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeType = renderData.momentType.toLowerCase().replaceAll("_", "-");
  return `${safeRound}-${safeType}-${config.suffix}.svg`;
}
