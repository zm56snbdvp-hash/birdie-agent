import test from "node:test";
import assert from "node:assert/strict";
import { createBirdieMomentsRuntime } from "../src/moments/integration/runtime.mjs";

function createRuntime(overrides = {}) {
  return createBirdieMomentsRuntime({
    repo: {},
    storage: {},
    assetGateway: {},
    paymentProvider: {
      name: "TEST_PAY",
      async createCheckoutSession() {},
      async verifyWebhook() {}
    },
    printProvider: {
      name: "GELATO",
      async validateProduct() {},
      async createOrder() {},
      async handleWebhook() {},
      async getOrderStatus() {}
    },
    assetUrlSigner: {},
    authenticate: async () => ({ userId: "user-1" }),
    readJson: async () => ({}),
    readRawBody: async () => "",
    json() {},
    ...overrides
  });
}

test("integration runtime preserves non-completed existing round save response", async () => {
  const runtime = createRuntime();
  const response = { success: true, round: { id: "round-active", status: "active" } };
  const save = runtime.wrapRoundSave(async () => response);
  assert.equal(await save({ body: {} }), response);
});

test("integration runtime leaves unrelated HTTP routes to the existing BirdieWorld router", async () => {
  const runtime = createRuntime();
  const handled = await runtime.routeRequest({
    req: { method: "GET", headers: {} },
    url: new URL("https://birdie.test/api/deck")
  });
  assert.equal(handled, false);
});
