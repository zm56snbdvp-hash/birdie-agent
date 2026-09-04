import test from "node:test";
import assert from "node:assert/strict";
import { createBirdieMomentsRuntime } from "../src/moments/integration/runtime.mjs";

function createRuntime(overrides = {}) {
  const defaults = {
    repo: {
      async claimPrintSubmission() { return { acquired: true }; }
    },
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
    assetUrlSigner: {
      async signProviderAsset() { return "https://assets.test/print/signed"; }
    },
    authenticate: async () => ({ userId: "user-1" }),
    readJson: async () => ({}),
    readRawBody: async () => "",
    json() {}
  };

  return createBirdieMomentsRuntime({ ...defaults, ...overrides });
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

test("integration runtime refuses production print wiring without atomic submission lease", () => {
  assert.throws(
    () => createRuntime({ repo: {} }),
    /claimPrintSubmission/
  );
});

test("integration runtime refuses print provider without authenticated status reconciliation", () => {
  assert.throws(
    () => createRuntime({
      printProvider: {
        name: "GELATO",
        async validateProduct() {},
        async createOrder() {},
        async handleWebhook() {}
      }
    }),
    /getOrderStatus/
  );
});

test("integration runtime refuses print wiring without private provider asset signer", () => {
  assert.throws(
    () => createRuntime({ assetUrlSigner: {} }),
    /signProviderAsset/
  );
});
