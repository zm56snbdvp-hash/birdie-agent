import test from "node:test";
import assert from "node:assert/strict";
import { toCanonicalMomentRound } from "../src/moments/integration/canonical-round.mjs";
import { createRoundSaveWithBirdieMoments } from "../src/moments/integration/scorecard-round-save.mjs";
import { afterRecoveredScorecardSave, fetchPostRoundMomentOffer } from "../src/moments/integration/recovered-scorecard-client.mjs";
import { createGelatoPrintProvider } from "../src/moments/print/gelato-provider.mjs";

function recoveredRound(overrides = {}) {
  const pars = [4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4];
  const strokes = [4,4,3,5,3,4,3,5,4,4,4,3,5,4,4,3,5,4];
  return {
    id: "round-live-1",
    courseName: "Recovered Club",
    playedAt: "2026-09-04",
    holeCount: 18,
    status: "completed",
    holes: pars.map((par, index) => ({ hole: index + 1, par, strokes: strokes[index] })),
    ...overrides
  };
}

function memoryMomentsRepo(previous = []) {
  const moments = new Map();
  return {
    moments,
    async getRound() { throw new Error("request-scoped current round should be used"); },
    async ensureMoment(input) {
      const key = `${input.roundId}:${input.momentType}:${input.templateVersion}`;
      if (!moments.has(key)) moments.set(key, { id: `m-${moments.size + 1}`, ...input });
      return moments.get(key);
    },
    async listPreviousComparableRounds() { return previous; }
  };
}

test("recovered /api/round shape maps only persisted data plus server auth identity", () => {
  const canonical = toCanonicalMomentRound(recoveredRound(), {
    authenticatedUser: { id: "u1", displayName: "Kevin" }
  });
  assert.equal(canonical.id, "round-live-1");
  assert.equal(canonical.userId, "u1");
  assert.equal(canonical.displayName, "Kevin");
  assert.equal(canonical.holesPlayed, 18);
  assert.equal(canonical.isCompleted, true);
  assert.equal(canonical.totalScore, canonical.holeScores.reduce((a, b) => a + b, 0));
  assert.equal(canonical.birdieCount, 1);
  assert.equal(canonical.scoreVsPar, -1);
});

test("completed persisted save runs Moments after core save without changing the API response", async () => {
  const order = [];
  const repo = memoryMomentsRepo();
  const save = createRoundSaveWithBirdieMoments({
    momentsRepo: repo,
    saveRound: async () => {
      order.push("persist");
      return { round: recoveredRound() };
    }
  });
  const originalEnsure = repo.ensureMoment.bind(repo);
  repo.ensureMoment = async (input) => { order.push("moments"); return originalEnsure(input); };

  const result = await save({ authenticatedUser: { id: "u1", displayName: "Kevin" }, input: { user_id: "attacker" } });
  assert.equal(result.round.id, "round-live-1");
  assert.equal(result.birdieMoment, undefined);
  assert.deepEqual(order.slice(0, 2), ["persist", "moments"]);
});

test("draft persisted save never triggers Moments", async () => {
  const repo = memoryMomentsRepo();
  const save = createRoundSaveWithBirdieMoments({
    momentsRepo: repo,
    saveRound: async () => ({ round: recoveredRound({ status: "draft" }) })
  });
  await save({ authenticatedUser: { id: "u1", displayName: "Kevin" } });
  assert.equal(repo.moments.size, 0);
});

test("unproven owner fails closed without breaking successful Scorecard save", async () => {
  const logs = [];
  const repo = memoryMomentsRepo();
  const save = createRoundSaveWithBirdieMoments({
    momentsRepo: repo,
    logger: { error(name) { logs.push(name); } },
    saveRound: async () => ({ round: recoveredRound({ userId: "u-other" }) })
  });
  const result = await save({ authenticatedUser: { id: "u1", displayName: "Kevin" } });
  assert.equal(result.round.id, "round-live-1");
  assert.equal(repo.moments.size, 0);
  assert.deepEqual(logs, ["birdie_moments_round_owner_unproven"]);
});

test("recovered client requests moment offer only after server-confirmed completion", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.equal(url, "/api/round/round-live-1/moment-offer");
    return { ok: true, async json() { return { momentOffer: { momentId: "m1" } }; } };
  };
  const complete = await afterRecoveredScorecardSave({ round: recoveredRound() }, { fetchImpl });
  const draft = await afterRecoveredScorecardSave({ round: recoveredRound({ status: "draft" }) }, { fetchImpl });
  assert.equal(complete.momentOffer.momentId, "m1");
  assert.equal(draft.momentOffer, null);
  assert.equal(calls, 1);
});

test("moment offer lookup fails gracefully on missing endpoint", async () => {
  const offer = await fetchPostRoundMomentOffer({
    savedRound: recoveredRound(),
    fetchImpl: async () => ({ ok: false })
  });
  assert.equal(offer, null);
});

