# BirdieWorld Emerald Canyon v3 Candidate C — Birdie Swing / recovered-host bridge

Status: LOCAL CANDIDATE BUILT, NOT DEPLOYED.

## Candidate C
Candidate C combines BIRDIE 1 canyon atmosphere, BIRDIE 2 passive shot effects, BIRDIE 3 gameplay UI and BIRDIE 6 continuous one-finger BIRDIE SWING.

Standalone Candidate C is stored in Birdie OS under `03_ERGEBNISSE/BIRDIE_MASTER_Canyon_v3_Candidate_C_BirdieSwing`.

- HTML Drive id: `1g0MkMVEx1LrxBKhATpI_WMFra4nb_tiT`
- Dev ZIP Drive id: `1TcXIdwYBAPurD_vz-eka3wxWfjP_Ozdg`
- Handoff Drive id: `1nih2YzEfoBnmGY1aF2AESH7IaUTu9YP4`
- Standalone HTML SHA-256: `62f7b415cb42d4dda4cd0bfd7391799d199bf7f34e7c8f072dd3a098dc497918`

Fresh local checks: v2 Node/TS 27/27 PASS, BIRDIE 2 shot effects 9/9 PASS, BIRDIE 6 mapper/controller 10/10 PASS, Candidate-C Chromium interaction 19/19 PASS. The visible legacy timing control is hidden; one valid gesture commits one existing `simulateShot` result, replay does not re-resolve, abort before impact resolves zero times, and the swing surface remains usable at 320/390px.

## Recovered host hook
A separate local Founder candidate was built from the previous recovered-host bridge. It does not change the recovered engine. A narrow hook in the recovered compiled GameApp exposes the already-identified `On()` handler only while phase is PLAN and equipment is available. BIRDIE SWING maps gesture metrics to the existing `timingMeter`; the hook clamps this value and invokes the existing `On()` handler. The engine is not called by the swing runtime.

Recovered-host ZIP is stored in the BIRDIE 5 OS result folder:
- Drive id: `1kGb5mvTVdSqgDWiGui79mdF7AXvEDcxj`

Local host checks executed:
- all JS/MJS syntax: PASS
- founder preflight: PASS
- existing canyon runtime helper QA: 6/6 PASS
- Candidate-C host hook QA: 8/8 PASS
- inherited gameplay QA: the old exact-visible-meter assertion now fails by design because Candidate C can override the hidden meter with gesture-derived timing; the pre-existing Result-accessibility failure also remains. No claim of full browser/live acceptance is made.

## QA dispatch
Independent QA requests were placed in the OS for BIRDIE 4 and BIRDIE 7. BIRDIE 7's previous blocker ('BIRDIE 6 artifact not found') is resolved; the exact BIRDIE 6 ZIP and Candidate C ids are now referenced.

No main-branch change, deployment, live API, score/round/coin mutation or production write was performed.