# Birdie System Universe — Closed Cycle V1

## Scope

This release proves one narrow, reversible system loop:

`Instagram comment -> exact identity -> governed claim -> canonical ledger -> Coin Shop -> BirdieWorld -> deterministic Birdie response`

NEST, quests, multiplayer, GPS, free-form durable memory, follower deltas,
like deltas and automated public messaging are explicitly out of scope.

BirdieOS is the only operational and economic source of truth. The Coin Shop
and BirdieWorld are projections. They may never create, repair or reinterpret
Coin balances locally.

## Prepared source state

Birdie Agent `2.9.0` contains the signed Meta intake, exact Community row
creation, production BirdieWorld OAuth boundary, canonical-ledger adapter,
durable projection/outbox, lease/ACK API and explicit reconciler. The real
HTTP integration test crosses all of those boundaries. This is deployment-
ready source, not a claim that any provider or public client is already live.

The existing BirdieWorld visual branch remains the bounded sandbox. A future
production client adapter must use the authenticated V1 routes and preserve
response-ID render deduplication; it must not retrofit persistence into the
sandbox adapter.

## Immutable correlation contract

For one Meta comment ID `<commentId>` the producer derives, rather than
accepts from a caller:

| Record | Stable identifier |
| --- | --- |
| Community sync event | `SCE-IG-COMMENT-<commentId>` |
| Work item | `WORK-IG-COMMENT-<commentId>` |
| Social Coin event | `SCE-IG-COMMENT-<commentId>` |
| Source reference | exact numeric Meta comment ID |
| Social idempotency key | `ig:ig_comment:<normalizedHandle>:<commentId>` |
| Claim idempotency key | derived by the governed IG_COMMENT claim handler |
| Ledger event | `coin:<transactionId>` |
| BirdieWorld response | `birdie-response:<transactionId>` |

The producer writes the community event, work item and social event under one
Apps Script lock and returns canonical readback. A replay must return the same
three identifiers and must not append another row.

## State machine

1. `RECEIVED`: a signature-valid Meta webhook contains one real comment.
2. `IDENTITY_PENDING`: the three canonical intake rows exist, with no Birdie ID.
3. `IDENTITY_RESOLVED`: exactly one ACTIVE profile has the exact normalized
   handle. Every non-exact, absent or duplicate match remains Founder review.
4. `CLAIM_PENDING`: the dedicated handler derives an `IG_COMMENT`, one-Coin,
   manual-approval claim from the canonical event.
5. `LEDGER_COMMITTED`: the Founder approves the exact claim and BirdieOS proves
   exactly one APPROVED EARN transaction with the exact source reference.
6. `SHOP_PROJECTED`: the Coin Shop reads the canonical balance; local D1 is
   evidence/outbox only and never wallet authority.
7. `WORLD_PROJECTED`: one stable ledger event advances one persistent world
   projection and creates one deterministic response record.
8. `RESPONSE_ACKED`: the authenticated BirdieWorld client leases, renders and
   acknowledges that response ID.
9. `COMPLETE`: reconciliation finds no missing projection and a ten-run replay
   produces zero new claims, transactions, world deltas or responses.

## Exactly-once boundary

- Economics: one canonical claim and one canonical ledger transaction per
  source reference. Retries are idempotent and global source uniqueness is
  status-agnostic.
- BirdieWorld: one canonical projection application and one response row per
  ledger transaction.
- Browser: render is deduplicated by response ID and acknowledged. A networked
  UI cannot mathematically guarantee a single visual display across a crash
  before ACK; it can guarantee one canonical dispatch record and idempotent
  retry behavior.
- Recovery: a reconciler repairs ledger-written/projection-missing and
  pending/failed outbox states. No recovery path may mint an opening balance,
  duplicate a claim or mutate an existing ledger transaction.

## Activation gates

All preparation before these gates is source-only or read-only. Each gate is a
separate, auditable Founder decision.

