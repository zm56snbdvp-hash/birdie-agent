import { routeMomentCommerceRequest } from "../commerce/routes.mjs";
import { createPrintFulfillmentService } from "../fulfillment/print-service.mjs";
import { routeMomentRequest } from "../ui/routes.mjs";
import { createRoundSaveWithMoments } from "./scorecard.mjs";

/**
 * Canonical Birdie Moments v1 integration surface.
 *
 * This module deliberately owns no BirdieWorld infrastructure. The live app
 * injects its existing auth, repository, storage, payment and response helpers.
 */
export function createBirdieMomentsRuntime({
  repo,
  storage,
  analytics = null,
  assetGateway,
  paymentProvider,
  printProvider,
  assetUrlSigner,
  authenticate,
  readJson,
  readRawBody,
  json,
  publicBaseUrl = "",
  logger = console,
  now = () => new Date().toISOString()
}) {
  const requiredFunctions = { authenticate, readJson, readRawBody, json };
  for (const [name, fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!repo || !storage || !assetGateway || !paymentProvider || !printProvider || !assetUrlSigner) {
    throw new TypeError("Birdie Moments runtime adapters are incomplete");
  }

  // Production exactly-once boundary: one internal order row is insufficient
  // when two workers can race between provider search and provider create.
  if (typeof repo.claimPrintSubmission !== "function") {
    throw new TypeError("Birdie Moments repo must implement atomic claimPrintSubmission()");
  }
  if (typeof printProvider.getOrderStatus !== "function") {
    throw new TypeError("Print provider must implement server-to-server getOrderStatus()");
  }
  if (typeof assetUrlSigner.signProviderAsset !== "function") {
    throw new TypeError("Print asset signer must implement signProviderAsset()");
  }

  const printFulfillment = createPrintFulfillmentService({
    provider: printProvider,
    repo,
    assetUrlSigner,
    analytics,
    now
  });

  return Object.freeze({
    printFulfillment,

    wrapRoundSave(saveRound) {
      return createRoundSaveWithMoments({
        saveRound,
        momentsRepo: repo,
        storage,
        analytics,
        logger,
        now
      });
    },

    async routeRequest({ req, url }) {
      const uiHandled = await routeMomentRequest({
        req,
        url,
        authenticate,
        repo,
        assetGateway,
        json
      });
      if (uiHandled) return true;

      return routeMomentCommerceRequest({
        req,
        url,
        authenticate,
        readJson,
        readRawBody,
        repo,
        paymentProvider,
        printFulfillment,
        assetGateway,
        analytics,
        json,
        publicBaseUrl
      });
    }
  });
}
