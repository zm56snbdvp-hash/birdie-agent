# Recovery status

## Proven

- 96-card canonical live catalog recovered.
- Canonical family typing is internally consistent.
- Deckbuilder uses `family` for CLUB/BALL/SPIN/TACTIC composition checks.
- Collection, Deckbuilder, GameApp and LocalDuel all consume the shared deployed artwork component.
- Artwork component resolves by physical-number suffix only.
- 96 deployed JPGs belong to an incompatible legacy category system.
- All 18 CLUB cards resolve to legacy COMMUNITY/person-number artwork.

## Reconstructed / safe replacement

- typed canonical catalog source
- starter-deck source
- client API contract inventory
- fail-safe artwork resolver contract
- deterministic Node test suite
- deployed bundle identity + SHA-256 manifest

## UNPROVEN / still missing

- original Next/Vinext page source files and component names before bundling
- server API implementations
- authentication/session source
- D1/Drizzle schema and migrations
- server-side booster randomization and persistence implementation
- verified current 96-card artwork set
- exact deployment configuration required to reproduce the ChatGPT Site

## Status

`BLOCKED` for a production replacement. `READY_TO_REVIEW` for the recovered card-domain checkpoint itself.
