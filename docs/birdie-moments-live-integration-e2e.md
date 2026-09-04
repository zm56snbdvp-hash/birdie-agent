# Birdie Moments v1 — Live Integration & E2E QA

## Status

**BLOCKED** until the authoritative BirdieWorld server/runtime functions for `/api/round`, the ChatGPT Site session-to-user resolver, database repository/migrations, Moment route mounting, private Digital asset storage, and the existing real-money payment provider are available and wired.

This branch intentionally does not claim production/live readiness from recovered browser code or contract tests.

## Repository / branch audit

- Repository: `zm56snbdvp-hash/birdie-agent`
- Integration branch: `feature/birdie-moments-live-integration-e2e`
- Digital baseline: `feature/birdie-moments-v1-phase4` at `9a58e361817f7d3e45d2dc6a33ad009114c4ac29`
- Recovered BirdieWorld client checkpoint: `recovery/birdie-score-live-20260904`
- Phase 5/6 Print branches remain separate and are not consumed by this branch.
- `feature/birdie-moments-v1-founder-go` and Phase 4 are divergent; Print/Gelato changes from that branch are deliberately not merged here.

### Recovered real Scorecard boundary

The deployed scorecard bundle persists through `POST /api/round` and reloads through `GET /api/round`.

The recovered POST payload contains only:

```js
{
  id: existingRoundId ?? undefined,
  courseName,
  playedAt,
  holeCount,
  holes
}
```

It does **not** send `userId`, a trusted `status`, or a trusted `completed` flag. The successful server response contains the persisted `round`, and the client reads `round.status` when restoring completed vs draft state.

Therefore Birdie Moments must trigger from the successfully persisted server record after commit. Request JSON and client-side “Runde abschließen” presentation are never completion or ownership authority.

The recovered checkpoint still does **not** contain the authoritative server implementation of `/api/round`, the database ownership layer, D1/ORM source, or deployed migration state.

### Recovered authentication boundary

The recovered deployed BirdieWorld page identifies Birdie Account authentication as ChatGPT Site authentication:

```text
/signin-with-chatgpt?return_to=%2F
```

The UI explicitly states that the user signs in with their ChatGPT access and needs no separate BirdieWorld password.

So the authentication provider is no longer classified as unknown. What remains unavailable is the authoritative server-side function that resolves a ChatGPT Site request/session to BirdieWorld's canonical user id.

### Recovered route boundary

The recovered deployed product route map contains:

- `/deck`
- `/duell`
- `/fortschritt`
- `/karten`
- `/scorecard`
- `/spiel`

No `/moments` route is present in the recovered deployed route map. Moment Reveal/Detail is therefore not currently proven to be mounted in the deployed BirdieWorld client.

See `docs/birdie-moments-live-runtime-evidence.md` for the recovered deployment evidence boundary.

## Integration files added

### `src/moments/live/canonical-round.mjs`

- Maps only server-loaded persisted Scorecard data into the existing Moment round contract.
- Supports required fields: `round_id`, `user_id`, `display_name`, `course_name`, `played_at`, `total_score`, `holes_played`, `birdie_count`.
- Derives totals/birdies only when complete real hole score/par data exists.
- Does not synthesize missing round statistics.

### `src/moments/live/repository-adapter.mjs`

- Adapts real persistence/user callbacks to the existing `getRound`, `listPreviousComparableRounds`, `ensureMoment`, and optional failure-recording contracts.
- Defensively filters PB history to the same user and same 9/18-hole class and excludes the current round.
- Makes no ORM/database framework assumption.

### `src/moments/live/scorecard-save-adapter.mjs`

- Wraps the existing Scorecard save without taking ownership of validation/persistence.
- Calls the existing `afterRoundCommitted` only after Core save resolves with a completed persisted round.
- Never uses request JSON as round/user authority.
- Preserves a successful Scorecard response when the downstream Moments pipeline fails.

### `src/moments/live/session-route-adapter.mjs`

