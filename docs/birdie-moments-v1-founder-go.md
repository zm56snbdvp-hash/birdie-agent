# Birdie Moments v1 — Founder-Go integration note

## Audited integration boundary

The currently recovered BirdieWorld client persists scorecards through `/api/round` and the booster client already uses a server-side API plus an explicit `idempotencyKey`. The live server implementation of `/api/round`, the authentication provider, D1 repository layer, private asset storage and the real-money checkout provider are not present in this repository.

This branch therefore implements the Birdie Moments domain/render/commerce/fulfillment core without inventing a second live infrastructure.

## Required live hook

The real `/api/round` handler must invoke `afterPersistedRoundCommit({ roundId }, deps)` only after the canonical round transaction has committed successfully and the round is complete. `deps.repo` must adapt the existing BirdieWorld database, and `deps.storage` must adapt the existing private asset storage.

Birdie Moments failures are downstream and must never roll back or change a successful scorecard save.

## Implemented contracts

- deterministic 9/18-hole Personal Best detection; first comparable round is not a PB
- idempotent Moment key `(round_id, moment_type, template_version)`
- exactly four v1 template IDs
- canonical render input with omission of absent optional stats
- thumbnail, protected preview, digital master and A3 print master
- separate digital and print layout families
- A3 trim 3508×4961 at 300 DPI plus 3 mm bleed (35 px each edge)
- fixed v1 SKUs/prices in one server-side catalog
- verified-payment purchase finalization; frontend state is never payment authority
- paid/owned digital-master access through a private asset signer
- one print provider abstraction implemented for Gelato
- atomic internal print-order claim plus provider lookup-before-create recovery
- webhook event de-duplication
- minimal analytics allowlist without payment secrets

## Live adapters still required

1. Existing BirdieWorld `/api/round` source and DB repository adapter.
2. Existing auth/session ownership adapter for Moment routes.
3. Existing private asset storage/signed URL adapter.
4. Existing real-money Booster-Shop payment verifier / checkout creation and webhook adapter. No second payment platform should be introduced if the existing provider is suitable.
5. Gelato API key and the exact printable A3 portrait poster `productUid`, validated against the Products API.
6. BirdieWorld UI source for post-round upsell and protected `/moments/:momentId` detail page.

Until these real adapters are connected and exercised against the actual BirdieWorld runtime, status is BLOCKED rather than READY_TO_REVIEW.
