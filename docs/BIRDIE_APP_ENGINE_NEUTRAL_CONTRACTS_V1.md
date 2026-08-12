# Birdie App V1 — Engine-Neutral Contracts

Status: **TASK-066 — architecture lock, sandbox only**

## Goal

Birdie App V1 uses React/TypeScript/Three.js as the first presentation client, but canonical Birdie identity, golf, object and companion state must remain independent from any rendering engine. A later Unity/C# client — including a future multiplayer client — must be able to consume the same versioned contracts without migrating canonical Birdie data.

## Boundary

The client owns presentation, local camera/input state, animation state and transient UI state only.

The governed Birdie app APIs own canonical identity, rounds, scorecards, object ownership/history, privacy-safe object projections, achievements and Personal Birdie authorization.

No Three.js-specific class, scene object, vector type or browser storage key may become a canonical domain identifier.

## Contract rules

1. All externally consumed payloads are JSON-serializable.
2. IDs are opaque strings and remain stable across clients.
3. Dates/times use ISO-8601 strings with explicit timezone/UTC semantics.
4. Enumerations use stable string values, never renderer-specific numeric ordinals.
5. Every public contract exposes an explicit `contractVersion`.
6. Unknown additive fields must be safely ignorable by clients.
7. Breaking changes require a new contract version or endpoint version.
8. Authoritative counters and state transitions are calculated/validated server-side.
9. Client retries for writes require idempotency keys.
10. Public projections never expose private telemetry by default.

## Core DTOs

### BirdieProfileDto

```json
{
  "contractVersion": "birdie-app-v1",
  "birdieId": "opaque-string",
  "displayName": "string",
  "golfProfile": {
    "homeClubRef": "opaque-string-or-null",
    "handicapDisplay": "string-or-null"
  },
  "avatar": {
    "presetId": "opaque-string",
    "cosmeticIds": ["opaque-string"]
  }
}
```

Avatar presentation assets are client-resolved from stable preset/cosmetic IDs. Canonical records never store Three.js mesh references, Unity prefab references or renderer object IDs.

### RoundSummaryDto

```json
{
  "contractVersion": "birdie-app-v1",
  "roundId": "opaque-string",
  "birdieId": "opaque-string",
  "courseRef": "opaque-string-or-null",
  "teeRef": "opaque-string-or-null",
  "holeCount": 18,
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601-or-null",
  "status": "ACTIVE|COMPLETED|ABANDONED",
  "totals": {
    "strokes": 0,
    "putts": 0,
    "penalties": 0,
    "scoredHoles": 0
  }
}
```

### RoundHoleDto

```json
{
  "contractVersion": "birdie-app-v1",
  "roundId": "opaque-string",
  "holeNumber": 1,
  "par": null,
  "strokes": 4,
  "putts": null,
  "penalties": null,
  "scoreRevision": 1,
  "completionState": "SCORED|UNSCORED"
}
```

V1 does not invent par/course/GPS facts when the source does not provide them.

### BallPassportDto

```json
{
  "contractVersion": "birdie-app-v1",
  "objectId": "opaque-string",
  "ownerBirdieId": "opaque-string",
  "editionId": "opaque-string-or-null",
  "rarity": "string-or-null",
  "state": "RESTING|IN_PLAY|LOST|FOUND|RELEASED_TO_FLOCK|CLAIM_PENDING|TRANSFERRED|RETIRED",
  "privacySafeStats": {
    "rounds": 0,
    "holesSurvived": 0,
    "courses": 0,
    "birdiesWitnessed": 0
  },
  "journey": []
}
```

### ObjectEventDto

```json
{
  "contractVersion": "birdie-app-v1",
  "eventId": "opaque-string",
  "objectId": "opaque-string",
  "eventType": "IN_PLAY|SWITCHED|LOST|FOUND|RELEASED|CLAIMED|TRANSFERRED|RETIRED",
  "occurredAt": "ISO-8601",
  "roundId": "opaque-string-or-null",
  "holeNumber": null,
  "privacyClass": "PRIVATE|COARSE|PUBLIC",
  "ruleVersion": "string"
}
```

Event history is append-only. Clients never rewrite prior ownership or journey facts.

### PersonalBirdieContextDto

```json
{
  "contractVersion": "birdie-app-v1",
  "birdieId": "opaque-string",
  "allowedDomains": [
    "PROFILE_SELF",
    "ROUNDS_SELF",
    "GOLF_STATS_SELF",
    "BALL_PASSPORTS_OWNED",
    "ACHIEVEMENTS_SELF",
    "PERSONAL_BIRDIE_MEMORY_SELF",
    "PUBLIC_BIRDIE_CONTENT"
  ]
}
```

Internal BirdieOS tasks, finance, suppliers, company mail, legal records, secrets, deployment controls and other users' private data are not representable as Personal Birdie tools.

## Event envelope

Future realtime and multiplayer transport may wrap domain events without changing the domain payload:

```json
{
  "contractVersion": "birdie-app-event-v1",
  "eventId": "opaque-string",
  "eventType": "string",
  "occurredAt": "ISO-8601",
  "actorBirdieId": "opaque-string-or-null",
  "entityId": "opaque-string",
  "entityVersion": 1,
  "payload": {}
}
```

This envelope may later travel over HTTP, WebSocket or a Unity networking layer. Transport is not part of canonical event meaning.

## Future multiplayer compatibility

Multiplayer is explicitly **not implemented in V1**, but the following constraints are locked now:

- one canonical `birdieId` per player identity;
- stable world/entity/object IDs independent from scene instances;
- authoritative shared-state mutations occur on a governed server/service, not by trusting a client;
- client movement/animation packets, if introduced later, are ephemeral and separate from durable Birdie business records;
- durable events such as ownership transfer, round completion and object journey events keep the existing audited/idempotent write model;
- Unity may map stable IDs to prefabs/GameObjects locally without storing Unity identifiers in canonical records.

## V1 adapter rule

The current React/Three.js vertical slice must consume a sandbox adapter that returns these DTO shapes. UI components may transform DTOs into view models, but must not reach directly into BirdieOS sheets or internal company APIs.

The next implementation gate is to locate/materialize the archived client workspace, introduce this sandbox adapter there, and wire Golf History to the already verified Round Mode semantics. Until that workspace is available in the repository/runtime, the architecture lock is complete but the client integration portion of TASK-066 remains open.

## Acceptance for TASK-066 architecture gate

PASS when:

1. these contracts are documented and reviewed against the verified Round Mode semantics;
2. the existing V1 client can be wired through a sandbox adapter using these shapes;
3. no canonical identifier depends on React, Three.js, browser DOM or Unity concepts;
4. future Unity/C# DTO generation/mapping is straightforward from the JSON contracts;
5. multiplayer remains a roadmap target only and adds no V1 runtime scope;
6. no Production data, Production deployment, external publication, QR/NFC choice or Coin side effect occurs.
