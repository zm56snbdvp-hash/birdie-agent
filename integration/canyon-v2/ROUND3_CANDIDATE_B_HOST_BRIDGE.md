# BIRDIE 5 / Master — Round 3 Candidate B recovered-host bridge

Stand: 10.09.2026

## Status

**LOCAL RECOVERED-HOST BRIDGE BUILT / NOT DEPLOYED.**

The OS now contains the canonical local `BirdieWorld_Emerald_Canyon_v3_Candidate_B`, which merges BIRDIE 1 atmosphere, BIRDIE 2 passive shot feel and BIRDIE 3 gameplay UI. Its handoff reports 27/27 base tests, 9/9 shot-effects tests, 41/41 Chromium checks, 41/41 UI checks, 4/4 BIRDIE-4 engine checks and 10/10 BIRDIE-4 interaction checks.

A separate recovered-host bridge package has now been built from the founder-test v5.4 recovered host identified in `ROUND2_RECOVERED_HANDLER.md`.

## Drive artifact

Google Drive folder: `Emerald_Canyon_v2__Chat_Birdies / 03_ERGEBNISSE / BIRDIE_5_App_Integration`

File: `BirdieWorld_Canyon_v3_Candidate_B_RecoveredHost_Bridge.zip`

Drive file ID: `1RV8X9J1BDKtnaOJQKTAKmKIgkpyuucKb`

Package SHA-256: `bfdff5a4db21af9199063d5273d4f9dee2557dc6f5a8add09aaaf78211c7a605`

## Recovered-host bridge

The recovered `On()` handler remains owner of the single engine resolution. Immediately after the existing result and pickup normalization have produced `t`, `start`, `flightEnd` and `end`, the candidate adds exactly one presentation callback:

```js
window.__birdieCanyonRuntime?.play?.({
  holeId: R.id,
  holeDistance: R.distance,
  remainingBefore: c,
  from: m,
  putt: z.kind === `PUTTER`,
  start: s,
  flightEnd: l,
  end: u,
  result: t,
});
```

`birdie-canyon-runtime.mjs` owns only the overlay animation. It receives already-resolved coordinates and result data. It does not invoke the engine and does not write strokes, remaining, lie, cards, rewards, coins, persistence or APIs. BIRDIE 2's `course-shot-effects` is used as the passive draw module. BIRDIE 1's atmosphere language is reproduced in the overlay as art-locked fog/light/gold accents.

BIRDIE 3's layout is preview-specific and is therefore not falsely transplanted into the recovered host DOM. The exact canonical Candidate-B HTML is included in the package under `course-lab/` for comparison/testing.

## Validation executed on the bridge candidate

- JS/MJS syntax sweep: PASS.
- Founder preflight: PASS.
- Pure bridge helper checks: 6/6 PASS, including exact start/flight-end/final endpoints, water reset and no flight phase for putt.
- Recovered gameplay QA: 32 PASS / 1 pre-existing FAIL (`Result accessibility`), identical class of failure to the untouched v5.4 baseline; no new bridge-caused gameplay failure identified.
- Engine bundle remains unchanged.

## Boundaries

This does not prove the current live revision or recover the readable original Codex/Sites source. It is not a production patch, not a deployment and not physical-device/Safari acceptance. The next gate is founder browser testing of the recovered host package, followed by BIRDIE 4 QA of this exact integration candidate before any further promotion.
