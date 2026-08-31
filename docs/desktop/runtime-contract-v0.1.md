# Birdie Desktop Runtime Contract v0.1

## Authority

`birdie-core` is the sole authority for visible Birdie PresenceState. Desktop, Voice and Presence publish facts or render snapshots; they do not set Birdie state directly.

## Canonical PresenceState

- IDLE
- SPEECH_DETECTED
- LISTENING
- THINKING
- SPEAKING
- WORKING
- SUCCESS
- ERROR
- OFFLINE

The Desktop Alpha actively emits IDLE, SPEECH_DETECTED, LISTENING, THINKING, SPEAKING, ERROR and OFFLINE. WORKING and SUCCESS remain reserved in the contract for the next milestone.

## Alpha state flow

Normal turn:

`IDLE -> SPEECH_DETECTED -> LISTENING -> THINKING -> SPEAKING -> IDLE`

Barge-in candidate:

`SPEAKING -> SPEECH_DETECTED`

Rejected candidate:

`SPEECH_DETECTED -> SPEAKING`

Accepted candidate:

`SPEECH_DETECTED -> LISTENING`

## Runtime invariants

1. State revisions increase only when the visible PresenceState changes.
2. Duplicate events are ignored by event_id.
3. Older producer sequences are ignored.
4. A stale event from an interrupted/completed/cancelled/failed turn cannot produce visible or audible state.
5. SPEAKING begins only from real output-started facts.
6. Voice activity alone never implies cloud transmission.
7. Surface state is independent of PresenceState.
8. Raw audio never travels as a control event.

## Snapshot

Reconnectable clients consume a runtime snapshot containing lifecycle, canonical presence state, revision, reason and the active turn descriptor.

## Ownership

- Desktop: Windows lifecycle, tray, autostart, windows/surfaces
- Voice: microphone, VAD, activation, AEC, STT, TTS playback
- Presence: rendering and motion
- Core Runtime: turns, cancellation, presence projection, routing and snapshots
