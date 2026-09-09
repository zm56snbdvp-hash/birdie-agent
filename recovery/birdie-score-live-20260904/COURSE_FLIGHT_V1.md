# Emerald Course / Ball Flight v1

Status: IMPLEMENTED AND LOCALLY TESTED, NOT DEPLOYED. 2026-09-10.

## Correct product and source boundary

This is for the shot/card/score BirdieWorld, not the walking/bridge mission in
`birdieworld-supporter-beta-deploy`. Base: `birdie-agent`, recovery branch
`recovery/birdie-score-live-20260904`, commit
`6dc644372661ed4317227c6b332dc74fef8eb8e5`.
The base is recovered client source, NOT the original full live workspace.
The parent README's production blockers remain in effect. No server code,
auth, wallet, coins, collection rules or production configuration is changed.

## Implemented

- `course-flight.ts`: immutable presentation snapshot of an ALREADY RESOLVED
  `ShotResult`, stable visual shot ID, carry arc, ground roll, cosmetic bounce,
  water-impact fade followed by the official penalty reset, grounded putts and
  hidden holed ball. End coordinates are exactly the engine's result.
- `course-scene.ts`: self-contained Canvas 2.5D perspective course; flowing
  emerald fairway, layered canyon folds, subtle gold edges, flag, white ball,
  gold flight trail, simple club swing and camera follow. One visual theme is
  shared across the six existing hole definitions, not six bespoke 3D levels.
- `CourseScene.tsx`: read-only React lifecycle wrapper and accessible fallback.
- `GameApp.tsx`: mounts that component and accepts optional `courseShot`.
  Existing cards, draws and hole progression are otherwise unchanged.
- Offline preview: three synthetic test scenarios, all six hole definitions,
  timing/mode controls, explicit replay/reset and reduced motion. Uses the
  unchanged recovered `simulateShot` exactly once per new test shot.

No engine code was modified: `shot-engine.ts` Git blob remains
`f73d2bb599b54e18023b9604f1b3a8de7259cb78`.

## Host integration contract

The recovered `GameApp` contains card handling, NOT the original live shot
button/controller. The optional prop is implemented, but that missing live
handler cannot truthfully be described as wired or tested here.

At the host's existing successful shot-resolution point:

```tsx
// input/result belong to the existing resolver. Do not simulate again.
const visualShot = prepareCourseShot(stableShotId, input, result);
setCourseShot(visualShot);
// <GameApp loadout={loadout} courseShot={courseShot}/>
```

Or mount `<CourseScene hole={currentHole} shot={visualShot}/>` inside the
original shot screen. The hole ID must match. Construct the snapshot once per
accepted shot; keep its ID stable on rerender. Prepare again from input/result
if crossing a serialization boundary: copied raw snapshot objects fail closed.
Never write score, draw cards or redeem rewards on animation completion.

Coordinates are a current-shot frame: x lateral, z forward, y cosmetic height.
The view reframes for each shot; it is NOT a persistent 3D world-coordinate map.
Decorative course boundaries do not enforce lies or collisions. Engine labels
are authoritative. A water penalty is not rendered as backward ground travel.

## Lifecycle and accessibility

One requestAnimationFrame loop while a shot is moving; none while idle/done.
Visibility and intersection changes pause playback; unmount destroys observers
and callbacks. Reduced-motion system preference or component setting skips to
the exact final result. Device pixel ratio is capped at 2 (1.5 on low quality).
Duplicate IDs are ignored within a bounded 128-entry visual cache; this is NOT
a financial or server idempotency mechanism. Explicit reset permits replay.

## Local verification and preview

Requires Node with type stripping (tested Node 22.16.0) and TypeScript on PATH
(tested 5.8.3). No package/dependency or lockfile changes are required.
From this recovery directory:

```sh
npm run verify:course
npm run preview:course
# Optional: Python Playwright plus Chromium installed locally
python tools/verify-course-browser.py
```

Open `dist-course/BirdieWorld_Course_Flight_v1.html` in a browser. It contains
all runtime code, requires no server, makes no network requests and saves no
state. `preview/course-preview.html` is the source template, not the built file.
The browser verification loads that same HTML into Chromium in memory.

Evidence: 17 new Node tests PASS (including 90 hole/timing/mode combinations),
strict TypeScript PASS for engine + flight + renderer; 23 local Chromium checks
PASS including desktop, 390/320 px viewports, motion preferences, reset, duplicate
play, synthetic visibility, intersection pause, destroy, water and putt paths.
No browser JS/console errors and zero network requests in that run.
Both TSX files passed syntax transpilation only. The full React host build,
original recovery regression suite, real phones, Safari and live app integration
were NOT run. Do not translate these local results into production acceptance.

## Next bounded work

Integrate the snapshot adapter at the real live shot handler once that exact
source workspace is available, then run the host's build and regression tests.
Art polish/true 3D terrain can follow independently without changing shot rules.
This first procedural 2.5D slice is deliberately simpler than the approved
cinematic reference image. Main, recovery base and live deployment stay unchanged.
