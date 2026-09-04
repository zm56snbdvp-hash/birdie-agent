import { MOMENT_TYPE } from "../contracts.mjs";
import {
  RENDER_TARGET,
  assetFileName,
  compactDisplayText,
  escapeXml,
  formatPlayedAt,
  formatScoreVsPar,
  resolveRenderTarget,
  validateMomentRenderData
} from "./contracts.mjs";

function px(value, width) {
  return Math.round(value * (width / 1080));
}

function renderMetric({ x, y, label, value, width, accent }) {
  return `
    <text x="${x}" y="${y}" fill="#8FA99B" font-family="Arial, Helvetica, sans-serif" font-size="${px(20, width)}" font-weight="700" letter-spacing="${px(3, width)}">${escapeXml(label)}</text>
    <text x="${x}" y="${y + px(48, width)}" fill="${accent}" font-family="Georgia, 'Times New Roman', serif" font-size="${px(54, width)}" font-weight="700">${escapeXml(value)}</text>`;
}

export function renderMomentSvg(renderData, target = RENDER_TARGET.PREVIEW) {
  validateMomentRenderData(renderData);
  const config = resolveRenderTarget(target);
  const { width, height } = config;
  const safe = config.safeMarginPx;
  const isPb = renderData.momentType === MOMENT_TYPE.PERSONAL_BEST;
  const accent = isPb ? "#F5D98B" : "#D7B86A";
  const scoreVsPar = formatScoreVsPar(renderData.scoreVsPar);
  const playerName = compactDisplayText(renderData.playerName, 30);
  const courseName = compactDisplayText(renderData.courseName, 44);
  const playedAt = formatPlayedAt(renderData.playedAt);
  const metadata = escapeXml(JSON.stringify({
    internalRoundId: renderData.internalRoundId,
    momentType: renderData.momentType,
    templateVersion: renderData.templateVersion,
    target,
    safeMarginPx: safe,
    renderData
  }));

  const top = Math.max(safe, Math.round(height * 0.065));
  const left = Math.max(safe, Math.round(width * 0.075));
  const right = width - left;
  const dividerY = Math.round(height * 0.205);
  const scoreY = Math.round(height * (target === RENDER_TARGET.PRINT_A3 ? 0.42 : 0.44));
  const finalScoreLabelY = dividerY + px(64, width);
  const metricsY = Math.round(height * (target === RENDER_TARGET.PRINT_A3 ? 0.61 : 0.64));
  const footerY = height - Math.max(safe, Math.round(height * 0.065));
  const pbPanelY = Math.round(height * (target === RENDER_TARGET.PRINT_A3 ? 0.73 : 0.76));
  const pbPanelHeight = Math.round(height * 0.115);

  const pbPanel = isPb ? `
    <rect x="${left}" y="${pbPanelY}" width="${right - left}" height="${pbPanelHeight}" rx="${px(28, width)}" fill="#F5D98B" fill-opacity="0.08" stroke="${accent}" stroke-opacity="0.55" stroke-width="${px(2, width)}"/>
    <text x="${left + px(34, width)}" y="${pbPanelY + Math.round(pbPanelHeight * 0.32)}" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="${px(21, width)}" font-weight="800" letter-spacing="${px(4, width)}">NEW PERSONAL BEST</text>
    <text x="${left + px(34, width)}" y="${pbPanelY + Math.round(pbPanelHeight * 0.70)}" fill="#F7F2E8" font-family="Georgia, 'Times New Roman', serif" font-size="${px(37, width)}" font-weight="700">Previous ${escapeXml(renderData.personalBestData.previousBestScore)}  ·  New ${escapeXml(renderData.personalBestData.newBestScore)}  ·  ${escapeXml(renderData.personalBestData.strokesImproved)} strokes better</text>` : "";

  const optionalScoreMetric = scoreVsPar !== null
    ? renderMetric({
        x: left + Math.round((right - left) * 0.66),
        y: metricsY,
        label: "VS PAR",
        value: scoreVsPar,
        width,
        accent
      })
    : "";

  return {
    target,
    templateVersion: renderData.templateVersion,
    width,
    height,
    mimeType: config.mimeType,
    safeMarginPx: safe,
    fileName: assetFileName(renderData, target),
    content: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc" data-moment-type="${escapeXml(renderData.momentType)}" data-template-version="${escapeXml(renderData.templateVersion)}" data-round-id="${escapeXml(renderData.internalRoundId)}">
  <title id="title">BirdieWorld ${isPb ? "Personal Best" : "Round"} Moment</title>
  <desc id="desc">${escapeXml(renderData.playerName)} · ${escapeXml(renderData.courseName)} · Score ${escapeXml(renderData.totalScore)}</desc>
  <metadata>${metadata}</metadata>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07130D"/>
      <stop offset="55%" stop-color="#0B1C13"/>
      <stop offset="100%" stop-color="#030A07"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="12%" r="70%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <circle cx="${Math.round(width * 0.86)}" cy="${Math.round(height * 0.12)}" r="${px(210, width)}" fill="none" stroke="${accent}" stroke-opacity="0.09" stroke-width="${px(2, width)}"/>
  <circle cx="${Math.round(width * 0.86)}" cy="${Math.round(height * 0.12)}" r="${px(150, width)}" fill="none" stroke="${accent}" stroke-opacity="0.07" stroke-width="${px(2, width)}"/>

  <text x="${left}" y="${top}" fill="${accent}" font-family="Georgia, 'Times New Roman', serif" font-size="${px(35, width)}" font-weight="700">BirdieWorld</text>
  <text x="${right}" y="${top}" fill="#8FA99B" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="${px(17, width)}" font-weight="800" letter-spacing="${px(3, width)}">${isPb ? "PERSONAL BEST EDITION" : "ROUND EDITION"}</text>

  <text x="${left}" y="${Math.round(height * 0.13)}" fill="#F7F2E8" font-family="Georgia, 'Times New Roman', serif" font-size="${px(72, width)}" font-weight="700">${escapeXml(playerName)}</text>
  <text x="${left}" y="${Math.round(height * 0.175)}" fill="#A8B9AF" font-family="Arial, Helvetica, sans-serif" font-size="${px(25, width)}" font-weight="600">${escapeXml(courseName)}  ·  ${escapeXml(playedAt)}</text>
  <line x1="${left}" y1="${dividerY}" x2="${right}" y2="${dividerY}" stroke="${accent}" stroke-opacity="0.28" stroke-width="${px(2, width)}"/>

  <text x="${left}" y="${finalScoreLabelY}" fill="#8FA99B" font-family="Arial, Helvetica, sans-serif" font-size="${px(20, width)}" font-weight="800" letter-spacing="${px(5, width)}">FINAL SCORE</text>
  <text x="${left}" y="${scoreY}" fill="#F7F2E8" font-family="Georgia, 'Times New Roman', serif" font-size="${px(245, width)}" font-weight="700" letter-spacing="${px(-10, width)}">${escapeXml(renderData.totalScore)}</text>
  <text x="${right}" y="${scoreY - px(18, width)}" fill="${accent}" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="${px(58, width)}" font-style="italic">${escapeXml(renderData.holesPlayed)} holes</text>

  ${renderMetric({ x: left, y: metricsY, label: "BIRDIES", value: renderData.birdieCount, width, accent })}
  ${renderMetric({ x: left + Math.round((right - left) * 0.33), y: metricsY, label: "HOLES", value: renderData.holesPlayed, width, accent })}
  ${optionalScoreMetric}

  ${pbPanel}

  <line x1="${left}" y1="${footerY - px(46, width)}" x2="${right}" y2="${footerY - px(46, width)}" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="${px(1, width)}"/>
  <text x="${left}" y="${footerY}" fill="#8FA99B" font-family="Arial, Helvetica, sans-serif" font-size="${px(17, width)}" font-weight="700" letter-spacing="${px(4, width)}">PLAY · ENJOY · REMEMBER</text>
  <text x="${right}" y="${footerY}" fill="#6E8679" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="${px(14, width)}">${escapeXml(renderData.templateVersion)}</text>
</svg>`
  };
}

export function renderMomentAssets(renderData) {
  return Object.freeze({
    preview: renderMomentSvg(renderData, RENDER_TARGET.PREVIEW),
    digital: renderMomentSvg(renderData, RENDER_TARGET.DIGITAL),
    print: renderMomentSvg(renderData, RENDER_TARGET.PRINT_A3)
  });
}
