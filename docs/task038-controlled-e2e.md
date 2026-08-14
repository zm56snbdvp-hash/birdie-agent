# TASK-038 Controlled E2E Readiness

## Current source state

PR #26 merged the existing-profile Instagram link into
`feature/community-identity-resolver` at
`9bca05c8f958612d381c39f1c14c9579ba53d054`. Draft PR #27 hardens the Apps
Script profile write and its executable contract tests. The TASK-038 release
candidate must include that hardening plus the canonical exact-link resolver
successor; neither change is deployed by this runbook.

No live profile, claim, ledger, work-item or social-event row may be mutated
until the authoritative Apps Script and Birdie Agent deployments are current
and the person-bound E2E scope is separately authorized.

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

## Remaining owning-module and economy gates

The controlled Coin portion must stop unless the Coin Action Catalog contains a
current approved action for the exact social event. In particular, an
Instagram-comment event must not borrow the tagged-media rule or a value stored
only on `SOCIAL_COIN_EVENTS`.

The repository also needs an existing governed Community/Social action that
marks the exact social-event row `WRITTEN` after ledger verification. That
transition does not belong in Community Identity or the Coin/Profile linker.

Aggregated follower and like deltas have no actor identity and are observation
only. They cannot create person-bound claims or Coins.

## Deployment preconditions

Before any live E2E:

1. Re-read the authoritative Apps Script project and dispatcher.
2. Deploy the reviewed `coin-system.gs` through the existing project and update
   the existing web-app deployment without changing its canonical URL.
3. Verify `coinLinkInstagramHandle` through the authenticated dispatcher.
4. Re-read and preserve the complete Cloud Run configuration, service account,
   IAM, traffic, scaling, resource limits, environment values and Secret
   Manager references.
5. Explicitly preserve the authoritative `BIRDIE_OS_BASE`; never rely on a
   source fallback URL.
6. Deploy the reviewed release commit and run authenticated read-only health
   checks before authorizing the E2E scope.

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
11. Create one canonical claim with an event-derived idempotency key and approve
    it only according to that rule.
12. Re-read the ledger and require exactly one APPROVED EARN transaction with
    the expected Birdie ID, action, source reference, amount and claim key.
13. Only after ledger proof, mark the exact social event `WRITTEN` through its
    owning module.
14. Run the same sequence again. Require an idempotent profile result, an
    ineligible/no-write resolver result, the same claim, zero new transactions,
    zero balance delta and no duplicate Coin.

## Fail-closed rules

Stop if any profile, event, action rule, candidate, claim, transaction, amount,
source reference, status or readback differs from the declared contract. Never
create a profile from a social event, write `matchedBirdieId` directly, bypass a
missing action rule, or turn aggregate observations into person-bound Coins.
