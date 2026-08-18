# BirdieWorld Character Creation Beta — release gates

The first public beta is intentionally limited to:

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

The public client never supplies `birdieId`. The server derives it from the authenticated Birdie session and forwards only that trusted identity to BirdieOS. Character data contains cosmetic/profile state only; coin balances or other economic state are never accepted from the client.

## Deployment order

1. Deploy `world-character-profile.gs` into the authoritative BirdieOS Apps Script and route `worldGetCharacter` / `worldSaveCharacter` through `handleBirdieWorldCharacterAuthorizedAction_` after the canonical BirdieOS API-key gate.
2. Deploy the Birdie Agent containing the authenticated character routes.
3. Open `clients/unity/BirdieWorld` in Unity 6 LTS with Web Build Support.
4. Run `BirdieWorld > Build WebGL Beta`.
5. Publish `Builds/WebGL` to the beta web host.
6. Verify create → save → reload → same authenticated character.

Local `PlayerPrefs` remains an offline/fallback convenience only. The server profile is authoritative once authentication is available.
