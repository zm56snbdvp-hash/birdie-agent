import { MOMENT_STATUS } from "../contracts.mjs";
import { MomentRenderError } from "./contracts.mjs";
import { renderMomentAssets } from "./svg-renderer.mjs";

/**
 * Required repository contract:
 * - getMoment(momentId)
 * - setMomentStatus(momentId, status)
 * - markMomentPreviewReady({ momentId, generatedAt, previewAsset, digitalAsset, printAsset })
 *
 * Optional:
 * - markMomentFailed({ momentId, error })
 *
 * Required storage contract:
 * - putAsset({ momentId, target, fileName, mimeType, content, width, height, metadata })
 *   -> persistent, non-public asset reference
 */
export async function renderMomentForStorage(momentId, { repo, storage, now = () => new Date().toISOString() }) {
  const moment = await repo.getMoment(momentId);
  if (!moment) {
    throw new MomentRenderError("MOMENT_NOT_FOUND", `Moment ${momentId} not found`);
  }
  if (!moment.renderData) {
    throw new MomentRenderError("MISSING_RENDER_DATA", `Moment ${momentId} has no render data`);
  }

  await repo.setMomentStatus(momentId, MOMENT_STATUS.GENERATING);

  try {
    const assets = renderMomentAssets(moment.renderData);
    const stored = {};

    for (const [kind, asset] of Object.entries(assets)) {
      stored[kind] = await storage.putAsset({
        momentId,
        target: asset.target,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        content: asset.content,
        width: asset.width,
        height: asset.height,
        metadata: {
          templateVersion: asset.templateVersion,
          safeMarginPx: asset.safeMarginPx,
          private: true
        }
      });
    }

    const generatedAt = now();
    await repo.markMomentPreviewReady({
      momentId,
      generatedAt,
      previewAsset: stored.preview,
      digitalAsset: stored.digital,
      printAsset: stored.print
    });

    return {
      ok: true,
      momentId,
      status: MOMENT_STATUS.PREVIEW_READY,
      generatedAt,
      assets: stored
    };
  } catch (error) {
    await repo.markMomentFailed?.({ momentId, error });
    return {
      ok: false,
      momentId,
      status: MOMENT_STATUS.FAILED,
      reason: error?.code || "RENDER_FAILED"
    };
  }
}
