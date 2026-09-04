# Birdie Moments v1 — Consolidated Integration State

## Status

**BLOCKED** for live READY_TO_REVIEW.

The Birdie Moments v1 domain, rendering, protected UI services, checkout/webhook core, digital entitlement, Gelato print abstraction, analytics and failure handling are implemented and covered by the integration regression suite. The remaining blocker is not Birdie Moments domain logic: the currently recovered BirdieWorld source still does not contain the original live server implementations for `/api/round`, authentication/session, database repository/migrations, private asset storage, or the existing real-money payment provider.

No production deployment, real payment, or real Gelato order was performed by this branch.

## Proven BirdieWorld client seam

Recovered scorecard client contract:

- `GET /api/round`
- `POST /api/round`
- request body: `{ id?, courseName, playedAt, holeCount, holes }`
- the client does not send an authoritative user id

The integration therefore treats user ownership and round completion as server responsibilities. `createRoundSaveWithMoments()` executes the existing round save first, preserves its response unchanged, and invokes Birdie Moments only when the persisted server response contains a round id and `status === "completed"`.

## Canonical runtime

`src/moments/integration/runtime.mjs` composes Birdie Moments without owning parallel infrastructure. The live BirdieWorld server injects its existing:

- authenticated user/session resolver
- round/moment/purchase repository
- private asset storage and signed URL gateway
- real-money payment provider
- print asset signer
- Gelato provider configuration
- JSON/raw-body HTTP helpers

The runtime fails closed if production print wiring does not provide:

- atomic `repo.claimPrintSubmission()` lease
- server-to-server `printProvider.getOrderStatus()` reconciliation
- private `assetUrlSigner.signProviderAsset()`

## Round / Moment rules

- Birdie Moments is downstream of a successfully persisted completed scorecard.
- Moment idempotency: `(round_id, moment_type, template_version)`.
- 9 holes compare only with valid previous 9-hole rounds; 18 only with 18.
- First comparable round is not marketed as Personal Best.
- PB is `current_score < previous_best_score`.
- Improvement is positive strokes better, e.g. 82 -> 78 = 4.
- Unproven PB history falls back to normal Round Moment.
- Missing optional stats are omitted; they are never invented.

## Products / rendering

Exactly four template ids:

- `ROUND_DIGITAL_V1`
- `PERSONAL_BEST_DIGITAL_V1`
- `ROUND_PRINT_V1`
- `PERSONAL_BEST_PRINT_V1`

Exactly four SKUs/prices:

- `BM-ROUND-DIGITAL-V1` — EUR 6.90
- `BM-PB-DIGITAL-V1` — EUR 9.90
- `BM-ROUND-A3-V1` — EUR 34.90
- `BM-PB-A3-V1` — EUR 34.90

Generated assets:

- thumbnail 540x675
- protected preview 1080x1350
- digital master 2160x2700
- separate A3 print master: 3508x4961 trim at 300 DPI plus 3 mm bleed

Long display text wraps instead of ellipsis clipping. Digital and print use separate layout families.

## Protected UX

Server services/routes support:

- post-round Moment offer after completed round
- owner-only Moment detail
- authorized preview URL rather than private storage reference
- Digital and A3 product options from the server catalog
- CTA wording: `Moment ansehen`, `Digitale Edition sichern`, `Premium Print bestellen`

## Payment / digital fulfillment

Checkout is server-authoritative:

- client supplies SKU, never price authority
- amount/currency come from canonical server catalog
- checkout idempotency key is persisted server-side
- payment webhook signature is verified before state mutation
- amount, currency and metadata are verified before payment-event claim
- success redirect alone grants no entitlement
- duplicate webhook is idempotent
- paid digital entitlement is owner-scoped
- master asset is returned only through authorized signed URL gateway

Payment metadata includes:

- `user_id`
- `round_id`
- `moment_id`
- `purchase_id`
- `product_type`
- `fulfillment_type`

## Print exactly-once hardening

One Gelato provider is implemented behind the print provider contract.

Duplicate prevention is layered:

1. unique internal print order per purchase
2. stable idempotency key per purchase
3. atomic short submission lease to prevent concurrent workers crossing the provider-create boundary
4. Gelato search-by-internal `orderReferenceId` before create to recover a prior accepted provider order
5. unique provider order reference when attached
6. webhook event de-duplication
7. provider webhook is signal only; server-to-server Gelato status is reconciled and checked against the internal order reference before state transition

A provider create failure leaves payment paid and marks fulfillment failed. A safe retry reuses the same internal print-order claim.

## Analytics

Allowlisted events:

- `moment_generated`
- `moment_preview_viewed`
- `moment_offer_closed`
- `digital_purchase_started`
- `digital_purchase_completed`
- `print_purchase_started`
- `print_purchase_completed`
- `moment_generation_failed`
- `fulfillment_failed`

Payment references, signatures, shipping addresses and other payment secrets are excluded by the analytics sanitizer.

## Test evidence

GitHub Actions integration run for commit `8da5c1c42b3701cdcb937df5005971889b5128d1`:

- tests: **153**
- pass: **153**
- fail: **0**
- skipped: **0**

The run includes Birdie Moments integration/security/idempotency/render/print hardening plus the full existing repository regression suite.

Notable covered cases include:

- completed Scorecard response preserved unchanged
- Moments failure cannot fail the Scorecard save
- first round no PB
- 9/18 history separation
- duplicate `round_completed`
- protected preview/master access
- long layout data / missing optional stats / 3-digit score
- invalid payment signature / amount mismatch
- redirect without webhook grants nothing
- duplicate payment webhook
- exactly one print order after verified payment
- provider failure + safe retry
- concurrent print worker denied lease => zero provider create calls
- forged webhook status overridden by authenticated provider status
- provider/internal order mismatch fails closed

## Remaining live blockers

To turn this branch from BLOCKED to READY_TO_REVIEW, the actual BirdieWorld live server source/adapters must be available and wired:

1. real `/api/round` persistence implementation and repository mapping
2. real auth/session implementation used by the deployed BirdieWorld app
3. real DB/D1/Drizzle schema and migration execution path
4. existing real-money Booster Shop payment provider implementation / webhook verification
5. real private asset storage and signed URL implementation
6. Gelato API key and exact validated printable A3 portrait `productUid`
7. live deployment integration followed by a non-destructive E2E proof; no fabricated production claim

Until those adapters are available and exercised against the real deployed runtime, status remains **BLOCKED**.
