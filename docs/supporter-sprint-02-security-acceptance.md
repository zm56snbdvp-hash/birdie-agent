# Supporter Sprint 02 — Security & Acceptance Contract

## Outcome

Sprint 02 delivers a closed, mobile-first supporter pilot for already-created
Birdie IDs. A supporter can request a one-time login code, establish a secure
session, see only their own profile and ledger, submit an action claim, and
request an eligible reward.

Public self-registration, social automation, payments, leaderboards and admin
decisions are outside this slice. Keeping registration out of the login flow
prevents an unreviewed consent and account-recovery system from entering the
pilot by accident.

## Trust boundaries

| Boundary | Rule |
|---|---|
| Browser → supporter API | Uses a supporter session and CSRF protection; never receives `BIRDIE_AGENT_API_KEY` or `BIRDIE_OS_API_KEY`. |
| Supporter API → Coin service | The server derives `birdieId` from the session. It ignores or rejects caller-supplied account IDs and point amounts. |
| Admin/Agent → existing `/coin/*` API | Remains protected by `BIRDIE_AGENT_API_KEY` and is not called directly by browser code. |
| Auth mail → IONOS SMTP | Uses a fixed transactional template and the email stored on the matched Birdie profile. The browser cannot choose recipient, subject, sender or body. |
| Birdie OS | Remains authoritative for profile, ledger, claim and redemption data. Authentication records do not become a second balance source. |

The existing governed `/mail/send` route is not the correct primitive for a
login email: it requires founder confirmation and accepts general mail content.
Magic-code delivery needs a narrow internal function that can send only the
fixed login template to the address resolved from Birdie OS.

## Recommended public contract

| Method | Route | Authentication | Result |
|---|---|---|---|
| `POST` | `/supporter/api/auth/request-code` | Public, rate-limited | Always returns the same `202` response for known and unknown emails. |
| `POST` | `/supporter/api/auth/verify-code` | Public, rate-limited | Consumes one challenge and sets the session cookie. |
| `POST` | `/supporter/api/auth/logout` | Session + CSRF | Revokes the current session and clears the cookie. |
| `GET` | `/supporter/api/bootstrap` | Session | Own profile, balances, level, badges, ledger, config and eligible rewards. |
| `POST` | `/supporter/api/claims` | Session + CSRF | Creates a claim for the session profile. |
| `POST` | `/supporter/api/redemptions` | Session + CSRF | Reserves a reward for the session profile. |

There is deliberately no public route shaped like
`/supporter/api/profiles/{birdieId}`. Account selection by URL or request body
would create an avoidable cross-account access risk.

## Magic-code requirements

Use these pilot defaults unless runtime configuration deliberately makes them
stricter:

- code lifetime: 10 minutes;
- maximum verification attempts: 5;
- resend cooldown: 60 seconds;
- request limit: 5 per 15 minutes per normalized email and per IP bucket;
- one active challenge per account; a new code invalidates the previous code;
- successful verification consumes the challenge atomically;
- session lifetime: no more than 7 days.

Codes must come from a cryptographically secure random generator. Store only a
keyed hash of the code, bound to its challenge ID; never store the raw code in
Sheets, logs or API responses. Keep the hashing key in Secret Manager or a
Script Property, never in the repository. Challenge verification must run
under a lock so two concurrent requests cannot consume one code twice.

The request endpoint must return an indistinguishable response and similar
timing whether the normalized email exists or not. This prevents the endpoint
from becoming a directory of supporters.

Suggested challenge fields:

- `challengeId`
- `birdieId`
- `codeHash`
- `createdAt`
- `expiresAt`
- `attemptCount`
- `consumedAt`
- `requestBucketHash`

The audit trail may record a challenge ID, Birdie ID, result and timestamp. It
must not record the code, session token, full email address or SMTP password.

## Session requirements

Generate at least 256 random bits for an opaque session token and persist only
its keyed hash. Rotate the token on every successful login. The browser receives
it only as a cookie with all of these attributes:

```text
__Host-birdie_session=<opaque>; Secure; HttpOnly; SameSite=Strict; Path=/
```

