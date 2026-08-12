# Birdie App Round Mode V0 — Digital Sandbox

Status: **sandbox only**  
Branch: `feature/birdie-round-mode-v0`  
Source baseline: `feature/birdie-dna-v0`

## Purpose

Provide a hardware-neutral, production-isolated domain sandbox for Birdie App Round Mode before any scorecard UI, QR/NFC decision, physical-object pilot, deployment or Birdie Coin integration.

## Domain records

The sandbox models four requested record sets:

- `ROUNDS` — one digital round owned by one Birdie profile.
- `ROUND_HOLES` — ordered hole lifecycle records (`PENDING → ACTIVE → COMPLETED`).
- `OBJECT_PLAY_SESSIONS` — which Birdie object is in play during a round, including switches, loss and round end.
- `OBJECT_LOCATION_EVENTS` — privacy-governed last-seen/lost/found/note events.

`OBJECT_STATES` is an in-memory derived state projection used to test the object state machine. It is not a new production table or Source of Truth.

## State machine

Object state transitions are intentionally small:

- `RESTING → IN_PLAY` when selected for play.
- `IN_PLAY → RESTING` when switched out or the round ends.
- `IN_PLAY → LOST` when the active object is marked lost.
- `LOST → FOUND` when a lost object is found.
- `FOUND → IN_PLAY` when resumed.
- `FOUND → RESTING` is supported by the model for a future explicit rest action.

Invalid transitions fail closed.

## Rule versioning

Every persisted sandbox record carries `ruleVersion = round-mode-v0.1.0`.

The V0 service rejects unsupported rule versions rather than silently changing behavior. Future rules must be introduced as a new explicit version.

## Privacy contract

Location is private by default.

- A human-readable `locationLabel` may be stored without coordinates.
- Exact latitude/longitude require `exactLocationOptIn=true`.
- Exact coordinates are only accepted with `visibility=PRIVATE`.
- The complete journey simulator uses no exact coordinates.

This is a domain privacy invariant, not merely a UI preference.

## Explicit non-goals / safety boundaries

V0 does **not**:

- choose QR, NFC or any physical identity mechanism;
- create or modify a real Birdie DNA object;
- call BirdieOS production write APIs;
- write `COIN_TRANSACTIONS`, claims, rewards, badges or balances;
- merge to `main`;
- deploy a service;
- publish an app;
- claim real course/GPS data;
- implement the final scorecard UX (reserved for later tasks).

## Complete journey simulator

`simulateCompleteRoundModeJourney()` exercises a deterministic 3-hole sandbox journey:

1. Start round.
2. Activate hole 1 and put Ball A in play.
3. Store a private label-only last-seen event.
4. Switch to Ball B on hole 2.
5. Mark Ball B lost.
6. Mark Ball B found.
7. Resume Ball B.
8. Finish holes 2 and 3.
9. End round and verify the active object returns to `RESTING`.

The simulator reports invariants for round completion, no Coin side effects, hardware neutrality and absence of exact location by default.

## Acceptance

Run:

```bash
npm test
```

V0 acceptance requires all repository tests plus Round Mode tests to pass. The branch-specific GitHub Actions workflow must remain isolated from production deployment.
