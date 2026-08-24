# BirdieWorld Character Creation Beta — private-review and release gates

The current private-review candidate, and later first public beta, is intentionally limited to:

1. Cinematic Birdie Express opener.
2. Character creation.
3. Account-bound character persistence.
4. Completion screen confirming that the Birdie is ready.

## Product lock

- Birdie means golf / Birdie & Breakfast; no bird mascot semantics.
- Birdie Express remains the core travel device through the world.
- Leni remains the recurring companion in the travel experience.
- Visual direction: black / deep forest green / brass-gold, warm practical lighting, premium railway interior, dramatic mountain climbs and descents.
- No Harry-Potter-derived names, lore, houses, symbols, creatures, school language, or recognizable franchise design vocabulary.

## Persistence contract

Authenticated clients use:

- `GET /birdie-app/v1/character`
- `POST /birdie-app/v1/character`

The client never supplies `birdieId`, `characterId`, timestamps or schema authority. The server derives `birdieId` and subject from the authenticated Birdie session, owns the durable `characterId`, and forwards only that trusted identity to BirdieOS. The Apps Script wrapper binds that exact request to a read or write scope before profile code can run. Legacy blank IDs are backfilled under lock on first read; malformed or duplicate stored IDs fail closed instead of rotating identity. Character writes contain allowlisted cosmetic/profile state only; coin balances or other economic state are rejected.

## Deployment order

1. Deploy `world-character-profile.gs` into the authoritative BirdieOS Apps Script. After the canonical BirdieOS API-key gate succeeds, pass its verified `source`, `authSubject` and `authBirdieId` request unchanged to `handleBirdieWorldCharacterAuthorizedAction_`; never route directly to `handleBirdieWorldCharacterAction_` or the profile helpers.
2. Deploy the Birdie Agent containing the authenticated character routes.
3. Open `clients/unity/BirdieWorld` in Unity 6 LTS with Web Build Support.
4. Run `BirdieWorld > Build WebGL Beta`.
5. Verify that `birdieworld-build.json` names the intended clean source SHA and record the run ID plus `birdieworld-files.sha256` digest; verify that exact artifact on Acer and iPhone Safari/touch.
6. Verify create → save → reload → the same authenticated server-owned `characterId`.
7. Verify invite-only protection, then use the protected production workflow to release that accepted prior artifact without rebuilding it.

Local `PlayerPrefs` is only for a signed-out draft. Account-bound state is isolated in memory and the server profile is authoritative once authentication is available.
