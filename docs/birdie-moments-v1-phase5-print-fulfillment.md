# Birdie Moments v1 — Phase 5 Print Fulfillment

## Scope

Phase 5 adds exactly one provider-agnostic print fulfillment contract for `PRINT_A3`.

Flow:

```text
owned PREVIEW_READY Moment
  -> server-priced PRINT_A3 checkout
  -> verified payment webhook
  -> purchase = PAID / AWAITING_ORDER
  -> validate shipping address + print master
  -> ensure one internal print order per purchase
  -> provider.validateProduct()
  -> provider.createOrder() with stable idempotency key
  -> provider webhook status updates
```

## Print provider contract

A single configured provider implements:

- `name`
- `validateProduct()`
- `createOrder()`
- `getOrderStatus()`
- `handleWebhook()`

No second provider is implemented in v1.

## Payment gate

A print order cannot be submitted unless the purchase is server-side `PAID`. A checkout success redirect is not payment proof. Print payments do not grant digital download entitlement.

## Idempotency

The internal print order is unique by `purchase_id` and by `internal_order_key`.

Stable provider key:

`birdie-moment-print:<purchaseId>`

Once a `provider_order_id` exists, repeated fulfillment calls return the existing order and do not call `createOrder()` again.

Provider webhook events are unique by `(provider_name, provider_event_id)`.

## Statuses

- `PENDING_SUBMISSION`
- `SUBMITTED`
- `IN_PRODUCTION`
- `SHIPPED`
- `DELIVERED`
- `FULFILLMENT_FAILED`
- `CANCELLED`

A provider create/validation failure produces `FULFILLMENT_FAILED`. It preserves the paid purchase and does not silently issue another order.

## Address handling

Required v1 fields:

- recipient name
- address line 1
- postal code
- city
- ISO-3166 alpha-2 country code

Optional company, line 2 and region are preserved when supplied.

The shipping address is part of the server-side purchase/order record; frontend route parameters are never fulfillment authority.

## Print asset

The provider receives the private A3 master created in Phase 2 (`3508 × 4961`, portrait, 300-DPI target). No browser chrome, CTA or web UI is part of the print asset.

## Failure rules

- unpaid purchase -> no order
- missing/invalid address -> no checkout/order
- missing print asset -> no order
- provider validation/create failure -> `FULFILLMENT_FAILED`
- duplicate fulfillment call after provider order exists -> no second order
- duplicate provider event -> no duplicate state transition
- payment failure -> no print order

The canonical Scorecard round and Birdie Moment remain intact through all print failures.
