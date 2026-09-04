import { MOMENT_TYPE } from "../contracts.mjs";
import {
  PRINT_A3,
  RENDER_TARGET,
  assetFileName,
  escapeXml,
  formatPlayedAt,
  formatScoreVsPar,
  templateIdFor,
  validateMomentLayout
} from "./contracts.mjs";

function scale(value, width, base = 1080) {
  return Math.round(value * (width / base));
}

function fontSizeForLines(lines, { single, multi, long }) {
  const max = Math.max(...lines.map((line) => line.length));
  if (lines.length > 1) return max > 25 ? long : multi;
  return max > 24 ? multi : single;
}

function metadata(renderData, target, templateId, layout) {
  return escapeXml(JSON.stringify({
    roundReference: renderData.roundReference,
    momentType: renderData.momentType,
    templateVersion: renderData.templateVersion,
    templateId,
    target,
    dimensions: { width: layout.config.width, height: layout.config.height },
    ...(target === RENDER_TARGET.PRINT_A3 ? {
      dpi: PRINT_A3.dpi,
      trim: { width: PRINT_A3.trimWidth, height: PRINT_A3.trimHeight },
      bleedPx: PRINT_A3.bleedPx
    } : {})
  }));
}

function renderTextLines(lines, { x, y, lineHeight, size, fill, family, weight = 700, anchor = "start", letterSpacing = 0 }) {
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}">${escapeXml(line)}</text>`
  ).join("\n");
}

function previewProtection(width, height, protectedPreview) {
  if (!protectedPreview) return "";
  return `
    <g opacity="0.10" transform="rotate(-18 ${width / 2} ${height / 2})" aria-hidden="true">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#F7F2E8" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(width * 0.055)}" font-weight="800" letter-spacing="${Math.round(width * 0.012)}">PREVIEW · BIRDIEWORLD</text>
    </g>`;
}

