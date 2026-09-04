# Birdie Moments v1 — Live Integration & E2E QA

## Status

**BLOCKED** until the authoritative BirdieWorld runtime sources for `/api/round`, authentication/session ownership, private asset storage, and the existing real-money payment provider are available and wired.

This branch intentionally does not claim production/live readiness from recovered browser code or contract tests.

## Repository / branch audit

- Repository: `zm56snbdvp-hash/birdie-agent`
- Integration branch: `feature/birdie-moments-live-integration-e2e`
- Digital baseline: `feature/birdie-moments-v1-phase4` at `9a58e361817f7d3e45d2dc6a33ad009114c4ac29`
- Recovered BirdieWorld client checkpoint: `recovery/birdie-score-live-20260904`
- Phase 5/6 print branches remain separate and are not consumed by this branch.
- `feature/birdie-moments-v1-founder-go` and Phase 4 are divergent; print/Gelato changes from that branch are deliberately not merged here.

### Recovered real Scorecard boundary

The recovered deployed browser client uses `POST /api/round` for Scorecard persistence and does not send a user ID as round ownership authority. The client-side “Runde abschließen” state is presentation only. Birdie Moments must therefore trigger from the successfully persisted server record after commit, with the persisted completion state as authority.

The recovered checkpoint does **not** contain the authoritative server implementation of `/api/round`, auth/session internals, database repository/schema ownership layer, private asset store, or the existing real-money provider integration. Those are release blockers, not assumptions to fill with mock production code.

## Integration files added

- `src/moments/live/canonical-round.mjs`
  - Maps only server-loaded persisted Scorecard data into the existing Moment round contract.
  - Supports required fields: `round_id`, `user_id`, `display_name`, `course_name`, `played_at`, `total_score`, `holes_played`, `birdie_count`.
  - Derives totals/birdies only when complete real hole score/par data is present.
  - Does not synthesize missing round statistics.

- `src/moments/live/repository-adapter.mjs`
  - Adapts real persistence/user callbacks to the existing `getRound`, `listPreviousComparableRounds`, `ensureMoment`, and optional failure-recording contract.
  - Defensively filters PB history to the same user and same 9/18-hole class and excludes the current round.
  - Makes no ORM/database/auth-framework assumption.

- `src/moments/live/scorecard-save-adapter.mjs`
  - Wraps the existing Scorecard save without taking ownership of validation/persistence.
  - Calls the existing `afterRoundCommitted` only after the core save resolves with a completed persisted round.
  - Never uses request JSON as round/user authority.
  - Preserves a successful Scorecard response when the downstream Moments pipeline fails.

- `test/birdie-moments-live-integration.test.mjs`
  - Contract tests for real recovered round shape, no synthetic data, source/user adapter filtering, post-commit ordering, no draft trigger, failure isolation, and core-save fail-closed behavior.

- `.github/workflows/birdie-moments-live-integration-tests.yml`
  - Node 22 full-suite CI gate for this branch.

## Existing components reused unchanged

- `src/moments/round-completion.mjs`
- `src/moments/evaluate-round.mjs`
- `src/moments/personal-best.mjs`
- `src/moments/rendering/*`
- `src/moments/ui/*`
- `src/moments/commerce/checkout.mjs`
- `src/moments/commerce/payment-webhook.mjs`
- `src/moments/commerce/download.mjs`
- `src/moments/commerce/routes.mjs`
- Phase-4 commerce contracts and purchase/entitlement storage contract

No Print provider/order implementation was added or modified.

## Required authoritative live wiring

The real `/api/round` owner must wire the adapter in this order:

```text
authenticate server session
→ validate Scorecard input
→ persist canonical round under authenticated user
→ commit transaction
→ obtain persisted round/result
→ if persisted status is completed:
     afterRoundCommitted({ roundId })
→ return successful Scorecard response regardless of downstream Moment failure
```

The `momentsRepo` callbacks must read the existing BirdieWorld database and real user source. Moment ownership must come from the persisted round user, never client input.

Moment detail/checkout/download routes must receive `authUserId` from the real authenticated server session. Existing Phase-3/4 owner checks stay unchanged.

The existing real-money provider must implement the Phase-4 provider contract. A browser success redirect is never payment authority; entitlement is granted only from verified server-side payment evidence.

The digital master must remain private and be exposed only through the existing paid-owner authorization/signed-read-URL path.

## PB semantics preserved

The proven v1 PB logic is intentionally unchanged:

- first comparable round: no PB claim
- worse round: no PB
- tie: no PB
- better same-hole-count round: PB
- 9-hole and 18-hole history: never mixed

