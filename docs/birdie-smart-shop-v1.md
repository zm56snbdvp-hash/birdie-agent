# Birdie Smart Shop v1

## Goal

Birdie Smart Shop adds a zero-inventory affiliate-commerce layer to the existing BirdieWorld app.

It must not create a separate storefront, require BirdieWorld to hold stock, accept merchant payments, fulfil orders, handle returns, or expose raw affiliate URLs to the client.

The intended flow is:

`BirdieWorld player context -> internal recommendation -> disclosed partner offer -> BirdieWorld outbound route -> affiliate merchant -> merchant checkout/fulfilment`

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
4. create/record an internal click ID
5. return a 302 redirect to the current affiliate destination

This makes partner URLs replaceable without an app release and preserves BirdieWorld attribution telemetry.

No tracking cookie or outbound merchant request should be triggered merely because a recommendation was rendered.

## Disclosure

Commercial recommendations must display a clear affiliate disclosure. German default copy is provided by `buildCommerceDisclosure()`.

Do not visually disguise partner offers as neutral editorial results.

## Provider activation

Registry entries deliberately contain stable integration identifiers only. Commission rates, temporary promotions, voucher rules, and other mutable commercial terms must not be hard-coded into the app or ranking algorithm.

To activate an Awin provider:

1. BirdieWorld's publisher account is approved for the advertiser program.
2. A dedicated Awin Datafeed API key exists server-side.
3. The advertiser's current program terms are reviewed for allowed placements, creatives, deep links, paid search, vouchers, and email use.
4. Add the provider ID to the server-side enabled-provider configuration.
5. Run feed-sync and recommendation integration tests against real non-production data.
6. Verify disclosure and redirect attribution before production release.

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
- fail closed on malformed, unavailable, inactive, region-incompatible, or unsafe products
- private/no-store for personalized recommendation responses
- Commerce failure must never break Scorecard persistence

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
- `src/affiliate-commerce/providers/registry.mjs`

Tests:

- `test/birdie-smart-shop-v1.test.mjs`
- `test/birdie-smart-shop-awin-remote.test.mjs`
- `test/birdie-smart-shop-registry.test.mjs`
- `test/birdie-smart-shop-scorecard-context.test.mjs`

The framework-neutral route handlers are intentional. They should be mounted into the actual BirdieWorld authenticated app backend rather than assumed to belong to the Birdie Agent operator service.

## Still required before live revenue

- actual affiliate-account approvals
- real server-side credentials
- mount handlers into the authoritative BirdieWorld app backend
- bind `loadPlayerCommerceSignals` to the authoritative BirdieWorld player/round source
- persistent click sink / analytics store
- real provider feed/link adapters for any non-Awin providers
- end-to-end staging proof: recommendation -> click -> affiliate attribution
- program-term review immediately before activation

Until those items are complete, Smart Shop is implemented infrastructure, not a live revenue channel.