function digitalSvg(renderData, target, layout) {
  const { config, templateId, player, course, stats } = layout;
  const { width, height } = config;
  const isPb = renderData.momentType === MOMENT_TYPE.PERSONAL_BEST;
  const accent = isPb ? "#F2D37A" : "#D5B468";
  const left = Math.round(width * 0.075);
  const right = Math.round(width * 0.925);
  const playerSize = scale(fontSizeForLines(player, { single: 76, multi: 63, long: 53 }), width);
  const courseSize = scale(fontSizeForLines(course, { single: 38, multi: 33, long: 29 }), width);
  const scoreVsPar = formatScoreVsPar(renderData.scoreVsPar);
  const date = formatPlayedAt(renderData.playedAt, { uppercase: true });
  const scoreSize = renderData.totalScore >= 100 ? scale(224, width) : scale(252, width);
  const statsText = stats.join(" · ");

  const pbBlock = isPb ? `
    <g>
      <rect x="${left}" y="${Math.round(height * 0.715)}" width="${right - left}" height="${Math.round(height * 0.115)}" rx="${scale(24, width)}" fill="${accent}" fill-opacity="0.08" stroke="${accent}" stroke-opacity="0.55" stroke-width="${scale(2, width)}"/>
      <text x="${left + scale(30, width)}" y="${Math.round(height * 0.755)}" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="${scale(19, width)}" font-weight="800" letter-spacing="${scale(4, width)}">NEW PERSONAL BEST</text>
      <text x="${left + scale(30, width)}" y="${Math.round(height * 0.795)}" fill="#F7F2E8" font-family="Georgia, 'Times New Roman', serif" font-size="${scale(36, width)}" font-weight="700">PREVIOUS BEST ${escapeXml(renderData.previousBest)} · ${escapeXml(renderData.improvement)} STROKES BETTER</text>
    </g>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" data-template-id="${templateId}" data-round-reference="${escapeXml(renderData.roundReference)}">
  <title>Birdie Moments ${isPb ? "Personal Best" : "Round"} Digital</title>
  <metadata>${metadata(renderData, target, templateId, layout)}</metadata>
  <defs>
    <linearGradient id="digital-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07120D"/>
      <stop offset="58%" stop-color="#0B1C13"/>
      <stop offset="100%" stop-color="#030906"/>
    </linearGradient>
    <radialGradient id="digital-glow" cx="78%" cy="9%" r="72%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.19"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#digital-bg)"/>
  <rect width="${width}" height="${height}" fill="url(#digital-glow)"/>
  <circle cx="${Math.round(width * 0.87)}" cy="${Math.round(height * 0.11)}" r="${scale(196, width)}" fill="none" stroke="${accent}" stroke-opacity="0.11" stroke-width="${scale(2, width)}"/>
  <circle cx="${Math.round(width * 0.87)}" cy="${Math.round(height * 0.11)}" r="${scale(138, width)}" fill="none" stroke="${accent}" stroke-opacity="0.08" stroke-width="${scale(2, width)}"/>

  <text x="${left}" y="${Math.round(height * 0.07)}" fill="${accent}" font-family="Georgia, 'Times New Roman', serif" font-size="${scale(34, width)}" font-weight="700">BIRDIE MOMENTS</text>
  <text x="${right}" y="${Math.round(height * 0.07)}" text-anchor="end" fill="#91A59A" font-family="Arial, Helvetica, sans-serif" font-size="${scale(17, width)}" font-weight="800" letter-spacing="${scale(3, width)}">${isPb ? "PERSONAL BEST" : "ROUND EDITION"}</text>

  ${renderTextLines(player, {
    x: left,
    y: Math.round(height * 0.155),
    lineHeight: Math.round(playerSize * 1.08),
    size: playerSize,
    fill: "#F7F2E8",
    family: "Georgia, 'Times New Roman', serif"
  })}

  ${renderTextLines(course, {
    x: left,
    y: Math.round(height * 0.255),
    lineHeight: Math.round(courseSize * 1.22),
    size: courseSize,
    fill: "#B9C6BF",
    family: "Arial, Helvetica, sans-serif",
    weight: 650
  })}
  <text x="${left}" y="${Math.round(height * 0.325)}" fill="#7F9388" font-family="Arial, Helvetica, sans-serif" font-size="${scale(19, width)}" font-weight="700" letter-spacing="${scale(3, width)}">${escapeXml(date)}</text>

  <line x1="${left}" y1="${Math.round(height * 0.36)}" x2="${right}" y2="${Math.round(height * 0.36)}" stroke="${accent}" stroke-opacity="0.27" stroke-width="${scale(2, width)}"/>
  <text x="${left}" y="${Math.round(height * 0.415)}" fill="#8EA297" font-family="Arial, Helvetica, sans-serif" font-size="${scale(18, width)}" font-weight="800" letter-spacing="${scale(5, width)}">TOTAL SCORE</text>
  <text x="${left}" y="${Math.round(height * 0.585)}" fill="#F7F2E8" font-family="Georgia, 'Times New Roman', serif" font-size="${scoreSize}" font-weight="700" letter-spacing="${scale(-8, width)}">${renderData.totalScore}</text>
  ${scoreVsPar === null ? "" : `
  <text x="${right}" y="${Math.round(height * 0.525)}" text-anchor="end" fill="${accent}" font-family="Georgia, 'Times New Roman', serif" font-size="${scale(62, width)}" font-weight="700">${escapeXml(scoreVsPar)}</text>
  <text x="${right}" y="${Math.round(height * 0.557)}" text-anchor="end" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="${scale(16, width)}" font-weight="800" letter-spacing="${scale(3, width)}">TO PAR</text>`}

  <text x="${left}" y="${Math.round(height * 0.665)}" fill="#F7F2E8" font-family="Arial, Helvetica, sans-serif" font-size="${scale(stats.length >= 3 ? 24 : 27, width)}" font-weight="750" letter-spacing="${scale(2.2, width)}">${escapeXml(statsText)}</text>
  ${pbBlock}

  <line x1="${left}" y1="${Math.round(height * 0.9)}" x2="${right}" y2="${Math.round(height * 0.9)}" stroke="#FFFFFF" stroke-opacity="0.09"/>
  <text x="${left}" y="${Math.round(height * 0.942)}" fill="#7D9186" font-family="Arial, Helvetica, sans-serif" font-size="${scale(15, width)}" font-weight="700" letter-spacing="${scale(3, width)}">BIRDIEWORLD</text>
  <text x="${right}" y="${Math.round(height * 0.942)}" text-anchor="end" fill="#63776C" font-family="Arial, Helvetica, sans-serif" font-size="${scale(13, width)}">ROUND ${escapeXml(renderData.roundReference)}</text>
  ${previewProtection(width, height, config.protectedPreview)}
</svg>`;
}

