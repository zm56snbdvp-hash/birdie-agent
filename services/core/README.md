# Birdie Core Runtime (Alpha)

Local deterministic runtime for the Birdie Desktop Alpha.

Responsibilities in this slice:
- canonical `PresenceState` projection
- monotonically increasing Presence revisions
- active-turn ownership
- stale/duplicate event rejection
- normal Voice turn lifecycle
- accepted/rejected barge-in isolation
- runtime snapshots for reconnecting clients
- role- and capability-gated local IPC

This service does not own microphone capture, rendering, or provider-specific AI logic.

## Alpha flow

```text
IDLE
→ SPEECH_DETECTED
→ LISTENING
→ THINKING
→ SPEAKING
→ IDLE
```

Barge-in candidate:

```text
SPEAKING → SPEECH_DETECTED
```

Rejected activation returns to the same `SPEAKING` output. Accepted activation assigns a new turn and prevents stale events from the interrupted turn from becoming visible or audible again.

## Local IPC contract

Windows control pipe:

```text
\\.\pipe\birdie.core.control.v1
```

Every connection must begin with `component.hello` and a compatible contract major. The Core does not send snapshots or accept events before the handshake is accepted.

| Role | May publish | May receive |
| --- | --- | --- |
| `desktop` | Runtime commands | Snapshots, Presence, realtime audio projections |
| `voice` | Voice lifecycle/privacy/level events | Voice control commands |
| `observer` | Nothing mutating | Snapshots, Presence, realtime audio projections |

Security invariants:

- unknown or incompatible roles are rejected;
- an unregistered socket receives `CONTRACT.HANDSHAKE_REQUIRED`;
- contract-major mismatch receives `CONTRACT.VERSION_MISMATCH`;
- observers cannot publish Voice events;
- Voice never receives Desktop snapshots or its own realtime projection;
- best-effort audio levels are not persisted and do not produce ACK traffic;
- microphone state changes only after `voice.privacy.changed` confirms the real Voice/WASAPI result.

## Run tests

```bash
cd services/core
npm test
```
