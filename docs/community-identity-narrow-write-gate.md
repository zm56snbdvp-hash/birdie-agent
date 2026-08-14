# Community Identity Resolver — Narrow Write Gate

Status: **BUILD VERIFIED / NOT DEPLOYED**

This design exists to validate the Community Identity Resolver without enabling the broader `BIRDIE_OS_WRITE_ENABLED` controlled-write surface.

## Security model

Keep the existing global property unchanged:

```text
BIRDIE_OS_WRITE_ENABLED=false
```

The narrow exception requires both of these Script Properties in the *same authoritative Apps Script project/deployment*:

```text
BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED=true
BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID=WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011
```

No secret value is added by this design.

The helper `birdieControlledWriteAllowed_(request)` permits a request while the global gate is closed only when all of the following are true:

1. `action === updateCommunityIdentityResolution`
2. `BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED === true`
3. `workItemId` exactly equals the configured Script Property target
4. `resolverVersion === v1`
5. `idempotencyKey === IDENTITY|<exact workItemId>|v1`
6. `source === Birdie Agent`

Any mismatch returns `false`; `birdieAssertControlledWriteAllowed_` raises `WRITE_DISABLED`.

The existing API-key authentication remains mandatory and occurs outside this helper.

## Authoritative Apps Script integration

The current authoritative outer POST dispatcher already parses/authenticates the request and enforces the global `BIRDIE_OS_WRITE_ENABLED` controlled-write gate before domain dispatch.

For a controlled deployment, add `birdie-os/community-write-gate.gs` to that Apps Script project and replace only the current global-write assertion with:

```javascript
birdieAssertControlledWriteAllowed_(request);
```

Do **not** remove or weaken `validateApiKey_` or any domain-level guards.

Do **not** change the protected `COMMUNITY SYNC QUEUE`, profile, Coin, claim, reward or redemption rules.

## Guarded E2E sequence

Before running:

- resolver Zap remains OFF/paused
- exact test work item is still `PENDING_IDENTITY`
- `matchedBirdieId` remains empty
- `BIRDIE_OS_WRITE_ENABLED` remains false
- set only the two narrow resolver properties above
- deploy the updated outer Apps Script version to the same Web App deployment used by the E2E URL

Then execute exactly one guarded E2E against:

```text
WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011
```

Expected no-profile-match result:

```text
resolutionStatus = IDENTITY_PENDING
matchedBirdieId = ""
decision = NO_PROFILE_MATCH
identityConfidence = 0
identityConflict = false
identityDecisionMode = FOUNDER_REVIEW_LOW_CONFIDENCE
```

## Immediate rollback / close

After the single E2E — whether it succeeds or fails — close the exception:

```text
BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED=false
```

and remove/clear:

```text
BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID
```

The global `BIRDIE_OS_WRITE_ENABLED` property must remain unchanged.

Re-read the exact work item and verify the resulting state before any Zap activation or later resolver promotion.

## Current branch evidence

Isolated branch: `test/community-identity-resolver-e2e`

- `birdie-os/community-write-gate.gs`
- `test/community-write-gate.test.mjs`
- workflow unit suite includes the write-gate tests
- no Production deployment or Script Property mutation is part of this branch change
