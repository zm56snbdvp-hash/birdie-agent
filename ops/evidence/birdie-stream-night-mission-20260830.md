# Birdie Stream Night Mission — Local Evidence Ledger

Recorded on 2026-08-30 for branch `feature/birdie-desktop-alpha` at HEAD `9fff8c26e8ae`. The worktree was intentionally dirty because pre-existing Desktop/Core/Voice work and the Stream Mode draft were preserved. The effective browser build identifier was `9fff8c26e8ae-stream-dirty`.

## Verdict

- Local private visual draft: `DEMONSTRABLE`, with the operator keeping `99_SAFE` available.
- Ten-minute renderer performance: `FAIL` for both High and Low in the measured machine conditions.
- Static path: visually observed, but performance and artifact-free behavior remain `UNPROVEN`.
- OBS profile/collection, MKV, audio, hotkeys and take-bound evidence: `UNPROVEN`.
- CTA/QR conversion: `DRAFT`; no public canonical CTA, matching verified QR or scan evidence exists.
- Founder stream/conversion decision: `STOP`.

No stream, upload, production deployment, external message or push was performed.

## Reproduction entrypoint

Exactly one Birdie start command is supported from the repository root:

```powershell
npm --prefix apps/desktop run stream
```

It binds `127.0.0.1:1421` with a strict port and does not open a browser automatically. The final post-hardening command smoke reported Vite ready in 4.317 s, served the Stream URL with HTTP 200, exposed the explicit `SYNTHETIC PRESENCE` and `DEMO VOICE REACTION` claims, and was then stopped without leaving a listener. An earlier verification-browser run under heavier concurrent load reported Vite ready in 6.868 s, build ID `9fff8c26e8ae-stream-dirty`, Low WebGL, first rendered frame after 1.366 s, configuration after 103 ms, exact 1920×1080 layout and zero page/runtime errors.

## Browser and timeline evidence

| Probe | Result | Evidence |
| --- | --- | --- |
| High WebGL 10-minute soak | `FAIL` | Start `2026-08-30T03:08:24.827Z`; duration 615.012 s; 8 loops; 86 transitions; maximum loop drift 26 ms; first frame 197 ms; config 11 ms; exact 1920×1080; `ERRORS 0`; no zero-FPS sample or renderer stall; maximum frame gap 330 ms; p95 frame time 40.1 ms; long-frame rate 5.664%; active-state p10 25.7 FPS, below the 28 FPS gate. |
| Low WebGL 10-minute soak | `FAIL` | Start `2026-08-30T03:19:06.834Z`; duration 612.258 s; 8 loops; 85 transitions; maximum loop drift 25 ms; first frame 203 ms; config 18 ms; exact 1920×1080; `ERRORS 0`; no zero-FPS sample or renderer stall; maximum frame gap 540 ms; p95 frame time 79.9 ms; long-frame rate 8.618%; idle p10 25 FPS, active-state p10 14 FPS, below the 24 FPS gate. |
| Low-soak host condition | `CONFOUNDED` | Near the late performance drop the whole machine reached 100% CPU with about 1.59 GiB free physical memory. Defender, ChatGPT/Chrome, WUDFHost/System and unrelated Node work were among the consumers; the Birdie Vite process used about 44 MiB and was not a top consumer. This supports host contention as a factor, but does not turn the failed gate into a pass. |
| Static renderer | `UNPROVEN` | Correctly reports `RAF_HEARTBEAT`, never renderer FPS, and keeps rendered frame count at zero. One capture tore under 100% host CPU; a later frame and the 1280×720 view appeared clean. No persisted pixel-diff or long soak proves artifact-free behavior. |
| 1280×720 layout | `PASS` | Exact 16:9, no overflow; telemetry, footer and CTA text remained at least 10 px. Low WebGL at this size reported first frame 488 ms and `ERRORS 0`. |
| 30-second route | `PASS` for page timeline only | Observed 31.324 s; `CLIP_30`; one loop; 2 ms drift; all expected states in order; `ERRORS 0`; label `CLIP 30 01 / 30S`. OBS MKV duration remains `UNPROVEN`. |
| 60-second route | `PASS` for page timeline only | Observed 61.580 s; `CLIP_60`; one loop; 9 ms drift; all expected states in order; `ERRORS 0`; label `CLIP 60 01 / 60S`. OBS MKV duration remains `UNPROVEN`. |

