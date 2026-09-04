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

Branch:

`feature/birdie-moments-v1-live-integration`

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

## App Store commerce split

### Digital Round / Personal Best editions

Inside the iOS App Store app, these are digital content unlocks and use StoreKit In-App Purchase.

Birdie Moments uses two configurable **Consumable** IAP product IDs because users can purchase a new edition for many different Rounds.

The server flow is:

```text
owned Moment
  -> stable server-issued appAccountToken
  -> server returns configured App Store product id
  -> native StoreKit purchase with appAccountToken
  -> native client sends signed transaction JWS
  -> official Apple SignedDataVerifier
  -> verify Product ID + appAccountToken + Consumable + quantity=1 + not revoked
  -> atomically bind Apple transaction to one purchase
  -> PAID + digital entitlement
```

The iOS client never chooses authoritative user identity, entitlement state or App Store product mapping.

`src/moments/commerce/apple-verifier.mjs` is written against Apple's official `@apple/app-store-server-library`. Runtime activation must install that library and provide Apple root certificates, bundle ID, environment, and production app Apple ID where required.

### Premium A3 Print

The print is a physical good and remains outside StoreKit IAP.

Its normal payment-provider flow (for example Apple Pay/card via the selected web/payment provider) remains separate from the digital StoreKit path.

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

The live integration audit found and fixed two Phase 5 persistence gaps:

1. `moment_purchases.fulfillment_status` originally rejected real Print states such as `AWAITING_ORDER`, `SUBMITTED`, `SHIPPED`, and `DELIVERED`.
2. Print shipping context and tracking references were used by code but not persisted by the earlier schema.

Migrations 004–007 correct the Print lifecycle and add App Store transaction/account-token ledgers.

## Tests

The live branch adds regression coverage for:

- recovered `/api/round` canonical mapping
- persist-first ordering
- draft save does not trigger Moments
- authenticated ownership fail-closed behavior
- post-round offer lookup
- complete migration chain under SQLite
- concrete D1 Moments repository
- stable server-issued StoreKit account tokens
- StoreKit consumable transaction verification and duplicate protection
- App Store Product / account-token / revocation mismatch rejection
- Gelato A3 validation
- private asset signing before provider order
- existing-provider-order recovery
- fail-closed Gelato webhook activation
- shipment tracking normalization

## Still external / configuration-bound

The following are real integration gates and are not fabricated by this repository:

1. obtain the current private server source implementing the existing `/api/round` persistence and map that exact repository to `roundSource`
2. apply Birdie Moments migrations to the selected staging/production D1 database
3. bind the actual iOS client to the StoreKit start/confirm endpoints
4. create/configure the two App Store Connect consumable product IDs and put their IDs into server catalog configuration
5. install/configure Apple's App Store Server Library, Apple root certificates, bundle ID, environment, and production app Apple ID
6. configure the existing physical-payment adapter for `PRINT_A3`
7. configure Gelato API key and exact printable A3 portrait `productUid`
8. configure and verify the Gelato webhook authenticity mechanism before enabling webhook-driven fulfillment state changes
9. run staging E2E with real auth, persisted Round, StoreKit sandbox purchase, payment sandbox for Print, and a Gelato test/sandbox order

## Status

This branch is **LIVE_INTEGRATION_READY_FOR_STAGING_CONFIGURATION**.

It is not a claim that production/App Store purchases or a real Print order have already been activated.
