# BIRDIE 5 — Round 7: Birdie Swing ↔ R2 SAFE compatibility boundary

Stand: 10.09.2026

Status: **INTEGRATION CONTRACT ONLY / NOT APPLIED / NO DEPLOYMENT**

## Purpose

This note defines the smallest safe coexistence between:

- canonical Canyon presentation line: Master Candidate B (`b4181a38e5eac1b1455c180443d4f89df4aad73e94ac3bed3308762f8eea9e1f`),
- BIRDIE 5 recovered-host presentation bridge: R2 SAFE (`c1451dd959d3aea8700341f3f383e7959f6e904280f8d420c5f3bdcb78e22175`),
- BIRDIE 6 `BIRDIE SWING` interaction prototype.

The goal is to prevent the shot-input experiment from acquiring presentation or engine authority.

## Proven recovered-host sequence

Historical recovered flow:

`PLAN preview -> TIMING -> On() -> one engine resolve -> PICK-UP/result normalization -> presentation callback -> existing result/position/stroke/remaining/lie commits`

Important:

- the `PLAN` timing-50 simulation is preview only;
- `On()` remains the only accepted shot-resolution owner;
- R2 SAFE callback is downstream of the resolved/normalized result and upstream of existing React state commits;
- R2 SAFE must never feed data back into the resolver.

## BIRDIE SWING allowed authority

The BIRDIE 6 handoff explicitly maps the continuous gesture to **only `timingMeter`**. That boundary is compatible with the recovered host if preserved exactly.

Allowed:

1. Gesture session measures backswing / transition / downswing / impact characteristics.
2. Mapper deterministically produces one `timingMeter` value.
3. At the one accepted impact commit, that value replaces the old timing-capture value used to build the already-existing ShotInput.
4. The existing `On()`/resolver path runs exactly once.
5. The resolved/normalized result then flows to the unchanged R2 SAFE presentation callback.

Not allowed from the gesture layer:

- `simulateShot()` or any second resolver call,
- direct carry/roll/end-point/lie/penalty/hazard computation,
- direct `aimLateral` or `targetDistance` override,
- tee/cup/course geometry re-registration,
- score/strokes/remaining/lie/card/coin/reward/persistence writes,
- invoking the Canyon presentation callback itself,
- replay causing another gesture commit or engine resolve.

## Recommended maintainable-source shape

Conceptually, the readable host should evolve from:

```ts
const timingValue = existingTimingCapture();
resolveAcceptedShot(timingValue);
```

to:

```ts
const timingValue = swingCommit.mapping.timingMeter;
resolveAcceptedShot(timingValue); // existing owner; exactly once
```

The existing accepted resolver then continues unchanged:

```ts
const result = simulateShot(input);
const normalizedResult = applyExistingPickupNormalization(result);
const visualShot = prepareCourseShot(stableVisualShotId, input, normalizedResult);
setCourseShot(visualShot);
// existing gameplay state commits remain authoritative
```

Names above are conceptual because the readable original Sites source remains unavailable. Do not transplant these sample names into minified output blindly.

## Recovered-bundle proof rule

For a temporary recovered-host proof only, an input adapter may supply the mapped timing value to the already-existing `On()` path, but it must be independently gated from the R2 presentation callback.

A global such as `window.__birdieSwingTimingOverride` is therefore **not part of the BIRDIE-5 bridge contract**. If BIRDIE 6 uses such a global for an isolated experiment, QA must prove:

- it changes only the timing value consumed at accepted impact;
- it cannot modify aim, geometry or result data;
- it is cleared/reset safely between shots;
- it cannot cause `On()` twice;
- keyboard fallback and pointer path converge into the same single timing-value handoff.

## Candidate C status

The currently observed Candidate C must remain outside the BIRDIE-5 promotion lane because it combines interaction experimentation with inherited host geometry re-registration. The latter feeds recovered `Fe(...)` aim conversion and can alter `aimLateral` / `targetDistance`.

Candidate C may be used by BIRDIE 6/7 as an interaction experiment, but it must not replace R2 SAFE as the minimal presentation bridge proof.

## UI / accessibility compatibility requirements

The BIRDIE-3 compatibility preflight found two important integration issues in the current Candidate C interaction surface:

1. keyboard-only users cannot execute the primary swing because the swing pad is not in the natural tab path while legacy shot controls are hidden;
2. on 390/320 px, visible swing chrome occupies roughly half to three-fifths of the course area.

For a mergeable Swing integration:

- provide a keyboard-accessible fallback that feeds the **same existing timing-value -> On() path exactly once**; no second resolver;
- preserve the large touch hitbox while reducing/fading visible chrome so the Canyon remains visually dominant;
- make clear that follow-through after the impact commit is feedback/closure and does not secretly change the resolved result.

## Required regression matrix before combining lanes

A future combined host candidate must prove all of the following on the exact same artifact:

1. one gesture impact -> exactly one `On()` call / engine resolve;
2. release/cancel/reset before impact -> zero resolve;
3. replay -> zero new resolve;
4. keyboard fallback -> same resolver path, exactly once;
5. gesture changes only timing input, never aim/geometry;
6. R2 presentation callback receives the already resolved/normalized result exactly once;
7. putt remains no-flight in presentation;
8. water/reset endpoint stays the accepted engine endpoint;
9. host geometry constants remain baseline unless separately approved as gameplay change;
10. no animation callback writes gameplay, cards, coins, rewards or persistence.

## Promotion order

Keep the lanes separate until both gates are complete:

1. BIRDIE 4 independently signs off Master Candidate B + R2 SAFE presentation boundary.
2. BIRDIE 7 independently playtests the current BIRDIE SWING interaction and BIRDIE 3 UI issues are resolved.
3. Only then build a **new combined candidate** in which Swing supplies timing input and R2 remains downstream presentation only.
4. Re-run full independent QA on that exact combined artifact.

No current Candidate C artifact is promoted by this document.

**Status:** `R2_PRESENTATION_BOUNDARY_LOCKED` / `SWING_INPUT_ONLY_COMPATIBLE_IN_PRINCIPLE` / `CURRENT_CANDIDATE_C_NOT_PROMOTABLE_IN_BIRDIE5_LANE` / `ORIGINAL_SOURCE_UNPROVEN` / `NO_DEPLOYMENT`.
