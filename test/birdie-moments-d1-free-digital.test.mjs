import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOMENT_STATUS, MOMENT_TYPE } from "../src/moments/contracts.mjs";
import { createD1FreeDigitalMomentsRepository } from "../src/moments/persistence/d1-free-digital-repository.mjs";
import { handleMomentCollectionRequest } from "../src/moments/ui/routes.mjs";
import { SQLiteD1TestDatabase } from "./helpers/sqlite-d1.mjs";

const migration001 = readFileSync(new URL("../db/001_birdie_moments.sql", import.meta.url), "utf8");
const migration008 = readFileSync(new URL("../db/008_free_digital_moment_failures.sql", import.meta.url), "utf8");

function setup() {
  const db = new SQLiteD1TestDatabase();
  db.exec(migration001);
  db.exec(migration008);

  const rounds = new Map([
    ["round-1", { id: "round-1", userId: "user-1", status: "completed", holeCount: 18 }],
    ["round-2", { id: "round-2", userId: "user-1", status: "completed", holeCount: 18 }],
    ["round-x", { id: "round-x", userId: "user-2", status: "completed", holeCount: 18 }]
  ]);

  let idSequence = 0;
  const repo = createD1FreeDigitalMomentsRepository({
    db,
    roundSource: {
      async getRound(id) { return rounds.get(id) ?? null; },
      async listPreviousComparableRounds() { return []; }
    },
    idFactory() {
      idSequence += 1;
      return `id-${idSequence}`;
    },
    now: () => "2026-09-04T12:00:00Z"
  });

  return { db, repo };
}

function momentInput(overrides = {}) {
  return {
    userId: "user-1",
    roundId: "round-1",
    momentType: MOMENT_TYPE.ROUND,
    status: MOMENT_STATUS.PENDING,
    templateVersion: "birdie-moment-round-v1",
    renderData: {
      courseName: "Gut Testhof",
      playedAt: "2026-09-04T10:00:00Z",
      totalScore: 82,
      holesPlayed: 18,
      birdieCount: 3
    },
    isPersonalBest: false,
    ...overrides
  };
}

test("free Digital D1 repository is idempotent on round/type/template and contains no commerce methods", async () => {
  const { db, repo } = setup();
  try {
    const first = await repo.ensureMoment(momentInput());
    const second = await repo.ensureMoment(momentInput());

    assert.equal(first.id, second.id);
    assert.equal(first.roundId, "round-1");
    assert.equal(first.userId, "user-1");
    assert.equal(first.status, MOMENT_STATUS.PENDING);
    assert.equal("ensurePurchase" in repo, false);
    assert.equal("getPurchaseForProduct" in repo, false);

    const count = db.sqlite.prepare("SELECT COUNT(*) AS count FROM birdie_moments").get().count;
    assert.equal(Number(count), 1);
  } finally {
    db.close();
  }
});

test("render completion persists private preview and Digital master references", async () => {
  const { db, repo } = setup();
  try {
    const created = await repo.ensureMoment(momentInput());
    const ready = await repo.markMomentPreviewReady({
      momentId: created.id,
      generatedAt: "2026-09-04T12:05:00Z",
      previewAsset: "private://moments/id-1/preview.svg",
      digitalAsset: "private://moments/id-1/digital.svg"
    });

    assert.equal(ready.status, MOMENT_STATUS.PREVIEW_READY);
    assert.equal(ready.previewAsset, "private://moments/id-1/preview.svg");
    assert.equal(ready.digitalAsset, "private://moments/id-1/digital.svg");
  } finally {
    db.close();
  }
});

test("Collection reads real D1 Moment rows and PB wins without a purchase table", async () => {
  const { db, repo } = setup();
  try {
    const roundMoment = await repo.ensureMoment(momentInput());
    await repo.markMomentPreviewReady({
      momentId: roundMoment.id,
      generatedAt: "2026-09-04T12:05:00Z",
      previewAsset: "private://moments/round/preview.svg",
      digitalAsset: "private://moments/round/digital.svg"
    });

    const pbMoment = await repo.ensureMoment(momentInput({
      momentType: MOMENT_TYPE.PERSONAL_BEST,
      templateVersion: "birdie-moment-pb-v1",
      isPersonalBest: true,
      renderData: {
        ...momentInput().renderData,
        personalBestData: { previousBestScore: 86, newBestScore: 82, improvement: -4 }
      }
    }));
    await repo.markMomentPreviewReady({
      momentId: pbMoment.id,
      generatedAt: "2026-09-04T12:06:00Z",
      previewAsset: "private://moments/pb/preview.svg",
      digitalAsset: "private://moments/pb/digital.svg"
    });

    const response = await handleMomentCollectionRequest({ authUserId: "user-1", repo });
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].momentId, pbMoment.id);
    assert.equal(response.body.items[0].roundId, "round-1");
  } finally {
    db.close();
  }
});

test("D1 Collection owner query excludes another user's Moments before round checks", async () => {
  const { db, repo } = setup();
  try {
    await repo.ensureMoment(momentInput({
      userId: "user-2",
      roundId: "round-x"
    }));

    const owned = await repo.listMomentsForUser("user-1");
    assert.deepEqual(owned, []);
  } finally {
    db.close();
  }
});

test("Moment failures are persisted independently of purchase/payment infrastructure", async () => {
  const { db, repo } = setup();
  try {
    const created = await repo.ensureMoment(momentInput());
    const failed = await repo.markMomentFailed({
      momentId: created.id,
      error: Object.assign(new Error("renderer exploded"), { code: "RENDER_TEST_FAILURE" })
    });

    assert.equal(failed.status, MOMENT_STATUS.FAILED);
    const failure = db.sqlite.prepare("SELECT * FROM moment_failures LIMIT 1").get();
    assert.equal(failure.stage, "RENDERING");
    assert.equal(failure.code, "RENDER_TEST_FAILURE");
    assert.equal(failure.moment_id, created.id);
  } finally {
    db.close();
  }
});
