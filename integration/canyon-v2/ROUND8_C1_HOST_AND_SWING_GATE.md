# BIRDIE 5 — Round 8: Candidate C.1 host + Swing gate

Stand: 10.09.2026

Status: **DO NOT PROMOTE CURRENT SWING MAPPER / HOST SAFETY PROOF PREPARED / NO DEPLOYMENT**

## 1. Independent BIRDIE 7 result now available

BIRDIE 7 completed its actual playtest of the BIRDIE-6 lab and integrated Candidate C and returned **GO WITH CHANGES** for the BIRDIE SWING interaction family.

The interaction concept is retained, but the current mapper is **not approved as the final skill model**. A reproducible TEE exploit with a grossly wrong ~700 ms transition can still map to `timingMeter=50`, `gestureScore=100`, `quality=PURE` because signed component errors cancel each other. BIRDIE 7 also found abrupt transition too forgiving and Candidate C Reduced-Motion integration incomplete.

BIRDIE 6 has already received a bounded follow-up request: non-compensating error energy, hard PURE/SOLID dimension gates and causal feedback, while preserving exactly one existing engine resolve at Impact.

## 2. Candidate C.1 standalone

Candidate C.1 SHA-256:

`288e790df065fb48ab62c458713731988cea389f1d015c115641e41927a34963`

It is a narrow UI/accessibility correction of Candidate C:

- restores a keyboard fallback into the same existing resolve path;
- keeps the large mobile motor hitbox while shrinking idle visual chrome below 18% of the course stage;
- clarifies Follow-through as post-Impact closure (`Finish · Ergebnis steht`);
- documents candidate-only build-script lineage.

Its own reported fresh checks are green, but **it does not change the BIRDIE-6 mapper**, so the BIRDIE-7 anti-cheese finding remains applicable until the mapper is hardened and independently re-tested.

## 3. Candidate C.1 recovered-host R2 SAFE audit

Drive candidate observed:

`BirdieWorld_Canyon_v3_Candidate_C1_RecoveredHost_R2_SAFE.zip`

Declared ZIP SHA-256:

`12880303e9e6ba0271fac87640caaeb20fc81e59b266b444ca373380a67da67c`

Positive findings:

- starts from BIRDIE-5 R2 SAFE lineage;
- original recovered host geometry retained: `y={x:512,y:1365}, b={x:520,y:195}`;
- unsafe prior re-registration absent;
- engine SHA remains `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`;
- R2 passive post-resolve Canyon callback remains exactly once;
- candidate-specific Swing-hook checks report 15/15 PASS;
- syntax / preflight / R2 runtime and boundary tests remain green.

However, the current C.1 recovered-host hook uses `window.__birdieSwingTimingOverride` as mutable global state before calling the existing `On()` resolver. This causes the inherited static gameplay check `Exact visible capture` to fail in addition to the known baseline `Result accessibility` failure.

The legacy runtime behavior still falls back to `meterValueRef.current`, but mutable global timing state is unnecessary for the recovered-host proof and creates avoidable stale-state risk.

## 4. Additional host-context race

During a pointer Swing the recovered host remains in `PLAN` until Impact. Therefore the old host `TIMING` locks are not active while the gesture is in progress.

The observed host runtime did not expose an active-Swing host lock or cancel the Swing session from the manual match restart handler. Without a context guard, a second input can potentially mutate aim/equipment/mode or reset host state while a Swing session is still using metrics measured against the previous context.

A safe integration must either freeze the accepted ShotInput context or fail closed if that context changes before Impact. The gesture layer must never silently resolve against a different club/ball/aim than the one under which the gesture began.

## 5. Local safer recovered-host adapter proof

A local, **not promoted and not deployed**, host-adapter proof was prepared to validate the safer shape:

- no `window.__birdieSwingTimingOverride`;
- `On(optionalSwingTiming)` initializes from existing `meterValueRef.current` and uses the optional mapped timing only for that one call;
- Swing adapter calls the same `On(mappedTiming)` exactly once;
- a context fingerprint covers hole, remaining, lie, stroke, club, ball, active actions, mode and aim;
- runtime captures that fingerprint at pointer-down;
- Impact fails closed if the current host context differs;
- manual match restart cancels the active Swing session before resetting host state;
- R2 passive Canyon callback remains downstream of normalized result;
- host geometry and engine remain unchanged.

Local proof results:

- syntax: **54/54 PASS**
- Founder preflight: **PASS**
- Canyon runtime: **6/6 PASS**
- R2 bridge boundary: **10/10 PASS**
- Swing/context boundary: **22/22 PASS**
- inherited gameplay: **32 PASS / 1 FAIL Result accessibility** — back to the same known Founder-v5.4 baseline class; the extra `Exact visible capture` failure is removed
- GameApp mirror identity: PASS
- recovered engine byte identity: PASS

This adapter proof is not a reason to integrate the current mapper. It is only the preferred host-safety shape once the mapper passes BIRDIE-7 re-test.

## 6. Promotion gate

Do not combine the lanes into a release candidate yet.

Required sequence:

1. BIRDIE 6 hardens mapper P1/P2/P5.
2. BIRDIE 7 repeats the same cheese / 15-gesture matrix and approves the hardened mapper.
3. Candidate C.1 UI/accessibility fixes are retained or re-applied to that hardened interaction candidate.
4. Host integration uses the R2 presentation boundary plus a no-global, context-safe timing handoff.
5. BIRDIE 4 independently regresses the exact combined artifact.
6. Maintainable source and current live revision must still be recovered/verified before any Production patch or deployment.

## Current decision

- Master Candidate B / R2 presentation bridge: **separate safe presentation lane; independent QA still required**.
- BIRDIE SWING concept: **GO WITH CHANGES**.
- Current BIRDIE-6 mapper: **BLOCKED FOR FINAL INTEGRATION**.
- Candidate C.1 UI correction: **compatible in principle; mapper defect still inherited**.
- C.1 recovered-host global-override implementation: **do not promote as preferred host handoff**.
- no-global + context-guard host shape: **local proof only, ready to reuse after mapper QA**.

No product branch, live system, engine, account, round, card, coin or reward state was changed.
