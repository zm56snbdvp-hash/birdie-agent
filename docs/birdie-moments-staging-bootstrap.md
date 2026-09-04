# Birdie Moments v1 — Staging Bootstrap

## Goal

This runbook closes the provider-configuration gap without storing secrets in Git or relying on manual product-ID transcription.

The bootstrap is **dry-run by default**.

```bash
npm run moments:staging:check
```

It reports only configuration state and public product identifiers. It never prints API keys, private keys, certificate contents, or the configured Gelato product UID.

## Canonical iOS product contract

Bundle ID:

`de.birdieandbreakfast.birdie`

Consumable IAPs:

- `DIGITAL_ROUND` → `de.birdieandbreakfast.birdie.moments.round.v1`
- `DIGITAL_PERSONAL_BEST` → `de.birdieandbreakfast.birdie.moments.personalbest.v1`

Target German customer prices:

- Round Digital: `€6.90`
- Personal Best Digital: `€9.90`

The bootstrap queries App Store Connect price points for territory `DEU`. It does **not** silently round the requested price. If Apple does not expose an exact price point, the run stops with `EXACT_PRICE_POINT_UNAVAILABLE` and returns only nearby public price-point values for a deliberate pricing decision.

## App Store Connect credentials

Provide at runtime through the secret manager/environment only:

- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY_ID`
- either `APP_STORE_CONNECT_PRIVATE_KEY` or `APP_STORE_CONNECT_PRIVATE_KEY_PATH`

The bootstrap creates a short-lived ES256 JWT and discovers the App Store app by the canonical bundle ID.

Dry-run checks:

1. exactly one app matches the bundle ID
2. both canonical IAP product IDs exist or are reported as `CREATE_REQUIRED`
3. existing products are `CONSUMABLE`
4. exact `DEU` price points exist
5. German localization exists
6. a price schedule exists

### Apply missing App Store resources

Only after reviewing the dry-run:

```bash
npm run moments:staging:apply-app-store
```

Apply mode may create a missing canonical consumable IAP, add its German localization, and create an initial German-base price schedule using the exact requested price point. Existing price schedules are preserved rather than overwritten.

App Store Connect metadata changes can take time to propagate to the StoreKit sandbox. Do not interpret immediate StoreKit product absence as proof that creation failed.

## Gelato A3 discovery

Provide:

- `GELATO_API_KEY`

Without a product UID, the same dry-run searches Gelato's `posters` catalog with exactly:

- `PaperFormat=A3`
- `Orientation=ver`

If multiple A3 portrait products are returned, the bootstrap deliberately reports `PRODUCT_SELECTION_REQUIRED`; it does not guess paper/finish quality.

After selecting the intended physical product, set:

- `GELATO_PRODUCT_UID` for the bootstrap validator
- `BIRDIE_MOMENTS_GELATO_A3_PRODUCT_UID` in the Birdie Moments runtime configuration

Validation requires the selected product to remain printable and A3 portrait.

## Runtime readiness

Knowing a canonical App Store product ID is not proof that the product exists in App Store Connect.

`evaluateBirdieMomentsStagingReadiness()` therefore requires `runtime.appStoreProductsConfigured === true`. Set that runtime evidence only after the App Store bootstrap has validated both canonical products.

The remaining runtime gates are intentionally separate:

- Core: auth, round source, D1, private asset signer
- Digital: App Store product validation, StoreKit verifier library/root certificates/environment
- Print: Gelato credential/product UID, physical-payment provider, verified Gelato webhook handling

## First real sandbox E2E

After all readiness gates are green:

```text
real completed round
→ ROUND / optional PERSONAL_BEST moment
→ preview
→ StoreKit sandbox purchase
→ Apple signed transaction
→ server PAID + entitlement
→ full-resolution digital access
```

Then run the physical path separately:

```text
paid Premium A3 Print
→ private print asset signed for provider
→ exactly one Gelato sandbox/test order
→ provider status/tracking webhook
```

No production publish, App Store submission, or live Gelato order is implied by this bootstrap.
