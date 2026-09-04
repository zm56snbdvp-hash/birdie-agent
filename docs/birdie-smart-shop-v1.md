# Birdie Smart Shop v1

## Goal

Birdie Smart Shop adds a zero-inventory affiliate-commerce layer to the existing BirdieWorld app.

It must not create a separate storefront, require BirdieWorld to hold stock, accept merchant payments, fulfil orders, handle returns, or expose raw affiliate URLs to the client.

The intended flow is:

`BirdieWorld player context -> internal recommendation -> disclosed partner offer -> BirdieWorld outbound route -> affiliate merchant -> merchant checkout/fulfilment -> network transaction reconciliation`

## v1 scope

Product categories:

- golf balls
- golf gloves
- tees / small essentials
- rangefinders / GPS
- training aids

Initial provider candidates are registered in `src/affiliate-commerce/providers/registry.mjs`.

No provider is enabled by default. Production activation requires an approved affiliate relationship and valid credentials/configuration.

## Architecture

### Catalog ingestion

Awin-backed merchants use the Awin Datafeed flow:

1. Fetch the scriptable feed list using the dedicated Awin Datafeed API key.
2. Select only explicitly enabled advertiser IDs.
3. Require `Membership Status = Joined`.
4. Require the configured region.
5. Compare `Last Imported` with the local cache.
6. Download only changed feeds.
7. Parse CSV.
8. Map supported golf products into the internal catalog contract.
9. Drop unrelated, malformed, unsafe, unavailable, or inactive rows fail-closed.

The datafeed key is a server secret. It must never be shipped to the app.

Awin product destinations are accepted only when the tracked deep link uses an HTTPS `awin1.com` tracking host. An arbitrary HTTPS destination from a malformed feed row is rejected.

### Recommendation

The recommendation engine receives only BirdieWorld-owned player context and the internal catalog. It ranks a small number of relevant products deterministically.

Supported initial signals:

- essentials focus
- distance focus
- practice focus
- rounds played
- recent completed round
- region

Do not send round scores, handicap history, profile data, or recommendation reasons to an affiliate merchant merely to choose a product. Personalization remains inside BirdieWorld.

### Scorecard integration

A no-op-safe client bridge exists for the recovered Scorecard flow. It requests BirdieWorld recommendations only after a persisted completed round. A Commerce failure must never fail or roll back the saved round.

The authoritative player-context adapter intentionally emits only minimal commerce signals. Raw score and handicap fields are not part of the recommendation context.

### Client contract

The app receives a public recommendation object containing product display data and an internal BirdieWorld outbound path.

The app must not receive the merchant affiliate URL directly.

### Outbound attribution

On an actual user click:

1. authenticate the BirdieWorld user
2. resolve the product server-side
3. re-check product validity and region
4. create an opaque internal click ID
5. resolve the user's server-side Awin tracking-consent state
6. for Awin, add the opaque ID as `clickref2` and explicitly set `cons=0` or `cons=1`
7. persist the click without storing the final destination URL
8. return a 302 redirect to the current affiliate destination

The service defaults to `cons=0` when no consent adapter is configured or the consent lookup fails. It does not rely on a network default to infer consent.

`clickref2` is used instead of the public first click-reference slot so BirdieWorld can reconcile a network transaction to its internal click without intentionally placing BirdieWorld's opaque click reference on the advertiser landing page.

This makes partner URLs replaceable without an app release and preserves BirdieWorld attribution telemetry.

No tracking cookie or outbound merchant request should be triggered merely because a recommendation was rendered.

### Conversion reconciliation

`db/009_affiliate_commerce.sql` owns two Smart Shop persistence surfaces:

- `affiliate_clicks`
- `affiliate_conversions`

The Awin transaction adapter uses server-side Bearer authentication and can reconcile network transaction state back into `affiliate_conversions`. Network transaction ID plus network is the idempotency key, allowing pending/approved/declined state to be refreshed without creating duplicate sales.

Transaction windows are capped at 31 days by the adapter. Input instants are converted into the declared IANA timezone before being serialized to the Awin query, avoiding UTC/local-time drift.

`affiliate_conversions.click_id` is intentionally nullable and is not a foreign key. A valid network transaction must still be retained when its original local click row is unavailable because of retention, migration, or pre-rollout boundaries. A click reference in a network report therefore means `withClickRef`, not automatically a proven local-click match.

### Platform boundary

Smart Shop is for physical golf goods that are bought and fulfilled by an external merchant. It does not replace the separate StoreKit path for BirdieWorld digital content.

## Disclosure

