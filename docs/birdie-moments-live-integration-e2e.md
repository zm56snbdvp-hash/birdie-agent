# Birdie Moments v1 — Live Integration & E2E QA

## STATUS

**BLOCKED**

Birdie Moments Digital v1 now follows the Founder Delta baseline:

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

The digital core and recovered-app integration contracts are implemented and green. Production/live E2E remains blocked because the authoritative ChatGPT Sites server/runtime source is not available in the repository, recovery archives, file Library, or a connected Sites workspace in this session.

No production/live claim is made from recovered browser artifacts or contract tests.

## Founder Delta — Digital monetization baseline

For normal Birdie Moments Digital v1:

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
- Digital baseline lineage: `feature/birdie-moments-v1-phase4` at `9a58e361817f7d3e45d2dc6a33ad009114c4ac29`
- Recovered BirdieWorld checkpoint: `recovery/birdie-score-live-20260904`
- Print Phase 5/6 remains separate and is not consumed by this branch.
- `feature/birdie-moments-v1-founder-go` and Phase 4 are divergent; Print/Gelato changes were deliberately not merged.

## Recovered deployed BirdieWorld evidence

The original uploaded `index(4).html` and `index(5).html` resolve to the same recovered deployment:

- deployment version: `a19bcfc2-99f0-46c4-8fb1-892a368f6e73`
- app shell: `index-BiRW1UFt.js`
- host: `birdie-score.wnrkgdmqfc.chatgpt.site`
- scorecard bundle: `golf-scorecard-Dut-vRpH.js`

The integration audit therefore is not mixing different deployment snapshots.

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

The safe trigger boundary therefore remains:

```text
server-authenticated user
→ Core Scorecard validation
→ canonical round persistence
→ transaction commit
→ persisted server round
→ persisted status == completed
→ Birdie Moments
```

Request JSON and client UI state are never ownership or completion authority.

An adversarial regression test proves that client-supplied foreign `user_id`, `status=completed`, and `completed=true` cannot trigger Moments when the server-persisted round is still `draft`.

### Authentication boundary

The recovered deployed Birdie Account UI uses:

```text
/signin-with-chatgpt?return_to=%2F
```

and states that BirdieWorld uses the user's ChatGPT access and creates the Birdie Account on first login.

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

The full recovery ZIP and all three embedded recovery ZIPs were recursively inspected. They contain browser assets only: no authoritative Sites server/worker API source, no deployed D1/Drizzle schema/migration source, and no source maps that reconstruct that runtime.

See `docs/birdie-moments-live-runtime-evidence.md` for the recovered runtime evidence boundary.

## Current Digital v1 implementation

### `src/moments/live/canonical-round.mjs`

Maps persisted Scorecard data into the existing Moment round contract. Derived score/birdie statistics are produced only from complete real hole data; missing values are not invented.

### `src/moments/live/repository-adapter.mjs`

Adapts authoritative persistence/user callbacks to the existing Moments domain contract. PB history is restricted to the same user and same 9/18-hole class, excludes the current round, and requires completed comparable rounds.

### `src/moments/live/scorecard-save-adapter.mjs`

Wraps the Core Scorecard save boundary. `afterRoundCommitted` runs only after the Core save returns a completed persisted server round. A downstream Moment failure never converts a successful Scorecard save into failure.

### `src/moments/ui/access.mjs`

Birdie Moments Digital v1 uses `getOwnedMomentForOwnedRound`:

1. authenticated user required;
2. Moment must belong to that user;
3. linked persisted source round must also belong to that user;
4. ownership mismatches are hidden as `404 MOMENT_NOT_FOUND`.

The older Moment-only helper remains because retained Phase-4 commerce code still imports it.

### `src/moments/ui/view-models.mjs`

Moment Detail now exposes:

```text
Digitaler Birdie Moment
Kostenlos
paymentRequired = false
entitlementRequired = false
```

The primary Digital CTA points to the private free download route.

The Collection is a private read model over existing `birdie_moments` rows. No new Collection persistence table is required. Collection selects one user-facing Moment per round, preserving the existing rule that `PERSONAL_BEST` wins over `ROUND` when both records exist and are ready.

### `src/moments/ui/routes.mjs`

- Reveal verifies the persisted source-round owner before returning an upsell.
- Detail verifies both Moment ownership and source-round ownership.
- Collection first filters by Moment owner and then verifies each linked persisted round owner.
- A cross-linked Moment row that claims the current user but points at another user's round is excluded.

### `src/moments/digital/free-download.mjs`

The active Birdie Moments v1 Digital download path:

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

The old `handleLiveDigitalCheckoutRequest` remains explicitly marked as retained legacy Phase-4 commerce. Birdie Moments Digital v1 does not call it.

