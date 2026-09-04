import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_TYPE, TEMPLATE_ID, buildRenderData } from "../src/moments/contracts.mjs";
import { PRINT_A3, RENDER_TARGET, MomentRenderError } from "../src/moments/rendering/contracts.mjs";
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
  parCount: 8,
  scoreVsPar: 10,
  coursePar: 72,
  isCompleted: true
};

const roundRenderData = buildRenderData(round, MOMENT_TYPE.ROUND);
const pbRenderData = buildRenderData(round, MOMENT_TYPE.PERSONAL_BEST, {
  isPersonalBest: true,
  previousBestScore: 86,
  newBestScore: 82,
  improvement: 4
});

test("preview render is exactly 1080x1350 and protected", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.equal(asset.width, 1080);
  assert.equal(asset.height, 1350);
  assert.match(asset.content, /PREVIEW · BIRDIEWORLD/);
});

test("digital master is exactly 2160x2700 and unmarked", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.DIGITAL);
  assert.equal(asset.width, 2160);
  assert.equal(asset.height, 2700);
  assert.doesNotMatch(asset.content, /PREVIEW · BIRDIEWORLD/);
});

test("A3 print contains trim plus 3mm bleed at 300 DPI", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PRINT_A3);
  assert.equal(asset.width, PRINT_A3.width);
  assert.equal(asset.height, PRINT_A3.height);
  assert.equal(asset.trimWidth, 3508);
  assert.equal(asset.trimHeight, 4961);
  assert.equal(asset.bleedPx, 35);
  assert.equal(asset.dpi, 300);
  assert.match(asset.content, /data-bleed-mm="3"/);
});

test("same render data produces byte-identical deterministic SVG", () => {
  assert.equal(
    renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW).content,
    renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW).content
  );
});

test("normal Round Card never contains a Personal Best claim", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.doesNotMatch(asset.content, /NEW PERSONAL BEST/);
  assert.match(asset.content, /ROUND EDITION/);
});

test("proven Personal Best contains positive strokes-better claim", () => {
  const asset = renderMomentSvg(pbRenderData, RENDER_TARGET.PREVIEW);
  assert.match(asset.content, /NEW PERSONAL BEST/);
  assert.match(asset.content, /PREVIOUS BEST 86/);
  assert.match(asset.content, /4 STROKES BETTER/);
});

test("PB render without proven comparison data fails closed", () => {
  assert.throws(
    () => renderMomentSvg({ ...pbRenderData, improvement: undefined }, RENDER_TARGET.PREVIEW),
    (error) => error instanceof MomentRenderError && error.code === "INVALID_PERSONAL_BEST_DATA"
  );
});

test("optional score-vs-par is omitted when unavailable", () => {
  const data = buildRenderData({ ...round, scoreVsPar: undefined }, MOMENT_TYPE.ROUND);
  assert.doesNotMatch(renderMomentSvg(data).content, /TO PAR/);
});

test("optional parCount is omitted without placeholder or empty separator", () => {
  const data = buildRenderData({ ...round, parCount: undefined }, MOMENT_TYPE.ROUND);
  const asset = renderMomentSvg(data);
  assert.doesNotMatch(asset.content, /PARS/);
  assert.match(asset.content, /3 BIRDIES · 18 HOLES/);
  assert.doesNotMatch(asset.content, /undefined|null|N\/A/);
});

test("user display text is XML escaped", () => {
  const asset = renderMomentSvg(roundRenderData, RENDER_TARGET.PREVIEW);
  assert.match(asset.content, /Kevin &amp; Friends/);
  assert.match(asset.content, /Gut &lt;Wissmannshof&gt;/);
});

test("all four output assets select the exact v1 templates", () => {
  const normal = renderMomentAssets(roundRenderData);
  const pb = renderMomentAssets(pbRenderData);
  assert.deepEqual(Object.keys(normal), ["thumbnail", "preview", "digital", "print"]);
  assert.equal(normal.digital.templateId, TEMPLATE_ID.ROUND_DIGITAL_V1);
  assert.equal(normal.print.templateId, TEMPLATE_ID.ROUND_PRINT_V1);
  assert.equal(pb.digital.templateId, TEMPLATE_ID.PERSONAL_BEST_DIGITAL_V1);
  assert.equal(pb.print.templateId, TEMPLATE_ID.PERSONAL_BEST_PRINT_V1);
});

test("digital and print are separate layout families", () => {
  const digital = renderMomentSvg(roundRenderData, RENDER_TARGET.DIGITAL);
  const print = renderMomentSvg(roundRenderData, RENDER_TARGET.PRINT_A3);
  assert.match(digital.content, /digital-bg/);
  assert.doesNotMatch(print.content, /digital-bg/);
});

test("long course wraps and never uses ellipsis", () => {
  const data = buildRenderData({
    ...round,
    courseName: "Royal Ancient Golf Club of Birdie Valley Championship Course"
  }, MOMENT_TYPE.ROUND);
  const asset = renderMomentSvg(data, RENDER_TARGET.PREVIEW);
  assert.doesNotMatch(asset.content, /…/);
});

test("render job stores four private assets then marks PREVIEW_READY", async () => {
  const statuses = [];
  const stored = [];
  let readyPayload = null;
  const repo = {
    async getMoment(id) { return { id, renderData: roundRenderData }; },
    async setMomentStatus(id, status) { statuses.push([id, status]); },
    async markMomentPreviewReady(payload) { readyPayload = payload; }
  };
  const storage = {
    async putAsset(input) { stored.push(input); return `private://${input.fileName}`; }
  };

  const result = await renderMomentForStorage("moment-1", {
    repo,
    storage,
    now: () => "2026-09-04T12:00:00.000Z"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "PREVIEW_READY");
  assert.deepEqual(statuses, [["moment-1", "GENERATING"]]);
  assert.equal(stored.length, 4);
  assert.ok(stored.every((item) => item.metadata.private === true));
  assert.match(readyPayload.thumbnailAsset, /^private:\/\//);
  assert.match(readyPayload.previewAsset, /^private:\/\//);
  assert.match(readyPayload.digitalAsset, /^private:\/\//);
  assert.match(readyPayload.printAsset, /^private:\/\//);
});

test("render failure marks Moment FAILED instead of exposing partial success", async () => {
  let failed = null;
  let readyCalled = false;
  const repo = {
    async getMoment(id) { return { id, renderData: roundRenderData }; },
    async setMomentStatus() {},
    async markMomentPreviewReady() { readyCalled = true; },
    async markMomentFailed(payload) { failed = payload; }
  };
  let calls = 0;
  const storage = {
    async putAsset() {
      calls += 1;
      if (calls === 2) throw new Error("storage unavailable");
      return "private://first.svg";
    }
  };

  const result = await renderMomentForStorage("moment-2", { repo, storage });
  assert.equal(result.ok, false);
  assert.equal(result.status, "FAILED");
  assert.equal(readyCalled, false);
  assert.equal(failed.momentId, "moment-2");
});