- Binds existing Reveal/Detail/Checkout/Download handlers to a server-resolved authenticated Site user.
- Requires the authoritative runtime to inject `resolveAuthenticatedUserId(request)`.
- Returns `401 AUTH_REQUIRED` before repository access if no authenticated Site user is resolved.
- Never accepts a body/query `userId` as authority.
- Keeps foreign Moment access hidden as `404` through the existing Phase-3 owner policy.

### Tests

- `test/birdie-moments-live-integration.test.mjs`
  - recovered round shape;
  - no synthetic values;
  - source/user filtering;
  - post-commit ordering;
  - no draft trigger;
  - failure isolation;
  - failed Core save prevents Moments.

- `test/birdie-moments-live-auth-routes.test.mjs`
  - logged-out Site request fails closed before repository access;
  - reveal is filtered to the server-resolved Site user;
  - foreign Site user receives 404;
  - checkout ownership/payment metadata comes from the server session, never request body identity;
  - foreign Site user cannot use another owner's paid entitlement and never reaches the asset signer.

- `.github/workflows/birdie-moments-live-integration-tests.yml`
  - Node 22 CI gate scoped to Birdie Moments tests.

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
resolve authenticated ChatGPT Site user
→ validate Scorecard input
→ persist canonical round under authenticated user
→ commit transaction
→ obtain persisted server round
→ if persisted round.status is completed:
     afterRoundCommitted({ roundId })
