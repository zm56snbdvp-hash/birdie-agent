# Birdie Voice Host v0.5

Native, local-first Voice Runtime for Birdie Desktop Alpha.

## Current vertical slice

- C++20 headless Voice Host
- Windows WASAPI shared-mode capture at 16 kHz mono float
- RAM-only circular pre-roll buffer
- adaptive energy-VAD baseline behind a replaceable boundary
- optional in-process `whisper.cpp` provider on a pinned reviewed revision
- separate bounded workers for Addressability and full accepted-turn transcription
- explicit `ACCEPT`, `REJECT` and `ABSTAIN` lifecycle
- stale-result protection through Activity- and Turn-IDs
- real WASAPI mute/restart control through Birdie Core
- content-classified `voice.utterance.finalized` events
- content-classified `voice.output.play` commands from Birdie Core
- bounded `TtsOutputWorker`
- optional Windows SAPI output using the installed system voice
- deterministic Voice, IPC, Conversation-STT and TTS tests
- native Windows CI for fallback and Whisper builds

The energy VAD is an engineering baseline, not the production Silero model. Windows SAPI is an integration voice, not Birdies final voice. Barge-in is deliberately disabled until an acoustic echo-cancellation reference path exists.

## Fastest complete local Windows test

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -FullVoiceDemo
```

The command prepares the reviewed Whisper source and verified multilingual `base` model, builds the native Voice Host and explicitly enables the deterministic Development-Brain plus Windows SAPI.

After Birdie reaches `IDLE`, say:

> Birdie, bist du da?

Expected flow:

```text
WASAPI
→ VAD
→ Gate-STT
→ ACCEPT
→ full local Conversation-STT
→ Birdie Core
→ deterministic Development-Brain
→ voice.output.play
→ Windows SAPI
→ voice.output.started
→ SPEAKING
→ voice.output.completed
→ IDLE
```

This verifies the complete local orchestration path but does not claim production AI quality or Birdies final voice.

## Reproducible Whisper setup

Source and model can be prepared separately:

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

The helper verifies official origin, reviewed commit and the model SHA published by the pinned whisper.cpp source tree. Both paths are ignored by Git.

## Fail-closed defaults

Without an explicitly configured local decoder:

```text
Speech Candidate
→ Gate-STT UNAVAILABLE
→ ABSTAIN
→ buffered candidate audio cleared
→ no Birdie turn
```

Without an explicitly configured Brain provider, no response text is generated. Without an explicitly configured TTS provider, no speech is attempted. Missing components therefore reduce capability instead of silently bypassing policy.

## Development-only auto-accept

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -DevelopmentAutoAccept
```

This deliberately accepts qualifying candidates only to exercise Presence and capture. It cannot be combined with the real Whisper provider and is invalid for privacy, DDSD, wake-word or release testing.

## Privacy invariants

- no temporary audio files
- no cloud request in the Voice Host
- pre-roll and utterance PCM exist only in process memory
- raw PCM never enters Birdie Core or Tauri
- Gate-STT and Conversation-STT run outside the WASAPI callback
- the short Gate transcript never leaves the local Addressability pipeline
- only an accepted full transcript may cross into Core, classified as `content`
- transcript content classified as `operational` is rejected
- Voice output text must remain `content` or `sensitive`
- audio and transcript buffers are overwritten before release where owned by the worker
- stale asynchronous decisions cannot resolve a newer Activity- or Turn-ID
- mute, capture failure and shutdown invalidate pending work
- the Voice publisher does not receive Desktop snapshots or its own realtime projection

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

- real Birdie AI provider instead of the deterministic Development-Brain
- Kevins final Birdie voice instead of Windows SAPI
- measured German false-accept and false-reject calibration on the target PC
- commercial dedicated “Hey Birdie” wake-word model
- media/loopback correlation
- overlap and multi-speaker detection
- optional speaker verification
- structured follow-up context from Birdie Core
- production AEC and full-duplex barge-in
- hardened packaging and installer release gate
