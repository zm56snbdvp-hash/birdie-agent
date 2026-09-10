# BIRDIE 5 — Round 6: recovered-host R2 SAFE patch manifest

Status: **NOT APPLIED / RECOVERED HOST ONLY / NO PRODUCTION AUTHORITY**

## Exact target

Historical recovered Founder-v5.4 host only. Both mirrored files are target-equivalent:

- `build/assets/game-app-D-PPPVPB.js`
- `build/game-app-D-PPPVPB.js`

Baseline SHA-256: `5e20cd816850ab60fc6a66ac9eaeac77963f1de764bed63fe0921a4660e964b2` (64769 bytes)  
R2 SHA-256: `58ef56b562407cb685800044b4acd67fd7c7ce7a121d99f108f425c7215bb3b6` (64928 bytes)

## Exact mutation

The R2 file equals the baseline file byte-for-byte except for **one 159-byte insertion**. No replacement or deletion is required.

Insert immediately before this unique existing anchor:

```js
if(wt(t),Tt({club:z.name,from:m,cards:a,mode:k,aim:U.lateral,targetDistance:U.distance,start:s,target:j,flightEnd:l,end:u,curve:V?.curve,output:t}),bt(u),Te(r),pe(t.remaining),we(t.lie)
```

Insert exactly:

```js
window.__birdieCanyonRuntime?.play?.({holeId:R.id,holeDistance:R.distance,remainingBefore:c,from:m,putt:z.kind===`PUTTER`,start:s,flightEnd:l,end:u,result:t});
```

The insertion is after the existing engine result + PICK-UP normalization and after `start`, `flightEnd`, `end` coordinates are computed, but before `wt(t)`, `Tt(...)`, `bt(u)`, stroke, remaining and lie state commits.

## New passive runtime

`build/assets/birdie-canyon-runtime.mjs` SHA-256: `812cd459ee3de2ce3e46d4727b8274a83245b53bd238ecf021337a9713a331a3`. It is presentation-only and must not call the shot engine or mutate score/remaining/lie/cards/coins/rewards/persistence.

## Fail-closed application conditions

1. Reject if the target bundle SHA-256 is not `5e20cd816850ab60fc6a66ac9eaeac77963f1de764bed63fe0921a4660e964b2`.
2. Reject if the anchor occurs other than exactly once.
3. Do not change the recovered host tee/cup geometry constants.
4. Do not change `game-engine-BHNViZ1-.js`.
5. Do not apply this manifest to current Production or any unknown live revision.
6. The PLAN timing-50 preview is not an accepted shot and must not invoke this bridge.

## Validation already executed on R2 SAFE

- JS/MJS syntax: 50/50 PASS
- Founder preflight: PASS
- Canyon runtime: 6/6 PASS
- Bridge boundary: 10/10 PASS
- Recovered gameplay: 32 PASS / 1 pre-existing `Result accessibility` FAIL
- Untouched Founder-v5.4 baseline reproduces the same 32/1 gameplay result

This manifest exists to make the recovered-host proof reproducible. It is **not** a maintainable-source patch and is not a deployment instruction. The readable original Next/Vinext/Codex-Sites source remains unproven.
