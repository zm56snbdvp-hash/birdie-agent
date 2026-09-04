import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_STORE_MOMENTS_ROUTES,
  createAppStoreMomentsRouteDefinitions
} from "../src/moments/integration/app-store-route-contract.mjs";

test("App Store native route paths are stable and POST-only", () => {
  assert.equal(APP_STORE_MOMENTS_ROUTES.START_DIGITAL_PURCHASE, "/api/moments/:momentId/app-store/start");
  assert.equal(APP_STORE_MOMENTS_ROUTES.CONFIRM_DIGITAL_PURCHASE, "/api/moment-purchases/:purchaseId/app-store/confirm");

  const noop = async () => null;
  const routes = createAppStoreMomentsRouteDefinitions({
    authenticate: noop,
    accountTokenProvider: { getOrCreateForUser: noop },
    repo: {},
    catalog: {},
    analytics: null,
    parseBody: noop,
    appleVerifier: {},
    json: noop
  });

  assert.deepEqual(routes.map(({ method, path }) => ({ method, path })), [
    { method: "POST", path: "/api/moments/:momentId/app-store/start" },
    { method: "POST", path: "/api/moment-purchases/:purchaseId/app-store/confirm" }
  ]);
});
