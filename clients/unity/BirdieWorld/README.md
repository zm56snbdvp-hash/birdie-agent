# BirdieWorld Unity Beta

First public vertical slice for BirdieWorld.

## Product lock

The beta is intentionally small:

1. Cinematic Birdie & Breakfast opener built around the **Birdie Express**.
2. The train travels dramatically down into valleys and back up into the mountains.
3. **Leni** is the recurring travel companion.
4. No bird mascot semantics. “Birdie” means golf / Birdie & Breakfast.
5. No Harry-Potter world, houses, wizard school, spells, or borrowed lore.
6. Character creation is the first durable player-owned object in BirdieWorld.
7. Visual language: near-black / deep forest green / brass-gold / warm interior light / premium rail travel.
8. Future destinations include Coin Shop and The Nest; the beta does not need those spaces playable yet.

## Beta 01 flow

`Opener -> Reise beginnen / Birdie erstellen -> Character Creation -> Save -> Ready`

Character profile schema: `birdieworld-character/v1`.

Current fields:

- characterId
- displayName
- story (`explorer`, `strategist`, `connoisseur`)
- style
- hair
- face
- outfit
- accessories
- color
- createdAt / updatedAt

The current scaffold persists locally with Unity `PlayerPrefs`, which maps to browser-local persistence in Web builds. Server-authoritative persistence is the next gate before a broad public beta.

## Unity

Pinned editor: **Unity 6000.0.76f1 (Unity 6 LTS)**.

Open this folder as a Unity project:

`clients/unity/BirdieWorld`

Then use:

`BirdieWorld -> Open Beta Scene`

or build WebGL directly:

`BirdieWorld -> Build WebGL Beta`

The build is written to:

`clients/unity/BirdieWorld/Builds/WebGL`

The WebGL build intentionally has Unity compression disabled for Beta 01 so it can be served by a basic static host without custom Brotli/Gzip response headers. We can optimize payload size after the first deployment.

## Art implementation

`BirdieWorldBetaBootstrap` currently establishes the exact layout/state flow without committing placeholder fantasy lore. The approved cinematic train artwork should be imported as the background/preview asset layer, followed by a proper 3D human avatar prefab.

Target opener composition:

- Birdie Express in alpine terrain with extreme vertical railway movement
- dark green lacquer, black and brass/gold railcar
- warm cabin light
- Leni visibly travelling with the player
- Birdie & Breakfast wordmark / B mark
- `REISE BEGINNEN`, `BIRDIE ERSTELLEN`, `ANMELDEN`

Target creation composition:

- character shown inside the Birdie Express
- three-step progress: Charakter / Anpassen / Bestätigen
- name, story, look, color
- later: real-time avatar parts and account-backed save

## Public beta deployment gate

Before calling this a durable public beta, replace browser-only persistence with the authenticated BirdieWorld character endpoint so a player keeps the same Birdie across browsers/devices. The existing BirdieWorld backend already scopes users by authenticated `birdieId`; the character endpoint should inherit that identity rather than accept a client-supplied Birdie ID.
