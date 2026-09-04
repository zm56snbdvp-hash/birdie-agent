# Birdie Moments v1 — Live / App Store Integration

## Verified recovery source

The newest recovered BirdieWorld source artifact available on 2026-09-04 contains the deployed Scorecard bundle `golf-scorecard-Dut-vRpH.js`.

That bundle proves the current browser contract:

```text
GET  /api/round
POST /api/round
```

The Scorecard POST body contains course/date/hole data and does not supply a user id. The server response supplies `payload.round`; only a persisted response with `round.id` and `round.status === "completed"` is allowed to trigger Birdie Moments.

The local UI label (`Runde abschließen` vs `Zwischenstand sichern`) is never server authority.

## Live integration implemented on this branch

Server/live branch:

`feature/birdie-moments-v1-live-integration`

Native iOS StoreKit branch:

`feature/birdie-moments-v1-ios-storekit`

### Scorecard → Moments

`src/moments/integration/scorecard-round-save.mjs`

- wraps the existing server `saveRound()` service
- runs core persistence first
- triggers Moments only from the persisted completed result
- requires authenticated server user ownership
- ignores client-authored `user_id`
- preserves the existing `/api/round` response shape by default
- Moment failures cannot fail an already-successful Scorecard save

`src/moments/integration/canonical-round.mjs`

- maps the recovered persisted Round shape into `MomentRenderData` inputs
- derives totals/Birdies/pars only from real complete hole data
- never invents optional golf metrics

### Post-round offer

`GET /api/round/:roundId/moment-offer`

is bound to the Phase 3 owner-only post-round Upsell contract.

The recovered browser adapter requests it only after a server-confirmed completed Round. Missing/unready offers are a no-op.

### D1

`src/moments/persistence/d1-repository.mjs` implements the Birdie Moments-owned persistence surfaces for:

- Moments
- render asset references
- purchases and payment-event idempotency
- App Store purchase intents and verified transactions
- Print orders and provider events
- tracking references
- failure records

The pre-existing BirdieWorld round repository remains injected as `roundSource`. Its private server table layout is not recoverable from the deployed browser bundle and is therefore not guessed.

## Confirmed native Apple lineage

The existing TestFlight/XcodeGen lineage is `feature/apple-ci-testflight` under `clients/apple`.

Confirmed BirdiePhone bundle identifier:

`de.birdieandbreakfast.birdie`

This identifier is pinned in `src/moments/commerce/apple-app-config.mjs` for the server verifier configuration. The two App Store Connect product IDs are intentionally not invented and remain deployment configuration.

The native BirdiePhone source did not previously contain BirdieWorld authentication or StoreKit. The new native branch therefore adds StoreKit as an injectable service and does **not** create a second login/session system.

## App Store commerce split

### Digital Round / Personal Best editions

Inside the iOS App Store app, these are digital content unlocks and use StoreKit In-App Purchase.

Birdie Moments uses two configurable **Consumable** IAP product IDs because users can purchase a new edition for many different Rounds.

### Purchase-intent-specific appAccountToken

Each Birdie Moment digital purchase intent receives its own server-issued UUID `appAccountToken`.

This is intentional: the same Consumable SKU can be purchased for many different Moments, so user-wide token reuse would not uniquely identify which Moment a StoreKit transaction belongs to.

Rules:

- a new Moment purchase intent gets a new token
- retrying the **same** purchase reuses the token already stored on that purchase intent
- different purchase intents cannot share a token; D1 enforces a UNIQUE index
- the native client cannot choose the token
- Apple returns the purchase token in the verified transaction and the server requires an exact match

The server flow is:

```text
owned Moment
  -> server creates/reuses purchase intent
  -> unique purchase-specific appAccountToken
  -> server returns configured App Store product id + token
  -> native StoreKit purchase with appAccountToken
  -> native client sends signed transaction JWS
  -> official Apple SignedDataVerifier
  -> verify Product ID + purchase token + Consumable + quantity=1 + not revoked
  -> atomically bind Apple transaction to exactly one purchase
  -> PAID + digital entitlement
  -> native client finishes StoreKit transaction
```

The iOS client never chooses authoritative user identity, entitlement state or App Store product mapping.

`src/moments/commerce/apple-verifier.mjs` is written against Apple's official `@apple/app-store-server-library`. Runtime activation must install that library and provide Apple root certificates, environment, and production app Apple ID where required; the bundle ID is already known.

### Crash / network / Ask-to-Buy recovery

A paid Consumable is not finished locally until the BirdieWorld server has durably granted the entitlement.

Server recovery:

- verifies the signed Apple transaction before using transaction fields
- looks up the unique purchase intent from the verified `appAccountToken`
- rejects unknown or foreign-user intents as not found
- reuses the canonical transaction confirmation path