Do not add a `Domain` attribute. Do not put the token, magic code or an API key
in `localStorage`, `sessionStorage`, a URL, analytics or client logs.

Every authenticated request resolves the session server-side and obtains its
`birdieId` there. Expired, revoked or unknown sessions return `401` without
profile data. Logout revokes the stored session before clearing the cookie.

State-changing routes require a session-bound CSRF token in a custom header and an exact
allowed-origin check. `SameSite=Strict` is useful defense in depth, but is not the
only write protection.

Suggested session fields:

- `sessionId`
- `tokenHash`
- `birdieId`
- `createdAt`
- `expiresAt`
- `lastSeenAt`
- `revokedAt`

## Authorization invariants

These rules are release blockers:

1. `/supporter/api/me*` never accepts a `birdieId` selector.
2. Claim creation injects the session's `birdieId` and rejects `amount` and
   `points` exactly as the internal Coin service does.
3. Redemption creation injects the session's `birdieId`; reward price and
   account eligibility come from Birdie OS.
4. Supporters cannot call claim decisions, badge awards, opening-balance
   migration, the admin queue or redemption decisions.
5. Existing `/coin/*`, `/mail/*`, task and idea routes remain behind the agent
   API key.
6. Public-wall visibility stays opt-in and is unrelated to login eligibility.

## HTTP and browser hardening

- Auth and supporter API responses use `Cache-Control: no-store`.
- Enforce a small JSON body limit and reject invalid content types.
- Apply `Content-Security-Policy`, including `default-src 'self'`,
  `frame-ancestors 'none'` and a narrow `connect-src`.
- Send `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and an
  appropriate `Permissions-Policy`.
- Escape all profile, reward and ledger strings before inserting them into the
  page; prefer `textContent` over HTML interpolation.
- Return generic public errors. Internal logs use stable error codes and redact
  secrets and personal data.
- The production origin is HTTPS-only. Development-only cookie relaxation must
  be explicit and unavailable in production.

## Required automated acceptance cases

### Authentication

- known and unknown emails receive the same status and public response;
- a code is absent from response bodies and captured logs;
- wrong codes increment attempts and the sixth attempt cannot succeed;
- expired, consumed and superseded challenges are rejected;
- concurrent verification of one code creates exactly one session;
- a successful login rotates the session token;
- logout revokes the session and clears the cookie;
- rate limits apply separately to email and IP buckets.

### Authorization

- unauthenticated `/supporter/api/me` returns `401`;
- changing a body or URL to another `birdieId` cannot expose or mutate that
  account;
- a PRIVATE session sees only PRIVATE rewards;
- caller-supplied `amount`, `points` or reward price is rejected;
- supporter sessions cannot access any admin Coin route;
- missing or invalid CSRF token blocks every supporter write.

### Coin regression

- exact founding-score migration remains idempotent;
- a pending redemption reduces available, not confirmed, Birdies;
- approval moves the reservation into confirmed spend;
- cancellation restores the balance through a reversal;
- TASK-023 reads, mail routes and existing agent authentication continue to
  pass their contracts after the supporter router is mounted.

`test/coin-apps-script-contract.test.mjs` covers the first four Coin regression
cases against the actual Apps Script implementation with an in-memory Sheets
runtime.

## Manual mobile acceptance

Test at 320 px width and on an actual phone:

1. request code;
2. enter an incorrect code and recover without losing context;
3. sign in and see balance, lifetime Birdies, level and badges;
4. inspect the ledger without horizontal page overflow;
5. submit one claim with a stable idempotency key;
6. reserve one eligible digital reward and see the updated available balance;
7. reload the app and retain the valid session;
8. log out and verify browser Back cannot reveal cached private data.

## Pilot launch gate

Do not enable the closed pilot until:

- Kevin has confirmed each founding supporter's spelling, email address and
  exact opening score;
- public-wall opt-in is captured independently;
- SMTP delivery works without exposing the general mail-send capability;
- all automated acceptance cases are green;
- no production secret appears in source, HTML, logs or screenshots;
- a rollback consists of disabling supporter auth while leaving the existing
  Birdie Agent, Mail and Coin admin APIs operational.
