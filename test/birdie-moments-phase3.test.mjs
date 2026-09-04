import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_STATUS, MOMENT_TYPE } from "../src/moments/contracts.mjs";
import { getOwnedMoment } from "../src/moments/ui/access.mjs";
import {
  buildMomentDetailViewModel,
  buildPostRoundUpsellViewModel,
  selectPrimaryPostRoundMoment
} from "../src/moments/ui/view-models.mjs";
import { getPostRoundUpsell, handleMomentDetailRequest } from "../src/moments/ui/routes.mjs";

const renderData = {
  internalRoundId: "round-1",
  playerName: "Kevin",
  courseName: "Gut Testhof",
  playedAt: "2026-09-04T10:00:00+02:00",
  totalScore: 82,
  holesPlayed: 18,
  birdieCount: 3,
  momentType: MOMENT_TYPE.ROUND,
  templateVersion: "birdie-moment-round-v1"
};

function moment(overrides = {}) {
  return {
    id: "moment-1",
    userId: "user-1",
    roundId: "round-1",
    momentType: MOMENT_TYPE.ROUND,
    status: MOMENT_STATUS.PREVIEW_READY,
    previewAsset: "private://moments/moment-1/preview.svg",
    renderData,
    ...overrides
  };
}

test("post-round upsell is dismissible and routes to the protected detail view", () => {
  const vm = buildPostRoundUpsellViewModel(moment());
  assert.equal(vm.title, "Dein Birdie Moment ist fertig.");
  assert.equal(vm.dismissible, true);
  assert.equal(vm.primaryAction.href, "/moments/moment-1");
  assert.equal(vm.secondaryAction.action, "DISMISS");
});

test("upsell is hidden until preview is ready", () => {
  assert.equal(buildPostRoundUpsellViewModel(moment({ status: MOMENT_STATUS.GENERATING })), null);
  assert.equal(buildPostRoundUpsellViewModel(moment({ previewAsset: null })), null);
});

test("PB is preferred over ROUND for the same post-round upsell", () => {
  const round = moment({ id: "round-moment" });
  const pb = moment({
    id: "pb-moment",
    momentType: MOMENT_TYPE.PERSONAL_BEST,
    renderData: {
      ...renderData,
      momentType: MOMENT_TYPE.PERSONAL_BEST,
      templateVersion: "birdie-moment-pb-v1",
      personalBestData: { previousBestScore: 86, newBestScore: 82, improvement: -4 }
    }
  });
  assert.equal(selectPrimaryPostRoundMoment([round, pb]).id, "pb-moment");
});

test("owner can load their Moment", async () => {
  const owned = await getOwnedMoment({
    momentId: "moment-1",
    authUserId: "user-1",
    repo: { async getMoment() { return moment(); } }
  });
  assert.equal(owned.id, "moment-1");
});

test("foreign owner receives not found", async () => {
  await assert.rejects(
    getOwnedMoment({
      momentId: "moment-1",
      authUserId: "user-2",
      repo: { async getMoment() { return moment(); } }
    }),
    (error) => error.code === "MOMENT_NOT_FOUND" && error.status === 404
  );
});

test("detail route requires authentication", async () => {
  const response = await handleMomentDetailRequest({
    momentId: "moment-1",
    authUserId: null,
    repo: { async getMoment() { return moment(); } },
    pricing: {}
  });
  assert.equal(response.status, 401);
});

test("detail route is private and no-store", async () => {
  const response = await handleMomentDetailRequest({
    momentId: "moment-1",
    authUserId: "user-1",
    repo: { async getMoment() { return moment(); } },
    pricing: { roundDigital: 6.9, personalBestDigital: 9.9, premiumA3Print: 34.9 }
  });
  assert.equal(response.status, 200);
  assert.equal(response.cacheControl, "private, no-store");
  assert.equal(response.body.products[0].price, "6,90 €");
  assert.equal(response.body.products[1].price, "34,90 €");
});

test("pricing is injected rather than hard-coded in the view model", () => {
  const vm = buildMomentDetailViewModel(moment(), {
    roundDigital: 7.5,
    personalBestDigital: 11,
    premiumA3Print: 39
  });
  assert.equal(vm.products[0].price, "7,50 €");
  assert.equal(vm.products[1].price, "39,00 €");
});

test("PB detail exposes proven comparison data", () => {
  const vm = buildMomentDetailViewModel(moment({
    momentType: MOMENT_TYPE.PERSONAL_BEST,
    renderData: {
      ...renderData,
      momentType: MOMENT_TYPE.PERSONAL_BEST,
      templateVersion: "birdie-moment-pb-v1",
      personalBestData: { previousBestScore: 86, newBestScore: 82, improvement: -4 }
    }
  }), { personalBestDigital: 9.9, premiumA3Print: 34.9 });
  assert.deepEqual(vm.personalBest, {
    previousBestScore: 86,
    newBestScore: 82,
    improvement: -4
  });
});

test("post-round lookup only uses the authenticated user's Moments", async () => {
  const vm = await getPostRoundUpsell({
    roundId: "round-1",
    authUserId: "user-1",
    repo: {
      async listMomentsForRound() {
        return [
          moment({ id: "foreign", userId: "user-2", momentType: MOMENT_TYPE.PERSONAL_BEST }),
          moment({ id: "owned", userId: "user-1" })
        ];
      }
    }
  });
  assert.equal(vm.primaryAction.href, "/moments/owned");
});
