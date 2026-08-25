# Birdie Voice Host v0.1

Native, local-first foundation for Birdie Desktop Alpha voice input.

## Current vertical slice

- C++20 headless voice host
- RAM-only circular pre-roll buffer
- adaptive energy-VAD baseline behind a replaceable boundary
- strict separation of `voice.activity.started`, activation accept/reject, and utterance endpointing
- maximum 30 Hz normalized input-level events
- privacy-safe mute/reject behavior that clears buffered audio
- output-aware speech candidates for the later Barge-in flow
- Windows WASAPI shared-mode capture at 16 kHz mono float
- deterministic tests without microphone or cloud dependencies

The energy VAD is an engineering baseline, **not** the production Silero model. The contract intentionally keeps VAD, wake word, DDSD/addressability, STT, and TTS as separate concerns. Silero/ONNX, WebRTC APM, wake-word inference, local gate-STT, Named-Pipe transport, and production AEC are subsequent slices.

## Build

```powershell
cmake -S services/voice -B build/voice -G "Visual Studio 17 2022" -A x64
cmake --build build/voice --config Release
ctest --test-dir build/voice -C Release --output-on-failure
```

## Development capture

```powershell
build\voice\Release\birdie-voice-host.exe --mic
```

By default, detected speech remains an activation candidate and is rejected on timeout because the wake-word/DDSD adapter is not yet connected. For a local development-only loop:

```powershell
build\voice\Release\birdie-voice-host.exe --mic --dev-auto-accept
```

`--dev-auto-accept` must never be enabled in production builds. It deliberately treats qualifying speech as addressed to Birdie only to exercise the downstream capture/endpoint path.

## Privacy invariants

- no disk audio writes
- no network calls
- pre-roll exists only in process memory
- reject, timeout, or mute zeroes and releases the pre-roll and active utterance buffers
- the event sink emits operational metadata, never PCM
