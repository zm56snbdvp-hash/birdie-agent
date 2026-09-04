import { MOMENT_TYPE, TEMPLATE_ID, TEMPLATE_VERSION } from "../contracts.mjs";

export const RENDER_TARGET = Object.freeze({
  THUMBNAIL: "THUMBNAIL",
  PREVIEW: "PREVIEW",
  DIGITAL: "DIGITAL",
  PRINT_A3: "PRINT_A3"
});

export const PRINT_A3 = Object.freeze({
  trimWidth: 3508,
  trimHeight: 4961,
  bleedPx: 35,
  width: 3578,
  height: 5031,
  dpi: 300,
  safeInsideTrimPx: 118
});

export const RENDER_TARGETS = Object.freeze({
  [RENDER_TARGET.THUMBNAIL]: Object.freeze({
    width: 540,
    height: 675,
    mimeType: "image/svg+xml",
    suffix: "thumbnail",
    protectedPreview: true
  }),
  [RENDER_TARGET.PREVIEW]: Object.freeze({
    width: 1080,
    height: 1350,
    mimeType: "image/svg+xml",
    suffix: "preview",
    protectedPreview: true
  }),
  [RENDER_TARGET.DIGITAL]: Object.freeze({
    width: 2160,
    height: 2700,
    mimeType: "image/svg+xml",
    suffix: "digital-master",
    protectedPreview: false
  }),
  [RENDER_TARGET.PRINT_A3]: Object.freeze({
    ...PRINT_A3,
    mimeType: "image/svg+xml",
    suffix: "a3-print-master",
    protectedPreview: false
  })
});

export class MomentRenderError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "MomentRenderError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MomentRenderError("INVALID_RENDER_DATA", `${field} must be a non-empty string`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    throw new MomentRenderError("LAYOUT_OVERFLOW", `${field} exceeds ${maxLength} characters`);
  }
  if (/\p{Cc}/u.test(normalized)) {
    throw new MomentRenderError("INVALID_RENDER_DATA", `${field} contains control characters`);
  }
  return normalized;
}

export function validateMomentRenderData(data) {
  requireText(data?.roundReference, "roundReference", 160);
  requireText(data?.playerName, "playerName", 80);
  requireText(data?.courseName, "courseName", 120);
  requireText(data?.playedAt, "playedAt", 80);

  if (!Number.isInteger(data?.totalScore) || data.totalScore < 1 || data.totalScore > 999) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "totalScore must be an integer from 1 to 999");
  }
  if (![9, 18].includes(data?.holesPlayed)) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "holesPlayed must be 9 or 18");
  }
  if (!Number.isInteger(data?.birdieCount) || data.birdieCount < 0 || data.birdieCount > data.holesPlayed) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "birdieCount is invalid");
  }
  if (data.parCount !== undefined && (!Number.isInteger(data.parCount) || data.parCount < 0 || data.parCount > data.holesPlayed)) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "parCount is invalid");
  }
  if (data.scoreVsPar !== undefined && !Number.isInteger(data.scoreVsPar)) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "scoreVsPar must be an integer when present");
  }
  if (!Object.values(MOMENT_TYPE).includes(data?.momentType)) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "momentType is unsupported");
  }

  const expectedVersion = data.momentType === MOMENT_TYPE.PERSONAL_BEST
    ? TEMPLATE_VERSION.PERSONAL_BEST
    : TEMPLATE_VERSION.ROUND;
  if (data.templateVersion !== expectedVersion) {
    throw new MomentRenderError("TEMPLATE_VERSION_MISMATCH", `Expected ${expectedVersion}`);
  }

  const expectedTemplates = data.momentType === MOMENT_TYPE.PERSONAL_BEST
    ? [TEMPLATE_ID.PERSONAL_BEST_DIGITAL_V1, TEMPLATE_ID.PERSONAL_BEST_PRINT_V1]
    : [TEMPLATE_ID.ROUND_DIGITAL_V1, TEMPLATE_ID.ROUND_PRINT_V1];
  if (data.templates?.digital !== expectedTemplates[0] || data.templates?.print !== expectedTemplates[1]) {
    throw new MomentRenderError("TEMPLATE_SELECTION_MISMATCH", "Moment has an invalid template selection");
  }

  if (data.momentType === MOMENT_TYPE.PERSONAL_BEST) {
    if (
      data.isPersonalBest !== true ||
      !Number.isInteger(data.previousBest) ||
      !Number.isInteger(data.improvement) ||
      data.previousBest <= data.totalScore ||
      data.improvement <= 0 ||
      data.improvement !== data.previousBest - data.totalScore
    ) {
      throw new MomentRenderError(
        "INVALID_PERSONAL_BEST_DATA",
        "PB render data requires a proven previous best and positive exact improvement"
      );
    }
  } else if (data.isPersonalBest === true) {
    throw new MomentRenderError("INVALID_RENDER_DATA", "ROUND moment cannot claim Personal Best");
  }

  return true;
}

