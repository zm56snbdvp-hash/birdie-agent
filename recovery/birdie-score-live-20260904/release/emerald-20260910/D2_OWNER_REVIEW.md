# D.2 owner review — consolidate, do not replace with another R4

2026-09-10. Developer/owner retest of the existing integrator's D.2. NOT independent B7/B4 approval and NOT production.

## Pinned existing inputs

D.2 ZIP SHA256: `61d7dd4e04945e7292a4db04e37d0a9834bec925752e8b5501a7c84ea5c05d12`.
D.2 HTML SHA256: `462f1489fe86c56ac555b1a44c0a5c65ee593c58fefa6d81405bd9f94fdcc16d`, 673257 bytes.
Input: https://drive.google.com/file/d/1NTb23t-rPGOHw-SRiO6pSNfIyNlsL7gL/view
Integrator handoff: https://drive.google.com/file/d/1RVMNN7jKwTzD7d5hh-GN9WLdoEYD4tdw/view

All 157 supplied file hashes verified. All 158 original extracted files unchanged. All 46 checked work-copy sources/assets/test/tool/configuration files unchanged after executions. Rebuild is byte-identical to the pinned D.2 HTML. Approved Emerald Pass06 remains unchanged. No new R4/D.3/E application built.

## Fresh actual executions

- Unchanged B2 consumer fault assertions on D.2: 21 PASS /0 FAIL /0 NOT TESTED.
- Unchanged prior R2 launch browser assertions on D.2: 49/49 PASS.
- Supplied D.2 integrator caller/impact/feedback assertions: 61/61 PASS.
- Supplied browser regression: 24/24 PASS; Reduced Motion: 6/6 PASS.
- Canyon/TS: 27/27; Swing/TS: 28/28; effects: 9/9.
- Original D.2 rebuild: exact HTML SHA above.

Nine process steps repeated from the completed portable delivery, all exit0, exact rebuild again. Initial portable attempt lacked the unchanged D.1 fixture imported by the preserved B7 dispatcher; dependency supplied, failed setup log preserved, no assertion weakened. The final B2/R2/integrator runs report no uncaught application errors or external HTTP(S) attempts. Suites overlap; no percentage of whole-app readiness inferred. The integrator's 61-case numeric comparison normalizes feedback/impactLineY; it is not an exact all-text parity test.

## R3/D.2 reconciliation

Of eleven shared TS/TSX modules, nine are identical, including engine, course-flight, art layout, base renderer, controller, mapper and impact helper. Differences are Cinematic fault integration and effects; preview templates also differ. D.2 includes extra context/abort guards. Do not copy the entire R3 template/Cinematic over it. B6 sampling, impactLineY and the two feedback strings are already present; no duplicate patches.

## One B2 owner delta still absent from D.2

D.2 deliberately retained its old `src/features/game/course-shot-effects.ts`. Its Cinematic error boundary preserves accepted results, but does not itself balance nested Canvas state if drawSwing throws.

This handoff supplies the exact already delivered B2 owner change: try/finally around the existing nested save/restore. Resulting module SHA256 `d057113ad2b25623ba85ec03e50bb3a613b32e8e944c183ac6b5a608e0d40113`. No new implementation/mapper/rule. Adjacent `B2_D2_SINGLE_FILE.patch` contains the actual one-file diff. It has NOT been applied to canonical D.2 or production. Optional safe wrapper is not needed for this single delta and is not claimed to be an integrated caller API.

Fresh recording-context test: 30/30 normal drawing traces identical. Across 356 injected operation faults, original D.2 leaves 22 unbalanced saved states; exact B2 delta leaves zero. Assumes save/restore themselves are operational, not pixel rollback or lost-context recovery.

Additional native Chromium Canvas test: 30/30 normal pixel/state comparisons identical. One native roundRect failure leaves original depth1 and changed alpha/composite; corrected module restores depth0 and caller state, propagating the same thrown error. This is a module comparison, not a newly built D.2-plus-delta app.

## Runnable safe handoff

`tools/prepare_b2_delta.py` validates sixteen pinned input files, its manifest and exact B2 module hash. Default is read-only; optional --out creates only a separate new delta tree and receipt. No source overwrite, no output overwrite, no symlink traversal, no install/network/deployment. Eight guard tests PASS.

`tools/run_d2_review.py --base-zip <original-D2.zip> --out <new-dir>` safely extracts the pinned archive, executes the above nine unchanged suites and checks exact output SHA. Tested from packaged paths. Node/TypeScript, Python/Playwright/Chromium required; no dependency installation performed.

## Confirmed delivery

Shared folder within the EXISTING D.2 review folder:
https://drive.google.com/drive/folders/1oh8JJwrDbG5uf-YkP2-AfuxfJFi3u6Jc

ZIP: https://drive.google.com/file/d/1U1trl9jvupnp446HrQxFH9eVP7jmwi-B/view
`BirdieWorld_D2_Uebernahme_und_Restpatch.zip`, 13627128 bytes,
SHA256 `8ec73aace0ee1c2f1c2388a09843505b4d31d496893f2269be454ee48ab101ec`.

Detailed report: https://drive.google.com/file/d/1azoL8Rf2eJQuhhJKOkS_5oOQZbrfhBd5/view

Sources/delta, portable tools, actual original/final logs, native/recording tests, screenshots and hashes included. No font files, production data or credentials. No new full application HTML offered as another competing release.

## Next gate

Existing integrator: keep D.2, review/stage only the B2 single-file fix, then rebuild with new source/build identities and obtain B7/B4 decisions on those exact bytes. Our owner contribution is not a substitute for their independent approval. Original web host/build/auth/deck/boosters/wallet/saved rounds, real devices/WebKit and rollback remain unproven.

Targeted connected-repo/Drive/Library search still did not expose the original web source. A PC filesystem/terminal connector has been suggested to Kevin but is not yet connected; no PC source was read. Initial authorized scope should be read-only inspection of the previously named web-project folder, not credentials, native/Unity projects, installs or deployment.

No merge, no deployment, no live data writes. Comments do not automatically execute other chats.
