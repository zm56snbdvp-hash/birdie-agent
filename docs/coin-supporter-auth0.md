# Coin Supporter Auth0 activation

This runbook activates the authenticated supporter Coin API without exposing
`BIRDIE_AGENT_API_KEY` to a browser or trusting a client supplied Birdie ID.

## Existing identity provider

Birdie already uses the Auth0 tenant:

`https://dev-dfveukr86fg3e8fr.eu.auth0.com/`

Reuse that tenant for the supporter app.

## Required API settings

Create or select the Auth0 API used by BirdieWorld and set its identifier to
the Birdie Agent audience used by the client. The runtime value
`BIRDIE_APP_OAUTH_AUDIENCE` must exactly match that identifier.

Grant the API permission:

`birdie-world:access`

The client requests this permission when obtaining its access token.

## Birdie identity source

Each supporter Auth0 user must have this server-side app metadata:

```json
{
  "birdie_id": "BIRDIE-..."
}
```

Do not put the authoritative identity in `user_metadata`; users must not be
able to edit it themselves.

Install `auth0/actions/birdie-supporter-claims.js` as a Post Login Action. It
adds the namespaced access-token claim:

`https://birdieandbreakfast.de/birdie_id`

The action intentionally emits no claim when the account has not yet been
linked to a Birdie ID.

## Cloud Run runtime configuration

Set these values on the Birdie Agent runtime:

```text
BIRDIE_APP_OAUTH_ISSUER=https://dev-dfveukr86fg3e8fr.eu.auth0.com/
BIRDIE_APP_OAUTH_AUDIENCE=<exact Auth0 API identifier>
BIRDIE_APP_BIRDIE_ID_CLAIM=https://birdieandbreakfast.de/birdie_id
BIRDIE_APP_OAUTH_JWKS_URL=https://dev-dfveukr86fg3e8fr.eu.auth0.com/.well-known/jwks.json
```

The app auth layer remains disabled until the issuer, audience and Birdie-ID
claim values are present.

## Supporter endpoints

The authenticated app surface is:

```text
GET  /birdie-app/v1/coin/profile
GET  /birdie-app/v1/coin/ledger
GET  /birdie-app/v1/coin/rewards
POST /birdie-app/v1/coin/instagram
POST /birdie-app/v1/coin/claims
POST /birdie-app/v1/coin/redemptions
```

The Birdie ID is always taken from the verified bearer token. A body-supplied
Birdie ID is rejected. Founder/admin Coin endpoints remain outside this
supporter surface.

## Activation order

1. Configure the Auth0 API permission and audience.
2. Add the Post Login Action.
3. Store each supporter's authoritative `birdie_id` in Auth0 `app_metadata`.
4. Configure the four Birdie App runtime values on Cloud Run.
5. Merge/deploy `feat/coin-supporter-api-v1`.

No live-user or end-to-end test is part of this runbook.
