# BirdieWorld Unity Beta

Current **Beta 02 candidate** vertical slice for BirdieWorld. This source is not live, public, or Founder-accepted.

## Product lock

The beta is intentionally small:

1. Cinematic Birdie & Breakfast opener built around the **Birdie Express**.
2. The train travels dramatically down into valleys and back up into the mountains.
3. **Leni** is the recurring travel companion.
4. No bird mascot semantics. “Birdie” means golf / Birdie & Breakfast.
5. No Harry-Potter world, houses, wizard school, spells, or borrowed lore.
6. Character creation is the first durable player-owned object in BirdieWorld.
7. Visual language: near-black / deep forest green / brass-gold / warm interior light / premium rail travel.
8. The first journey reaches a generated 3-D exterior forecourt of The Nest; the interior and the wider world remain outside this Beta 02 slice.

## Beta 02 candidate flow

`Opener -> creator -> ready -> first journey platform -> meet human Leni -> route map -> Birdie Express ride -> The Nest forecourt -> 3-D forecourt`

On a first run, both opener choices enter Character Creation. A successful local or account-backed save reaches the ready confirmation before the player can begin the bounded first journey. A returning player with a valid ready profile may resume from `REISE BEGINNEN`; `BIRDIE ERSTELLEN` always reopens the creator. Leni is a human travel companion. At The Nest forecourt the player can enter a small generated 3-D forecourt and walk to the golden Nest marker. The Nest interior, a wider free-roam world and a second route are not implied.

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

Signed-out drafts use local `PlayerPrefs`. Once the authenticated web shell supplies an in-memory Birdie session, the profile is isolated to that account and synchronizes through the account-scoped endpoint; account-bound state is never reused as another account's local fallback. BirdieOS is authoritative for authenticated accounts.

## Unity

Pinned editor: **Unity 6000.0.76f1 (Unity 6 LTS)**.

Open this folder as a Unity project:

`clients/unity/BirdieWorld`

Then use:

`BirdieWorld -> Open Beta Scene`

or build WebGL directly:

`BirdieWorld -> Build WebGL Beta`

On the Acer/Windows machine, close the Unity Editor and run from PowerShell:

```powershell
.\build-webgl.ps1
```

The script pins Unity `6000.0.76f1`, fails on the wrong project version, verifies the generated WebGL entrypoint and confirms that the in-memory auth bridge is present. It never deploys.

The build is written to:

`clients/unity/BirdieWorld/Builds/WebGL`

The WebGL build intentionally has Unity compression disabled for this candidate so it can be served by a basic static host without custom Brotli/Gzip response headers. We can optimize payload size after the first accepted deployment.

## Art implementation

`BirdieWorldBetaBootstrap` wires the cinematic opener, start menu, character form, authenticated persistence, ready screen, bounded Beta 02 first journey and the generated 3-D Nest forecourt without committing placeholder fantasy lore. Character Creation includes a lightweight human live-preview that reacts to name, story and signature color without adding downloadable art dependencies. `BirdieWorldFirstJourney` and `BirdieWorldThreeDWorld` receive read-only cosmetic snapshots, own only in-memory presentation state and never write character, account or economic data. The approved cinematic train artwork remains the background asset layer; the current 3-D forecourt is built from deterministic Unity primitives so it can later be replaced piece-by-piece by production prefabs.

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
- account-backed save is wired
- human live-preview and selected-choice states react immediately
- portrait layouts stack the journey/creator panels and the WebGL shell respects mobile safe areas
- later: production 3D avatar parts behind the existing preview/profile contract

Target first-journey composition:

- begin on the BirdieWorld platform only after the ready confirmation
- meet human Leni as the player's travel companion
- read the bounded route map before boarding
- ride the Birdie Express through the established green/gold Birdie & Breakfast world
- arrive at The Nest forecourt and stop at the candidate boundary
- enter the generated 3-D Nest forecourt and walk to the gold arrival marker
- keyboard and touch controls plus responsive desktop/iPhone layouts
- session-only journey state: no `PlayerPrefs`, network call, Coin effect or profile mutation

## Private review and later public-beta gate

Beta 02 account sync and release remain separate gates. The source is not externally invite-ready until a current Unity WebGL build passes the complete Beta 02 flow on Acer and iPhone, the authenticated shell injects the session in memory, BirdieOS dispatches the character actions, create → save → reload returns the same server-owned `characterId`, and the exact Founder production confirmation plus fresh project/artifact-bound invite-only receipt are present. The client never accepts or sends a caller-supplied Birdie identity. A green source test or build-only artifact does not make this candidate live, public, or Founder-accepted.