function response(ok, body, status = ok ? 200 : 500) {
  return { ok, status, async json() { return body; } };
}

function gelatoProviderHarness({ searchOrders = [], webhookVerifier } = {}) {
  const calls = [];
  const signerCalls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("product.gelatoapis.com")) {
      return response(true, {
        attributes: { PaperFormat: "A3", Orientation: "ver" },
        isPrintable: true,
        supportedCountries: ["DE", "AT"]
      });
    }
    if (url.endsWith("/orders:search")) return response(true, { orders: searchOrders });
    if (url.endsWith("/v4/orders") && options.method === "POST") {
      return response(true, { id: "gelato-order-1", fulfillmentStatus: "created" });
    }
    if (url.includes("/v4/orders/")) {
      return response(true, { id: "gelato-order-1", fulfillmentStatus: "shipped", financialStatus: "paid" });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const provider = createGelatoPrintProvider({
    apiKey: "test-key",
    productUid: "poster-a3-ver",
    fetchImpl,
    webhookVerifier,
    assetSigner: {
      async createSignedReadUrl(input) {
        signerCalls.push(input);
        return "https://signed.example/print.svg?exp=1800";
      }
    }
  });
  return { provider, calls, signerCalls };
}

const address = {
  recipientName: "Kevin Test",
  email: "kevin@example.com",
  line1: "Teststr. 1",
  postalCode: "12345",
  city: "Berlin",
  countryCode: "DE"
};

test("Gelato adapter validates A3 portrait and signs private asset before create order", async () => {
  const { provider, calls, signerCalls } = gelatoProviderHarness();
  const valid = await provider.validateProduct({ format: "A3_PORTRAIT_300DPI", countryCode: "DE" });
  assert.equal(valid.valid, true);

  const created = await provider.createOrder({
    idempotencyKey: "birdie-moment-print:p1",
    printAsset: "private://moments/m1/print.svg",
    format: "A3_PORTRAIT_300DPI",
    address,
    metadata: { purchase_id: "p1", moment_id: "m1", user_id: "u1" }
  });
  assert.equal(created.id, "gelato-order-1");
  assert.deepEqual(signerCalls, [{ assetRef: "private://moments/m1/print.svg", expiresInSeconds: 1800 }]);

  const createCall = calls.find((call) => call.url.endsWith("/v4/orders") && call.options.method === "POST");
  const body = JSON.parse(createCall.options.body);
  assert.equal(body.orderReferenceId, "birdie-moment-print:p1");
  assert.equal(body.items[0].quantity, 1);
  assert.equal(body.items[0].files[0].url.startsWith("https://signed.example/"), true);
  assert.equal(body.shippingAddress.email, "kevin@example.com");
});

test("Gelato adapter recovers existing provider order instead of creating a duplicate", async () => {
  const { provider, calls, signerCalls } = gelatoProviderHarness({
    searchOrders: [{ id: "existing-order", orderReferenceId: "birdie-moment-print:p1", fulfillmentStatus: "passed" }]
  });
  const result = await provider.createOrder({
    idempotencyKey: "birdie-moment-print:p1",
    printAsset: "private://moments/m1/print.svg",
    format: "A3_PORTRAIT_300DPI",
    address,
    metadata: { purchase_id: "p1", moment_id: "m1", user_id: "u1" }
  });
  assert.equal(result.id, "existing-order");
  assert.equal(result.recovered, true);
  assert.equal(signerCalls.length, 0);
  assert.equal(calls.filter((call) => call.url.endsWith("/v4/orders") && call.options.method === "POST").length, 0);
});

test("Gelato webhook path is fail-closed until an explicit verifier is configured", async () => {
  const { provider } = gelatoProviderHarness();
  await assert.rejects(
    provider.handleWebhook({ rawBody: "{}", signature: null }),
    (error) => error.code === "GELATO_WEBHOOK_VERIFIER_NOT_CONFIGURED"
  );
});

test("verified Gelato shipped webhook normalizes to Birdie print status contract", async () => {
  const { provider } = gelatoProviderHarness({
    webhookVerifier: async () => ({
      id: "evt1",
      event: "order_status_updated",
      orderId: "gelato-order-1",
      orderReferenceId: "birdie-moment-print:p1",
      fulfillmentStatus: "shipped",
      items: [{ fulfillments: [{ trackingUrl: "https://carrier.example/track" }] }]
    })
  });
  const event = await provider.handleWebhook({ rawBody: "signed", signature: "proof" });
  assert.equal(event.type, "SHIPPED");
  assert.equal(event.providerOrderId, "gelato-order-1");
  assert.equal(event.trackingReference, "https://carrier.example/track");
});
