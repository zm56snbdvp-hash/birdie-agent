import { PRODUCT_TYPE } from "./contracts.mjs";

export const BIRDIE_MOMENTS_APP_STORE_PRODUCTS = Object.freeze({
  [PRODUCT_TYPE.DIGITAL_ROUND]: Object.freeze({
    productType: PRODUCT_TYPE.DIGITAL_ROUND,
    referenceName: "Birdie Moment Round Digital v1",
    productId: "de.birdieandbreakfast.birdie.moments.round.v1",
    inAppPurchaseType: "CONSUMABLE",
    targetCustomerPrice: "6.90",
    localization: Object.freeze({
      locale: "de-DE",
      name: "Birdie Moment – Runde",
      description: "Digitale Erinnerung an deine Golfrunde."
    })
  }),
  [PRODUCT_TYPE.DIGITAL_PERSONAL_BEST]: Object.freeze({
    productType: PRODUCT_TYPE.DIGITAL_PERSONAL_BEST,
    referenceName: "Birdie Moment Personal Best Digital v1",
    productId: "de.birdieandbreakfast.birdie.moments.personalbest.v1",
    inAppPurchaseType: "CONSUMABLE",
    targetCustomerPrice: "9.90",
    localization: Object.freeze({
      locale: "de-DE",
      name: "Birdie Moment – Personal Best",
      description: "Digitale Edition deines neuen Bestscores."
    })
  })
});

export function canonicalBirdieMomentsAppStoreProduct(productType) {
  return BIRDIE_MOMENTS_APP_STORE_PRODUCTS[productType] ?? null;
}
