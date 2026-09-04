import { MOMENT_TYPE, TEMPLATE_ID } from "../contracts.mjs";

export const FULFILLMENT_TYPE = Object.freeze({ DIGITAL: "DIGITAL", PRINT: "PRINT" });

export const PRODUCT_SKU = Object.freeze({
  ROUND_DIGITAL: "BM-ROUND-DIGITAL-V1",
  PERSONAL_BEST_DIGITAL: "BM-PB-DIGITAL-V1",
  ROUND_A3: "BM-ROUND-A3-V1",
  PERSONAL_BEST_A3: "BM-PB-A3-V1"
});

export const MOMENT_PRODUCTS = Object.freeze({
  [PRODUCT_SKU.ROUND_DIGITAL]: Object.freeze({
    sku: PRODUCT_SKU.ROUND_DIGITAL,
    momentType: MOMENT_TYPE.ROUND,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL,
    templateId: TEMPLATE_ID.ROUND_DIGITAL_V1,
    amountMinor: 690,
    currency: "EUR"
  }),
  [PRODUCT_SKU.PERSONAL_BEST_DIGITAL]: Object.freeze({
    sku: PRODUCT_SKU.PERSONAL_BEST_DIGITAL,
    momentType: MOMENT_TYPE.PERSONAL_BEST,
    fulfillmentType: FULFILLMENT_TYPE.DIGITAL,
    templateId: TEMPLATE_ID.PERSONAL_BEST_DIGITAL_V1,
    amountMinor: 990,
    currency: "EUR"
  }),
  [PRODUCT_SKU.ROUND_A3]: Object.freeze({
    sku: PRODUCT_SKU.ROUND_A3,
    momentType: MOMENT_TYPE.ROUND,
    fulfillmentType: FULFILLMENT_TYPE.PRINT,
    templateId: TEMPLATE_ID.ROUND_PRINT_V1,
    amountMinor: 3490,
    currency: "EUR",
    format: "A3"
  }),
  [PRODUCT_SKU.PERSONAL_BEST_A3]: Object.freeze({
    sku: PRODUCT_SKU.PERSONAL_BEST_A3,
    momentType: MOMENT_TYPE.PERSONAL_BEST,
    fulfillmentType: FULFILLMENT_TYPE.PRINT,
    templateId: TEMPLATE_ID.PERSONAL_BEST_PRINT_V1,
    amountMinor: 3490,
    currency: "EUR",
    format: "A3"
  })
});

export function getProduct(sku) {
  const product = MOMENT_PRODUCTS[sku];
  if (!product) throw new Error(`Unknown Birdie Moments SKU: ${sku}`);
  return product;
}

export function productsForMoment(momentType) {
  return Object.values(MOMENT_PRODUCTS).filter((product) => product.momentType === momentType);
}
