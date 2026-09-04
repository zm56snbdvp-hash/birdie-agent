import {
  createAppStoreDigitalPurchaseStartHandler,
  createAppStoreDigitalPurchaseConfirmHandler,
  createAppStoreDigitalPurchaseRecoveryHandler
} from "./app-store-routes.mjs";

export const APP_STORE_MOMENTS_ROUTES = Object.freeze({
  START_DIGITAL_PURCHASE: "/api/moments/:momentId/app-store/start",
  CONFIRM_DIGITAL_PURCHASE: "/api/moment-purchases/:purchaseId/app-store/confirm",
  RECOVER_DIGITAL_PURCHASE: "/api/moment-purchases/app-store/recover"
});

/**
 * Framework-neutral route definitions for the BirdieWorld server router.
 * Authentication remains inside each handler and client-authored identity is never authoritative.
 */
export function createAppStoreMomentsRouteDefinitions(deps) {
  return Object.freeze([
    Object.freeze({
      method: "POST",
      path: APP_STORE_MOMENTS_ROUTES.START_DIGITAL_PURCHASE,
      handler: createAppStoreDigitalPurchaseStartHandler(deps)
    }),
    Object.freeze({
      method: "POST",
      path: APP_STORE_MOMENTS_ROUTES.CONFIRM_DIGITAL_PURCHASE,
      handler: createAppStoreDigitalPurchaseConfirmHandler(deps)
    }),
    Object.freeze({
      method: "POST",
      path: APP_STORE_MOMENTS_ROUTES.RECOVER_DIGITAL_PURCHASE,
      handler: createAppStoreDigitalPurchaseRecoveryHandler(deps)
    })
  ]);
}
