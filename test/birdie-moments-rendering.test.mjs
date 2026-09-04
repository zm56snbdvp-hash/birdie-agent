import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_TYPE, TEMPLATE_VERSION, buildRenderData } from "../src/moments/contracts.mjs";
import { RENDER_TARGET, MomentRenderError } from "../src/moments/rendering/contracts.mjs";
import { renderMomentAssets, renderMomentSvg } from "../src/moments/rendering/svg-renderer.mjs";
import { renderMomentForStorage } from "../src/moments/rendering/render-job.mjs";

const round = {
  id: "round-2026-09-04-001",
  userId: "u-1",
  displayName: "Kevin & Friends",
  courseName: "Gut <Wissmannshof>",
  playedAt: "2026-09-04T10:00:00+02:00",
  holesPlayed: 18,
  totalScore: 82,
  birdieCount: 3,
  scoreVsPar: 10,
  coursePar: 72,
  isCompleted: true
};

const roundRenderData = buildRenderData(round, MOMENT_TYPE.ROUND);
const pbRenderData = buildRenderData(round, MOMENT_TYPE.PERSONAL_BEST, {
  isPersonalBest: true,
  previousBestScore: 86,
  newBestScore: 82,
  strokesImproved: 4
});

test("preview render is exactly 1080x1350", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.equal(asset.width, 1080);
  assert.equal(asset.height, 1350);
  assert.match(asset.content, /width="1080" height="1350"/);
});

test("digital full-resolution render is exactly 2160x2700", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.DIGITAL);
  assert.equal(asset.width, 2160);
  assert.equal(asset.height, 2700);
});

test("A3 print render uses 300dpi portrait dimensions and safe area", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PRINT_A3);
  assert.equal(asset.width, 3508);
  assert.equal(asset.height, 4961);
  assert.equal(asset.safeMarginPx, 95);
});

test("same render data produces byte-identical deterministic SVG", () => {
  const a = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  const b = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.equal(a.content, b.content);
});

test("normal Round Card never contains a Personal Best claim", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.doesNotMatch(asset.content, /NEW PERSONAL BEST/);
  assert.match(asset.content, /ROUND EDITION/);
});

test("proven Personal Best Card contains the PB claim and positive exact delta", () => {
  const asset = renderMomentSvg(pbRenderData, RENDER_TARGET.PREVIEW);
  assert.match(asset.content, /NEW PERSONAL BEST/);
  assert.match(asset.content, /Previous 86/);
  assert.match(asset.content, /New 82/);
  assert.match(asset.content, /4 strokes better/);
});

test("PB render without proven comparison data fails closed", () => {
  const invalid = { ...pbRenderData, personalBestData: undefined };
  assert.throws(
    () => renderMomentSvg(invalid, RENDER_TARGET.PREVIEW),
    (error) => error instanceof MomentRenderError && error.code === "INVALID_PERSONAL_BEST_DATA"
  );
});

test("PB render rejects negative legacy improvement semantics", () => {
  const invalid = {
    ...pbRenderData,
    personalBestData: { previousBestScore: 86, newBestScore: 82, improvement: -4 }
  };
  assert.throws(
    () => renderMomentSvg(invalid, RENDER_TARGET.PREVIEW),
    (error) => error instanceof MomentRenderError && error.code === "INVALID_PERSONAL_BEST_DATA"
  );
});

test("optional score-vs-par is omitted when source data does not contain it", () => {
  const data = buildRenderData({ ...round, scoreVsPar: undefined }, MOMENT_TYPE.ROUND);
  const asset = renderMomentSvg(data, RENDER_TARGET.PREVIEW);
  assert.doesNotMatch(asset.content, />VS PAR</);
});

test("user-supplied display text is XML escaped", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.match(asset.content, /Kevin &amp; Friends/);
  assert.match(asset.content, /Gut &lt;Wissmannshof&gt;/);
});

test("internal round id is embedded as internal metadata and data attribute", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.match(asset.content, /data-round-id="round-2026-09-04-001"/);
  assert.match(asset.content, /internalRoundId/);
});

test("all three canonical outputs are generated from one render input", () => {
  const assets = renderMomentAssets(roundRenderData);
  assert.deepEqual(Object.keys(assets), ["preview", "digital", "print"]);
  assert.equal(assets.preview.templateVersion, TEMPLATE_VERSION.ROUND);
  assert.equal(assets.digital.templateVersion, TEMPLATE_VERSION.ROUND);
  assert.equal(assets.print.templateVersion, TEMPLATE_VERSION.ROUND);
  assert.notEqual(assets.preview.fileName, assets.digital.fileName);
});

test("render job stores three private assets then marks PREVIEW_READY", async () => {
  const stored = [];
  let readyPayload = null;
  let status = null;
  const result = await renderMomentForStorage("moment-1", {
    repo: {
      async getMoment() { return { id: "moment-1", renderData: roundRenderData }; },
      async setMomentStatus(_id, value) { status = value; },
      async markMomentPreviewReady(payload) { readyPayload = payload; },
      async markMomentFailed() { throw new Error("unexpected failure"); }
    },
    storage: {
      async putAsset(asset) {
        stored.push(asset);
        return `private://${asset.fileName}`;
      }
    },
    now: () => "2026-09-04T11:00:00Z"
  });
  assert.equal(status, "GENERATING");
  assert.equal(result.status, "PREVIEW_READY");
  assert.equal(stored.length, 3);
  assert.equal(readyPayload.previewAsset.startsWith("private://"), true);
  assert.equal(readyPayload.digitalAsset.startsWith("private://"), true);
  assert.equal(readyPayload.printAsset.startsWith("private://"), true);
});

test("render failure marks Moment FAILED instead of exposing partial success", async () => {
  let failed = null;
  const result = await renderMomentForStorage("moment-1", {
    repo: {
      async getMoment() { return { id: "moment-1", renderData: roundRenderData }; },
      async setMomentStatus() {},
      async markMomentPreviewReady() { throw new Error("should not be ready"); },
      async markMomentFailed(payload) { failed = payload; }
    },
    storage: { async putAsset() { throw new Error("store down"); } }
  });
  assert.equal(result.status, "FAILED");
  assert.equal(failed.momentId, "moment-1");
});
