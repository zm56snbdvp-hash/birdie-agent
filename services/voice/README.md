# Birdie Voice Host v0.3

Native, local-first foundation for Birdie Desktop Alpha voice input and addressability.

## Current vertical slice

- C++20 headless Voice Host
- Windows WASAPI shared-mode capture at 16 kHz mono float
- RAM-only circular pre-roll buffer
- adaptive energy-VAD baseline behind a replaceable boundary
- strict separation of speech activity, addressability decision and utterance endpointing
- replaceable local `IGateStt` interface
- fail-closed `UnavailableGateStt` default provider
- optional in-process `whisper.cpp` Gate-STT provider
- reviewed and pinned `whisper.cpp` source revision
- bounded asynchronous Gate-STT worker outside the WASAPI callback
- deterministic transcript- and acoustic-evidence pipeline
- explicit `ACCEPT`, `REJECT` and `ABSTAIN` lifecycle
- stale-result protection through Activity-IDs
- maximum 30 Hz normalized input-level events
- real WASAPI mute/restart control through Birdie Core
- output-aware speech candidates for later production Barge-in
- deterministic Windows CI for both the fallback and native Whisper builds

The energy VAD is an engineering baseline, **not** the production Silero model. The local Gate-STT backend is integrated, but model weights remain an explicit local setup step and are never committed to the repository.

## Fastest real Windows test

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -GateSttProvider WhisperCpp `
  -SetupWhisperCpp `
  -GateSttModelName base `
  -GateSttLanguage de
```

This command:

1. checks out the reviewed `whisper.cpp` commit `978113305b2ead22249b881deafa131dc8884911`;
2. downloads the multilingual `base` model from the official whisper.cpp model location;
3. verifies the model against the SHA-1 published by the pinned whisper.cpp source tree;
4. builds Birdie Voice with `BIRDIE_WITH_WHISPER_CPP=ON`;
5. starts Birdie Desktop, Core and Voice together.

The default model is `base` because it is multilingual and small enough for the first Gate-STT test. `small` is available as a later accuracy benchmark but is substantially larger.

## Manual setup

Source and model can also be prepared separately:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\setup-birdie-whisper-cpp.ps1 `
  -Model base
```

Default local paths:

```text
third_party/whisper.cpp
models/whisper/ggml-base.bin
```

Both paths are ignored by Git. The helper refuses a dirty source checkout, a non-official origin, an unexpected source revision or a model hash mismatch.

## Fail-closed mode

Without a configured local decoder, qualifying speech follows:

```text
Speech Candidate
→ Gate-STT UNAVAILABLE
→ ABSTAIN
→ buffered candidate audio cleared
→ no Birdie turn
```

This remains the default when `GateSttProvider` is not explicitly set to `WhisperCpp`. The Voice Host never pretends it understood speech because a model is missing.

## Development-only auto-accept

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -DevelopmentAutoAccept
```

`DevelopmentAutoAccept` deliberately treats qualifying speech as addressed to Birdie only to exercise the downstream Presence and capture path. It cannot be combined with the real Whisper provider and is invalid for privacy, DDSD, false-accept, wake-word or release testing.

## Addressability pipeline

For triggerless candidates:

```text
WASAPI
→ VAD
→ bounded GateSttRequest
→ one-slot worker
→ local IGateStt
→ transcript + acoustic evidence
→ RuleBasedAddressabilityGate
→ ACCEPT / REJECT / ABSTAIN
→ VoiceHost lifecycle event
```

An explicit activation such as click, hotkey or a future verified wake word is a separate evidence source. Merely transcribing the words “Hey Birdie” is not treated as a trusted wake-word detection.

## Privacy invariants

- no disk audio writes
- no network calls from the Voice Host during inference
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
- model absence, load failure or inference failure maps to fail-closed behavior
- the event sink emits operational metadata, never PCM or Gate transcripts

## Build and test

Fallback build:

```powershell
cmake -S services/voice -B build/voice -A x64 -DGGML_NATIVE=OFF
cmake --build build/voice --config Release --parallel
ctest --test-dir build/voice -C Release --output-on-failure
```

Native Whisper build:

```powershell
cmake -S services/voice -B build/voice -A x64 `
  -DBIRDIE_WITH_WHISPER_CPP=ON `
  "-DBIRDIE_WHISPER_CPP_SOURCE_DIR=$PWD\third_party\whisper.cpp" `
  -DGGML_NATIVE=OFF
cmake --build build/voice --config Release --parallel
ctest --test-dir build/voice -C Release --output-on-failure
```

## Remaining product gaps

The following are deliberately not claimed as complete:

- measured German false-accept and false-reject calibration on Kevin’s target PC
- commercial “Hey Birdie” wake-word model
- media/loopback correlation
- overlap and multi-speaker detection
- optional speaker verification
- structured follow-up context from Birdie Core
- full accepted-turn Brain/STT/TTS loop
- production AEC and full-duplex barge-in
