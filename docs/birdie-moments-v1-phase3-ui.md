# Birdie Moments v1 — Phase 3 UI

## Scope

Phase 3 defines the protected UI contract between a completed round and the future App Store BirdieWorld frontend.

Included:

- post-round `Your Birdie Moment` upsell view model
- deterministic selection of the best ready Moment for a round
- protected `/moments/:momentId` detail route contract
- owner-only Moment access
- digital and Premium A3 product presentation
- configurable pricing input
- no-store/private response semantics

Not included:

- checkout execution
- payment verification
- paid asset entitlement
- print provider ordering
- public sharing

## Post-round behavior

The Scorecard remains authoritative. After the round has committed and Birdie Moments has reached `PREVIEW_READY`, the app may request the upsell view model.

If both a normal `ROUND` Moment and a proven `PERSONAL_BEST` Moment are ready, the PB Moment is preferred for the immediate upsell. The normal Round Moment remains stored and accessible.

If no preview is ready, the upsell is omitted rather than showing fake or pending artwork.

Copy contract:

- title: `Dein Birdie Moment ist fertig.`
- primary: `Moment ansehen`
- secondary: `Später`
- dismissible: true

There is no forced purchase path and no dark pattern.

## Protected Moment detail

Canonical route:

`/moments/:momentId`

Server-side rules:

1. authenticated user required
2. load Moment server-side
3. compare Moment `userId` with authenticated user ID
4. owner mismatch returns 404 to avoid identifier disclosure
5. successful response uses `Cache-Control: private, no-store`

Frontend route parameters are never ownership authority.

## Detail view model

The view model includes only source-backed Moment data:

- preview asset
- course
- played date
- total score
- holes played
- birdies
- optional score vs par
- proven PB comparison data when applicable

Product offers:

- Digital Edition
- Premium A3 Print

Prices are injected through configuration. The UI module does not hard-code the v1 example prices.

## Current integration boundary

The historical `birdie-agent` Round Mode baseline is an ordering/reference source, not the current App Store frontend repository. Phase 3 therefore implements framework-neutral route/view-model contracts and a standalone UX prototype without pretending to have modified the current production frontend.

When the current App Store frontend source is available, the adapter work is intentionally small:

- map auth session -> `authUserId`
- map persisted Moments repository -> `getMoment()` / `listMomentsForRound()`
- bind Scorecard completion screen to `getPostRoundUpsell()`
- bind `/moments/:momentId` route to `handleMomentDetailRequest()`
- render the returned view models with native/current BirdieWorld components
