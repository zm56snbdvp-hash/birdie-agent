# Birdie Coin Sprint 01 — Deployment Guide

## Delivered

- Birdie ID profile creation and retrieval
- append-only, idempotent Coin Ledger
- claim submission and admin approval/rejection
- fixed and bounded-variable earning rules
- reward catalog and account-type filtering
- atomic reward reservation and balance checks
- redemption approval, rejection, cancellation and fulfillment
- founder-protected opening balance migration
- founder-protected Founding badges
- admin queue for pending claims and redemptions
- audit records for every sensitive mutation
- Cloud Run routes with request validation

## Birdie OS integration

Add `birdie-os/coin-system.gs` to the authoritative Apps Script project. In the existing request dispatcher, route Coin actions before the generic unknown-action response:

```javascript
if (String(request.action || "").indexOf("coin") === 0) {
  return handleBirdieCoinAction_(request);
}
```

If Birdie OS is not bound to the target spreadsheet, set the Script Property:

```text
BIRDIE_COIN_SPREADSHEET_ID=<spreadsheet id>
```

Run `setupBirdieCoinSystem_()` once in the Apps Script editor. It creates these tabs and seeds the six pilot rewards:

- `BIRDIE_PROFILES`
- `COIN_TRANSACTIONS`
- `ACTION_CLAIMS`
- `REWARDS`
- `REDEMPTIONS`
- `USER_BADGES`
- `AUDIT_EVENTS`

Deploy a new Apps Script Web App version, then deploy the Cloud Run branch.

## Cloud Run API

Every route requires the existing Birdie Agent API key.

| Method | Route | Purpose |
|---|---|---|
| GET | `/coin/config` | Pilot rules, levels and starting rewards |
| POST | `/coin/profiles` | Create Birdie ID profile |
| GET | `/coin/profiles/{birdieId}` | Profile, balances, level and badges |
| GET | `/coin/profiles/{birdieId}/ledger` | Full transaction history |
| POST | `/coin/profiles/{birdieId}/badges` | Award a controlled profile badge |
| POST | `/coin/claims` | Submit an action claim |
| POST | `/coin/claims/{claimId}/decision` | Approve or reject claim |
| GET | `/coin/rewards?accountType=PRIVATE` | Active rewards |
| GET | `/coin/admin/queue` | Pending claims and reward requests |
| POST | `/coin/redemptions` | Reserve a reward |
| POST | `/coin/redemptions/{id}/decision` | Approve, reject, fulfill or cancel |
| POST | `/coin/opening-balances` | Founder-approved legacy score migration |

All write requests require an `idempotencyKey`. Retrying the same request cannot create a second profile, claim, redemption or ledger entry.

## Security boundary

These endpoints are currently an internal Birdie Agent/Admin API. They are not yet a public Supporter login API. A public dashboard needs individual user authentication and authorization before it may call profile, ledger or redemption endpoints directly.

Supporters can never submit the number of Birdies they want. Fixed amounts come from the action catalog. Variable awards can only be selected by an admin within the configured minimum and maximum.

## Founding supporter migration

Create the six Birdie ID profiles first with `migrationProfile: true` and `founderApproved: true`. This suppresses the normal +1 registration Birdie so the historical score remains exact:

```json
{
  "displayName": "Lee-Ann",
  "email": "confirmed-address@example.com",
  "accountType": "PRIVATE",
  "migrationProfile": true,
  "founderApproved": true,
  "idempotencyKey": "profile:founding:lee-ann"
}
```

Then call `/coin/opening-balances` separately for each confirmed profile with:

```json
{
  "birdieId": "BIRDIE-...",
  "amount": 14,
  "sourceReference": "supporter-score-2026-08-10",
  "founderApproved": true,
  "idempotencyKey": "opening:BIRDIE-...:2026-08-10"
}
```

Do not run the migration until Kevin has confirmed the final supporter list, spelling and scores.

## Next sprint

Sprint 02 is implemented in service version 2.4.0: passwordless supporter authentication, the mobile Birdie ID dashboard, claim form and Reward Shop now sit on this internal backend contract. See [`supporter-sprint-02.md`](supporter-sprint-02.md) for the gated rollout.
