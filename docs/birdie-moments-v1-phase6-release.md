# Birdie Moments v1 — Phase 6 Release Hardening

## Scope

Phase 6 closes the v1 engineering loop with:

- required analytics events
- analytics payload allow-listing (no payment references, signatures or shipping addresses)
- MVP KPI aggregation
- normalized failure records
- render and fulfillment failure telemetry
- full synthetic end-to-end regression coverage
- branch CI under Node.js 22

## Required analytics events

- `moment_generated`
- `moment_preview_viewed`
- `moment_offer_closed`
- `digital_purchase_started`
- `digital_purchase_completed`
- `print_purchase_started`
- `print_purchase_completed`
- `moment_generation_failed`
- `fulfillment_failed`

Analytics accepts only an explicit allow-list of operational identifiers and KPI fields. Provider payment references, webhook signatures and shipping addresses are never emitted.

## KPI definitions

### Generation Rate

Distinct completed `roundId` values with at least one `moment_generated` event divided by completed rounds.

A Personal Best round may generate both `ROUND` and `PERSONAL_BEST`; this must not drive Generation Rate above 100%.

### Preview Rate

Distinct previewed Moments divided by distinct generated Moments.

### Purchase Conversion

Distinct purchased Moments divided by distinct previewed Moments.

Buying both Digital and Print from one Moment therefore does not create a conversion above 100%.

### Revenue per Completed Round

Sum of completed Digital + Print purchase amounts divided by completed rounds.

### Print Attach Rate

Distinct buyers with a completed Print purchase divided by distinct buyers with any completed Moment purchase.

## Failure behavior

- incomplete round -> no Moment
- PB comparison unavailable -> normal ROUND only, no PB claim
- render/storage failure -> Moment `FAILED`; Scorecard remains committed
- failed/mismatched payment -> no entitlement and no Print order
- digital route manipulation without paid entitlement -> 403
- Print provider create/validation failure -> `FULFILLMENT_FAILED`; paid purchase remains
- duplicate payment event -> no duplicate entitlement or completion analytics
- duplicate Print submission -> no second provider order
- duplicate Print provider event -> no duplicate state transition

Failure telemetry is best-effort and must never throw back into the Scorecard or fulfillment state transition that it is observing.

## End-to-end regression path

The Phase 6 E2E harness covers a proven Personal Best round:

```text
completed round (82)
  -> previous comparable best (86)
  -> ROUND + PERSONAL_BEST
  -> deterministic Preview + Digital + A3 assets
  -> preview viewed
  -> Digital checkout
  -> verified payment
  -> paid entitlement
  -> 300-second signed download
  -> Print checkout
  -> verified Print payment
  -> AWAITING_ORDER
  -> one provider createOrder()
  -> duplicate fulfillment call returns existing order
  -> provider SHIPPED webhook
  -> KPI calculation
```

The harness also asserts `86 -> 82 = -4`, raw private asset references are not returned to the client, and analytics does not contain payment references.

## Definition-of-Done mapping

The code-level contracts now cover:

- automatic post-commit Moment evaluation
- deterministic PB logic and fail-closed PB claims
- versioned rendering and Preview assets
- Digital purchase and secure entitlement
- Premium A3 purchase and exactly-once Print order submission
- user ownership isolation
- Scorecard failure isolation
- duplicate-event / duplicate-order protection
- required analytics and KPI definitions
- automated core and E2E checks

## Current integration boundary

This branch is **engineering READY_TO_INTEGRATE**, not a claim that the App Store production system is already live.

The currently accessible sources still do not prove the final App Store frontend/persistence adapter, production payment credentials, or a selected live Print-on-Demand provider. Those must be connected and exercised with production/staging infrastructure before the original product-level `READY_TO_REVIEW` definition can be claimed.

Remaining external integration gates:

1. map the current App Store Round repository to the Phase 1 repository contract
2. bind the current App Store UI to the Phase 3 route/view-model contracts
3. implement the real existing/selected payment provider adapter against the Phase 4 contract
4. apply D1/production migrations for Moments, purchases and Print orders
5. select exactly one Print provider and implement the Phase 5 provider contract
6. execute staging E2E with real auth, real persisted round, provider sandbox payment and provider sandbox/test Print order

No merge to `main`, production deployment or real customer order is performed by this branch.
