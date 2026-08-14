# Provider Evidence V1

TASK-038A adds a read-only evidence boundary in front of the existing Instagram identity resolver.

## Endpoint

`POST /community/identity/evidence`

Use either `Authorization: Bearer <BIRDIE_AGENT_API_KEY>` or
`X-Birdie-Agent-Key: <BIRDIE_AGENT_API_KEY>`.

The endpoint reads the exact work item and `BIRDIE_PROFILES`. It never calls
`updateCommunityIdentityResolution` and performs no write.

## Raw request contract

```json
{
  "workItemId": "WORK-...",
  "providerIdentity": {
    "provider": "INSTAGRAM",
    "providerUserId": "optional raw stable provider ID",
    "username": "optional raw provider username",
    "verifiedEmail": "optional provider-verified email",
    "emailVerified": true,
    "sourceEventId": "optional raw event ID",
    "observedAt": "optional ISO-8601 timestamp"
  }
}
```

Zapier may map only fields proven to exist in the raw Instagram trigger/API
payload. Missing fields must be omitted. It must not provide `confidence`,
`explicitLink`, `conflictingEvidence`, candidates, or a candidate Birdie ID.

## Deterministic scoring

Only ACTIVE profiles participate.

- Stable Instagram provider ID exact match: 100
- Provider-verified email exact match: 90
- Normalized Instagram handle exact match: 60
- No attributable signal: 0

Candidate ordering is score-descending and then Birdie-ID ascending. Equal
winning scores, cross-signal candidates, or a stable-ID contradiction produce a
conflict. A handle-only match cannot auto-resolve.

## Canonical exact-link path

Before consuming provider evidence, the resolve route reads the target work item
and `BIRDIE_PROFILES` from BirdieOS. If exactly one `ACTIVE` profile has an
`instagramHandle` that exactly matches the normalized work-item
`externalUserId`, the existing `AUTO_EXACT_LINK` path may resolve it. BirdieOS
re-checks the same unique exact match before accepting the resolver write.

This exception trusts only the canonical work item plus the governed profile
link. A caller-supplied provider username by itself remains 60-point evidence
and cannot auto-resolve. If valid signed provider evidence identifies a
different profile or is itself conflicting, the resolver stays pending for
Founder review instead of allowing either signal to override the other.

## Integrity and resolver handoff

The evidence response contains an `integrityToken`. Outside the canonical
exact-link path above, `POST /community/identity/resolve` accepts only the
complete signed evidence object returned by the evidence endpoint. Any changed,
unsigned, or caller-authored derived evidence is rejected before a BirdieOS
write can occur.

## Activation gate

The Zap stays OFF/DRAFT until the real Instagram source fields are verified,
the approved mappings contain no literals/placeholders, the dry run passes in
the target runtime, and deployment is separately approved.
