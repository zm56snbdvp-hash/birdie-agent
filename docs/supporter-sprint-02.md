# Birdie Coin Sprint 02 — Supporter Pilot Runbook

## Delivered

- mobile Supporter App at `/supporter`
- passwordless six-digit login codes
- fixed, non-general IONOS login-mail template
- HMAC-protected codes and opaque 256-bit session tokens
- revocable seven-day sessions persisted in Birdie OS
- exact-origin and session-bound CSRF protection
- own profile, balances, level, badges and Coin Ledger
- claim submission without client-controlled Birdie amounts
- account-scoped Reward Shop and reservation flow
- persistent rate/attempt controls plus Cloud Run IP throttling
- automated Coin, auth, router, mail and server regression coverage

## Birdie OS update

Replace the previous repository copy of `birdie-os/coin-system.gs` in the authoritative Apps Script project and keep the existing dispatcher rule:

```javascript
if (String(request.action || "").indexOf("coin") === 0) {
  return handleBirdieCoinAction_(request);
}
```

Run `setupBirdieCoinSystem_()` once and deploy a new Apps Script Web App version. The setup is idempotent. In addition to the Sprint 01 sheets it creates:

- `SUPPORTER_AUTH_CHALLENGES`
- `SUPPORTER_SESSIONS`

The sheets store HMAC hashes only. Raw login codes and raw session tokens must never appear in Sheets, logs or screenshots.

## Cloud Run configuration

Keep all existing Agent, Birdie OS and IONOS secrets. Add a separate random Supporter secret with at least 32 characters:

```text
SUPPORTER_AUTH_SECRET=<random secret from Secret Manager>
```

Do not reuse `BIRDIE_AGENT_API_KEY`, `BIRDIE_OS_API_KEY`, `OPENAI_API_KEY` or the mailbox password.

Deploy the service from this repository. `GET /` must then report version `2.4.0` and:

```json
{
  "supporterApp": "PILOT_READY"
}
```

`CONFIG_REQUIRED` is a safe disabled state: the existing Agent, Mail and internal Coin APIs remain operational, but no Supporter login can be created.

## Closed-pilot activation order

1. Confirm spelling, email address, account type and exact opening score for every founding supporter.
2. Create or migrate each Birdie ID through the founder-protected internal Coin API.
3. Apply the confirmed opening balance and Founding badges idempotently.
4. Deploy the updated Apps Script and run its setup once.
5. Configure `SUPPORTER_AUTH_SECRET` and deploy Cloud Run.
6. Open `/supporter` on a phone and complete one real login, claim and eligible reward reservation with a pilot account.
7. Confirm the admin queue receives the claim and redemption without exposing another profile.
8. Only then share the closed-pilot URL with the confirmed founding supporters.

Public self-registration remains intentionally disabled. A person needs an existing active Birdie ID before a login mail can be delivered.

## Security behavior

- A known and unknown email receive the same public `202` response shape.
- A new code supersedes the previous unconsumed code for that profile.
- Codes expire after 10 minutes and lock after five failed attempts.
- Requests are limited by profile in Birdie OS and by client-IP window in Cloud Run.
- Login delivery uses the email returned from the authoritative Birdie profile, never an arbitrary recipient supplied to a general mail endpoint.
- Session tokens exist only in a `Secure`, `HttpOnly`, `SameSite=Strict`, `__Host-` cookie.
- All supporter writes require exact same-origin validation and a session-bound CSRF token.
- Claim Birdie values, reward prices and account eligibility remain server-controlled.

## Rollback

Disable or remove only `SUPPORTER_AUTH_SECRET` from the Cloud Run revision and redeploy. Supporter login then fails closed with `CONFIG_REQUIRED`; the Chatty ↔ Birdie bridge, governed mail and internal Coin admin routes remain available. Existing supporter sessions remain as revocable records in Birdie OS and can be marked `REVOKED` if required.