A PB round can persist both a normal `ROUND` Moment and a `PERSONAL_BEST` Moment because uniqueness is defined per `(round_id, moment_type, template_version)`. The existing post-round presentation chooses exactly one user-facing hero, with `PERSONAL_BEST` winning when ready. This preserves the already-tested domain behavior instead of rewriting PB logic during integration.

## Test evidence

Materialized Phase-4 evidence suite: **77/77 PASS**.

Additional live-adapter contract suite authored for this branch: **7/7 PASS** locally against the same Phase-4 implementation.

These results prove code contracts; they do not substitute for execution against the missing authoritative BirdieWorld server/runtime sources.

## Mandatory E2E matrix

`UNPROVEN` is intentionally not upgraded to `PASS` merely because the isolated service/domain test passes.

| # | Required case | Status | Evidence / reason |
|---|---|---|---|
| 1 | echte normale Round | UNPROVEN | Recovered client POST path known; real `/api/round` server owner unavailable. |
| 2 | echte PB Round | UNPROVEN | PB domain logic passes; actual persisted live history adapter not wired. |
| 3 | erste Round | UNPROVEN | No-PB contract passes; real runtime path not executable. |
| 4 | 9-Loch | UNPROVEN | Canonical 9-hole/PB separation passes; real runtime path not executable. |
| 5 | 18-Loch | UNPROVEN | Canonical 18-hole/PB logic passes; real runtime path not executable. |
| 6 | duplicate trigger | UNPROVEN | Idempotency tests pass in domain/repository doubles; real DB unique constraint/retry path not exercised. |
| 7 | page reload | UNPROVEN | Actual integrated app route/state unavailable. |
| 8 | Moment render | PASS | Current renderer suite proves deterministic render and protected asset separation. |
| 9 | Moment reveal | UNPROVEN | Existing reveal resolver passes in isolation; recovered live app has no proven Moments route binding. |
| 10 | “Später” | UNPROVEN | Requires actual live app UX binding. |
| 11 | Moment erneut finden | UNPROVEN | Requires actual live routing/query integration. |
| 12 | fremder User | UNPROVEN | Owner-denial service tests pass; real auth/session adapter unavailable. |
| 13 | ausgeloggter User | UNPROVEN | Auth-required service tests pass; real session adapter unavailable. |
| 14 | Checkout | UNPROVEN | Phase-4 checkout contract passes; existing real payment provider source unavailable. |
| 15 | Payment Success | UNPROVEN | Verified webhook logic passes; real provider verification/webhook not exercised. |
| 16 | Payment Failure | UNPROVEN | Failure contract passes; real provider event path not exercised. |
| 17 | Digital entitlement | UNPROVEN | Grant logic passes after verified payment; real persistence/provider path not exercised. |
| 18 | direkter unbezahlter Assetzugriff | UNPROVEN | Service denies access; real private asset gateway/storage adapter unavailable. |
| 19 | fremder Assetzugriff | UNPROVEN | Service denies foreign access; real auth/storage adapter unavailable. |
| 20 | Render Failure Isolation | PASS | Renderer failure is fail-closed and Scorecard post-commit adapter preserves successful core save in contract tests. |

## Mobile integration

The existing Moments UI logic/prototype has separate tests, but the authoritative BirdieWorld app source containing the real route tree is not available. Therefore integrated viewport validation at 390×844, 768×1024, and 1440×900 remains **UNPROVEN**. No production-responsive claim is made.

## Print isolation

Print Phase 5/6 remains on separate branches. This integration branch does not import provider/order implementation and does not make Digital depend on Print readiness.

## Real blockers

1. Authoritative implementation/owner of BirdieWorld `POST /api/round` is missing from the recovered repository.
2. Real auth/session source and server user-resolution path are missing.
3. Real round/database repository implementation and deployed Moments uniqueness migration cannot be exercised here.
4. Real BirdieWorld app source/router for post-round reveal and `/moments/:momentId` is not recovered.
5. Existing real-money checkout provider/verifier/webhook implementation is not recovered.
6. Real private asset storage/signed-read adapter is not recovered.
7. Consequently, real-device/mobile and real-provider E2E cannot be honestly marked PASS.

## Conflict boundaries

- Print Birdie: no Print files/provider/order code changed.
- Karten Birdie: no card taxonomy/assets/deck/booster logic changed.
- Gameplay Birdie: no gameplay/power-bar files changed.

If the missing authoritative runtime source is recovered, the intended next operation is to bind its existing `/api/round`, auth, DB, payment, storage, and app-router functions to these adapters and then rerun the 20-case matrix against the real runtime.
