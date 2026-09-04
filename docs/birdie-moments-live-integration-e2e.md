# Birdie Moments v1 — Live Integration & E2E QA

## STATUS

**BLOCKED**

The Birdie Moments digital core and the recovered-app integration boundary are implemented and green. Production/live E2E remains blocked because the authoritative ChatGPT Sites server/runtime source is not available in the repository, the uploaded recovery archives, the file Library, or a connected Sites workspace in this session.

No production/live claim is made from browser recovery artifacts or contract tests.

## Repository / branch audit

- Repository: `zm56snbdvp-hash/birdie-agent`
- Integration branch: `feature/birdie-moments-live-integration-e2e`
- Digital baseline: `feature/birdie-moments-v1-phase4` at `9a58e361817f7d3e45d2dc6a33ad009114c4ac29`
- Recovered BirdieWorld checkpoint: `recovery/birdie-score-live-20260904`
- Print Phase 5/6 remains separate and is not consumed by this branch.
- `feature/birdie-moments-v1-founder-go` and Phase 4 are divergent; Print/Gelato changes were deliberately not merged.

## Recovered deployed BirdieWorld evidence

The original uploaded `index(4).html` and `index(5).html` resolve to the same recovered deployment:

- deployment version: `a19bcfc2-99f0-46c4-8fb1-892a368f6e73`
- app shell: `index-BiRW1UFt.js`
- host: `birdie-score.wnrkgdmqfc.chatgpt.site`
- scorecard bundle: `golf-scorecard-Dut-vRpH.js`

So the integration audit is not mixing two different deployment snapshots.

### Scorecard persistence contract

The deployed scorecard bundle reloads via:

```text
GET /api/round
```

and saves via:

```text
POST /api/round
```

The recovered browser POST body is:

```js
{
  id: existingRoundId ?? undefined,
  courseName,
  playedAt,
  holeCount,
  holes
}
```

The browser does **not** send a trusted `userId`, `status`, or `completed` authority. The successful server response contains the persisted `round`; the client reads the persisted `round.status` when restoring completed vs draft state.

Therefore the only safe Moments trigger boundary is:

```text
server-authenticated user
→ core Scorecard validation
→ canonical round persistence
→ transaction commit
→ persisted server round
→ persisted status == completed
→ Birdie Moments
```

Request JSON and UI state are never ownership/completion authority.

### Authentication boundary

The recovered deployed Birdie Account UI uses:

```text
/signin-with-chatgpt?return_to=%2F
```

and explicitly states that BirdieWorld uses the user's ChatGPT access and creates the Birdie Account on first login.

The authentication mechanism is therefore identified as the ChatGPT Site sign-in/session boundary. What remains missing is the authoritative **server-side Site session → canonical BirdieWorld user id resolver**.

### Route boundary

The recovered deployed route map contains:

- `/deck`
- `/duell`
- `/fortschritt`
- `/karten`
- `/scorecard`
- `/spiel`

No `/moments` route is present in the recovered deployment map. Moment Reveal/Detail is therefore not proven to be mounted in the currently recovered live app.

### Recovery boundary

The full recovery ZIP and all three embedded recovery ZIPs were recursively inspected. They contain browser assets only: no server/worker API source, no D1/Drizzle schema/migrations, and no source maps that reconstruct the missing Sites server runtime.

Historical recovery documentation also confirms that Sites D1/runtime data is not automatically copied into these source snapshots.

See `docs/birdie-moments-live-runtime-evidence.md` for the runtime evidence note.

## Integration files added

### `src/moments/live/canonical-round.mjs`

Maps persisted real Scorecard data into the existing Moment round contract. It supports the required `round_id`, `user_id`, `display_name`, `course_name`, `played_at`, `total_score`, `holes_played`, and `birdie_count` fields. Derived values are produced only from complete real hole data; no seed/demo replacement values are invented.

### `src/moments/live/repository-adapter.mjs`

Adapts authoritative persistence/user callbacks to the existing Moments repository contract. PB history is defensively restricted to the same user, same 9/18-hole class, completed rounds, and excludes the current round. No ORM/framework assumption was introduced.

### `src/moments/live/scorecard-save-adapter.mjs`

Wraps the real Core save boundary without owning Scorecard validation or persistence. It triggers `afterRoundCommitted` only from the persisted server result after the save resolves, and never rolls back a successful Core save because of a downstream Moments failure.

### `src/moments/live/session-route-adapter.mjs`

Binds existing Reveal/Detail/Checkout/Download handlers to an injected authoritative `resolveAuthenticatedUserId(request)` callback. Logged-out requests fail with 401 before repository access. Body/query `userId` is never accepted as authority. Foreign Moment access remains hidden as 404 through the existing owner policy.

## Existing Birdie Moments components reused unchanged

- `src/moments/round-completion.mjs`
- `src/moments/evaluate-round.mjs`
- `src/moments/personal-best.mjs`
- `src/moments/rendering/*`
- `src/moments/ui/*`
- `src/moments/commerce/checkout.mjs`
- `src/moments/commerce/payment-webhook.mjs`
- `src/moments/commerce/download.mjs`
- `src/moments/commerce/routes.mjs`
- existing Phase-4 purchase/entitlement contracts

No Print provider/order implementation was added or modified.

## PB semantics preserved

The proven v1 rules were not rewritten:

- first comparable round → no PB claim
- worse round → no PB
- tie → no PB
- better same-hole-count round → PB
- 9-hole and 18-hole history → never mixed
- other user's rounds → never compared

A PB round may persist both `ROUND` and `PERSONAL_BEST` records because uniqueness is per `(round_id, moment_type, template_version)`. Existing presentation logic selects one hero and prefers `PERSONAL_BEST` when ready.

