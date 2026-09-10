# D.1 Launch-Fix R2 — Emerald-UI contribution

2026-09-10. LOCAL PATCH REVIEW / NOT CANONICAL / NOT LIVE.

Kevin requested current cross-Birdie reconciliation and continued launch work. The approved Emerald Pass06 HTML is unchanged (SHA256 `0fadc5f767bc4cf76e06efb26555828083c7da76e506f21db0f8a57ac6ec632a`). No new art direction, no D.2/E candidate, no overwrite of canonical D.1 or the original application. This commit records the handoff; actual preview source delta and runnable tooling are in the referenced package.

## Current sources read

B7's current #85 gate is GO WITH CHANGES on exact D.1: sampling S1 closed; F02 impact-marker mismatch and F03 hidden quality/cause remain. Its 180/180 one-commit/abort and 12/12 sampling comparisons are not a blanket UX/launch PASS. B4/B5 reproduced context and renderer/asset faults on historical D; B2 supplied a separate canvas-save resilience owner delta. B6 R2.1 remains a separately identified owner handoff. No foreign gate was overwritten or automatically applied.

## Delivered code scope

Only `preview/course-canyon-v2.html` changes in a separate local copy of canonical D.1. The other 38 checked source/asset/test/builder/configuration files are byte-identical. No mapper/controller, engine, flight, renderer, effects, account, coin, wallet, booster or stored-round source is changed.

1. Active gesture is cancelled on mode changes instead of silently accepting a new mode at impact.
2. Accepted resolver result and stable ID are retained BEFORE preparation/playback. play=false, play=throw and preparation failure cannot undo acceptance or trigger another resolver on a repeated activation without explicit reset.
3. Renderer/artwork failure exposes the existing result rather than waiting indefinitely for animation completion. Stale asset callbacks are generation-guarded.
4. Visible impact marker follows the pinned existing start-relative controller threshold; it never triggers impact itself. Controller-contract parity must be rechecked if that controller changes.
5. Quality and one existing causal-feedback line remain visible outside the fading input pad, including Reduced Motion and narrow viewports.

## Exact identities

- Canonical input ZIP: `d2dcb4457438a82ebd36c7a0c5c98a55010e7a16ead8831bd87e29cde7f8c1a0`.
- Canonical D.1 HTML: `64f0fd72b1c5be0b23cdc125a6d36e0b4b6df782d5d54b2cd21e46f0569fff62`.
- Before preview template: `f317ea9ba22bfabaa2a403109f1ed020f3b386362f99ba71acc6de817f2b5e97`.
- Patched preview template: `bba7b56d02139955ee40c714290beabf5bdd61d44a3d416ef16291c46f082a24`.
- Labelled local R2 proof: `32402399d02f81e51a9cd38d36a1f081d1bfec93ac7acc157211b824cf618196` (670029 bytes).
- Delivery ZIP: `82aaf188f9fd19c0fc2b40cb0cd97a18d3cf7067cf21a8e09e6d02f45bfd939b` (4582122 bytes).

## Freshly executed by this implementation session

Own 49 browser assertions: unchanged D.1 **16 PASS / 33 FAIL** (exit 1); patch **49 PASS / 0 FAIL** (exit 0). Same test rerun from packaged paths: 49/49. Overlapping assertions are not 33 separate product bugs.

Unchanged inherited checks on the local patch: Canyon/TypeScript 27/27; Swing/TypeScript 28/28; passive effects 9/9; browser 24/24; P4 Reduced Motion 6/6; DOM sampling 12/12. Five new apply-tool guard cases pass. A fresh original-ZIP extraction plus unchanged D.1 builder reproduces the exact proof SHA.

Own browser runs: no uncaught application errors or external HTTP(S) requests. Faults and gesture traces are synthetic, not a physical-device test. B7's unchanged gesture/BOOT/RUN functions are reused with provenance; this is NOT a rerun or replacement of its complete independent gate. Our marker assertion reads the actual drawn line and verifies controller parity plus actual one-shot crossing, rather than retaining the legacy hard-coded 80% screen coordinate. Product CSP remains unchanged; harness wait polling was adjusted, with failed preparatory harness logs retained separately.

## Shared delivery, confirmed uploaded

Folder: https://drive.google.com/drive/folders/1u143X5__SH_6QigLcgfqrS4CHFsx40Yp

Full patch, original/patched templates, hash-guarded apply and reproducible build tools, unchanged B7 generator/reference input, before/after reports, inherited logs, screenshots and inventory:
https://drive.google.com/file/d/1f72e-FtVMMBEao0WsdI_zXZRhQOGY_yI/view

Detailed German handoff:
https://drive.google.com/file/d/11QPSvp0UDFlsSMPk8Oo9VbN_z1K7cIFQ/view

Clearly labelled local proof, not approved Pass06 and not canonical D.1:
https://drive.google.com/file/d/1ZHQNQwCQU5UexekQ6cqOOSEYLqB7IxrY/view

## Next gate

Existing B3/integrator reviews the single delta; B6 reviews visible/actual impact parity; B7 retests F02/F03 on the exact produced bytes; B4 reruns overall integration and B5 fault fixtures. B2 resilience and B6 R2.1 wording are NOT included in this delta and remain explicit owner decisions. Complete original live-host source/build, full account/deck/booster/scorecard/wallet flows, real devices/WebKit and rollback remain unproven.

NO MERGE / NO DEPLOYMENT / NO LIVE API CALLS. Handoff storage does not automatically start another chat.
