# Birdie Voice Host v0.2

Native, local-first foundation for Birdie Desktop Alpha voice input and addressability.

## Current vertical slice

- C++20 headless Voice Host
- Windows WASAPI shared-mode capture at 16 kHz mono float
- RAM-only circular pre-roll buffer
- adaptive energy-VAD baseline behind a replaceable boundary
- strict separation of speech activity, addressability decision and utterance endpointing
- replaceable local `IGateStt` interface
- fail-closed `UnavailableGateStt` default provider
- bounded asynchronous Gate-STT worker outside the WASAPI callback
- deterministic transcript- and acoustic-evidence pipeline
- explicit `ACCEPT`, `REJECT` and `ABSTAIN` lifecycle
- stale-result protection through Activity-IDs
- maximum 30 Hz normalized input-level events
- real WASAPI mute/restart control through Birdie Core
- output-aware speech candidates for later production Barge-in
- deterministic tests without microphone, cloud or model dependencies

The energy VAD is an engineering baseline, **not** the production Silero model. The Gate-STT boundary and Evidence Pipeline are implemented, but the default provider does not transcribe. Wake word, calibrated DDSD features, full local STT, TTS and production AEC remain separate concerns.

## Build

```powershell
cmake -S services/voice -B build/voice -G "Visual Studio 17 2022" -A x64
cmake --build build/voice --config Release
ctest --test-dir build/voice -C Release --output-on-failure
```

The test suite covers the Voice lifecycle, addressability policy, Gate-STT pipeline, asynchronous worker, pre-roll isolation, Core IPC and C++→Node process integration.

## Normal development capture

```powershell
build\voice\Release\birdie-voice-host.exe --mic
```

Without a configured local decoder, qualifying speech follows the fail-closed path:

```text
Speech Candidate
→ Gate-STT UNAVAILABLE
→ ABSTAIN
→ buffered candidate audio cleared
→ no Birdie turn
```

This is intentional. The Voice Host must never pretend it understood speech because a model is missing.

## Development-only auto-accept

```powershell
build\voice\Release\birdie-voice-host.exe --mic --dev-auto-accept
```

`--dev-auto-accept` must never be enabled in production builds. It deliberately treats qualifying speech as addressed to Birdie only to exercise the downstream capture/endpoint path.

The flag is not valid for privacy, DDSD, false-accept, wake-word or release testing.

## Addressability pipeline

For triggerless candidates:

```text
WASAPI
→ VAD
→ bounded GateSttRequest
→ one-slot worker
→ local IGateStt
→ local evidence extraction
→ RuleBasedAddressabilityGate
→ ACCEPT / REJECT / ABSTAIN
→ VoiceHost lifecycle event
```

An explicit activation such as click, hotkey or a future verified wake word may use `GateSttStatus::Bypassed`. Ordinary triggerless speech cannot use that route.

## Privacy invariants

- no disk audio writes
- no network calls in the Voice Host
- pre-roll exists only in process memory
- raw PCM never enters Birdie Core or Tauri
- Gate-STT runs outside the WASAPI callback
- Gate transcripts never leave the local Evidence Pipeline
- Gate transcripts are not logged or emitted as Runtime events
- Gate PCM and transcript buffers are overwritten before release
- reject, abstain, timeout or mute clears buffered audio
- an older pending Gate-STT job is wiped before a newer one replaces it
- stale asynchronous decisions cannot resolve a newer Activity-ID
- mute, capture failure and shutdown invalidate pending addressability work
- the event sink emits operational metadata, never PCM or Gate transcripts

## Production gaps

The following are deliberately not claimed as complete:

- an integrated, licensed local Gate-STT model
- commercial „Hey Birdie“ wake-word model
- media/loopback correlation
- overlap and multi-speaker detection
- optional speaker verification
- structured follow-up context from Birdie Core
- calibrated German real-world thresholds
- full accepted-turn Brain/STT/TTS loop
- production AEC and full-duplex barge-in
