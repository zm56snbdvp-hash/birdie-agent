# Recovery status

## Proven

- 96-card canonical live catalog recovered and internally consistent.
- Deckbuilder uses canonical `family` for CLUB/BALL/SPIN/TACTIC composition.
- Production Collection, Deckbuilder, GameApp and LocalDuel consume the shared unsafe number-only artwork resolver.
- Deployed 96 JPG fronts belong to an incompatible legacy category system.
- All 18 current CLUB cards resolve to legacy COMMUNITY/person-number artwork.
- Deployed six-hole shot-engine constants and simulation behavior recovered from the browser bundle.

## Reconstructed / safe replacement

- typed canonical catalog + starter deck
- fail-safe artwork resolver and CardArtwork fallback
- CardVault collection + booster client flow
- DeckBuilder client flow + canonical-family validator
- GameApp card-state layer
- pure GameCardState draw/install semantics
- pure TypeScript shot engine
- six-hole course/hazard constants
- deterministic production-output shot fixtures
- client API contract inventory

## Validation

- strict TypeScript: PASS
- local Node contract/equivalence suite: **34/34 PASS**
- shot equivalence covers all six hazards, putts, Lee-Ann signature and action filtering/modifiers

## UNPROVEN / still missing

- original Next/Vinext page source before bundling
- server API implementations
- authentication/session source
- D1/Drizzle schema and migrations
- server-side booster randomization/persistence implementation
- verified current 96-card artwork set
- exact ChatGPT Site deployment configuration
- full maintainable visual shot-simulator interaction layer (pure simulation core recovered)

## Status

`READY_TO_REVIEW` — recovered client card layer + pure shot engine.

`BLOCKED` — production replacement/release until server/runtime source and verified current artwork are available.
