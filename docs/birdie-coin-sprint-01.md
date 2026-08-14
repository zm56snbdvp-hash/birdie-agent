# Birdie Coin Sprint 01 — Deployment Guide

## Delivered

- Birdie ID profile creation and retrieval
- narrow existing-profile Instagram handle linking
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
- dedicated, manually approved Instagram-comment +1 flow
- exact social-event/work-item identity binding
- ledger-before-`WRITTEN` ownership and idempotent reruns

## Birdie OS integration

Add the reviewed `birdie-os/coin-system.gs`,
`birdie-os/community-identity.gs`, and `birdie-os/social-coin-events.gs` to
the authoritative Apps Script project. In the existing request dispatcher,
route Coin actions before the generic unknown-action response:

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
| POST | `/coin/profiles/{birdieId}/instagram` | Link an owner-submitted handle to an existing ACTIVE profile |
| GET | `/coin/profiles/{birdieId}/ledger` | Full transaction history |
| POST | `/coin/profiles/{birdieId}/badges` | Award a controlled profile badge |
| POST | `/coin/claims` | Submit an action claim |
| POST | `/coin/claims/{claimId}/decision` | Approve or reject claim |
| GET | `/coin/rewards?accountType=PRIVATE` | Active rewards |
| GET | `/coin/admin/queue` | Pending claims and reward requests |
| POST | `/coin/redemptions` | Reserve a reward |
| POST | `/coin/redemptions/{id}/decision` | Approve, reject, fulfill or cancel |
| POST | `/coin/opening-balances` | Founder-approved legacy score migration |
| GET | `/coin/social-events/{eventId}` | Read one canonical social Coin event |
| POST | `/coin/social-events/{eventId}/instagram-comment/identity` | Bind one exact resolved work item |
| POST | `/coin/social-events/{eventId}/instagram-comment/claim` | Create the event-derived pending claim |
| POST | `/coin/social-events/{eventId}/instagram-comment/written` | Mark the event written after exact ledger proof |

All write requests require an `idempotencyKey`. Retrying the same request cannot create a second profile, claim, redemption or ledger entry.

The Instagram link action is identity state only. It writes only
`instagramHandle` and `updatedAt`, refuses an inactive target, an ACTIVE-profile
handle conflict, or replacement of a different existing handle, and creates no
Coin transaction or automatic `INSTAGRAM_VERIFIED` reward.

`IG_COMMENT` cannot use the generic claim route. Its dedicated flow derives
the action, Instagram source, exact text comment ID, +1 amount and idempotency
from the canonical social event. Identity, claim, approval and `WRITTEN`
transitions all require the exact linked work item and Birdie profile. See
`docs/task038-controlled-e2e.md` and `docs/task038-deploy-runbook.md` before
any provider deployment or live test.

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

Sprint 02 should add user authentication, the mobile supporter dashboard, the claim form and the admin review queue. The internal API built here is the backend contract for those screens.
