# Coin Supporter API v1 — Merge Handoff

Branch: `feat/coin-supporter-api-v1`
Target: `main`

Status: IMPLEMENTATION COMPLETE / AUTH0 ACTIVATION REQUIRED / NO LIVE TESTS

## Included
- Authenticated supporter-facing Coin routes under `/birdie-app/v1/coin/*`
- Birdie ID derived only from verified OAuth bearer token
- Client supplied `birdieId` rejected
- Founder/admin Coin routes remain outside supporter surface
- Auth0 Post Login Action source at `auth0/actions/birdie-supporter-claims.js`
- Auth0 activation runbook at `docs/coin-supporter-auth0.md`

## Required before production activation
- Auth0 API permission `birdie-world:access`
- Auth0 Post Login Action deployed
- authoritative `app_metadata.birdie_id` assigned to supporter accounts
- Cloud Run values:
  - `BIRDIE_APP_OAUTH_ISSUER`
  - `BIRDIE_APP_OAUTH_AUDIENCE`
  - `BIRDIE_APP_BIRDIE_ID_CLAIM`
  - `BIRDIE_APP_OAUTH_JWKS_URL

## Merge blocker
The connected GitHub credentials can write repository contents and branches but GitHub rejects Pull Request creation with:

`Resource not accessible by personal access token`

Do not bypass branch protection by force-updating `main`.

## Founder instruction
No further live-user, end-to-end, or experimental authentication tests are to be run unless explicitly re-authorized.
