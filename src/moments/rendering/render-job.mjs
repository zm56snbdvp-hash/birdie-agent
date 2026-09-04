import { MOMENT_STATUS } from "../contracts.mjs";
import { MomentRenderError } from "./contracts.mjs";
import { renderMomentAssets } from "./svg-renderer.mjs";

/**
 * Repository contract:
 * - getMoment(momentId)
 * - setMomentStatus(momentId, status)
 * - markMomentPreviewReady({ momentId, generatedAt, thumbnailAsset, previewAsset, digitalAsset, printAsset })
 * Optional: markMomentFailed({ momentId, error })
 *
 * Storage contract:
 * - putAsset(...) -> private asset reference
 */
export async function renderMomentForStorage(momentId, { repo, storage, now = () => new Date().toISOString() }) {
  const moment = await repo.getMoment(momentId);
  if (!moment) throw new MomentRenderError("MOMENT_NOT_FOUND", `Moment ${momentId} not found`);
  if (!moment.renderData) throw new MomentRenderError("MISSING_RENDER_DATA", `Moment ${momentId} has no render data`);

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
          templateId: asset.templateId,
          private: true,
          protectedPreview: asset.protectedPreview,
          ...(asset.dpi ? {
            dpi: asset.dpi,
            bleedPx: asset.bleedPx,
            trimWidth: asset.trimWidth,
            trimHeight: asset.trimHeight
          } : {})
        }
      });
    }

    const generatedAt = now();
    await repo.markMomentPreviewReady({
      momentId,
      generatedAt,
      thumbnailAsset: stored.thumbnail,
      previewAsset: stored.preview,
      digitalAsset: stored.digital,
      printAsset: stored.print
    });

    return { ok: true, momentId, status: MOMENT_STATUS.PREVIEW_READY, generatedAt, assets: stored };
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
