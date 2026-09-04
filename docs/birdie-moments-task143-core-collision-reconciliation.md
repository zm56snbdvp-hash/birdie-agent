# TASK-143 — Canonical Core Collision Reconciliation

Verified: 2026-09-04 Europe/Berlin

## STATUS

**INTERNAL RECONCILIATION: PASS**

**TASK-143 LIVE E2E: BLOCKED / UNPROVEN**

This receipt records the reconciliation between the Birdie Moments Live Integration workstream (TASK-143) and the canonical Birdie Moments Core/Print handoff (TASK-142).

The reconciliation does not claim that the authoritative ChatGPT Sites runtime has executed the real Founder-Delta end-to-end flow.

## Canonical source used

TASK-142 review package:

- artifact: `birdie-moments-task142-ready-to-review.zip`
- verified SHA-256: `87610345bebe2fa5b447efe283f8c38561ae07fc6370e361991ccc8c6ec27c2b`

TASK-143 integration branch:

- branch: `feature/birdie-moments-live-integration-e2e`
- reconciled code head before this documentation commit: `0d5768554794ee01c4b30ef752745ec84285392c`
- GitHub Actions run: `33856989211`
- result: **85/85 PASS, 0 FAIL**

## CHANGES

### 1. Failure schema / migration collision closed

TASK-143 previously carried `db/008_free_digital_moment_failures.sql`, which defined an incompatible `moment_failures` shape using `message` and `created_at`.

TASK-142 canonically owns `db/004_moment_telemetry.sql` with:

- `summary`
- `occurred_at`
- optional `purchase_id`
- optional `product_type`
- optional `fulfillment_type`

Reconciliation:

- canonical `db/004_moment_telemetry.sql` adopted;
- conflicting TASK-143 `db/008_free_digital_moment_failures.sql` removed;
- free-Digital D1 failure persistence now writes the canonical columns;
- failure summaries redact URLs, email addresses, secret-looking values and token-looking strings;
- migration repeat-safety is regression-tested.

### 2. Scorecard completion authority aligned

The live integration trigger now accepts only the exact persisted canonical state:

```js
persistedRound.status === "completed"
```

Boolean aliases such as `isCompleted=true` or `is_completed=true`, and case variants such as `COMPLETED`, cannot independently trigger Birdie Moments.

TASK-143 additionally preserves its server-side ownership guard:

```text
persisted round owner == authenticated server user
```

Any uncertainty or mismatch fails closed for Moments without invalidating an already successful Scorecard save.

### 3. Personal Best delta aligned

Canonical PB semantics are now:

```text
strokesImproved = previousBestScore - newBestScore
```

Example:

```text
86 → 82 = 4 strokesImproved
```

The previous negative `improvement=-4` convention is no longer emitted by the PB detector and is rejected by the renderer as legacy-invalid PB render input.

### 4. Private Preview boundary aligned

User-facing Reveal, Detail and Collection payloads no longer expose raw private preview asset references.

Server-side persistence may retain:

```text
private://moments/.../preview.svg
```

but the UI receives only:

```text
previewUrl
```

from the injected authorized preview gateway:

```js
assetGateway.getAuthorizedPreviewUrl({ momentId, previewAsset })
```

The gateway is invoked only after authentication, Moment ownership and linked source-round ownership have been verified.

Without a gateway, `previewUrl` remains null; the raw private reference is never substituted.

## TESTS

Final reconciled suite on Node 22:

- tests: **85**
- pass: **85**
- fail: **0**
- GitHub Actions run: `33856989211`

Dedicated collision regression coverage proves:

1. the conflicting `db/008_free_digital_moment_failures.sql` is absent and canonical `db/004_moment_telemetry.sql` is present;
2. boolean/case completion aliases cannot bypass exact `status === "completed"`;
3. PB delta is positive `strokesImproved` and exact;
4. Moment Detail never exposes the raw private preview ref;
5. Reveal and Collection use authorized `previewUrl` only;
6. foreign source-round ownership prevents the preview gateway from being invoked at all.

Existing coverage remains green for:

- D1 Moment idempotency;
- private Collection owner scoping;
- free owner Digital download with no purchase/entitlement lookup;
- logged-out, foreign-user and manipulated-ID denial;
- source-round ownership denial;
- deterministic rendering;
- render-failure isolation from Scorecard success;
- retained legacy commerce contracts.

## BLOCKERS

The TASK-142↔143 source collision is no longer an internal code blocker.

Remaining TASK-143 blockers are authoritative runtime boundaries only:

1. real BirdieWorld `POST /api/round` server implementation and exact post-commit hook;
2. real BirdieWorld round repository/history source (`roundSource`);
3. authoritative ChatGPT Site session → canonical BirdieWorld user resolver;
4. actual Sites D1 binding and migration execution/readback;
5. real app/router mounting for Reveal, Detail, Collection and free Download;
6. real private Preview gateway / Digital-master signer binding;
7. real browser/device Founder-Delta E2E and viewport QA after those bindings exist.

No Digital payment provider is required for Birdie Moments Digital v1.

## COLLISION CHECK

- TASK-142 Core semantics are now explicitly locked by TASK-143 regression tests.
- TASK-146 fulfillment/economics remains a separate workstream and was not changed.
- Print provider/order code was not changed by this reconciliation.
- Gameplay and card/deck workstreams were not touched.
- The older StoreKit/paid Digital live-integration branch was not merged wholesale.
- Retained legacy commerce remains available for future Birdie products but is not the Digital v1 access gate.

## NEXT

When the authoritative Sites runtime/source is accessible:

1. bind the real `/api/round` post-commit path;
2. bind the real `roundSource`;
3. bind the authoritative session resolver;
4. apply/read back the Moment migrations on the actual Sites D1 binding;
5. mount Reveal, Detail, Collection and free Download routes;
6. bind the real private preview gateway and Digital-master signer;
7. execute the full Founder-Delta live matrix and mobile viewport QA;
8. promote only actually executed cases from UNPROVEN to PASS.

Until then the correct overall TASK-143 state remains:

**BLOCKED / WAITING — COMPONENT RECONCILIATION PASS, LIVE E2E UNPROVEN.**
