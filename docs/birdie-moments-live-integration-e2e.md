# Birdie Moments v1 — Live Integration & E2E QA

## STATUS

**BLOCKED**

Birdie Moments Digital v1 follows the Founder Delta baseline:

```text
real BirdieWorld Scorecard
→ persisted completed round
→ Birdie Moment evaluation
→ render / preview
→ reveal
→ private Moment Detail
→ private Collection
→ free private download
```

There is **no Digital payment, paywall, purchase, or entitlement requirement in the Birdie Moments v1 user flow**.

The Digital domain, ownership boundaries, concrete D1 persistence for Birdie Moments-owned data, Collection, and free private download are implemented and green. Production/live E2E remains blocked because the authoritative ChatGPT Sites runtime that owns the real BirdieWorld round/session/router/storage boundaries is still unavailable.

No production/live claim is made from recovered browser artifacts or contract tests.

## Founder Delta — Digital baseline

For Birdie Moments Digital v1:

- price: **free**
- payment required: **no**
- entitlement purchase required: **no**
- authentication required: **yes**
- Moment ownership required: **yes**
- source-round ownership required: **yes**
- Digital master remains private: **yes**
- download exposure: short-lived server-authorized signed URL only

The retained Phase-4 payment/entitlement infrastructure is not deleted. It remains isolated for possible future Birdie products, but Birdie Moments Digital v1 does not call it as its access gate.

## Repository / branch audit

- Repository: `zm56snbdvp-hash/birdie-agent`
- Integration branch: `feature/birdie-moments-live-integration-e2e`
- Digital baseline lineage: `feature/birdie-moments-v1-phase4`
- Recovered BirdieWorld checkpoint: `recovery/birdie-score-live-20260904`
- Separate newer branch reviewed: `feature/birdie-moments-v1-live-integration`
- Print Phase 5/6 remains separate and is not consumed by this branch.

The newer live-integration branch contains useful concrete D1 and Scorecard-wrapper work, but its Digital path still follows the older paid/StoreKit baseline and includes Print concerns. It was **not merged wholesale**. Only free-Digital-safe persistence and ownership ideas were selectively brought into this branch.

## Recovered deployed BirdieWorld evidence

The original uploaded `index(4).html` and `index(5).html` resolve to the same recovered deployment:

- deployment version: `a19bcfc2-99f0-46c4-8fb1-892a368f6e73`
- app shell: `index-BiRW1UFt.js`
- host: `birdie-score.wnrkgdmqfc.chatgpt.site`
- scorecard bundle: `golf-scorecard-Dut-vRpH.js`

### Scorecard persistence contract

The recovered deployed Scorecard reloads via:

```text
GET /api/round
```

and saves via:

```text
POST /api/round
```

The browser POST body is:

```js
{
  id: existingRoundId ?? undefined,
  courseName,
  playedAt,
  holeCount,
  holes
}
```

The browser does **not** send an authoritative `userId`, `status`, or `completed` value. The successful server response contains the persisted `round`; the client reads persisted `round.status` when restoring completed vs draft state.

The safe trigger boundary is therefore:

```text
server-authenticated user
→ Core Scorecard validation
→ canonical round persistence
→ transaction commit
→ persisted server round
→ persisted status == completed
→ persisted round owner == authenticated server user
→ Birdie Moments
```

Request JSON and client UI state are never ownership or completion authority.

Regression coverage proves:

- client-supplied foreign `user_id`, `status=completed`, and `completed=true` cannot trigger Moments when the persisted server round is `draft`;
- a completed persisted round cannot trigger Moments when its persisted owner differs from the authenticated server user;
- Moment failure never converts an already successful Scorecard save into failure.

### Authentication boundary

The recovered deployed Birdie Account UI uses:

```text
/signin-with-chatgpt?return_to=%2F
```

The auth mechanism is identified. What remains unavailable is the authoritative server-side **ChatGPT Site session → canonical BirdieWorld user id resolver**.

### Route boundary

The recovered deployed route map contains:

- `/deck`
- `/duell`
- `/fortschritt`
- `/karten`
- `/scorecard`
- `/spiel`

