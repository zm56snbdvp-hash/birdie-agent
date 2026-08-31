# Birdie Stream — Founder GO/NO-GO and rollback record

- Take: `birdie-stream-rehearsal-20260830T050017Z`
- Operator: Codex local rehearsal
- Build: `9fff8c26e8ae-stream-dirty` from `feature/birdie-desktop-alpha` at `9fff8c26e8aecdf7364e15004152802458952bc9`
- Recorded: 2026-08-30 05:41:23.996Z–05:51:41.409Z
Decision: **NO-GO for a live stream, public demo, conversion claim or publication.** The MKV is suitable only for private local review with the limits below.

The structured, take-bound evidence is in [birdie-stream-general-rehearsal-20260830.json](./birdie-stream-general-rehearsal-20260830.json), privacy-redacted SHA-256 `71a841f18e5c660f71379263c4da5e602d0a377ecd9db307ccfc438998732abd`. Any change to the Stream UI, public config, OBS profile/collection, browser engine, GPU driver or hotkeys invalidates this record.

## Gate ledger

| Gate | Result | Evidence |
| --- | --- | --- |
| Isolated offline OBS contract | PASS | 8 scenes, 5 allowlisted sources, no desktop/window/game/camera/WASAPI source; stream, replay buffer and virtual camera never started |
| 1080p30 MKV | PASS | 617.413 s, 475,240,757 bytes, SHA-256 `2ec3fc3c…9e71` |
| OBS frame stability | FAIL | 18,503 frames; 17 render-lag frames and 17 encode skips, both 0.1%; das Zero-Frame-Gate ist damit nicht erfüllt |
| Happy-path state coverage | PASS | 8 loops, 84 transitions, all 7 canonical demo states, order errors 0 |
| Deterministic ERROR | PASS | separate `fixture=error`: visible `ERROR`, code `SYNTHETIC_FIXTURE`, loop count 0 |
| Startup | PASS | first visual frame 258 ms; config ready 15 ms |
| Browser frame gate | FAIL | active-state p10 lower bound 26.0 FPS; required 28 FPS |
| Browser stall/frame-time gates | PASS | p95 50.1 ms, max gap 710 ms, long-frame rate 4.93%, errors 0 |
| Host performance certification | UNPROVEN | CPU p95/max 100%, aggregate GPU-engine p95 100%, free RAM minimum 961.1 MB; this is a confounded host |
| Title-safe/layout | PASS | all visible content groups and QR fallback inside 5% safe area, no overflow; CSS 1280×720 maps to OBS 1920×1080 at device scale 1.5 |
| CTA/QR visibility | PASS | CTA and QR fallback remained visible in main, backup and clip scenes |
| CTA/QR conversion | STOP | `example.com/birdie`, `DRAFT`, placeholder QR, no scan/hash verification |
| Privacy image path | PASS | explicit allowlist: Birdie browser sources plus the inert `SAFE_SLATE` (`#070a0f`) used for start/BRB/end/safe scenes; no screen capture or transcript/diagnostic source |
| Audio capture contract | PASS | OBS mixer empty throughout; target collection contains no audio/capture source |
| Final AAC content review | UNPROVEN | OBS muxed a 48 kHz AAC track; no active source was present, but the track was not independently decoded/listened to |
| `Ctrl+Alt+Shift+F12` with OBS focused | PASS | switched to `99_SAFE` and retained recording |
| Global `Ctrl+Alt+Shift+F12` from Codex | FAIL | `01_STREAM` remained active; OBS focus behavior was already `Hotkeys nie deaktivieren` |
| `Ctrl+Alt+Shift+F10` with OBS focused | PASS | recording stopped and MKV closed cleanly |
| Global `Ctrl+Alt+Shift+F10` from Codex | FAIL | recording remained active until the focused fallback |
| Tests/build | PASS | 29/29 targeted tests; Vite production build passed; repository readiness contract passed |

The automated global-hotkey failure is evidence for this host and input path, not proof that a physical keyboard can never work. It is still a release blocker because the required out-of-app path was not demonstrated.

## Scene and clip evidence

- Start, main, BRB, main, low-end backup, 30-second clip, 60-second clip, main, SAFE, main and end were all activated during the MKV.
- `03_CLIP_30` was active for 30.048 s before the next scene.
- `04_CLIP_60` was active for 60.019 s before the next scene.
- Both clip browser sources visibly reloaded on activation. This validates the operator timing, not a separately exported final social clip.
- Main and backup scenes showed the CTA plus non-scannable QR fallback. No conversion claim is allowed.

## Founder decisions

| Scope | Decision | Reason |
| --- | --- | --- |
| Private local review of this MKV | GO WITH LIMITS | coherent visual take and safe source graph; do not present it as microphone, PC-action or conversion proof |
| Live demo / OBS operation | NO-GO | global SAFE and stop-recording paths failed; active-state FPS gate failed |
| Conversion | STOP | placeholder CTA/QR |
| Publication or production deploy | STOP | no final privacy listening pass, no founder sign-off and the two live blockers remain |

- Founder sign-off: **UNSIGNED**
- Owner for retest: Founder + Desktop Principal Engineer
- Expiry: immediately on any product, config, OBS, runtime, driver or hotkey change.

## Rollback drill

Trigger observed: global emergency chord did not switch the scene.

1. Focused OBS and invoked the same SAFE chord: `99_SAFE` became the active slate.
2. Global stop-recording chord from Codex failed; focused OBS and invoked the same chord: recording stopped and MKV closed.
3. Restored profile `Unbenannt` and scene collection `Birdie Live Lab — FreeBridge v4`.
4. Confirmed recording, streaming and virtual camera inactive.
5. Closed OBS, stopped Vite, closed the local browser tab.
6. Confirmed no OBS/OBS-browser process, no task-owned Vite process and no listener on ports 1421 or 1424.

Rollback result: **PASS**, but the manual focus dependency is not acceptable as the only live emergency path.

## Exact retest acceptance

All four conditions are required before changing the live decision:

1. From a genuinely different foreground app, a physical or independently verified OS-level `Ctrl+Alt+Shift+F12` must switch to `99_SAFE`; `Ctrl+Alt+Shift+F10` must stop recording. Both require timestamped OBS evidence.
2. A quiet-host 600-second run must meet every per-state p10 FPS gate, with host CPU/GPU/RAM series attached to the same take.
3. Replace the placeholder CTA with one founder-approved canonical HTTPS target and a matching locally hashed, scan-verified raster QR.
4. Review the final MKV visually and audibly for secrets, notifications, transcripts, diagnostics and unintended sound, then sign this record.
