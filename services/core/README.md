# Birdie Core Runtime (Alpha)

Local deterministic runtime for the Birdie Desktop Alpha.

Responsibilities in this slice:
- canonical PresenceState projection
- monotonically increasing presence revisions
- active-turn ownership
- stale/duplicate event rejection
- normal voice turn lifecycle
- accepted/rejected barge-in isolation
- runtime snapshots for reconnecting clients

This service does not own microphone capture, rendering, or provider-specific AI logic.

## Alpha flow

`IDLE -> SPEECH_DETECTED -> LISTENING -> THINKING -> SPEAKING -> IDLE`

Barge-in candidate:

`SPEAKING -> SPEECH_DETECTED`

Rejected activation returns to the same `SPEAKING` output. Accepted activation assigns a new turn and prevents stale events from the interrupted turn from becoming visible or audible again.

## Run tests

```bash
cd services/core
npm test
```
