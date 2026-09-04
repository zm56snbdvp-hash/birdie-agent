import test from "node:test";
import assert from "node:assert/strict";
import { MOMENT_STATUS, MOMENT_TYPE } from "../src/moments/contracts.mjs";
import { getFreePrivateMomentDownload } from "../src/moments/digital/free-download.mjs";
import {
  handleLiveDigitalDownloadRequest,
  handleLiveMomentCollectionRequest
} from "../src/moments/live/session-route-adapter.mjs";

function makeMoment(overrides = {}) {
  return {
    id: "moment-1",
    userId: "user-1",
    roundId: "round-1",
    momentType: MOMENT_TYPE.ROUND,
    status: MOMENT_STATUS.PREVIEW_READY,
    previewAsset: "private://moments/moment-1/preview.svg",
    digitalAsset: "private://moments/moment-1/digital.svg",
    createdAt: "2026-09-04T10:05:00Z",
    renderData: {
      courseName: "Gut Testhof",
      playedAt: "2026-09-04T10:00:00Z",
      totalScore: 82,
      holesPlayed: 18,
      birdieCount: 3
    },
    ...overrides
  };
}

function freeRepo(items = [makeMoment()], roundOwners = { "round-1": "user-1" }) {
  let purchaseReads = 0;
  return {
    get purchaseReads() { return purchaseReads; },
    async getMoment(id) {
      return items.find((item) => item.id === id) ?? null;
    },
    async getRound(id) {
      const owner = roundOwners[id];
      return owner ? { id, userId: owner, status: "completed" } : null;
    },
    async listMomentsForUser() {
      return items;
    },
    async getPurchaseForProduct() {
      purchaseReads += 1;
      throw new Error("free Moments v1 must never query purchases");
    },
    async ensurePurchase() {
      throw new Error("free Moments v1 must never create purchases");
    }
  };
}

const ownerSession = async () => "user-1";
const foreignSession = async () => "user-2";
const noSession = async () => null;

test("private Collection exposes one user-facing Moment per round and PB wins", async () => {
  const round = makeMoment({ id: "round-card" });
  const pb = makeMoment({
    id: "pb-card",
    momentType: MOMENT_TYPE.PERSONAL_BEST,
    createdAt: "2026-09-04T10:06:00Z",
    renderData: {
      ...round.renderData,
      personalBestData: { previousBestScore: 86, newBestScore: 82, improvement: -4 }
    }
  });
  const otherRound = makeMoment({
    id: "moment-2",
    roundId: "round-2",
    createdAt: "2026-09-03T10:00:00Z"
  });
  const foreign = makeMoment({ id: "foreign", userId: "user-2", roundId: "round-x" });
  const repo = freeRepo([round, pb, otherRound, foreign], {
    "round-1": "user-1",
    "round-2": "user-1",
    "round-x": "user-2"
  });

  const response = await handleLiveMomentCollectionRequest({
    request: {},
    resolveAuthenticatedUserId: ownerSession,
    repo
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.equal(response.body.access, "PRIVATE_OWNER_ONLY");
  assert.equal(response.body.items.length, 2);
  assert.equal(response.body.items[0].momentId, "pb-card");
  assert.equal(response.body.items[0].roundId, "round-1");
  assert.equal(response.body.items.some((item) => item.momentId === "round-card"), false);
  assert.equal(response.body.items.some((item) => item.momentId === "foreign"), false);
});

test("owner downloads the private Digital master for free without purchase or entitlement lookup", async () => {
  const repo = freeRepo();
  let signerCalls = 0;
  const response = await getFreePrivateMomentDownload({
    authUserId: "user-1",
    momentId: "moment-1",
    repo,
    assetSigner: {
      async createSignedReadUrl({ assetRef, expiresInSeconds }) {
        signerCalls += 1;
        assert.equal(assetRef, "private://moments/moment-1/digital.svg");
        assert.equal(expiresInSeconds, 300);
        return "https://assets.test/signed/free-moment?expires=300";
      }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.access, "FREE_PRIVATE");
  assert.equal(response.body.paymentRequired, false);
  assert.equal(response.body.entitlementRequired, false);
  assert.equal(response.body.downloadUrl, "https://assets.test/signed/free-moment?expires=300");
  assert.equal(JSON.stringify(response).includes("private://moments"), false);
  assert.equal(repo.purchaseReads, 0);
  assert.equal(signerCalls, 1);
});

test("Moment owner cannot download when the persisted source round belongs to another user", async () => {
  const repo = freeRepo([makeMoment()], { "round-1": "user-2" });
  let signerCalled = false;

  await assert.rejects(
    getFreePrivateMomentDownload({
      authUserId: "user-1",
      momentId: "moment-1",
      repo,
      assetSigner: {
        async createSignedReadUrl() {
          signerCalled = true;
          return "https://assets.test/should-not-exist";
        }
      }
    }),
    (error) => error.code === "MOMENT_NOT_FOUND" && error.status === 404
  );

  assert.equal(signerCalled, false);
});

test("foreign Site user cannot download another owner's free Moment", async () => {
  const repo = freeRepo();
  let signerCalled = false;
  const response = await handleLiveDigitalDownloadRequest({
    request: {},
    momentId: "moment-1",
    resolveAuthenticatedUserId: foreignSession,
    repo,
    assetSigner: {
      async createSignedReadUrl() {
        signerCalled = true;
        return "https://assets.test/should-not-exist";
      }
    }
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, "MOMENT_NOT_FOUND");
  assert.equal(signerCalled, false);
});

test("manipulated or unknown Moment id is hidden as 404", async () => {
  const response = await handleLiveDigitalDownloadRequest({
    request: {},
    momentId: "attacker-controlled-id",
    resolveAuthenticatedUserId: ownerSession,
    repo: freeRepo(),
    assetSigner: { async createSignedReadUrl() { throw new Error("must not run"); } }
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, "MOMENT_NOT_FOUND");
});

test("not-ready Moment cannot expose a stale Digital master", async () => {
  const repo = freeRepo([makeMoment({ status: MOMENT_STATUS.FAILED })]);
  let signerCalled = false;
  const response = await handleLiveDigitalDownloadRequest({
    request: {},
    momentId: "moment-1",
    resolveAuthenticatedUserId: ownerSession,
    repo,
    assetSigner: {
      async createSignedReadUrl() {
        signerCalled = true;
        return "https://assets.test/should-not-exist";
      }
    }
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, "DIGITAL_MOMENT_NOT_READY");
  assert.equal(signerCalled, false);
});

test("logged-out free download fails before repository or asset access", async () => {
  let repoTouched = false;
  let signerTouched = false;
  const response = await handleLiveDigitalDownloadRequest({
    request: {},
    momentId: "moment-1",
    resolveAuthenticatedUserId: noSession,
    repo: {
      async getMoment() { repoTouched = true; return makeMoment(); },
      async getRound() { repoTouched = true; return { id: "round-1", userId: "user-1" }; }
    },
    assetSigner: {
      async createSignedReadUrl() { signerTouched = true; return "https://assets.test/no"; }
    }
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error, "AUTH_REQUIRED");
  assert.equal(repoTouched, false);
  assert.equal(signerTouched, false);
});

test("logged-out Collection fails before the ownership-scoped query", async () => {
  let repoTouched = false;
  const response = await handleLiveMomentCollectionRequest({
    request: {},
    resolveAuthenticatedUserId: noSession,
    repo: {
      async listMomentsForUser() { repoTouched = true; return []; }
    }
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error, "AUTH_REQUIRED");
  assert.equal(repoTouched, false);
});