## Test evidence

### Recovered/local evidence

- recovered Moments evidence suite: **77/77 PASS**
- original live Scorecard adapter suite: **7/7 PASS** locally

### Current GitHub Actions evidence

Current branch suite on Node 22: **61/61 PASS**.

The 61 tests include:

- canonical recovered Scorecard mapping
- no synthetic statistics
- PB first/worse/tie/better behavior
- 9/18 separation
- other-user PB exclusion
- exactly-one normal ROUND behavior and duplicate idempotency contract
- post-commit ordering
- Core-save failure isolation
- downstream Moments failure isolation
- logged-out Site request rejection before repo access
- foreign Site-user ownership rejection
- Checkout ownership/payment metadata sourced from server session only
- foreign paid-entitlement rejection before asset signing
- **adversarial client completion test:** client supplies foreign `user_id`, `status=completed`, and `completed=true`, but the persisted server round is `draft` → zero Moment trigger
- Reveal ownership and PB preference
- central price injection
- server-side payment verification contracts
- payment amount/metadata mismatch denial
- duplicate payment-event idempotency
- failed payment without entitlement
- unpaid Digital Master denial
- paid-owner short-lived signed URL only
- deterministic render/preview behavior
- Render Failure → Moment FAILED

An earlier repository-wide `npm ci` attempt exposed a pre-existing `package.json`/`package-lock.json` mismatch unrelated to Moments. The Moments CI was scoped to its dependency-free Node tests instead of modifying that unrelated baseline.

## Mandatory E2E matrix

`UNPROVEN` is not PASS.

| # | Required case | Status | Evidence / reason |
|---|---|---|---|
| 1 | echte normale Round | UNPROVEN | Exact deployed client POST contract is recovered; authoritative `/api/round` server owner is unavailable. |
| 2 | echte PB Round | UNPROVEN | PB logic passes; real persisted history DB adapter is not wired. |
| 3 | erste Round | UNPROVEN | No-PB behavior passes; real runtime persistence path unavailable. |
| 4 | 9-Loch | UNPROVEN | 9/18 separation passes; real runtime path unavailable. |
| 5 | 18-Loch | UNPROVEN | 18-hole logic passes; real runtime path unavailable. |
| 6 | duplicate trigger | UNPROVEN | Idempotency contract passes; deployed DB unique constraint/retry path not exercised. |
| 7 | page reload | UNPROVEN | Recovered deployed app has no Moment route binding. |
| 8 | Moment render | PASS | Renderer suite proves deterministic render and protected asset separation. |
| 9 | Moment reveal | UNPROVEN | Reveal resolver/session filtering passes; `/moments` is absent from recovered deployed route map. |
| 10 | „Später“ | UNPROVEN | Dismissible view-model behavior passes; real deployed UX binding is absent/unproven. |
| 11 | Moment erneut finden | UNPROVEN | Deployed `/moments/:id` route is not recovered. |
| 12 | fremder User | UNPROVEN | Route adapter denies foreign user in tests; authoritative Site session resolver is not wired. |
| 13 | ausgeloggter User | UNPROVEN | Route adapter returns 401 before repo access; real deployed Moment route is not mounted. |
| 14 | Checkout | UNPROVEN | Phase-4 + Site-user ownership contracts pass; real payment provider source unavailable. |
| 15 | Payment Success | UNPROVEN | Verified webhook contract passes; real provider verification not exercised. |
| 16 | Payment Failure | UNPROVEN | Failure contract passes; real provider event path not exercised. |
| 17 | Digital entitlement | UNPROVEN | Entitlement contract passes after verified payment; real persistence/provider path not exercised. |
| 18 | direkter unbezahlter Assetzugriff | UNPROVEN | Service denies access; real private storage/gateway unavailable. |
| 19 | fremder Assetzugriff | UNPROVEN | Session/entitlement layers deny foreign access; real storage/session gateway not wired. |
| 20 | Render Failure Isolation | PASS | Render fails closed and successful Core Scorecard save is preserved. |

## Mobile integration

Integrated 390×844, 768×1024 and 1440×900 validation remains **UNPROVEN** because the recovered deployment contains no Moment route to exercise inside the actual app. No production-responsive claim is made.

## Real blockers

1. **Authoritative BirdieWorld `POST /api/round` server implementation/transaction hook** is missing.
2. **ChatGPT Site session → canonical BirdieWorld user resolver** is missing. The auth mechanism itself is known.
3. **Real round/Moments DB repository and deployed Moments uniqueness migration** cannot be exercised.
4. **Moment routes are absent from the recovered deployed app route map** and must be mounted in the authoritative app/router.
5. **Existing real-money payment provider/verifier/webhook implementation** is not recovered.
6. **Real private Digital-master storage/signed-read adapter** is not recovered.
7. Therefore real-device/mobile and provider-backed E2E remain unproven.

## Conflict boundaries

- Print Birdie: no Print provider/order code changed.
- Karten Birdie: no card taxonomy/artwork/deck/booster code changed.
- Gameplay Birdie: no gameplay/power-bar code changed.

## Next operation when Sites runtime source is accessible

1. bind `/api/round` post-commit path to `scorecard-save-adapter.mjs`;
2. bind the Site session resolver to `session-route-adapter.mjs`;
3. bind DB callbacks to `repository-adapter.mjs`;
4. mount Reveal/Detail/Checkout/Download in the real app/router;
5. bind the existing payment verifier and private storage signer;
6. execute all 20 mandatory cases against the authoritative runtime.

Until those runtime functions are accessible, final status remains exactly:

**BLOCKED**