One bounded exception may precede the provider gate: the governed Cloud Run
**Stage-A absent-bundle lane** may create a directly addressable tagged revision
at 0% default traffic solely to prove OIDC, registry, unchanged runtime/IAM
fingerprints, and fail-closed Meta/BirdieWorld-userauth absence. It evaluates no
Apps Script deployment, performs no authenticated application call, and does
not satisfy or reorder any activation gate. Its authoritative runbook is
`docs/github-oidc-cloud-run-no-traffic.md`.

1. **Identity gate:** choose one exact ACTIVE private `birdieId` and confirm
   ownership of its exact Instagram handle.
2. **Economy gate:** confirm `IG_COMMENT = +1 Birdie`, manual approval,
   per-distinct-comment. The catalog row stays DRAFT before this decision.
3. **Provider gate:** after any optional Stage-A infrastructure receipt, approve
   the in-place Apps Script deployment, then separately approve configured
   no-traffic Birdie Agent capability revisions, read-only verification and an
   explicit traffic switch.
4. **App-auth gate:** approve the BirdieWorld user-session issuer, audience and
   signed Birdie-ID claim/JWKS configuration. The server agent key is never
   exposed to a browser.
5. **Heartbeat gate:** approve the exact comment, profile, work item, event and
   claim IDs for one controlled run.
6. **Response gate:** approve any external Instagram reply separately. The
   first heartbeat requires only the private in-app deterministic response.

## Provider integration packet

### Apps Script modules and dispatcher

Deploy the reviewed Coin/identity modules together with:

- `birdie-os/community-meta.gs`
- `birdie-os/app-world-projection.gs`

After the existing API-key check, add only these exact dispatcher routes:

```javascript
case "appendCommunitySyncEvent":
  return handleMetaCommunityAction_(request);

case "worldProjectTransaction":
case "worldReconcileLedger":
case "worldListApprovedEarnEvents":
case "worldLeaseNextResponse":
case "worldLeaseResponses":
case "worldAckResponse":
  return handleBirdieWorldAuthorizedAction_(request);
```

Do not route a `world*` action directly to
`handleBirdieWorldProjectionAction_`; that lower-level handler deliberately
has no standalone network trust. Preserve the existing Script ID, deployment
ID, canonical URL, `BIRDIE_COIN_SPREADSHEET_ID`, manifest, permissions and all
unrelated files.

The authoritative `doPost` dispatcher is provider-owned and is not present in
this repository. Live cutover is therefore blocked until the provider receipt
contains the exported before/after dispatcher source, its SHA-256, the minimal
diff above, and proof that the existing API-key rejection runs before either
handler. A runbook snippet alone is not a deployment attestation.

Before enabling reconciliation, set one immutable Script Property:

```text
BIRDIE_WORLD_V1_CUTOVER_AT=<UTC timestamp after the historical-ledger preflight>
```

The cutover prevents historical approved earns, including opening-balance
imports, from creating new user notifications. Canonical world progress still
reads the full ledger. A missing cutover fails closed. Record its value in the
release receipt and never move it backwards.

### Birdie Agent runtime

Preserve all existing runtime configuration and add:

```text
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
META_INSTAGRAM_USERNAME
META_INSTAGRAM_ACCOUNT_ID
BIRDIE_APP_OAUTH_ISSUER
BIRDIE_APP_OAUTH_AUDIENCE
BIRDIE_APP_BIRDIE_ID_CLAIM
```

`BIRDIE_APP_OAUTH_JWKS_URL` is optional when the issuer's standard JWKS path
is correct. Every signed webhook entry must match the configured numeric
Instagram account ID before any BirdieOS write. The Meta access token is not
required for intake and must remain absent unless a separately approved
outbound-message release needs it. Deploy a no-traffic revision first. Verify
the webhook challenge,
signature rejection, disabled/valid app-auth behavior and authenticated
read-only world route before switching traffic.

### Meta subscription

Subscribe only the reviewed Instagram comment field to
`GET/POST /meta/webhook` after the no-traffic revision and Apps Script readback
both pass. Store the app secret and verify token only in the provider secret
store. Do not activate messaging or publish an automated reply.

### BirdieWorld client

