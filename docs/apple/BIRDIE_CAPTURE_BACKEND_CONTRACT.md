# Birdie Capture Backend Contract (`birdie.capture.v1`)

Status: **proposed, not enabled in the app**. Until this document is accepted by the backend owner, `LocalCaptureMockAdapter` remains the only adapter and no network request is made.

## Scope and invariants

The contract accepts a user-reviewed capture from the main iPhone app. The Share Extension only stages data in the App Group. A request is never an instruction to publish, contact a person, create a task, or send mail without a separate user confirmation.

Required invariants:

- Every submission has a stable `captureID` and `idempotencyKey` (`birdie.capture.v1.<uuid>`).
- The server must return the same result for the same key and payload digest. A reused key with a different digest is rejected with `409 capture_idempotency_conflict`.
- Local file paths, App Group paths, device identifiers, Watch tokens and raw credentials are never sent.
- `requiresUserReview` is always `true`; `originalPolicy` is either `derivedTextOnly` or explicitly user-selected `includeOriginals`.
- The server must not retain or process originals when `derivedTextOnly` is selected.

## Transport proposal

The production adapter should run only in `BirdiePhone` and use an authenticated background `URLSession` for large originals. The URL and auth scheme are deployment configuration, not source code constants.

```text
POST /v1/captures
Authorization: Bearer <short-lived user access token>
Idempotency-Key: birdie.capture.v1.<uuid>
Content-Type: application/json
```

The first request contains metadata and derived text. If originals are allowed, the server responds with an upload session and per-part URLs; the client uploads parts from the main app, then calls the completion endpoint. The Share Extension never performs this exchange.

## Request

```json
{
  "contract": "birdie.capture.v1",
  "captureID": "uuid",
  "idempotencyKey": "birdie.capture.v1.uuid",
  "createdAt": "2026-08-28T00:00:00Z",
  "source": "share|lens",
  "intent": "remember|summarize|prepareTask|sendToPC",
  "parts": [
    {
      "partID": "uuid",
      "kind": "text|url|image|pdf|file",
      "displayName": "receipt.pdf",
      "contentType": "application/pdf",
      "byteCount": 12345,
      "sha256": "hex-or-null",
      "uploadToken": "server-issued-or-null"
    }
  ],
  "derivedText": "optional OCR or user text",
  "suggestions": [],
  "requiresUserReview": true,
  "originalPolicy": "derivedTextOnly|includeOriginals",
  "pcTarget": null
}
```

`pcTarget` is null unless the user has selected a previously enrolled destination. It must be an opaque server-issued target ID; no email address, LAN address or device token is inferred by the client.

## Responses and retries

- `202 Accepted`: capture accepted; response contains `captureID`, `serverReceiptID` and processing state.
- `200 OK`: an idempotent replay of the completed request; response body is byte-for-byte equivalent in semantic fields.
- `401/403`: authentication or consent failure; do not retry automatically.
- `409 capture_idempotency_conflict`: permanent failure; surface a reviewable error.
- `413`: size policy violation; permanent failure.
- `429`, `408`, `5xx`: transient failure; preserve the local queue item and use existing capped backoff.

The server must expose an authenticated delete operation for a server receipt. Local deletion always happens first; remote deletion is a separate, explicit user action and must be retryable.

## Consent and retention

The main app must display the final preview and intent before submission. `includeOriginals` requires a second explicit confirmation and an active, unlocked scene. The backend must return its retention class and deletion deadline; the client displays both and never silently extends retention.

## Acceptance checklist

Before enabling a production adapter, backend and mobile owners must agree on:

1. Auth token audience, expiry and refresh behavior.
2. PC target enrollment and revocation semantics.
3. Upload session lifetime, part size and checksum verification.
4. Idempotency response equivalence and conflict details.
5. Retention/deletion guarantees for derived text, OCR suggestions and originals.
6. Audit events for user confirmation, submission, retry and deletion.

Until all six are approved, the mock adapter is the intended safe behavior.
