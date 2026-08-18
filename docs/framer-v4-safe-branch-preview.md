# Framer V4 — Safe Branch Preview

## Objective

Provide a governed Framer write path that can create a reviewable preview without mutating `main` or deploying Production.

## Safety invariants

1. Legacy `POST /framer/preview` is disabled fail-closed.
2. Every executable V4 change starts from a fresh PLAN_ONLY result.
3. The execution request must carry the exact `baseHash` from that plan.
4. A deterministic `planHash` binds operation type, exact target identifiers, approved values and `baseHash`.
5. Founder confirmation must equal `APPLY_FRAMER_V4_BRANCH_PREVIEW:<planHash>`.
6. V4 refuses to write unless Framer branching APIs are present.
7. V4 must start from `main`, create a child branch, and verify that the child branch is active before mutation.
8. The target is re-read on the child branch and its state must still equal `baseHash` before mutation.
9. Only allowlisted operations exist in V1: one TextNode text update or one CMS item attribute update.
10. V4 performs an exact readback after mutation and fails if the approved value is not present.
11. `publish()` is called only after verifying the active branch is the isolated child branch.
12. V4 never calls `deploy()`.
13. V4 attempts to restore the editor to `main` after every branch operation.
14. Production deployment remains the separate legacy `/framer/deploy` Founder gate and is outside this V4 flow.

## Routes

- `GET /framer/v4/policy`
- `POST /framer/v4/site/text-plan`
- `POST /framer/v4/cms/plan`
- `POST /framer/v4/site/text-apply-preview`
- `POST /framer/v4/cms/apply-preview`

## Runtime compatibility

The implementation checks for `getActiveBranch`, `getBranch`, `createBranch`, and `publish` at runtime and refuses execution if the deployed Framer Server API runtime does not expose them. This is intentional fail-closed behavior.

## Production boundary

A branch preview is not authorization to merge the Framer branch into `main`, publish `main`, call `deploy()`, or otherwise change custom-domain Production state.