export function resolveRenderTarget(target) {
  const config = RENDER_TARGETS[target];
  if (!config) throw new MomentRenderError("UNKNOWN_RENDER_TARGET", `Unknown render target ${target}`);
  return config;
}

export function templateIdFor(renderData, target) {
  return target === RENDER_TARGET.PRINT_A3 ? renderData.templates.print : renderData.templates.digital;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatScoreVsPar(value) {
  if (!Number.isInteger(value)) return null;
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]);

export function formatPlayedAt(value, { uppercase = false } = {}) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new MomentRenderError("INVALID_RENDER_DATA", "playedAt must begin with YYYY-MM-DD");
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) throw new MomentRenderError("INVALID_RENDER_DATA", "playedAt month is invalid");
  const output = `${match[3]} ${month} ${match[1]}`;
  return uppercase ? output.toUpperCase() : output;
}

export function wrapText(value, { maxCharsPerLine, maxLines = 2, field = "text" }) {
  const text = requireText(value, field, 160);
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      throw new MomentRenderError("LAYOUT_OVERFLOW", `${field} contains an unbreakable word that is too long`);
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    throw new MomentRenderError("LAYOUT_OVERFLOW", `${field} needs more than ${maxLines} lines`);
  }
  return lines;
}

export function buildStats(renderData) {
  const stats = [];
  if (Number.isInteger(renderData.birdieCount)) stats.push(`${renderData.birdieCount} BIRDIES`);
  if (Number.isInteger(renderData.parCount)) stats.push(`${renderData.parCount} PARS`);
  stats.push(`${renderData.holesPlayed} HOLES`);
  return stats;
}

export function validateMomentLayout(renderData, target) {
  validateMomentRenderData(renderData);
  const config = resolveRenderTarget(target);
  const templateId = templateIdFor(renderData, target);
  const player = wrapText(renderData.playerName, { maxCharsPerLine: 32, maxLines: 2, field: "playerName" });
  const course = wrapText(renderData.courseName, {
    maxCharsPerLine: target === RENDER_TARGET.PRINT_A3 ? 38 : 34,
    maxLines: 2,
    field: "courseName"
  });
  const stats = buildStats(renderData);
  if (!stats.length || stats.some((item) => /undefined|null|N\/A|—/.test(item))) {
    throw new MomentRenderError("LAYOUT_INVALID_STATS", "Stats contain invalid placeholders");
  }
  return Object.freeze({ config, templateId, player, course, stats });
}

export function assetFileName(renderData, target) {
  const config = resolveRenderTarget(target);
  const safeRound = renderData.roundReference.replace(/[^a-zA-Z0-9_-]/g, "-");
  const safeType = renderData.momentType.toLowerCase().replaceAll("_", "-");
  return `${safeRound}-${safeType}-${config.suffix}.svg`;
}
