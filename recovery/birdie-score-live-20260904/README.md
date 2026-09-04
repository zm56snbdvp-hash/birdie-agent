# Birdie Score / BirdieWorld — Live Recovery 2026-09-04

This branch is a **source-recovery checkpoint**, reconstructed from the deployed BirdieWorld browser bundles because the original Codex/Sites workspace is not accessible without additional credits.

It is isolated from older BirdieWorld implementation branches and **must not be described as the original source tree**.

## Proven deployment identity

- Product title: `BirdieWorld — Golf, Karten & Fortschritt`
- Deployed artifact `deploymentVersion`: `a19bcfc2-99f0-46c4-8fb1-892a368f6e73`
- Recovered catalog source metadata: `Birdieworld-First-Edition-v1.md`, generated `2026-09-01`
- Canonical identities: **96**

## Canonical card taxonomy

- `PLAYER` — 12
- `CLUB` — 18
- `BALL` — 12
- `SPIN` — 24
- `TACTIC` — 24
- `COURSE` — 6

`SPIN`, `TACTIC` and `BALL` are real deployed gameplay families and are retained as-is.

## Proven artwork root cause

The current catalog and deployed 96 JPG fronts are incompatible catalog versions. Production resolves front art only from the physical-number suffix:

`/assets/cards/edition-01/BW-E01-XXX-standard.jpg`

It does not validate card ID, family, name or artwork version. The deployed legacy front-art ranges are:

- 001–048 `COMMUNITY`
- 049–064 `PLACES`
- 065–080 `GEAR`
- 081–092 `MOMENTS`
- 093–096 `SIGNATURE`

Therefore all 18 current `CLUB` cards point to legacy `COMMUNITY` / person artwork.

## Recovery policy

`src/domain/card-artwork.ts` and `src/components/CardArtwork.tsx` fail closed. Front art is shown only when card ID, physical number, family and name all match an explicitly verified manifest entry. Otherwise the UI renders a canonical text/family fallback. A number-derived JPG is never accepted as proof of identity.

## Recovery Phase 2 — maintainable client card layer

Recovered into maintainable React/TypeScript:

- `card-vault/CardVault.tsx` — collection, starter-set claim, booster client flow
- `deck-builder/DeckBuilder.tsx` — deployed player + 24-card deck composition flow
- `game/GameApp.tsx` — player/equipment/action-hand card layer
- `game/card-state.ts` — equipment auto-install + replacement-draw semantics
- `components/CardArtwork.tsx` — shared fail-safe renderer

Known client API contracts are retained for `/api/deck`, `/api/boosters/open`, `/api/starter-set/claim`, `/api/round`, `/api/local-duel` and `/api/local-duel/reward`.

## Recovery Phase 3 — shot engine

`src/features/game/shot-engine.ts` is a pure TypeScript reconstruction of the deployed `game-engine-BHNViZ1-.js` golf simulation core. It preserves:

- the six deployed holes, hazard rules and target-stroke ladder
- `CONTROL`, `STANDARD`, `ATTACK` shot modes
- timing grades and perfect/good windows
- legal/recommended club thresholds
- carry, roll, wind, lie and lateral calculations
- putt break/reach behavior
- Lee-Ann `ONE READ` signature putt
- `CROSSWIND`, `TREE_GATE`, `WATER_CARRY`, `BUNKER_JAWS`, `BREAKING_GREEN`, `FALSE_FRONT` hazard branches
- action eligibility (`teeOnly`, `afterFirstShot`), spin curve and timing-window modifiers

The equivalence suite pins 11 representative outputs generated directly from the deployed production bundle and compares the reconstructed engine against those results. Cases cover all six hazards, putting, signature behavior and active/inactive action modifiers.

Latest local validation: strict TypeScript PASS and **34/34 tests PASS**.

```bash
npm run verify
```

## Evidence boundary

Immutable browser bundle snapshots remain in the external/local recovery archive supplied during this recovery session. The GitHub branch contains recovered contracts, source, production-output fixtures and evidence metadata; it is not claimed to contain the original Codex workspace or every raw production bundle.

Server implementations, auth/session internals, D1/Drizzle schema/migrations, server booster randomization/persistence and exact ChatGPT-Site deployment configuration remain **UNPROVEN**.

## Release state

**BLOCKED** for Production replacement: verified current 96-card artwork and the unrecovered server/runtime source are still missing. The recovered client card layer and shot-engine core are **READY_TO_REVIEW** as isolated recovery code.
