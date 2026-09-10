# D.1 Launch-Fix R3 — owner-integrated review, not production

2026-09-10. Existing Emerald-UI / D.1 Launch-Fix track continued. No new visual direction or competing D.2/E release. Approved Pass06 stays byte-identical: `0fadc5f767bc4cf76e06efb26555828083c7da76e506f21db0f8a57ac6ec632a`.

## Current gate correction

Latest B4/B7 comments in #87 identify unmodified D.1 as REWORK, not the earlier GO WITH CHANGES. Sampling is closed; caller/context/artwork and impact/feedback defects remain on that historical hash. This implementation's developer tests do not overwrite independent gates or grant production approval.

## Combined code delivered

Five existing product files modified, two owner helper modules added. Full runnable source, deltas, original references, tests, raw failures and new evidence are in the handoff ZIP.

- Exact B6 F02 controller proposal + passive impact guide: UI now reads `impactLineY`, rather than duplicating the threshold formula. Existing D.1 sampling fix retained, not applied twice.
- Out-of-pad threshold is displayed through an explicit overflow-visible guide in the existing stage margin. No clamped/fabricated hit line or new input rule. Tested at 99.9% start height over four viewport sizes.
- Exact B2 nested Canvas save/restore fix adopted. Its optional safe wrapper is present/tested; runtime still uses the original drawing API.
- New integrator-owned Cinematic paint fault boundary latches failure, stops scheduling and reports a presentation-only error. UI exposes the already accepted result even when a later animation frame fails.
- Accepted ID/result/input persist before optional preparation/play. Explicit replay retries presentation with the same accepted ID and no new resolver, including a failed initial preparation.
- Only B6's two supplied causal Downswing strings adopted. Scoring formulas, gates, engine input and numeric results unchanged.

Engine, course-flight, projection, artwork, existing app host, cards, coins/wallet and persisted rounds unchanged. This is the combined Canyon/Swing review slice, not an original full React/Sites app build. Approved Pass06 UI and this technical proof are not interchangeable artifacts.

## Fresh actual tests

- SAME unchanged B2 consumer-fault runner on previous R2: 17 PASS /1 FAIL /3 NOT TESTED, exit1. Late native Canvas exception and disabled replay are retained in evidence.
- Same B2 runner on final R3: 21 PASS /0 FAIL /0 NOT TESTED, exit0.
- Previous R2 launch browser checks on final R3: 49/49.
- New actual R3 integration browser checks: 23/23, including exact outside guide, late-frame recovery, frozen input, stable ID and stale error callback rejection.
- Canyon/TS 27/27; Swing 28/28; original + owner effects 23/23; actual integrated numeric/exact-wording contracts 8/8; inherited browser 24/24; P4 6/6.
- B6's unchanged separate owner-reference tests 13/13 (not claimed to replace integration tests).
- DOM sampling 12/12 with explicit exact two-string expectation update; old literal-all-text comparison remains archived as FAIL. No numeric tolerance weakened or arbitrary feedback excluded.
- Strict affected-module TypeScript exit0; original-ZIP rebuild reproduces exact final HTML SHA; reproduction success +4 negative guards 5/5.

No uncaught application errors or external HTTP(S) requests in final own/B2 browser runs. Synthetic gestures/fault injection; no physical-device, Safari/WebKit, full-host/account/wallet/round or independent B7/B4 acceptance claim. A timed-out preparatory sampling batch and a missing local fixture on first test setup remain documented; neither is counted as successful execution.

## Exact handoff

Review HTML: `BirdieWorld_D1_LaunchFix_R3_Proof.html`, 672103 bytes, SHA256 `8d7d1ea20462b76d2ceaafdc87cb0f6228c75298bc247c8d7bb40ede39c0f2fd`.

Manifest SHA256: `4524f89a9856dd7093c22d4ab7e545956d88732011a25598f2b52cf1280652cf`.

Full ZIP: 22445594 bytes, SHA256 `bf562a6f6f94084a30f3e8a0a5b98f57b662583ec3e3b3f80e15ec39460f753f`.

Confirmed Drive upload folder: https://drive.google.com/drive/folders/1Qx0d5wShXgwkvGQX3n8yYUcDrHDpeFPe
ZIP: https://drive.google.com/file/d/1XWz2iIg-CjJAwMU20JFUqUratv5OVFtB/view
Detailed German handoff: https://drive.google.com/file/d/1blUjbQ6xSR44W3oAlA5pe156PxM9Kooe/view
Technical proof: https://drive.google.com/file/d/1WK1PA2Q7ve2uvWI0JwhPSHmz9E0VEcqX/view

The accompanying `reproduce_r3.py` is committed in this directory. It validates the original D.1 archive, manifest, before/after source identities, protected modules, builder and exact output. It works in a temporary directory, refuses existing output and does no installation/network/deployment. Reproduction and four negative cases were executed locally.

## Next independent gate

Existing integrator/owners review these exact combined bytes; B7 retests interaction/feedback/fault cases and B4 performs overall regression. Original maintainable live host/build, complete app flows, real touch devices/WebKit and rollback remain separate open gates. No merge, no deployment, no live data changes; a stored comment does not automatically start another chat.