No `/moments` route is present in the recovered deployment map. Reveal, Detail, Collection, and free Download are therefore not yet proven to be mounted inside the currently recovered live app.

### Recovery boundary

The recovery ZIPs contain browser assets only. They do not reconstruct the authoritative Sites server/worker implementation, deployed BirdieWorld round-table layout, session resolver, or private asset signer.

## Current Digital v1 implementation

### `src/moments/live/canonical-round.mjs`

Maps persisted Scorecard data into the existing Moment round contract. Derived score/birdie statistics are produced only from complete real hole data; missing values are not invented.

### `src/moments/live/scorecard-save-adapter.mjs`

Wraps the Core Scorecard save boundary and now requires all of the following before invoking Moments:

1. Core save resolved successfully;
2. persisted server round exists;
3. persisted server round is completed;
4. persisted round owner exists;
5. authenticated server user exists;
6. persisted round owner equals authenticated server user.

Ownership uncertainty fails closed for Moments while preserving the successful Scorecard result.

### `src/moments/persistence/d1-free-digital-repository.mjs`

Concrete Cloudflare-D1-compatible persistence now exists for the free/private Digital path.

It implements only Birdie Moments-owned persistence:

- `getRound` through injected authoritative `roundSource`
- `listPreviousComparableRounds` through injected authoritative `roundSource`
- `ensureMoment`
- `getMoment`
- `listMomentsForRound`
- `listMomentsForUser`
- Moment status updates
- Preview/Digital asset persistence
- failure recording

It deliberately implements **no** purchase, payment, StoreKit, entitlement, or Print methods.

The `roundSource` remains injected because the recovered browser bundle proves the `/api/round` contract but not the private BirdieWorld round-table schema or real server repository.

### `db/008_free_digital_moment_failures.sql`

Adds a collision-safe failure ledger for the free Digital integration line without altering purchase or Print tables.

The existing `db/001_birdie_moments.sql` remains the canonical Moment table/unique-index surface. The new D1 tests execute those schemas through a SQLite/D1-compatible test harness.

### `src/moments/ui/access.mjs`

Birdie Moments Digital v1 uses `getOwnedMomentForOwnedRound`:

1. authenticated user required;
2. Moment must belong to that user;
3. linked persisted source round must also belong to that user;
4. ownership mismatches are hidden as `404 MOMENT_NOT_FOUND`.

### `src/moments/ui/view-models.mjs`

Moment Detail exposes:

```text
Digitaler Birdie Moment
Kostenlos
paymentRequired = false
entitlementRequired = false
```

The Digital CTA points to the private free download route.

### `src/moments/ui/routes.mjs`

- Reveal verifies source-round ownership.
- Detail verifies Moment + source-round ownership.
- Collection queries Moments by authenticated owner and then verifies every linked source-round owner.
- A cross-linked Moment that points to another user's round is excluded.
- Collection selects one user-facing Moment per round, with `PERSONAL_BEST` winning over `ROUND` when both are ready.

### `src/moments/digital/free-download.mjs`

The active free Digital download path:

- requires authenticated user;
- verifies Moment ownership;
- verifies source-round ownership;
- requires a ready Digital asset;
- performs **no purchase lookup**;
- performs **no entitlement lookup**;
- returns only a short-lived signed private asset URL;
- never exposes the raw private asset reference.

### `src/moments/live/session-route-adapter.mjs`

Binds Reveal, Detail, Collection, and free Download to an injected authoritative `resolveAuthenticatedUserId(request)` callback.

The old Digital checkout adapter remains retained legacy infrastructure only.

## PB semantics preserved

- first comparable round → no PB claim
- worse round → no PB
- tie → no PB
- better same-hole-count round → PB
- 9-hole and 18-hole history → never mixed
- other user's rounds → never compared

A PB round may persist both `ROUND` and `PERSONAL_BEST` internal records because uniqueness remains per `(round_id, moment_type, template_version)`.

For Reveal and Collection, exactly one primary user-facing Moment is selected; `PERSONAL_BEST` wins when ready. A normal non-PB round creates exactly one `ROUND` Moment.

## Physical CTA boundary

Moment Detail may show the prepared physical upsell:

