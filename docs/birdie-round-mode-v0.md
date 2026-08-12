# Birdie App Round Mode V0 — Digital Sandbox

Status: **TASK-050 sandbox implementation**  
Branch: `feature/birdie-round-mode-v0`  
Source baseline: `feature/birdie-dna-v0`

## Purpose

Provide a hardware-neutral, production-isolated Birdie App Round Mode domain with a scorecard, Ball in Play/Lost Birdie lifecycle and privacy-safe last-seen projection before any app deployment, QR/NFC choice, physical-object pilot or Birdie Coin integration.

## Domain records

The sandbox keeps the four original record sets:

- `ROUNDS` — one digital round owned by one Birdie profile.
- `ROUND_HOLES` — ordered hole lifecycle and user-entered score records.
- `OBJECT_PLAY_SESSIONS` — which Birdie object is in play, including switches, loss and round end.
- `OBJECT_LOCATION_EVENTS` — privacy-governed last-seen/lost/found/note events.

`OBJECT_STATES` remains an in-memory derived projection for state-machine tests, not a production Source of Truth.

## Scorecard contract

Rule version: `round-mode-v0.2.0`.

Each hole may store:

- `strokes` — required when a score is entered;
- `putts` — optional, never inferred;
- `penalties` — optional, never inferred;
- `scoreRevision` — increments on a correction while the round remains active;
- `scoreSource = USER_ENTERED_SANDBOX`.

`getScorecard(roundId)` returns hole rows, scored/unscored counts and totals. It does not invent par, course metadata or GPS data. A `courseRef` is treated as a reference only and `gpsDataUsed` remains false.

## Ball in Play / Lost Birdie

The state machine remains explicit:

- `RESTING → IN_PLAY` when selected for play.
- `IN_PLAY → RESTING` when switched out or the round ends.
- `IN_PLAY → LOST` when the active object is marked lost.
- `LOST → FOUND` when a lost object is found.
- `FOUND → IN_PLAY` when resumed.

A round can have only one active object play session at a time. Mid-round switches close the previous session before selecting the next object.

## Privacy-safe Last Seen

Location remains private by default.

- Exact latitude/longitude require `exactLocationOptIn=true`.
- Exact coordinates are accepted only with `visibility=PRIVATE`.
- `getPrivacySafeLastSeen(objectId)` never returns coordinates.
- Private location labels are redacted from the privacy-safe projection.
- Approximate/public labels may be returned without coordinates.

This is enforced in the domain layer rather than left to UI behavior.

## Complete sandbox journey

`simulateCompleteRoundModeJourney()` exercises a deterministic three-hole journey:

1. Start round.
2. Put Ball A in play on hole 1 and enter a score.
3. Switch to Ball B on hole 2.
4. Mark Ball B lost, found and resumed.
5. Enter hole 2 score including a penalty.
6. Record an approximate last-seen label on hole 3.
7. Enter hole 3 score.
8. Build a complete scorecard.
9. Read privacy-safe Last Seen.
10. End the round and return the active object to `RESTING`.

Acceptance verifies score totals, revision behavior, optional putts/penalties, lost/found lifecycle, no Coin effects, hardware neutrality and no GPS/course-fact fabrication.

## Explicit safety boundaries

TASK-050 does **not**:

- choose QR, NFC or any physical identity mechanism;
- create or modify a real Birdie DNA object;
- call BirdieOS production write APIs from the sandbox code;
- write Birdie Coins, claims, rewards, badges or balances;
- fabricate real course, par or GPS data;
- decide PWA vs native app;
- merge to `main`;
- deploy a service or publish an app.

## Acceptance

Run:

```bash
npm test
```

Acceptance requires the full repository suite plus all Round Mode tests to pass on the branch-specific GitHub Actions workflow. Production merge/deploy remains a separate governed decision.
