# BirdieWorld Beta 02 candidate — private-review and release gates

The candidate is intentionally limited to one coherent path:

1. Cinematic Birdie Express opener.
2. Character creation.
3. Account-bound character persistence.
4. Completion screen confirming that the Birdie is ready.
5. First-journey platform and meeting human Leni.
6. Route map and bounded Birdie Express ride.
7. Arrival at The Nest forecourt.

Canonical flow:

`Opener -> creator -> ready -> first journey platform -> meet human Leni -> route map -> Birdie Express ride -> The Nest forecourt`

The candidate stops at the forecourt. It does not unlock The Nest interior, free-roam travel, a second destination or a public audience.

## Product lock

- Birdie means golf / Birdie & Breakfast; no bird mascot semantics.
- Birdie Express remains the core travel device through the world.
- Leni remains the recurring companion in the travel experience.
- Visual direction: black / deep forest green / brass-gold, warm practical lighting, premium railway interior, dramatic mountain climbs and descents.
- No Harry-Potter-derived names, lore, houses, symbols, creatures, school language, or recognizable franchise design vocabulary.

## First-journey runtime boundary

- `BirdieWorldFirstJourney` receives a read-only cosmetic snapshot after the ready screen.
- Display name, story and signature color may personalize presentation; the journey must not mutate the profile.
- Journey progression is session-only and must not use `PlayerPrefs` or a new network endpoint.
- The first journey has no Coin, balance, reward, transaction or redemption effect.
- Keyboard and touch must expose the same bounded stages, and the layout must remain usable on desktop and iPhone portrait.
- Leni is human; neither Birdie nor Leni is represented as a bird mascot.

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
5. Verify that `birdieworld-build.json` names the intended clean source SHA and record the run ID plus `birdieworld-files.sha256` digest.
6. Verify the exact artifact on Acer and iPhone Safari/touch through creator, ready, platform, human Leni, route map, Birdie Express ride and The Nest forecourt.
7. Complete the separate account sync gate: create → save → reload → the same authenticated server-owned `characterId`.
8. Record explicit Founder acceptance for that exact artifact.
9. Verify invite-only protection, then use the protected production workflow to release that accepted prior artifact without rebuilding it.

Local `PlayerPrefs` is only for a signed-out draft. Account-bound state is isolated in memory and the server profile is authoritative once authentication is available.

Passing source tests, Unity compile or a build-only artifact does not consume any release gate. Until the exact device, account sync, invite and Founder gates above pass, Beta 02 is not live, public, or Founder-accepted.