## Collection persistence choice

The existing `birdie_moments` schema already contains:

- `user_id`
- `round_id`
- Moment type/status
- render data
- preview asset
- Digital asset
- created/updated timestamps
- a user-created index

Therefore v1 Collection is implemented as an ownership-scoped read view over existing Moment rows rather than adding a duplicate Collection table or entitlement record.

## PB semantics preserved

The proven rules remain unchanged:

- first comparable round → no PB claim
- worse round → no PB
- tie → no PB
- better same-hole-count round → PB
- 9-hole and 18-hole history → never mixed
- other user's rounds → never compared

A PB round may persist both `ROUND` and `PERSONAL_BEST` internal records because uniqueness remains per `(round_id, moment_type, template_version)`.

For the user-facing Reveal and Collection, exactly one primary Moment is selected for that round; `PERSONAL_BEST` wins when ready. A normal non-PB round still creates exactly one `ROUND` Moment.

## Physical CTA boundary

Moment Detail may show the prepared physical upsell:

```text
A4 Birdie Moment Print
Zielpreis: 19,90 € inkl. Versand Deutschland
```

Current state is intentionally:

- `economicsStatus = UNPROVEN`
- `availability = PREPARATION`
- `productionClaim = false`
- purchase CTA disabled

No claim is made that the A4 product can currently be produced at 19,90 € delivered. Prodigi/provider economics must be proven separately before enabling a real physical checkout.

Physical economics are **not a blocker for the free Digital v1 flow**.

## Retained legacy commerce

The following infrastructure remains in the repository and remains tested:

- `src/moments/commerce/checkout.mjs`
- `src/moments/commerce/contracts.mjs`
- `src/moments/commerce/payment-webhook.mjs`
- `src/moments/commerce/download.mjs`
- `src/moments/commerce/routes.mjs`
- purchase/payment/entitlement contracts and tests

This infrastructure is retained for future Birdie products or later commercial use. It is no longer part of the Birdie Moments Digital v1 Definition of Done.

## Test evidence

### Previous recovered/local evidence

- recovered Moments evidence suite: **77/77 PASS**
- original live Scorecard adapter suite: **7/7 PASS** locally

### Current Founder-Delta GitHub Actions evidence

Current branch suite on Node 22: **71/71 PASS**.

The current suite proves, at contract/component level:

- recovered Scorecard mapping without synthetic values
- persisted-server completion authority
- client completion/ownership manipulation cannot trigger a persisted draft
- PB first/worse/tie/better behavior
- 9/18-hole separation
- other-user PB exclusion
- normal round exactly one `ROUND` Moment
- duplicate trigger idempotency contract
- Moment failure isolation from successful Scorecard save
- private Reveal with source-round ownership
- PB preferred as the single user-facing hero
- private Detail with Moment + Round ownership
- Digital Detail shows `Kostenlos` and no paywall
- private Collection selects one user-facing Moment per owned round
- cross-linked foreign-round Moment excluded from Collection
- free Digital download performs zero purchase/entitlement lookups
- foreign user blocked
- manipulated/unknown Moment id hidden as 404
- Moment-owner/source-round-owner mismatch blocked
- logged-out Collection/download fail before repo/asset access
- not-ready/failed Moment cannot expose a stale Digital master
- raw private Digital master reference is never returned
- only short-lived signed URL is exposed
- A4 19,90 € target is labeled `UNPROVEN/PREPARATION` with no production claim
- deterministic rendering and render-failure fail-closed behavior
- retained Phase-4 payment/entitlement infrastructure still passes its legacy tests

A previous intermediate CI run produced 69/70 because a Phase-3 test stub had not yet supplied the newly required authoritative `repo.getRound()` callback for Reveal. The stub was corrected and a negative foreign-round Reveal test was added; the current head then passed **71/71**. Product access code was not weakened to satisfy that test.

The known repository-wide `package.json`/`package-lock.json` mismatch remains unrelated. The Moments CI continues to execute the dependency-free Node test surface directly.

## Mandatory Founder-Delta E2E matrix

`UNPROVEN` means the contract is green but the authoritative live Sites runtime has not executed that case. Contract PASS is not promoted to live E2E PASS.

