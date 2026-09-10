# BIRDIE 5 — Round 8: Candidate C.1 host + Swing gate

Stand: 10.09.2026

Status: **BIRDIE SWING REWORK / CURRENT MAPPER BLOCKED / HOST SAFETY PROOF PREPARED / NO DEPLOYMENT**

## 1. Final independent BIRDIE 7 gate

The canonical, updated BIRDIE-7 handoff now returns **REWORK** for the current BIRDIE SWING mapper / Candidate C.

This supersedes the earlier intermediate `GO WITH CHANGES` wording. The interaction family itself should be kept: continuous one-finger `ADDRESS -> BACKSWING -> TRANSITION -> DOWNSWING -> IMPACT -> FOLLOW THROUGH` is judged stronger and more golf-like than a timing tap. One-shot safety, cancel/reset/multitouch handling and viewport normalization are already solid.

The current mapper is nevertheless **not a valid integration candidate** because the skill model can produce fake skill through signed error cancellation.

Independent reproduced defects include:

- S1 phase-cancellation: a physically poor swing with roughly 8.7% backswing vs 28.5% target, ~1512 ms backswing vs 560 ms, ~299 ms transition vs 78 ms and ~803 ms downswing still reached `timingMeter 50-51 / SOLID`;
- S1 abrupt transition: clearly abrupt direction change reached roughly `timingMeter 54 / gestureScore 94 / PURE`;
- long top pause can still receive `SOLID / Guter Swing` instead of causal transition feedback.

BIRDIE 6 has received the bounded rework: P1 non-compensating error energy, P2 hard PURE/SOLID gates for critical dimensions and P5 causal feedback from the dominant normalized error. Only existing `timingMeter` may cross into gameplay and the one accepted Impact must still resolve exactly once.

## 2. Candidate C.1 standalone

Candidate C.1 SHA-256:

`288e790df065fb48ab62c458713731988cea389f1d015c115641e41927a34963`

C.1 is a narrow UI/accessibility correction of Candidate C:

- keyboard fallback uses the same existing resolve path;
- large mobile motor hitbox remains while idle visual chrome is reduced below 18% of the course stage;
- Follow-through is explicitly described as post-Impact closure (`Finish · Ergebnis steht`);
- candidate-only build-script lineage is documented.

C.1 **does not change the BIRDIE-6 mapper**, therefore the final BIRDIE-7 `REWORK` gate remains fully applicable until a hardened mapper is integrated and re-tested.

## 3. Candidate C.1 recovered-host R2 SAFE audit

Observed Drive candidate:

`BirdieWorld_Canyon_v3_Candidate_C1_RecoveredHost_R2_SAFE.zip`

Declared ZIP SHA-256:

`12880303e9e6ba0271fac87640caaeb20fc81e59b266b444ca373380a67da67c`

Positive findings:

- starts from BIRDIE-5 R2 SAFE lineage;
- original recovered host geometry retained: `y={x:512,y:1365}, b={x:520,y:195}`;
- unsafe prior re-registration absent;
- engine remains byte-identical (`ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`);
- R2 passive post-resolve Canyon callback remains exactly once.

Host-specific concerns:

1. current C.1 recovered-host proof uses mutable `window.__birdieSwingTimingOverride` before calling the existing `On()` resolver; this makes the inherited static `Exact visible capture` check fail in addition to the known baseline Result-accessibility failure;
2. during pointer Swing the recovered host remains in `PLAN` until Impact, so the old `TIMING` locks do not freeze aim/equipment/mode/restart. Without a context guard, a second input can mutate the ShotInput context during a gesture.

## 4. Local safer host-adapter proof

A local proof-only adapter was prepared; it is **not promoted and must not bypass the mapper REWORK gate**.

Safety shape:

- no `window.__birdieSwingTimingOverride`;
- `On(optionalSwingTiming)` always starts legacy timing from `meterValueRef.current`, and only an explicit finite Swing timing replaces that local value for the one call;
- the same existing `On(mappedTiming)` remains sole resolver path;
- context fingerprint covers hole, remaining, lie, stroke, club, ball, active actions, mode and aim;
- runtime captures context at pointer-down;
- changed context at Impact fails closed with zero resolve;
- manual match restart cancels the active Swing session first;
- R2 post-resolve presentation callback, engine and baseline host geometry remain unchanged.

Local proof results:

- syntax **54/54 PASS**
- Founder preflight **PASS**
- Canyon runtime **6/6 PASS**
- R2 bridge boundary **10/10 PASS**
- Swing/context boundary **22/22 PASS**
- inherited gameplay **32 PASS / 1 known baseline Result-accessibility FAIL**
- GameApp mirrors identical; engine byte identity PASS

Proof artifact in Drive:

`PROOF_ONLY__BirdieWorld_Canyon_v3_Candidate_C1_RecoveredHost_R4_SAFE_CONTEXT_GUARD.zip`

Drive ID `1LtfrCYW3e3JrYr9JOALueASIAL4MRR18`  
ZIP SHA-256 `72e3393d63ebbff3c6dc99f4da52b9558608dfa18e74127ce21f2c666b31427a`

## 5. Promotion order

Do not build or label a final combined integration candidate yet.

1. BIRDIE 6 implements mapper P1/P2/P5 and adds the exact BIRDIE-7 exploit vectors as regressions.
2. BIRDIE 7 reruns the same 15-gesture / cheese matrix and must lift `REWORK` on the hardened mapper.
3. Candidate C.1 UI/accessibility improvements are retained or re-applied to that hardened interaction candidate.
4. Host integration uses R2 presentation boundary plus a no-global, context-safe timing handoff.
5. BIRDIE 4 independently regresses the exact combined artifact.
6. Maintainable original Sites source and current live revision still must be recovered/verified before any Production patch or deployment.

## Current decision

- Master Candidate B / R2 presentation bridge: **separate presentation lane; independent QA still required**.
- BIRDIE SWING interaction idea: **KEEP**.
- Current BIRDIE SWING mapper: **REWORK / BLOCKED FOR INTEGRATION**.
- Candidate C.1 UI correction: **useful and compatible, but inherits mapper block**.
- C.1 recovered-host global-override implementation: **not preferred for promotion**.
- no-global + context-guard host shape: **proof only; reuse after mapper passes QA**.

No product branch, live system, engine, account, round, card, coin or reward state was changed.