Both ten-minute runs covered the seven synthetic timeline states and preserved their canonical order. They do not prove microphone input, voice recognition, agent runtime connectivity, real PC actions or any other Presence state.

## Tests and builds

| Check | Result |
| --- | --- |
| Desktop Node tests | `PASS` — 72/72 |
| Core Node tests | `PASS` — 39/39 |
| Protocol Node tests | `PASS` — 3/3 |
| Protocol validation | `PASS` — 9 states, 3 roles, 33 events, 18 messages |
| Voice CTest | `PASS` — 11/11, 2.48 s |
| Root cycle-server integration | `PASS` — 1/1, 5.223 s |
| Root MCP HTTP integration | `PASS` — 1/1, 2.072 s |
| Root Cloud Run workflow contract | `FAIL` — 2/4; two pre-existing CRLF-sensitive assertions |
| `cargo fmt --all -- --check` | `PASS` |
| `cargo check --message-format short` | `PASS`, 45.16 s |
| `cargo test --message-format short` | `PASS` — 23/23; one non-failing MSVC import-library warning |
| Stream plan preflight | `PASS` for repository plan only; Founder status `STOP` |
| Vite production build | `PASS` — 19 modules; effective build ID `9fff8c26e8ae-stream-dirty` |
| Tauri production build | `PASS` — final rebuild completed with exit code 0; release profile 9m28s under host contention |

The repository-wide Node suite is not fully green. The isolated `test/cloud-run-deploy-workflow-contract.test.mjs` run finished 2/4: `production workflow stays manual, protected, and WIF-compatible` expects LF in `/^on:\n  workflow_dispatch:/m`, while the checked-out workflow contains CRLF; `all actions are immutable and all embedded shell blocks parse` likewise finds too few blocks because its parser is LF-sensitive. These are deterministic, pre-existing cross-platform workflow-test failures and were not changed as part of Stream Mode. The two environment-contended integrations were separated successfully afterward: cycle-server `PASS` in 5.223 s and MCP HTTP `PASS` in 2.072 s.

## Built artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `apps/desktop/src-tauri/target/release/birdie-desktop.exe` | 9,356,288 | `e550cd5675b74e6b284bc2f384aeb746cbabf7aa33ecb20daa894be083dda7f8` |
| `apps/desktop/src-tauri/target/release/bundle/nsis/Birdie_0.1.0-alpha.0_x64-setup.exe` | 131,356,258 | `5f420addce9c2c67387499e6606e80105a6dda47d9e49eb59cac262b23a1d523` |

These are local artifacts from a dirty worktree, not release artifacts.

## Open STOP gates

1. Rerun High and Low for ten quiet-host minutes and satisfy every renderer gate; do not average away a failed state.
2. Preview the Static path under realistic load and persist an artifact-free visual check; Static remains an emergency visual path, not a performance proof.
3. Apply the isolated OBS profile/collection locally, exercise the four emergency hotkeys, and record a private 90-second MKV with zero dropped/render-lagged/encoding-lagged frames.
4. Record private 30.0 ± 0.1 s and 60.0 ± 0.1 s MKVs and inspect start/end frames.
5. Replace the placeholder with one Founder-approved public canonical HTTPS Paid-Pilot URL plus a matching local PNG/WebP QR; verify its configured SHA-256 and scan the final MKV on a second device.
6. Retain the two CRLF workflow-test findings as separate repository issues; they are not Stream Mode product evidence.
7. Only after the above evidence is green may the Founder issue a new stream/conversion `GO`. Publication or an actual stream still requires a separate explicit authorization.