| # | Required case | Live E2E status | Contract/component evidence |
|---|---|---|---|
| 1 | echte normale Round | UNPROVEN | Recovered POST contract + normal ROUND tests PASS; authoritative `/api/round` server hook unavailable. |
| 2 | echte PB Round | UNPROVEN | PB domain tests PASS; real persisted history repository not wired. |
| 3 | erste Round | UNPROVEN | First-round no-PB behavior PASS; real runtime persistence path unavailable. |
| 4 | 9-Loch | UNPROVEN | 9/18 separation PASS; real runtime path unavailable. |
| 5 | 18-Loch | UNPROVEN | 18-hole mapping/PB tests PASS; real runtime path unavailable. |
| 6 | duplicate trigger / retry | UNPROVEN | Domain idempotency PASS; deployed DB unique/retry path not exercised. |
| 7 | korrektes Render | PASS | Deterministic renderer and protected asset generation are directly tested. |
| 8 | Reveal | UNPROVEN | Session + Moment + source-round ownership contract PASS; live `/moments` mount absent. |
| 9 | Moment Detail | UNPROVEN | Free/private Detail contract PASS; live Moment route absent. |
| 10 | „Später“ | UNPROVEN | Dismissible view model PASS; real app interaction not mounted/exercised. |
| 11 | private Collection | UNPROVEN | Collection ownership/PB selection/cross-link rejection PASS; real app route absent. |
| 12 | Moment erneut finden / reload | UNPROVEN | Collection read model exists; actual deployed navigation/reload not exercisable. |
| 13 | kostenloser Owner-Download | UNPROVEN | Free download contract PASS with zero purchase/entitlement reads; real storage signer unavailable. |
| 14 | fremder User blockiert | UNPROVEN | Foreign Moment/round access returns 404 in tests; authoritative Site resolver not wired. |
| 15 | manipulierte Moment-ID blockiert | UNPROVEN | Unknown/manipulated id returns 404 before asset access; live route not mounted. |
| 16 | Round-Ownership mismatch blockiert | UNPROVEN | Reveal, Detail, Collection, and Download ownership checks PASS; live DB/session path not wired. |
| 17 | ausgeloggter User blockiert | UNPROVEN | 401 occurs before repo/asset access; live Moment routes not mounted. |
| 18 | private Master Assets | UNPROVEN | Raw private ref never returned and stale/not-ready assets blocked; real signer/storage unavailable. |
| 19 | kein Digital Payment / keine Paywall | UNPROVEN | v1 Detail/download require no payment, purchase, or entitlement in tests; live UI route not mounted. |
| 20 | Moment Failure lässt Scorecard intakt | PASS | Post-commit failure isolation is directly tested: successful Core save remains successful. |

## New Definition of Done

Birdie Moments Digital v1 is done only when the authoritative app proves this complete path:

```text
real authenticated BirdieWorld user
→ real Scorecard
→ real persisted completed round
→ automatic Moment evaluation
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

Integrated 390×844, 768×1024, and 1440×900 validation remains **UNPROVEN** because the recovered deployment contains no Moment route to exercise inside the actual app. No production-responsive claim is made.

## Real Digital v1 blockers

1. **Authoritative BirdieWorld `POST /api/round` server implementation / transaction hook** is missing.
2. **ChatGPT Site session → canonical BirdieWorld user resolver** is missing. The auth mechanism itself is known.
3. **Real round/Moments DB repository and deployed Moment uniqueness migration** cannot be exercised.
4. **Moment routes are absent from the recovered deployed app route map** and must be mounted in the authoritative app/router: Reveal, Detail, Collection, Download.
5. **Real private Digital-master storage / signed-read adapter** is not recovered.
6. Therefore real-device/mobile execution of the complete free Digital flow remains unproven.

The real-money payment provider is **no longer a Birdie Moments Digital v1 blocker** under the Founder Delta.

## Physical blocker, separate from Digital

Before enabling the A4 physical CTA as a real order path, the target economics of **19,90 € incl. Germany shipping** must be proven against the actual provider/Prodigi quote and fulfillment setup. Until then the UI remains preparation-only and makes no production claim.

## Conflict boundaries

- Print Birdie: no Print provider/order implementation changed.
- Karten Birdie: no card taxonomy/artwork/deck/booster code changed.
- Gameplay Birdie: no gameplay/power-bar code changed.
- Legacy Digital Commerce: retained rather than removed; Birdie Moments v1 simply bypasses it.

## Next operation when Sites runtime source is accessible

1. bind the authoritative `/api/round` post-commit path to `scorecard-save-adapter.mjs`;
2. bind the Site session resolver to `session-route-adapter.mjs`;
3. bind real DB callbacks (`getRound`, Moment queries/ensure) to the existing adapters;
4. mount `/moments`, `/moments/:momentId`, and `/moments/:momentId/download` plus post-round Reveal in the real app/router;
5. bind the real private asset storage signer to the free download route;
6. execute the Founder-Delta matrix against the real runtime and real devices.

Until those runtime functions are accessible, final status remains exactly:

**BLOCKED**