```text
A4 Birdie Moment Print
Zielpreis: 19,90 € inkl. Versand Deutschland
```

Current state remains:

- `economicsStatus = UNPROVEN`
- `availability = PREPARATION`
- `productionClaim = false`
- purchase CTA disabled

Physical economics are **not a blocker for the free Digital v1 flow**.

## Retained legacy commerce

The following infrastructure remains in the repository and remains tested:

- `src/moments/commerce/checkout.mjs`
- `src/moments/commerce/contracts.mjs`
- `src/moments/commerce/payment-webhook.mjs`
- `src/moments/commerce/download.mjs`
- `src/moments/commerce/routes.mjs`
- purchase/payment/entitlement contracts and tests

It is not part of the Birdie Moments Digital v1 Definition of Done.

## Test evidence

### Current GitHub Actions evidence

Current branch suite on Node 22: **77/77 PASS**.

The suite now additionally proves concrete D1 behavior:

- `INSERT OR IGNORE` + unique `(round_id, moment_type, template_version)` idempotency;
- private preview and Digital master refs persist to D1-compatible storage;
- Collection reads real D1 rows and PB wins without a purchase table;
- D1 owner query excludes another user's Moments;
- Moment failures persist independently of purchase/payment infrastructure.

It also proves:

- persisted-server completion authority;
- authenticated server user must equal persisted round owner before trigger;
- client ownership/completion manipulation cannot force a Moment;
- PB first/worse/tie/better behavior and 9/18 separation;
- duplicate trigger idempotency;
- Scorecard failure isolation;
- Reveal/Detail/Collection/Download ownership boundaries;
- logged-out and foreign-user denial;
- manipulated Moment-ID denial;
- free download with zero purchase/entitlement reads;
- private signed URL behavior;
- deterministic rendering and render-failure fail-closed behavior;
- retained Phase-4 commerce still passes its legacy tests.

One intermediate run exposed a bug in the newly added Scorecard ownership helper: it accidentally read `round.id` as an owner identifier. The helper was split into `roundOwnerId()` and `authenticatedUserId()`, and the corrected head passed **77/77**. This was a newly introduced integration bug, not a live-app or D1 failure.

## Mandatory Founder-Delta E2E matrix

`UNPROVEN` means the contract/component is green but the authoritative live Sites runtime has not executed that case.

| # | Required case | Live E2E status | Contract/component evidence |
|---|---|---|---|
| 1 | echte normale Round | UNPROVEN | Recovered POST contract + normal ROUND + concrete Moment D1 persistence PASS; authoritative `/api/round` implementation unavailable. |
| 2 | echte PB Round | UNPROVEN | PB logic + D1 persistence PASS; authoritative real round-history source not wired. |
| 3 | erste Round | UNPROVEN | First-round no-PB behavior PASS; real runtime round source unavailable. |
| 4 | 9-Loch | UNPROVEN | 9/18 separation PASS; real runtime round source unavailable. |
| 5 | 18-Loch | UNPROVEN | Mapping/PB tests PASS; real runtime round source unavailable. |
| 6 | duplicate trigger / retry | UNPROVEN | Domain + concrete D1 unique-key idempotency PASS; deployed D1 migration/runtime not exercised. |
| 7 | korrektes Render | PASS | Deterministic renderer and protected asset generation directly tested. |
| 8 | Reveal | UNPROVEN | Session + Moment + round ownership PASS; live route mount absent. |
| 9 | Moment Detail | UNPROVEN | Free/private Detail PASS; live route absent. |
| 10 | „Später“ | UNPROVEN | Dismissible view model PASS; deployed interaction not mounted/exercised. |
| 11 | private Collection | UNPROVEN | D1-backed Collection + ownership + PB selection PASS; live route absent. |
| 12 | Moment erneut finden / reload | UNPROVEN | D1 Collection read model exists; deployed navigation/reload not exercisable. |
| 13 | kostenloser Owner-Download | UNPROVEN | Free download PASS with zero purchase/entitlement reads; real storage signer unavailable. |
| 14 | fremder User blockiert | UNPROVEN | Foreign access returns 404 in tests; authoritative Site resolver not wired. |
| 15 | manipulierte Moment-ID blockiert | UNPROVEN | Manipulated/unknown id returns 404 before asset access; live route not mounted. |
| 16 | Round-Ownership mismatch blockiert | UNPROVEN | Trigger, Reveal, Detail, Collection, Download checks PASS; live round/session source not wired. |
| 17 | ausgeloggter User blockiert | UNPROVEN | 401 before repo/asset access; live routes not mounted. |
| 18 | private Master Assets | UNPROVEN | Raw ref never returned and stale/not-ready asset blocked; real signer/storage unavailable. |
| 19 | kein Digital Payment / keine Paywall | UNPROVEN | v1 D1/Detail/download path contains no payment/entitlement gate; live UI not mounted. |
| 20 | Moment Failure lässt Scorecard intakt | PASS | Post-commit failure isolation directly tested. |

