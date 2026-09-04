# Birdie Moments v1 — Phase 2 Rendering

## Scope

Phase 2 implements the canonical visual rendering layer for the two v1 Moment types:

- `ROUND` → `birdie-moment-round-v1`
- `PERSONAL_BEST` → `birdie-moment-pb-v1`

The renderer is deterministic and receives only validated `MomentRenderData`. It does not read browser state, UI state, local storage, random values or another user's data.

## Canonical outputs

Exactly one render input produces three distinct assets:

| Output | Size | Purpose |
| --- | ---: | --- |
| Preview | 1080 × 1350 | Post-round and Moment detail preview |
| Digital | 2160 × 2700 | Purchased full-resolution digital edition |
| Print A3 | 3508 × 4961 | A3 portrait master at 300 DPI |

The A3 master uses a 95 px safe margin (approximately 8 mm at 300 DPI). The print asset contains no browser chrome, buttons or purchase UI.

All v1 outputs are deterministic SVG masters (`image/svg+xml`). SVG is used as the canonical vector asset so a later storage/fulfillment adapter can rasterize or convert to provider-specific PNG/PDF without changing Moment data or template logic.

## Data authority

Required render input:

- `internalRoundId`
- `playerName`
- `courseName`
- `playedAt`
- `totalScore`
- `holesPlayed`
- `birdieCount`
- `momentType`
- `templateVersion`

Optional source-backed values are rendered only when present, for example `scoreVsPar`.

A `PERSONAL_BEST` render additionally requires a proven:

- `previousBestScore`
- `newBestScore`
- `improvement`

The canonical v1 improvement convention is score delta:

`newBestScore - previousBestScore`

Example: `86 → 82 = -4`.

If PB data is absent or inconsistent, the PB renderer fails closed and cannot print `NEW PERSONAL BEST`.

## Asset lifecycle

```text
PENDING
  -> GENERATING
  -> render preview + digital + print masters
  -> store all as private assets
  -> PREVIEW_READY
```

A render/storage failure marks the Moment `FAILED`. It does not affect the already committed Scorecard round.

The digital full-resolution asset and print master remain private references. Phase 4/5 payment and fulfillment adapters decide when a user may access or submit those assets.

## Security boundary

- no public asset URL is required by the renderer
- storage adapter receives `private: true`
- the internal Round ID is embedded in asset metadata/data attributes for traceability, not shown as visible customer copy
- HTML/XML-sensitive player and course names are escaped
- long display text may be visually compacted, while full canonical values remain in asset metadata

## Visual direction v1

The template deliberately matches the current BirdieWorld visual language:

- deep green / near-black field
- restrained gold accent
- editorial collectible-card hierarchy
- large score as the hero datum
- no screenshot-like scorecard table
- Personal Best uses the same system with an explicit `NEW PERSONAL BEST` edition panel

This remains a versioned template. Any future redesign creates a new `templateVersion`; existing purchased assets do not silently change.

## Out of Phase 2

Not implemented here:

- Moment detail UI
- post-round upsell UI
- payment
- entitlement/download authorization
- provider-specific PDF/raster conversion
- print ordering
- analytics

Those remain later Birdie Moments phases.
