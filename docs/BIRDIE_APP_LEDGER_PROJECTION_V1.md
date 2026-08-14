# BirdieWorld Ledger Projection V1

## Purpose and boundary

This contract adds an isolated production core beside the existing static
BirdieWorld sandbox. The production server adapter and routes are wired, but
the sandbox adapter, browser storage and client rendering remain unchanged.
The app routes stay fail-closed until the approved OAuth configuration is
present, and no provider deployment is performed by this source release.

BirdieOS remains the economic source of truth. BirdieWorld consumes only
canonical, already-approved ledger events and stores a projection plus a
response outbox record. It never awards, repairs or recalculates Coins.

## Canonical ledger input

`LedgerEventDto` has the following shape:

| Field | Rule |
| --- | --- |
| `transactionId` | stable canonical identifier |
| `birdieId` | stable canonical profile identifier |
| `amount` | positive safe integer |
| `transactionType` | exactly `EARN` |
| `actionCode` | uppercase canonical code |
| `sourceType` | uppercase canonical code |
| `sourceReference` | non-empty canonical source reference |
| `status` | exactly `APPROVED` |
| `approvedAt` | valid timestamp |
| `createdAt` | optional valid timestamp |

The core fails closed for pending, rejected, spend, adjustment, zero, negative,
fractional or malformed events. A production storage adapter must dereference
the transaction ID against BirdieOS instead of trusting a browser or webhook
payload as economic input.

The immutable derived identifiers are:

- projection event: `coin:<transactionId>`
- response: `birdie-response:<transactionId>`

## Deterministic projection

`projectApprovedEarnLedgerEvents` is a pure set projection. It normalizes each
event, scopes the set to one Birdie, deduplicates exact event replays by the
derived event ID and sorts IDs before calculating output. Therefore duplicate
or reordered delivery produces byte-equivalent progress:

```json
{
  "schemaVersion": "birdie-world-progress/v1",
  "birdieId": "BIRDIE-1",
  "revision": 1,
  "approvedEarnedBirdies": 1,
  "appliedEventIds": ["coin:TX-1"],
  "lastEventId": "coin:TX-1"
}
```

The revision is the count of distinct canonical ledger events, not a delivery
attempt counter. Reusing a transaction ID with different canonical data is a
hard conflict.

## Deterministic Birdie response

One eligible ledger transaction yields exactly one response object. It uses no
model call, prompt, randomness or current time. The first one-Coin response is
exactly:

`+1 Birdie ist angekommen.`

Amounts above one use `+<amount> Birdies sind angekommen.` The response also
carries the stable response ID, event ID, Birdie ID, amount and action code.

## Injected persistence adapter

`createBirdieAppService` requires an adapter with four asynchronous methods:

| Method | Required behavior |
| --- | --- |
| `applyLedgerProjection(input)` | Atomically insert one event and one READY response by their stable IDs. Exact replay returns `{ created: false }`; divergent replay fails. |
| `listApprovedEarnEvents({ birdieId })` | Return only canonical events for that exact Birdie. |
| `leaseNextResponse(input)` | Atomically lease at most one READY or expired response for that Birdie, or return `null`. |
| `ackResponse(input)` | ACK only the exact active lease; repeat of that same successful ACK is idempotent. |

`applyLedgerProjection` receives `{ eventId, responseId, event, response }` and
returns `{ created, event?, response? }`. If it returns the stored objects, the
service verifies they still match the canonical event and deterministic
response.

Lease input is
`{ birdieId, actorSubject, leaseRequestId, requestedAt, leaseSeconds }`. The
request ID is a cryptographically random, server-generated lease proof. The
BirdieOS adapter persists that exact value as `leaseId` together with the
server-generated start and expiry. A successful lease returns
`{ response, leaseId, leaseExpiresAt, leaseRequestId? }`, where `leaseId` is
the transport-neutral proof returned to the client. The core validates that
the returned expiry is in the future. ACK input is
`{ birdieId, actorSubject, responseId, leaseId, acknowledgedAt }` and returns
`{ acknowledged: true, idempotent, birdieId, responseId, acknowledgedAt? }`.

The adapter owns concurrency and durable uniqueness. For the BirdieOS Apps
Script adapter that means a `ScriptLock`, unique `eventId`/`responseId`
readback, transaction-ID lookup in `COIN_TRANSACTIONS`, and persistent
`WORLD_PROJECTIONS` plus `BIRDIE_RESPONSE_OUTBOX` rows. The core does not use an
in-process cache as authority. BirdieWorld progress reads the exact canonical
`coinGetLedger` result; projection and outbox reconciliation re-dereference
each transaction ID in `COIN_TRANSACTIONS` and accept no caller-supplied amount
or status. The required immutable Script Property
`BIRDIE_WORLD_V1_CUTOVER_AT` suppresses notification backfill for historical
approved earns while the progress view still includes the full canonical
ledger. A missing cutover fails closed.

## Service and HTTP integration

The isolated service exposes:

- `projectLedgerEvent(event)` for a trusted ledger reconciler only;
- `getWorld(authContext)`;
- `leaseNextResponse(authContext, body)`;
- `ackResponse(authContext, body)`.

The router reserves these authenticated client routes:

| Method | Route | Result |
| --- | --- | --- |
| `GET` | `/birdie-app/v1/world` | projected progress for the session Birdie |
| `POST` | `/birdie-app/v1/responses/lease` | one leased response or `null` |
| `POST` | `/birdie-app/v1/responses/{responseId}/ack` | idempotent ACK result |

`authenticateBirdie(req)` verifies an RS256 bearer token and returns the
server-verified `{ subject, birdieId, scopes }` context. It requires issuer,
audience, the `birdie-world:access` scope and a configured signed Birdie-ID
claim. The three values below are all required; if one is absent, the app API
returns `BIRDIE_APP_AUTH_NOT_CONFIGURED` and remains disabled:

- `BIRDIE_APP_OAUTH_ISSUER`
- `BIRDIE_APP_OAUTH_AUDIENCE`
- `BIRDIE_APP_BIRDIE_ID_CLAIM`

`BIRDIE_APP_OAUTH_JWKS_URL` is optional when the standard issuer JWKS path is
correct. Production issuer/JWKS URLs must use HTTPS. An Agent API key is not
accepted by these browser routes. A
client-supplied `birdieId` is rejected, and the authenticated subject is
preserved for lease/ACK audit ownership.

The Agent-authenticated admin route
`POST /admin/birdie-app/v1/reconcile` requires exact confirmation
`RECONCILE_BIRDIE_WORLD_V1`. It scans the canonical ledger idempotently and
repairs missing projections/outbox rows; it cannot write a Coin transaction.

After the existing Apps Script dispatcher validates the canonical BirdieOS API
key, every `world*` action must be routed through
`handleBirdieWorldAuthorizedAction_(request)`. The wrapper binds the action to
one allowed scope and to the exact in-process request object. Calling the
lower-level handler directly fails closed. The static sandbox continues under
its existing no-network/no-durable-memory contract until its separate client
merge and deployment gate is approved.

## Delivery guarantee

BirdieOS can guarantee one canonical response row and lease/ACK retries. The
client must deduplicate rendering by `responseId` and ACK only after display.
A browser crash after display but before ACK can cause a visual retry; no
network protocol can prove exactly one human-visible render across that crash.
