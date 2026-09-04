# Birdie Moments v1 — Phase 4 Digital Commerce

## Scope

Phase 4 implements the server-side contract for purchasing and unlocking Birdie Moments digital editions.

Included:

- `moment_purchases` persistence schema
- provider-event idempotency ledger
- server-authoritative product catalog contract
- owner-only digital checkout creation
- payment metadata binding
- signed webhook verification contract
- exact amount/currency/metadata validation
- paid digital entitlement
- short-lived signed download URL
- private/no-store response semantics

Not included:

- Premium Print ordering (Phase 5)
- provider-specific production credentials
- tax calculation implementation
- refunds UI
- public asset URLs

## Current payment evidence

Birdie & Breakfast has prior Stripe test-mode / Payment Link evidence, but the currently accessible BirdieWorld source does not prove a reusable Booster Shop payment implementation. Phase 4 therefore does not invent a second payment stack and does not hard-wire provider secrets.

The provider contract is intentionally Stripe-compatible:

- create checkout/session with server amount + currency
- attach metadata
- verify raw webhook signature
- normalize the verified provider event

When the App Store BirdieWorld payment adapter is recovered, it can implement this contract or replace the provider adapter without changing purchase/entitlement rules.

## Canonical digital product IDs

- `DIGITAL_ROUND`
- `DIGITAL_PERSONAL_BEST`

Reserved for Phase 5:

- `PRINT_A3`

The Phase 3 detail view now uses these same IDs, so UI, checkout and persistence share one vocabulary.

## Checkout authority

The frontend may request a product purchase but never supplies an authoritative amount.

Server flow:

```text
authenticated user
  -> load owned Moment
  -> derive digital product from Moment type
  -> resolve amount/currency from server catalog
  -> idempotently ensure pending purchase
  -> provider checkout session
  -> server-authored metadata
```

Required provider metadata:

- `user_id`
- `round_id`
- `moment_id`
- `product_type`
- `fulfillment_type=DIGITAL`

## Payment verification

A payment webhook may grant entitlement only after the payment provider has cryptographically verified the raw request/signature and returned a normalized event.

The event must then match the pending purchase on:

- payment reference
- user ID
- round ID
- Moment ID
- product type
- fulfillment type
- exact amount
- exact currency
- paid state

A client-authored route, query parameter or success-page redirect is never proof of payment.

`confirmPaidPurchase()` is intentionally a repository transaction boundary. It must atomically:

1. claim the unique `provider_event_id`
2. mark the purchase `PAID`
3. set `entitlement_granted_at`
4. set digital fulfillment to `READY`

A repeated provider event returns idempotently and cannot grant twice.

## Secure download

Canonical protected flow:

```text
GET /moments/:momentId/download
  -> authenticated user
  -> owner gate
  -> matching DIGITAL purchase
  -> payment_status = PAID
  -> entitlement_granted_at exists
  -> private digital asset exists
  -> short-lived signed read URL
```

The raw private storage reference is not returned to the frontend.

Recommended signed URL lifetime for v1: 300 seconds.

All download responses use `Cache-Control: private, no-store`.

## Failure behavior

- checkout failure: no entitlement
- failed payment: no entitlement
- amount mismatch: reject event
- currency mismatch: reject event
- metadata mismatch: reject event
- foreign Moment: 404 from owner gate
- missing digital asset: 409
- unpaid route manipulation: 403
- duplicate paid event: idempotent success, no duplicate entitlement

The already-saved Scorecard and generated Moment remain intact through all commerce failures.
