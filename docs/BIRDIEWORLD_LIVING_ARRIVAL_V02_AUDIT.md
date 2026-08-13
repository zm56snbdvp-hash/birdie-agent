# BirdieWorld Living Arrival V0.2 — Experience Audit and Bounded Pass

Status: implementation candidate on Draft PR #20

Audited rollback: `cd7c7b919698fd23a5dd6e32a359e400852367c8`

Baseline CI: `31741427705` — success

Baseline preview: <https://birdie-app-v1-neele-preview.vercel.app/>

Canonical work: `TASK-116` / `WS-BIRDIEWORLD-TRYHARD-V02-20260814`

## Evidence boundary

Neele's statement, “Dass es so familiär bleibt, wie es jetzt ist”, is a confirmed
qualitative product signal. It is neither a complete user study nor a release,
merge or production approval. This pass treats familiarity as an acceptance lens
and preserves contradictory evidence.

The live preview was reproduced in a 1363 × 936 cloud browser. WebGL was disabled
there, so the compatibility path and navigation were observed directly; the true
3D render was not. Exact 390 × 844 execution and real touch input were blocked on
that remote surface and must be verified in the implementation test pass.

## Evidence-classified audit

| Area | Type | Finding | Counterexample or limit |
| --- | --- | --- | --- |
| Emotional effect | Confirmed observation | Forest green, cream, gold, serif type, golden-hour motion and “Welcome home” already carry warmth. | The first view is dominated by a large hero and dialog, so it still reads as a polished developer demo. |
| Birdie as host | Confirmed observation | Birdie opens first, recommends one of exactly three places and remains reachable as a contextual launcher. | “I see where you are” can imply tracking before the boundary is explained. |
| First ten seconds | Confirmed observation | The CTA pair is understandable and content is stable by about three seconds. | Mixed German/English, Sandbox labels and contract vocabulary compete with the welcome. A blank immediate frame was seen once; no reliable FCP/LCP measurement was available. |
| Visual hierarchy | Product hypothesis | A compact welcome above a spatial world will make Birdie the relationship layer without obscuring the place. | A smaller card alone cannot prove familiarity; it may simply reduce explanation. |
| Navigation | Confirmed observation | Golf History, Ball Vault and Personal Birdie all open and each renders “Zurück zu Birdie”; return reopens a context-aware guide. | After destination choice, browser focus fell to `BODY`, leaving keyboard and screen-reader continuity incomplete. |
| Hotel / arrival / green / terrace | Confirmed observation | Source contains all four landmarks in the Three.js scene. | In compatibility mode they were only text associations over a generic gradient, so the place was not spatially legible. |
| Mobile / touch | Technical limitation | CSS stacks destination panels and supplies coarse-pointer controls. | Exact 390 × 844 interaction was not available in the cloud audit. Existing rules hid the Birdie illustration and reduced boundary copy to 7.5 px. |
| WebGL / fallback | Confirmed observation | Fallback kept Birdie and all destinations usable without a canvas. | Three.js emitted three expected context-creation errors before fallback. True WebGL remains unverified in the cloud environment. |
| Performance | Technical limitation | The generated JS/CSS artifacts are modest, while React and Three remain CDN imports. | Sandbox request timing is not a reliable production performance measurement; dynamic Three loading is outside this bounded pass. |
| Accessibility | Confirmed observation | Main heading, named dialog, labeled textarea, meaningful destination names, focus styles and reduced-motion support exist. | `lang="en"` mismatched German UI; movement keys were global; route focus was lost; 9 px low-contrast boundary text and sub-44 px controls were present. |
| Brand feeling | Product hypothesis | One German hospitality narrative and a spatial fallback can feel more like Birdie & Breakfast than a feature dashboard. | Warm language cannot substitute for supporter observation or founder acceptance. |

## Locked V0.2 pass

Living Arrival V0.2 is a presentation successor above the unchanged Arrival Loop
V0.1 and locked V1 data contracts.

1. Add a session-only `birdie-as-host-v0.2` journey with the ordered stages
   `noticed → welcomed → oriented → invited → return-to-birdie`.
2. Replace the mixed-language first view with one compact German welcome and make
   Birdie’s technical boundary secondary but still visible.
3. Preserve exactly `golf-history`, `ball-vault` and `personal-birdie`, the five
   coarse context zones and renderer-private coordinates.
4. Turn compatibility mode into a deliberate spatial 2D view of the hotel,
   arrival path, putting green, terrace and Birdie.
5. Preflight WebGL2 and construct Three with the verified canvas/context so a
   normal fallback does not generate expected Three.js errors.
6. Scope movement keys to the focused scene, label touch controls, preserve Birdie
   on mobile, restore route focus and announce arrival/return changes.
7. Express a quiet heartbeat using only current, transient coarse context. It is
   not a social feed and stores no personal data.

## Explicitly out of scope

No quests, spendable Birdie Coin, multiplayer, durable memory, real identity or
user data, voice/wake word, exact GPS, new permission/authority, canonical Coin or
profile ledger change, merge or main-production deployment.

## Verification contract

The candidate may receive an isolated review preview only after repository
contracts, TypeScript, production build, desktop browser, 390 × 844 mobile/touch,
fallback, all three destinations, return-to-Birdie, browser/console and basic
accessibility checks pass. If WebGL is unavailable, the fallback is verified and
the real 3D check remains explicitly open. Merge and main production require a
separate explicit Go from Kevin.

## Founder decisions retained

This pass does not decide a final release language, permanent opening behavior or
long-term recommendation policy. German, an initially open compact welcome and
coarse-zone recommendations are isolated V0.2 review hypotheses. Founder
acceptance is still required before merge or production.