Commercial recommendations must display a clear affiliate disclosure. German default copy is provided by `buildCommerceDisclosure()`.

Do not visually disguise partner offers as neutral editorial results.

## Provider activation

Registry entries deliberately contain stable integration identifiers only. Commission rates, temporary promotions, voucher rules, and other mutable commercial terms must not be hard-coded into the app or ranking algorithm.

To activate an Awin provider:

1. BirdieWorld's publisher account is approved for the advertiser program.
2. A dedicated Awin Datafeed API key exists server-side.
3. A server-side Awin API access token exists for transaction reconciliation.
4. The advertiser's current program terms are reviewed for allowed placements, creatives, deep links, paid search, vouchers, and app use.
5. Add the provider ID to the server-side enabled-provider configuration.
6. Bind the authoritative consent provider.
7. Run feed-sync, redirect and recommendation integration tests against real non-production data.
8. Verify disclosure, click attribution and transaction reconciliation before production release.

Direct networks such as Refersion/Affiliatly require equivalent approval and server-side catalog/link adapters before activation.

## Initial provider priority

For the German v1 launch, evaluate in this order:

1. Golf und Günstig DE — broad golf-retail catalog and Awin datafeed candidate.
2. Golf House DE — specialist golf retailer and Awin datafeed candidate.
3. Decathlon DE — broad low/mid-price coverage and Awin datafeed candidate.
4. Shot Scope — high-ticket GPS/rangefinder opportunity through a direct affiliate program.
5. SuperSpeed Golf — training-aid opportunity through a direct affiliate program.

This is an implementation priority, not a guarantee of acceptance or commercial terms.

## Guardrails

- zero inventory in v1
- no BirdieWorld fulfilment
- no checkout/payment capture by BirdieWorld for affiliate products
- no automatic merchant visit without a user click
- no unapproved advertiser enabled in production
- no raw affiliate URL exposed to the client
- no user score/profile payload sent to merchants for recommendation logic
- no hard-coded commission assumptions
- no implied tracking consent
- fail closed on malformed, unavailable, inactive, region-incompatible, or unsafe products
- private/no-store for personalized recommendation responses
- Commerce failure must never break Scorecard persistence
- network revenue records must not be discarded merely because a local click row is absent

## Current implementation

Core modules:

- `src/affiliate-commerce/contracts.mjs`
- `src/affiliate-commerce/recommend.mjs`
- `src/affiliate-commerce/click.mjs`
- `src/affiliate-commerce/service.mjs`
- `src/affiliate-commerce/integration/live-routes.mjs`
- `src/affiliate-commerce/integration/player-context.mjs`
- `src/affiliate-commerce/integration/scorecard-client.mjs`
- `src/affiliate-commerce/providers/awin.mjs`
- `src/affiliate-commerce/providers/csv.mjs`
- `src/affiliate-commerce/providers/awin-remote.mjs`
- `src/affiliate-commerce/providers/awin-attribution.mjs`
- `src/affiliate-commerce/providers/awin-transactions.mjs`
- `src/affiliate-commerce/providers/registry.mjs`
- `src/affiliate-commerce/persistence/d1-store.mjs`
- `db/009_affiliate_commerce.sql`

Tests:

- `test/birdie-smart-shop-v1.test.mjs`
- `test/birdie-smart-shop-awin-remote.test.mjs`
- `test/birdie-smart-shop-registry.test.mjs`
- `test/birdie-smart-shop-scorecard-context.test.mjs`
- `test/birdie-smart-shop-attribution.test.mjs`

CI:

- `.github/workflows/birdie-smart-shop-tests.yml`
- runs the isolated Smart Shop test suite on Node 22 without depending on unrelated repository package installation

The framework-neutral route handlers are intentional. They should be mounted into the actual BirdieWorld authenticated app backend rather than assumed to belong to the Birdie Agent operator service.

## Still required before live revenue

- actual affiliate-account approvals
- real server-side Awin Datafeed/API credentials
- current private BirdieWorld server source implementing the authoritative `/api/round` persistence
- mount handlers into that authoritative BirdieWorld app backend
- bind `loadPlayerCommerceSignals` to the authoritative BirdieWorld player/round source
- bind the real consent source
- apply migration 009 to staging/production D1
- schedule transaction reconciliation in the authoritative backend/runtime
- real provider feed/link adapters for any non-Awin providers
- end-to-end staging proof: recommendation -> click -> merchant -> network transaction -> BirdieWorld conversion
- program-term review immediately before activation

Until those items are complete, Smart Shop is implemented infrastructure, not a live revenue channel.
