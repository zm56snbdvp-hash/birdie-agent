# Community Identity Resolver — Narrow Write Gate Rollout

Scope: one guarded non-production resolver E2E for `TASK-038` while keeping the global BirdieOS write gate closed.

## Hard boundaries

- Keep `BIRDIE_OS_WRITE_ENABLED` false/off.
- Do not activate Zapier.
- Do not write Coins, claims, rewards, profiles, ledgers, or unrelated queues.
- Do not merge `main` or deploy Birdie Agent Production.
- Permit only `updateCommunityIdentityResolution` for the exact scoped work item.

## Authoritative Apps Script integration

Add `birdie-os/community-write-gate.gs` to the authoritative BirdieOS Apps Script project.

In the existing **controlled-write branch** of the outer dispatcher — exactly where the current global-only `BIRDIE_OS_WRITE_ENABLED` check throws `WRITE_DISABLED` — replace only that write-gate check with:

```javascript
birdieAssertControlledWriteAllowed_(request);
```

Do not apply this assertion to read-only actions. The helper preserves the existing behavior when `BIRDIE_OS_WRITE_ENABLED=true`, but when the global gate is off it allows only the exact resolver exception described below.

## One-E2E Script Properties

Set only these non-secret Script Properties for the test:

```text
BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED=true
BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID=WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011
```

Do not change `BIRDIE_OS_WRITE_ENABLED`.

The gate additionally requires:

- action = `updateCommunityIdentityResolution`
- resolverVersion = `v1`
- idempotencyKey = `IDENTITY|WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011|v1`
- source = `Birdie Agent`

The existing community identity handler then enforces Instagram source, pending state, no prior match, validated resolver output, and writes only J:O and Q:T of the same eligible `COMMUNITY WORK QUEUE` row. Column P/sourceSnapshotKey remains untouched.

## Execute exactly once

Trigger `Community Identity Resolver E2E` with confirmation:

```text
RUN_IDENTITY_E2E
```

Expected target for the current no-match case:

- resolutionStatus = `IDENTITY_PENDING`
- matchedBirdieId = empty
- decision = `NO_PROFILE_MATCH`
- identityConfidence = `0`
- identityConflict = `false`
- identityDecisionMode = `FOUNDER_REVIEW_LOW_CONFIDENCE`

Require direct BirdieOS row readback after the run.

## Immediate restore

Immediately after the single run, regardless of pass/fail:

```text
BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED=false
```

Then verify a second write is not attempted. The target property may remain as inert scope metadata or be removed; it must not be treated as authorization while the enable property is false.

## Acceptance

TASK-038 E2E is accepted only when all are true:

1. global write gate stayed off;
2. narrow gate was scoped to the exact work item;
3. one resolver E2E ran;
4. target row readback matches the expected governed result;
5. no unrelated protected data changed;
6. narrow enable property was restored to false;
7. workflow returned to manual-only state.