function printSvg(renderData, target, layout) {
  const { config, templateId, player, course, stats } = layout;
  const { width, height } = config;
  const bleed = PRINT_A3.bleedPx;
  const trimLeft = bleed;
  const trimTop = bleed;
  const trimRight = width - bleed;
  const trimBottom = height - bleed;
  const safe = bleed + PRINT_A3.safeInsideTrimPx;
  const isPb = renderData.momentType === MOMENT_TYPE.PERSONAL_BEST;
  const accent = isPb ? "#B7923A" : "#8B7440";
  const paper = "#F2EFE7";
  const ink = "#142019";
  const mute = "#6C756F";
  const scoreVsPar = formatScoreVsPar(renderData.scoreVsPar);
  const date = formatPlayedAt(renderData.playedAt);
  const courseSize = fontSizeForLines(course, { single: 165, multi: 143, long: 126 });
  const playerSize = fontSizeForLines(player, { single: 78, multi: 67, long: 58 });
  const statsText = stats.join("  ·  ");

  const pb = isPb ? `
    <g>
      <line x1="${safe}" y1="${Math.round(height * 0.70)}" x2="${width - safe}" y2="${Math.round(height * 0.70)}" stroke="${accent}" stroke-width="3"/>
      <text x="${safe}" y="${Math.round(height * 0.735)}" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="800" letter-spacing="18">PERSONAL BEST EDITION</text>
      <text x="${safe}" y="${Math.round(height * 0.785)}" fill="${ink}" font-family="Georgia, 'Times New Roman', serif" font-size="112" font-weight="700">NEW PERSONAL BEST</text>
      <text x="${safe}" y="${Math.round(height * 0.82)}" fill="${mute}" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700" letter-spacing="4">PREVIOUS BEST ${renderData.previousBest}  ·  ${renderData.improvement} STROKES BETTER</text>
    </g>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" data-template-id="${templateId}" data-bleed-mm="3" data-dpi="300">
  <title>Birdie Moments ${isPb ? "Personal Best" : "Round"} A3 Print</title>
  <metadata>${metadata(renderData, target, templateId, layout)}</metadata>
  <rect width="${width}" height="${height}" fill="${paper}"/>
  <rect x="${trimLeft}" y="${trimTop}" width="${PRINT_A3.trimWidth}" height="${PRINT_A3.trimHeight}" fill="none" stroke="#000" stroke-opacity="0"/>

  <g opacity="0.42" aria-hidden="true">
    <path d="M ${Math.round(width * 0.60)} ${trimTop} C ${Math.round(width * 0.84)} ${Math.round(height * 0.08)}, ${Math.round(width * 0.93)} ${Math.round(height * 0.23)}, ${trimRight} ${Math.round(height * 0.34)}" fill="none" stroke="${accent}" stroke-width="4"/>
    <path d="M ${Math.round(width * 0.69)} ${trimTop} C ${Math.round(width * 0.89)} ${Math.round(height * 0.10)}, ${Math.round(width * 0.98)} ${Math.round(height * 0.20)}, ${trimRight} ${Math.round(height * 0.29)}" fill="none" stroke="${accent}" stroke-width="2"/>
    <circle cx="${Math.round(width * 0.86)}" cy="${Math.round(height * 0.12)}" r="210" fill="none" stroke="${accent}" stroke-width="2"/>
  </g>

  <text x="${safe}" y="${Math.round(height * 0.065)}" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="800" letter-spacing="15">BIRDIE MOMENTS</text>
  <text x="${width - safe}" y="${Math.round(height * 0.065)}" text-anchor="end" fill="${mute}" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" letter-spacing="8">${isPb ? "PERSONAL BEST" : "ROUND PRINT"}</text>

  ${renderTextLines(course, {
    x: safe,
    y: Math.round(height * 0.17),
    lineHeight: Math.round(courseSize * 1.08),
    size: courseSize,
    fill: ink,
    family: "Georgia, 'Times New Roman', serif"
  })}
  <text x="${safe}" y="${Math.round(height * 0.29)}" fill="${mute}" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="650" letter-spacing="5">${escapeXml(date)}</text>

  <text x="${safe}" y="${Math.round(height * 0.39)}" fill="${mute}" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="800" letter-spacing="14">TOTAL SCORE</text>
  <text x="${safe}" y="${Math.round(height * 0.585)}" fill="${ink}" font-family="Georgia, 'Times New Roman', serif" font-size="${renderData.totalScore >= 100 ? 660 : 745}" font-weight="700" letter-spacing="-28">${renderData.totalScore}</text>
  ${scoreVsPar === null ? "" : `
  <text x="${width - safe}" y="${Math.round(height * 0.515)}" text-anchor="end" fill="${accent}" font-family="Georgia, 'Times New Roman', serif" font-size="160" font-weight="700">${escapeXml(scoreVsPar)}</text>
  <text x="${width - safe}" y="${Math.round(height * 0.548)}" text-anchor="end" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" letter-spacing="8">TO PAR</text>`}

  <text x="${safe}" y="${Math.round(height * 0.655)}" fill="${ink}" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="750" letter-spacing="7">${escapeXml(statsText)}</text>
  ${pb}

  ${renderTextLines(player, {
    x: safe,
    y: Math.round(height * (isPb ? 0.885 : 0.82)),
    lineHeight: Math.round(playerSize * 1.1),
    size: playerSize,
    fill: ink,
    family: "Georgia, 'Times New Roman', serif"
  })}
  <text x="${safe}" y="${Math.round(height * 0.94)}" fill="${mute}" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" letter-spacing="7">BIRDIEWORLD · ROUND ${escapeXml(renderData.roundReference)}</text>
  <line x1="${safe}" y1="${trimBottom - 145}" x2="${width - safe}" y2="${trimBottom - 145}" stroke="${accent}" stroke-opacity="0.55" stroke-width="2"/>
</svg>`;
}

export function renderMomentSvg(renderData, target = RENDER_TARGET.PREVIEW) {
  const layout = validateMomentLayout(renderData, target);
  const content = target === RENDER_TARGET.PRINT_A3
    ? printSvg(renderData, target, layout)
    : digitalSvg(renderData, target, layout);

  return Object.freeze({
    target,
    templateId: templateIdFor(renderData, target),
    templateVersion: renderData.templateVersion,
    width: layout.config.width,
    height: layout.config.height,
    mimeType: layout.config.mimeType,
    protectedPreview: layout.config.protectedPreview,
    ...(target === RENDER_TARGET.PRINT_A3 ? {
      dpi: PRINT_A3.dpi,
      bleedPx: PRINT_A3.bleedPx,
      trimWidth: PRINT_A3.trimWidth,
      trimHeight: PRINT_A3.trimHeight
    } : {}),
    fileName: assetFileName(renderData, target),
    content
  });
}

export function renderMomentAssets(renderData) {
  return Object.freeze({
    thumbnail: renderMomentSvg(renderData, RENDER_TARGET.THUMBNAIL),
    preview: renderMomentSvg(renderData, RENDER_TARGET.PREVIEW),
    digital: renderMomentSvg(renderData, RENDER_TARGET.DIGITAL),
    print: renderMomentSvg(renderData, RENDER_TARGET.PRINT_A3)
  });
}
