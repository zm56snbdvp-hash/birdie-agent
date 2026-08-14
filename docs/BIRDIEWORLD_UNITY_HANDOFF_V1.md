# BirdieWorld — Unity Handoff V1

Status: **implementation-ready blockout contract on top of Immersive Estate V0.3.5**

## Outcome

The current Three.js estate and the future Unity client now have one shared,
engine-neutral description of the world:

`client/birdie-app-v1/src/contracts/birdieworld-estate-handoff-v1.json`

The running web scene already consumes this manifest. Unity must import the same
file rather than reproducing coordinates, colors or collision values by hand.

This handoff covers presentation only. It adds no quest, progression,
multiplayer, persistence, location tracking, business-state authority or new
product destination.

## Coordinate contract

BirdieWorld canonical coordinates are right-handed, use meters and keep Y up.
The arrival court sits at positive Z; walking from arrival to the hotel moves
toward negative Z.

Unity is left-handed and also uses Y up. Import positions and yaw as follows:

| Value | Three.js | Unity |
| --- | --- | --- |
| Position | `(x, y, z)` | `(x, y, -z)` |
| Yaw degrees | `yaw` | `-yaw` |
| Scale | meters | meters |

Example: the canonical spawn `(0, 0.08, 46)` becomes the Unity position
`(0, 0.08, -46)`. The hotel anchor `(0, 0, -22)` becomes `(0, 0, 22)`.

Do the conversion once at the importer boundary. Game logic and saved stable IDs
must never contain prefab instance IDs, `GameObject` references or Unity scene
paths.

## What is locked in the manifest

- world bounds and one-meter scale;
- player spawn, movement bounds and presentation speed;
- desktop and compact third-person camera values;
- the six ordered district resolver rules;
- seven landmark anchors;
- three session-only interaction anchors and radii;
- hotel, stable and pond collision primitives;
- the complete V0.3.5 golden-estate palette and light rig;
- 56 tree instance transforms;
- the same three bounded product destinations;
- explicit disabled flags for quests, progression and multiplayer.

## Unity implementation order

### 1. Import and validate

Create a `BirdieWorldEstateManifest` DTO and deserialize the JSON from a
`TextAsset` or build-time addressable. Reject the import unless
`contractVersion == "birdieworld-estate-handoff-v1"` and
`sourcePresentationContract == "birdieworld-immersive-estate-v0.3.5"`.

Apply the Z/yaw adapter while constructing Unity values. Keep the unmodified
manifest available for diagnostics.

### 2. Build the greybox

Create one additive scene named `BirdieEstate_Blockout`. Build the ground,
landmark anchors and the three collision areas from the manifest. Use stable IDs
as component data, not Unity object names as domain identifiers.

Acceptance: the player spawns in the arrival court, faces the estate and can
walk to the hotel, putting green and stables without entering the two buildings
or pond.

### 3. Match movement and camera

Implement the third-person follow camera from the desktop/compact values. Keep
movement client-local and session-only. Match the current camera collision
sample step before tuning feel.

Acceptance: comparison captures from spawn, hotel approach, putting green and
stable approach preserve the same composition and route proportions.

### 4. Match materials and light

Create one Unity material palette from the manifest's sRGB hex values. Start
with URP and ACES tonemapping, then reproduce hemisphere light with an
environment/ambient setup plus the sun and cool fill specified in the manifest.

Acceptance: forest depth, fairway readability, warm architecture, restrained
water and gold accents retain the V0.3.5 hierarchy in daylight and on phone
screens.

### 5. Add bounded interactions

Create trigger volumes from `interactionAnchors` and resolve content by stable
interaction ID through the existing estate contract. Triggers remain scripted
and session-only. They may suggest one of the three product destinations but
cannot write canonical state.

Acceptance: `hotel-reception`, `greenkeeper` and `stable-guide` fire at matching
distances and never create persistence or network traffic.

## Definition of ready for the first Unity spike

The spike is ready to begin when:

1. this JSON imports without manual coordinate edits;
2. the automated repository tests confirm ID and WebGL parity;
3. Unity project choices are made for Unity LTS version, URP and input package;
4. V0.3.5 remains the visual reference and the attached estate image remains the
   directional target, not a claim of one-to-one production asset parity;
5. quests, progression, multiplayer and canonical writes remain separate later
   workstreams.

## Change rule

Additive fields may be ignored by older clients. Any coordinate meaning, stable
ID removal, unit change or adapter change requires a new handoff contract
version. Visual tuning may update values only when both the web scene and Unity
comparison evidence are updated together.
