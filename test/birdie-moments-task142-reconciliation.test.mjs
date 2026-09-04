import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { MOMENT_STATUS, MOMENT_TYPE, buildRenderData } from "../src/moments/contracts.mjs";
import { detectPersonalBest } from "../src/moments/personal-best.mjs";
import { renderMomentSvg } from "../src/moments/rendering/svg-renderer.mjs";
import { createRoundSaveWithMoments } from "../src/moments/live/scorecard-save-adapter.mjs";
import {
  getPostRoundUpsell,
  handleMomentCollectionRequest,
  handleMomentDetailRequest
} from "../src/moments/ui/routes.mjs";

const rawPreview = "private://moments/m1/preview.svg";
const rawDigital = "private://moments/m1/digital.svg";

function round(overrides = {}) {
  return {
    id: "r1",
    userId: "u1",
    displayName: "Kevin",
    courseName: "Test Course",
    playedAt: "2026-09-04T10:00:00+02:00",
    holesPlayed: 18,
    totalScore: 82,
    birdieCount: 3,
    isCompleted: true,
    status: "completed",
    ...overrides
  };
}

function moment(overrides = {}) {
  return {
    id: "m1",
    userId: "u1",
    roundId: "r1",
    momentType: MOMENT_TYPE.ROUND,
    status: MOMENT_STATUS.PREVIEW_READY,
    previewAsset: rawPreview,
    digitalAsset: rawDigital,
    createdAt: "2026-09-04T10:01:00+02:00",
    renderData: buildRenderData(round(), MOMENT_TYPE.ROUND),
    ...overrides
  };
}

function ownerRepo(m = moment()) {
  return {
    async getMoment(id) { return id === m.id ? m : null; },
    async getRound(id) { return id === "r1" ? { id, userId: "u1", status: "completed" } : null; },
    async listMomentsForRound(id) { return id === "r1" ? [m] : []; },
    async listMomentsForUser(id) { return id === "u1" ? [m] : []; }
  };
}

function previewGateway(calls = []) {
  return {
    async getAuthorizedPreviewUrl(input) {
      calls.push(input);
      return `https://preview.example/${input.momentId}?signed=1`;
    }
  };
}

test("TASK-143 no longer carries conflicting db/008 moment_failures migration", () => {
  assert.equal(existsSync(new URL("../db/008_free_digital_moment_failures.sql", import.meta.url)), false);
  assert.equal(existsSync(new URL("../db/004_moment_telemetry.sql", import.meta.url)), true);
});

test("persisted boolean completion aliases cannot bypass canonical exact completed status", async () => {
  for (const persisted of [
    round({ status: "draft", isCompleted: true, is_completed: true }),
    round({ status: "COMPLETED", isCompleted: true })
  ]) {
    let triggers = 0;
    const save = createRoundSaveWithMoments({
      momentsRepo: {},
      async saveRound() { return { round: persisted }; },
      async afterRoundCommittedFn() { triggers += 1; return { accepted: true, moments: [] }; }
    });
    const saved = await save({ authenticatedUser: { id: "u1" } });
    assert.equal(saved.round.status, persisted.status);
    assert.equal(saved.birdieMoment, undefined);
    assert.equal(triggers, 0);
  }
});

test("canonical Personal Best delta is positive strokesImproved and renderer accepts it", () => {
  const current = round();
  const previous = [round({ id: "old", totalScore: 86, playedAt: "2026-08-01T10:00:00+02:00" })];
  const pb = detectPersonalBest(current, previous);
  assert.equal(pb.isPersonalBest, true);
  assert.equal(pb.strokesImproved, 4);
  assert.equal("improvement" in pb, false);

  const data = buildRenderData(current, MOMENT_TYPE.PERSONAL_BEST, pb);
  assert.deepEqual(data.personalBestData, {
    previousBestScore: 86,
    newBestScore: 82,
    strokesImproved: 4
  });
  assert.match(renderMomentSvg(data).content, /4 strokes better/);
});

test("Moment Detail never exposes raw private preview and uses authorized gateway only after ownership", async () => {
  const calls = [];
  const response = await handleMomentDetailRequest({
    momentId: "m1",
    authUserId: "u1",
    repo: ownerRepo(),
    assetGateway: previewGateway(calls)
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.previewUrl, "https://preview.example/m1?signed=1");
  assert.equal("previewAsset" in response.body, false);
  assert.doesNotMatch(JSON.stringify(response.body), /private:\/\//);
  assert.deepEqual(calls, [{ momentId: "m1", previewAsset: rawPreview }]);

  const noGateway = await handleMomentDetailRequest({
    momentId: "m1",
    authUserId: "u1",
    repo: ownerRepo()
  });
  assert.equal(noGateway.body.previewUrl, null);
  assert.doesNotMatch(JSON.stringify(noGateway.body), /private:\/\//);
});

test("Reveal and Collection expose authorized previewUrl but never raw previewAsset", async () => {
  const gateway = previewGateway();
  const repo = ownerRepo();

  const reveal = await getPostRoundUpsell({ roundId: "r1", authUserId: "u1", repo, assetGateway: gateway });
  assert.equal(reveal.previewUrl, "https://preview.example/m1?signed=1");
  assert.equal("previewAsset" in reveal, false);
  assert.doesNotMatch(JSON.stringify(reveal), /private:\/\//);

  const collection = await handleMomentCollectionRequest({ authUserId: "u1", repo, assetGateway: gateway });
  assert.equal(collection.status, 200);
  assert.equal(collection.body.items[0].previewUrl, "https://preview.example/m1?signed=1");
  assert.equal("previewAsset" in collection.body.items[0], false);
  assert.doesNotMatch(JSON.stringify(collection.body), /private:\/\//);
});

test("foreign source-round ownership blocks preview gateway invocation", async () => {
  let gatewayCalls = 0;
  const response = await handleMomentDetailRequest({
    momentId: "m1",
    authUserId: "u1",
    repo: {
      async getMoment() { return moment(); },
      async getRound() { return { id: "r1", userId: "attacker", status: "completed" }; }
    },
    assetGateway: {
      async getAuthorizedPreviewUrl() { gatewayCalls += 1; return "https://should-not-run.example"; }
    }
  });
  assert.equal(response.status, 404);
  assert.equal(gatewayCalls, 0);
});
