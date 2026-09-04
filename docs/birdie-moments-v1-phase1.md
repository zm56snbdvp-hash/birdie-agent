# Birdie Moments v1 — Phase 1

## Scope

This branch implements only the first Birdie Moments vertical slice:

- canonical `birdie_moments` persistence surface
- `round_completed` post-commit integration contract
- idempotent ROUND moment creation
- deterministic Personal Best detection
- fail-closed PB behavior
- failure isolation from the Scorecard save path

Rendering, preview UI, checkout, digital fulfillment, print fulfillment and analytics remain later phases.

## Canonical ordering

```text
Scorecard save transaction
  -> COMMIT successful round
  -> round_completed(round_id)
  -> validate canonical round
  -> ensure ROUND moment
  -> compare previous valid rounds with same holes_played
  -> ensure PERSONAL_BEST only when proven
```

Birdie Moments MUST NOT execute inside a transaction in a way that can roll back the canonical round save.

## Repository contract

`evaluateCompletedRound(roundId, repo)` expects:

- `getRound(roundId)`
- `ensureMoment(input)` with database idempotency on `(round_id, moment_type, template_version)`
- `listPreviousComparableRounds({ userId, holesPlayed, excludeRoundId })`

Optional:

- `recordMomentEvaluationFailure({ roundId, stage, error })`

## Required canonical round shape

The persistence adapter must map the real app round into:

- `id`
- `userId`
- `displayName`
- `courseName`
- `playedAt`
- `totalScore`
- `holesPlayed` (9 or 18)
- `birdieCount`
- `isCompleted: true`

Optional fields are passed into render data only when present and valid.

No value may be invented to make a Moment eligible.

## Personal Best rules

- first comparable round is not marketed as a PB
- 18-hole compares only with 18-hole
- 9-hole compares only with 9-hole
- lower score only; ties are not PB
- another user's rounds are never considered
- missing/unreliable history yields normal ROUND only

## Historical Round Mode relationship

This branch is based on the verified historical `feature/birdie-round-mode-v0` source. Its `endRound()` sets the round to `COMPLETED`; the compatibility helper demonstrates that Moments evaluation occurs only after that core completion step.

That historical sandbox does not contain all production Birdie Moments input fields. It is therefore an ordering/evidence reference, not a substitute for the current App Store app persistence repository.
