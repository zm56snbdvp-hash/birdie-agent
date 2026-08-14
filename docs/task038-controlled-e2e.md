# TASK-038 Controlled E2E Readiness

## Current source state

The reviewed base is `feature/community-identity-resolver` at
`338bd58beeb220e9da52018c94146c8382f84bb4` (tree
`e1cdbf42aa6cca6fbbf3cca85a6e0a4966772350`). The TASK-038 successor adds
the dedicated `IG_COMMENT` action, event-derived claim creation, exact
identity binding, and the Social-owning ledger-before-`WRITTEN` transition.
The release reports Birdie Agent `2.8.0`. None of these successor changes is
live until both provider deployments are attested.

No live profile, claim, ledger, work-item or social-event row may be mutated
until the authoritative Apps Script and Birdie Agent deployments are current
and the person-bound E2E scope is separately authorized.

At source-review time, `SOCIAL_COIN_EVENTS` contains pending `IG_COMMENT`
events but `COMMUNITY WORK QUEUE` contains no matching `IG_COMMENT` work
item. A producer-attested exact event/work-item pair therefore remains a hard
runtime prerequisite; this release does not synthesize one.

## Identity contract

- A unique normalized handle on exactly one ACTIVE canonical `BIRDIE_PROFILES`
  row is an explicit profile identity link: confidence 100,
  `AUTO_EXACT_LINK`, `IDENTITY_RESOLVED`.
- BirdieOS re-reads the canonical work item and ACTIVE profiles before accepting
  that resolver write.
- Duplicate ACTIVE handle links are terminal conflicts and cannot be overridden
  by otherwise high provider evidence.
- A raw caller/provider username match remains 60-point evidence and cannot
  auto-resolve a different work-item handle.
- If provider evidence is supplied, it must pass the existing signature and
  work-item binding checks. Contradictory signed evidence fails closed; the
  canonical exact path does not require evidence.
- Display name, email similarity, name fragments and fuzzy matching are never
  ownership proof.

## Owning-module and economy contract

The controlled Coin portion must stop unless the Coin Action Catalog contains a
current approved `IG_COMMENT` action for the exact social event. An
Instagram-comment event cannot borrow the tagged-media rule or a value stored
only on `SOCIAL_COIN_EVENTS`.

`birdie-os/social-coin-events.gs` owns two narrow transitions:
`IDENTITY_PENDING -> IDENTITY_RESOLVED` only after an exact resolved work
item, and `NOT_WRITTEN -> WRITTEN` only after one exact approved claim and one
unique matching ledger transaction. Community Identity and the Coin/Profile
linker never write those event fields.

Generic `POST /coin/claims` rejects `IG_COMMENT`. The dedicated route
derives action code, source type, comment source reference, one-Coin amount and
idempotency from the canonical event. The caller cannot supply or override
those economic fields.

Aggregated follower and like deltas have no actor identity and are observation
only. They cannot create person-bound claims or Coins.

## Deployment preconditions

Before any live E2E:

1. Re-read the authoritative Apps Script project and dispatcher.
2. Deploy the reviewed `coin-system.gs`, `community-identity.gs`, and
   `social-coin-events.gs` through the existing project and update the
   existing web-app deployment without changing its canonical URL.
3. Verify `coinLinkInstagramHandle` through the authenticated dispatcher.
4. Re-read and preserve the complete Cloud Run configuration, service account,
   IAM, traffic, scaling, resource limits, environment values and Secret
   Manager references.
5. Explicitly preserve the authoritative `BIRDIE_OS_BASE`; never rely on a
   source fallback URL.
6. Deploy the reviewed release commit and run authenticated read-only health
   checks before authorizing the E2E scope.
7. Keep the canonical `COIN ACTION CATALOG` `IG_COMMENT` row `DRAFT`
   throughout both provider deployments. Only after both readbacks pass may
   the already approved implementation gate activate that exact row. The Apps
   Script source deliberately fails every economic step while the row is not
   exactly `ACTIVE`.

## Guarded inputs

The manual run may accept only:

- exact `birdieId`
- exact owner-confirmed Instagram handle with auditable provenance
- exact canonical work-item and social-event identifiers
- an exact confirmation string

Action code, source type, source reference and Coin amount must come from
canonical data and an approved catalog rule. The caller cannot supply an
amount, candidate, confidence score or matched Birdie ID.

## Guarded execution sequence

1. Read the exact profile, work item, social event, action rule and ledger.
2. Require the profile to be ACTIVE with a blank or identical normalized
   handle.
3. Require the work item and event to be Instagram, identity-pending, unmatched
   and not written, with the exact confirmed normalized handle.
4. Record preflight transaction IDs and authoritative balances.
5. Call `POST /coin/profiles/{birdieId}/instagram` with a deterministic key.
6. Read the profile back and verify Birdie ID, ACTIVE status and exact handle.
7. Re-read the ledger and prove the link created zero transactions and zero
   balance change.
8. Resolve the exact canonical work item without caller-authored evidence.
9. Re-read it and require the exact target Birdie ID, confidence 100 and
   `AUTO_EXACT_LINK` before continuing.
10. Stop unless the exact event has a current approved Coin action rule and a
    governed owner-module transition.
11. Bind the event through
    `POST /coin/social-events/{eventId}/instagram-comment/identity`, then
    create one canonical pending claim through
    `POST /coin/social-events/{eventId}/instagram-comment/claim`. Approve it
    manually through the existing claim-decision route with the exact
    `APPROVE_IG_COMMENT_CLAIM` confirmation. The event derives the claim
    action, source, amount and idempotency.
12. Re-read the ledger and require exactly one APPROVED EARN transaction with
    the expected Birdie ID, action, source reference, amount and claim key.
13. Only after ledger proof, mark the exact social event `WRITTEN` through
    `POST /coin/social-events/{eventId}/instagram-comment/written`.
14. Run the same sequence again. Require an idempotent profile result, an
    ineligible/no-write resolver result, the same claim, zero new transactions,
    zero balance delta and no duplicate Coin.

## Fail-closed rules

Stop if any profile, event, action rule, candidate, claim, transaction, amount,
source reference, status or readback differs from the declared contract. Never
create a profile from a social event, write `matchedBirdieId` directly, bypass a
missing action rule, or turn aggregate observations into person-bound Coins.
