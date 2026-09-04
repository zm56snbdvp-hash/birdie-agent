# Recovery status

## Proven

- 96-card canonical live catalog recovered and internally consistent.
- Deckbuilder uses canonical `family` for CLUB/BALL/SPIN/TACTIC composition.
- Production Collection, Deckbuilder, GameApp and LocalDuel consume the shared unsafe number-only artwork resolver.
- Deployed 96 JPG fronts belong to an incompatible legacy category system.
- All 18 current CLUB cards resolve to legacy COMMUNITY/person-number artwork.
- Deployed six-hole shot engine constants and simulation behavior have been recovered from the browser bundle.

## Reconstructed / safe replacement

- typed canonical catalog + starter deck
- fail-safe artwork resolver and CardArtwork fallback
- CardVault collection + booster client flow
- DeckBuilder client flow + canonical-family validator
- GameApp card-state layer
- pure GameCardState draw/install semantics
- pure TypeScript shot engine
- six-hole course/hazard constants
- deterministic production-equivalence shot fixtures
- client API contract inventory
- explicit canonical-card → shot-engine bridge for all 96 cards
- fail-safe binding states: EXACT / CONDITIONAL_EXACT / PROVISIONAL / DEFERRED / REFERENCE_ONLY

## Validation

- strict TypeScript: PASS
- Node contract/equivalence suite: **44/44 PASS**
- shot equivalence fixtures generated from the deployed engine cover all six hazards, putts, Lee-Ann signature and action filtering/modifiers
- card-engine bridge coverage: `EXACT 24`, `CONDITIONAL_EXACT 20`, `PROVISIONAL 18`, `DEFERRED 28`, `REFERENCE_ONLY 6`

## UNPROVEN / still missing

- original server-side detailed club-type → engine-kind mapping
- original server conversion for PERFECT_WINDOW percentage cards
- advanced card semantics outside generic shot-engine fields (absolute overrides, multipliers, collision/deck-state rules)
- original Next/Vinext page source before bundling
- server API implementations
- authentication/session source
- D1/Drizzle schema and migrations
- server-side booster randomization/persistence implementation
- verified current 96-card artwork set
- exact ChatGPT Site deployment configuration
- full maintainable visual shot-simulator interaction layer (the pure simulation core is recovered)

## Status

`READY_TO_REVIEW` — recovered client card layer + pure shot engine + explicit 96-card engine bridge.

`BLOCKED` — production replacement/release until server/runtime source and verified current artwork are available.