Native recovery on `feature/birdie-moments-v1-ios-storekit`:

- `Transaction.unfinished` is processed after the authenticated BirdieWorld session is ready
- `Transaction.updates` can be observed for delayed/Ask-to-Buy transactions
- server recovery is called with the transaction JWS
- StoreKit `finish()` happens only after server status is `PAID`

This makes a crash or temporary network failure recoverable instead of losing an already-paid Moment.

### Native iOS files

`clients/apple/BirdiePhone/BirdieMomentsAPIClient.swift`

- authenticated `URLSession` client
- no invented auth; request authorization is injected
- StoreKit start / confirm / recovery endpoints are injected

`clients/apple/BirdiePhone/BirdieMomentsStoreKitClient.swift`

- loads only the server-selected App Store product
- requires StoreKit product type `.consumable`
- purchases with server-issued `appAccountToken`
- uses StoreKit verified transaction/JWS
- confirms entitlement server-side before `finish()`
- recovers unfinished and delayed transactions

### Premium A3 Print

The print is a physical good and remains outside StoreKit IAP.

Its normal payment-provider flow (for example Apple Pay/card via the selected physical-payment provider) remains separate from the digital StoreKit path.

## Gelato

`src/moments/print/gelato-provider.mjs` implements the selected single-provider A3 contract:

- validate configured product is printable A3 portrait
- validate destination country when provider data supplies country availability
- search by stable Birdie order reference before create
- sign the private Print asset only for a short provider-access window
- submit quantity exactly 1
- recover an existing provider order instead of duplicating it
- normalize provider order status and tracking

Webhook processing is deliberately disabled unless an explicit verified `webhookVerifier` is configured. The branch does not invent a provider-signature mechanism that has not been verified from provider documentation/configuration.

## Schema hardening found during live integration

The live integration audit found and fixed persistence gaps that would otherwise have appeared only in real commerce:

1. `moment_purchases.fulfillment_status` originally rejected real Print states such as `AWAITING_ORDER`, `SUBMITTED`, `SHIPPED`, and `DELIVERED`.
2. Print shipping context and tracking references were used by code but not persisted by the earlier schema.
3. Consumable StoreKit purchases need a unique transaction/purchase-intent ledger.
4. `appAccountToken` must be unique per purchase intent, not merely per user.

Migrations 004–007 harden the Print lifecycle and App Store purchase-intent/transaction isolation.

## Tests

The live branch adds regression coverage for:

- recovered `/api/round` canonical mapping
- persist-first ordering
- draft save does not trigger Moments
- authenticated ownership fail-closed behavior
- post-round offer lookup
- complete migration chain under SQLite
- concrete D1 Moments repository
- unique StoreKit token isolation per purchase intent
- StoreKit consumable transaction verification and duplicate protection
- App Store Product / token / revocation mismatch rejection
- unfinished StoreKit transaction recovery
- cross-user StoreKit recovery rejection
- Gelato A3 validation
- private asset signing before provider order
- existing-provider-order recovery
- fail-closed Gelato webhook activation
- shipment tracking normalization

The native iOS branch is built by the existing macOS/XcodeGen CI using the confirmed TestFlight project lineage.

## Still external / configuration-bound

The following are real integration gates and are not fabricated by this repository:

1. obtain the current private server source implementing the existing `/api/round` persistence and map that exact repository to `roundSource`
2. apply Birdie Moments migrations to the selected staging/production D1 database
3. wire the existing authenticated BirdieWorld session into `BirdieMomentsRequestAuthorizing` and configure the actual start/confirm/recovery endpoint URLs
4. create/configure the two App Store Connect Consumable product IDs and put their IDs into server catalog configuration
5. install/configure Apple's App Store Server Library, Apple root certificates, environment, and production app Apple ID; bundle ID is confirmed as `de.birdieandbreakfast.birdie`
6. configure the existing physical-payment adapter for `PRINT_A3`
7. configure Gelato API key and exact printable A3 portrait `productUid`
8. configure and verify the Gelato webhook authenticity mechanism before enabling webhook-driven fulfillment state changes
9. run staging E2E with real auth, persisted Round, StoreKit sandbox purchase, payment sandbox for Print, and a Gelato test/sandbox order

## Status

The server branch is **LIVE_INTEGRATION_READY_FOR_STAGING_CONFIGURATION**.

The native iOS StoreKit client exists and compiles on the existing Apple/TestFlight lineage; final activation still requires the real authenticated BirdieWorld session, configured API endpoints and App Store Connect products.

This is not a claim that production/App Store purchases or a real Print order have already been activated.