→ return successful Scorecard response regardless of downstream Moment failure
```

The `momentsRepo` callbacks must read the existing BirdieWorld database and real user source. Moment ownership must come from the persisted round user, never client input.

Reveal/Detail/Checkout/Download must receive `authUserId` only from the real ChatGPT Site session resolver. The new `session-route-adapter.mjs` is the narrow boundary for that binding; the underlying Phase-3/4 owner checks remain unchanged.

The existing real-money provider must implement the Phase-4 provider contract. A browser success redirect is never payment authority; entitlement is granted only from verified server-side provider evidence.

The Digital master must remain private and be exposed only through the existing paid-owner authorization/signed-read-URL path.

## PB semantics preserved

The proven v1 PB logic is intentionally unchanged:

- first comparable round: no PB claim
- worse round: no PB
- tie: no PB
- better same-hole-count round: PB
- 9-hole and 18-hole history: never mixed

A PB round may persist both a normal `ROUND` Moment and a `PERSONAL_BEST` Moment because uniqueness is defined per `(round_id, moment_type, template_version)`. The existing post-round presentation chooses one user-facing hero, with `PERSONAL_BEST` winning when ready. No PB rewrite was introduced during integration.

## Test evidence

- Materialized recovered Moments evidence suite: **77/77 PASS**.
- Original live Scorecard adapter suite: **7/7 PASS** locally.
- Current GitHub Actions branch suite after Site-session route binding: **60/60 PASS** on Node 22.
- The five new Site-session security tests are included in that 60/60 result.

A first auth-route CI attempt produced **59/60 PASS** because the new test incorrectly expected a `momentId` field from the existing Reveal view model. Phase 3 intentionally exposes the target through `primaryAction.href`. The test was corrected to the existing API; product/view-model code was not changed. The next CI run passed **60/60**.

An earlier CI attempt also exposed a pre-existing repository-wide `package.json`/`package-lock.json` mismatch during `npm ci`. The integration workflow was narrowed to dependency-free Birdie Moments tests instead of changing the unrelated lockfile.

These results prove the integration contracts. They do not substitute for executing the missing authoritative Site server/database/payment/storage runtime.

## Mandatory E2E matrix

`UNPROVEN` is intentionally not upgraded to `PASS` merely because a component or contract test passes.

| # | Required case | Status | Evidence / reason |
|---|---|---|---|
| 1 | echte normale Round | UNPROVEN | Real deployed POST contract recovered; authoritative `/api/round` server owner is still unavailable. |
| 2 | echte PB Round | UNPROVEN | PB logic passes; real persisted history repository is not wired. |
| 3 | erste Round | UNPROVEN | No-PB contract passes; real runtime persistence path not executable here. |
| 4 | 9-Loch | UNPROVEN | 9/18 separation passes; real runtime path not executable here. |
| 5 | 18-Loch | UNPROVEN | 18-hole logic passes; real runtime path not executable here. |
| 6 | duplicate trigger | UNPROVEN | Idempotency contract passes; deployed DB uniqueness/retry path not exercised. |
| 7 | page reload | UNPROVEN | Deployed app has no recovered Moments route binding. |
| 8 | Moment render | PASS | Renderer suite proves deterministic render and protected asset separation. |
| 9 | Moment reveal | UNPROVEN | Reveal resolver and Site-user filtering pass, but deployed route map contains no `/moments` binding. |
| 10 | “Später” | UNPROVEN | Existing dismissible view model passes; actual deployed app UX binding is absent/unproven. |
| 11 | Moment erneut finden | UNPROVEN | Deployed `/moments/:id` route is not present in recovered route map. |
| 12 | fremder User | UNPROVEN | Site-session adapter denies foreign ownership in tests; real Site session resolver is not wired. |
| 13 | ausgeloggter User | UNPROVEN | Site-session adapter returns 401 before repo access; real deployed Moment route is not wired. |
| 14 | Checkout | UNPROVEN | Phase-4 checkout and Site-user ownership contracts pass; real payment provider source unavailable. |
| 15 | Payment Success | UNPROVEN | Verified webhook logic passes; real provider verification/webhook not exercised. |
| 16 | Payment Failure | UNPROVEN | Failure contract passes; real provider event path not exercised. |
| 17 | Digital entitlement | UNPROVEN | Grant logic passes after verified payment; real persistence/provider path not exercised. |
| 18 | direkter unbezahlter Assetzugriff | UNPROVEN | Service denies access; real private asset gateway/storage adapter unavailable. |
| 19 | fremder Assetzugriff | UNPROVEN | Site-user and entitlement checks deny foreign access; real storage/session gateway not wired. |
| 20 | Render Failure Isolation | PASS | Renderer fails closed and the post-commit Scorecard adapter preserves successful Core save. |

## Mobile integration

The existing Moments UI logic/prototype has tests, but the recovered deployed route map has no Moment route. Therefore integrated viewport validation at 390×844, 768×1024, and 1440×900 remains **UNPROVEN**. No production-responsive claim is made.

## Print isolation

Print Phase 5/6 remains on separate branches. This integration branch does not import provider/order implementation and does not make Digital depend on Print readiness.

## Real blockers

1. **Authoritative `/api/round` server implementation** is not present in the recovered source. The client contract is known; the server transaction/commit hook is not available to patch.
2. **ChatGPT Site session → canonical BirdieWorld user id resolver** is not recovered. The authentication mechanism itself is now known; only the authoritative server resolver remains missing.
3. **Real BirdieWorld round/Moments database repository and deployed uniqueness migration** cannot be exercised from the recovered client.
4. **Moment routes are not present in the recovered deployed app route map.** Reveal and `/moments/:momentId` still require a real app/server route mount.
5. **Existing real-money payment provider/verifier/webhook implementation** is not recovered and cannot be exercised against real provider evidence.
6. **Real private Digital-master storage/signed-read adapter** is not recovered.
7. Consequently, real-device/mobile and real-provider E2E cannot yet be honestly marked PASS.

## Conflict boundaries

- Print Birdie: no Print provider/order code changed.
- Karten Birdie: no card taxonomy/assets/deck/booster logic changed.
- Gameplay Birdie: no gameplay/power-bar files changed.

## Next integration operation

When the authoritative ChatGPT Site runtime source becomes available, the intended operation is narrow and already specified:

1. bind its existing `/api/round` commit path to `scorecard-save-adapter.mjs`;
2. bind its Site session resolver to `session-route-adapter.mjs`;
3. bind the existing DB callbacks to `repository-adapter.mjs`;
4. mount Reveal/Detail/Checkout/Download in the real app/router;
5. bind the existing payment verifier and private storage signer;
6. execute the 20-case matrix against the real runtime.

Until that runtime source is accessible, status remains **BLOCKED** rather than READY_TO_REVIEW.