The production client merge is a separate gate. It must obtain the configured
OAuth token, call only its own `/birdie-app/v1/*` scope, render a response once
per `responseId` in the active session and ACK with the exact `leaseId`. It may
not receive `BIRDIE_AGENT_API_KEY`, select a `birdieId`, or write a Coin amount.

### Coin Shop checkpoint

The Coin Shop source patch adds a founder-authenticated, same-origin,
two-click retry for known non-opening outbox events. It recovers only stale
non-opening leases by compare-and-set, requires an authoritative
`success === true` Agent envelope, and explicitly excludes both opening-balance
imports and the special pilot decision key. The existing canonical `+18`
approved adjustment and `-10` pending reservation are not recreated or
finalized by this retry.

Because a Sites checkpoint is a public production action, save/deploy that
version only after the separate Founder checkpoint gate. The source build and
tests do not authorize a public rollout.

## Controlled heartbeat

### Preflight

- Record the reviewed source SHA and provider deployment receipts.
- Record and verify the immutable BirdieWorld cutover timestamp.
- Require clean CI and syntax checks for every deployed Apps Script module.
- Read the exact profile, action rule, empty target source reference, current
  ledger, current Coin Shop balance and current world revision.
- Require a real provider event/work-item pair produced by the deployed Meta
  intake path. Never synthesize a live provider row.

### Execution

1. Receive one signature-valid real comment webhook.
2. Read back exactly one sync event, one work item and one social Coin event.
3. Resolve only the exact ACTIVE profile link.
4. Bind the resolved identity to the social event.
5. Create one pending governed claim.
6. Stop for the exact Founder claim approval.
7. Prove exactly one APPROVED ledger transaction and its resulting balance.
8. Read the same balance through the Coin Shop canonical-wallet path.
9. Reconcile the ledger event into one BirdieWorld projection and response.
10. Authenticate as the same Birdie, lease the response, render it and ACK it.

The first deterministic response is `+1 Birdie ist angekommen.` No model call
or external message is required.

### Replay proof

Run the same webhook and every downstream idempotent operation ten times.
Require:

- one intake triple;
- one resolved work item;
- one claim;
- one APPROVED ledger transaction;
- zero additional balance delta;
- one world revision increment;
- one response ID;
- no response after ACK;
- no cross-Birdie read or ACK access.

## Monitoring and stop conditions

Stop immediately on a signature error, non-numeric comment ID, mismatched
handle, duplicate ACTIVE handle, caller-supplied economy field, missing action
rule, more than one claim/transaction/projection/response, stale unresolved
lease, Coin Shop/BirdieOS balance mismatch, cross-user access, or failed
canonical readback.

Monitor at least:

- oldest PENDING community event and claim;
- failed/stale Coin Shop outbox count;
- ledger-to-world reconciliation lag;
- leased response age;
- duplicate/conflict exceptions;
- canonical balance versus Shop and World projections.

## Rollback

1. Set the exact action rule back to DRAFT and stop new intake processing.
2. Route Cloud Run traffic back to the recorded previous revision and restore
   the previous Apps Script deployment version in place.
3. Disable BirdieWorld live routes while preserving sandbox routes.
4. Preserve all event, claim, ledger, outbox, projection and audit rows.
5. Never edit or delete a committed ledger transaction. If a verified economic
   correction is necessary, use a separately approved compensating
   transaction with its own audit trail.
6. Reconcile read-only, document the exact partial state, and resume only from
   the same deterministic identifiers.

Never move `BIRDIE_WORLD_V1_CUTOVER_AT` backwards during rollback. Existing
projection/outbox rows remain audit evidence; disabling the app routes and
restoring provider revisions is sufficient to stop delivery.

## Go-live receipt

The cycle is live only when the receipt contains the source SHA, Apps Script
version/deployment ID, exported dispatcher SHA/diff and auth-order proof,
Cloud Run revision and traffic state, app-auth issuer,
exact input identifiers, pre/post ledger proof, Shop readback, world revision,
response ID/ACK, ten-run replay result, timestamps and operator. Secrets,
tokens and full provider payloads are never recorded.