## New Definition of Done

Birdie Moments Digital v1 is done only when the authoritative app proves:

```text
real authenticated BirdieWorld user
→ real Scorecard
→ real persisted completed round
→ automatic Moment evaluation
→ concrete D1 Moment persistence
→ exactly one user-facing Moment for that round
→ correct render / preview
→ Reveal
→ private Detail
→ private Collection
→ free private Digital download
→ foreign user / manipulated id blocked
→ Scorecard remains intact if Moment processing fails
```

No payment event or entitlement grant belongs inside this Digital v1 Definition of Done.

## Mobile integration

Integrated 390×844, 768×1024, and 1440×900 validation remains **UNPROVEN** because the recovered deployment contains no Moment route to exercise inside the actual app.

## Real Digital v1 blockers — narrowed

1. **Authoritative BirdieWorld `POST /api/round` server implementation / transaction hook** is still unavailable. The client contract and the integration wrapper are known; the actual live owner is not patchable from recovered browser code.
2. **Authoritative BirdieWorld round source** is still unavailable: the real server repository/table shape that powers `getRound` and comparable round history must be bound to the now-concrete D1 Moments repository.
3. **ChatGPT Site session → canonical BirdieWorld user resolver** is still unavailable. The login mechanism itself is known.
4. **Deployment binding is unproven:** `db/001_birdie_moments.sql` plus `db/008_free_digital_moment_failures.sql` and the concrete D1 repository have not been applied/exercised against the actual BirdieWorld Sites D1 binding.
5. **Moment routes are absent from the recovered deployed app route map** and must be mounted: Reveal, Detail, Collection, Download.
6. **Real private Digital-master storage / signed-read adapter** is still unavailable.
7. Therefore real-device/mobile execution of the complete free Digital flow remains unproven.

The following are **no longer code-level blockers**:

- Birdie Moments D1 repository implementation;
- Collection query/persistence model;
- Digital purchase/entitlement logic (not required under Founder Delta);
- server-side persisted-round owner equality contract.

The real-money payment provider is **not a Birdie Moments Digital v1 blocker**.

## Physical blocker, separate from Digital

Before enabling the A4 physical CTA as a real order path, the target economics of **19,90 € incl. Germany shipping** must be proven against the actual provider quote and fulfillment setup. Until then the UI remains preparation-only and makes no production claim.

## Conflict boundaries

- Print Birdie: no Print provider/order implementation changed.
- Karten Birdie: no card taxonomy/artwork/deck/booster code changed.
- Gameplay Birdie: no gameplay/power-bar code changed.
- Legacy Digital Commerce: retained rather than removed; Birdie Moments v1 bypasses it.

## Next operation when authoritative Sites runtime is accessible

1. bind the real `/api/round` post-commit path to `scorecard-save-adapter.mjs`;
2. bind the real BirdieWorld round repository/history source into `d1-free-digital-repository.mjs`;
3. bind the Site session resolver to `session-route-adapter.mjs`;
4. apply/verify the Moment D1 migrations against the actual Sites D1 binding;
5. mount Reveal, Detail, Collection, and free Download routes in the real app/router;
6. bind the real private asset storage signer;
7. execute the Founder-Delta matrix on the authoritative runtime and real devices.

Until those runtime functions are accessible, final status remains exactly:

**BLOCKED**
