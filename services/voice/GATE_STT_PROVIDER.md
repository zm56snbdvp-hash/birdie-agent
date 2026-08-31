# Birdie Local Gate-STT Provider Contract

## Purpose

Gate-STT answers only the low-cost local question needed before a Birdie turn may begin:

> What was probably said, in which language, and with what confidence?

It is not the full conversational transcription layer. Its output is consumed only by the local Addressability pipeline.

## C++ boundary

A provider implements:

```cpp
class IGateStt {
 public:
  virtual ~IGateStt() = default;
  virtual GateTranscript transcribe(const GateAudio& audio) = 0;
};
```

Input:

- one bounded `activity_id`-scoped candidate;
- mono PCM float samples;
- sample rate and channel count;
- local monotonic start/end timestamps.

Output:

- `FINAL` with text, language and confidence;
- `NO_SPEECH` when the candidate does not contain usable speech;
- `UNAVAILABLE` when no local model is ready;
- `FAILED` for a local inference failure.

## Mandatory privacy behavior

A production provider must:

- run on the local device;
- make no network request;
- create no temporary audio file;
- persist neither audio nor transcript;
- avoid logging transcript text;
- return one final bounded result;
- tolerate cancellation or stale `activity_id` results;
- treat model absence as `UNAVAILABLE`, never as an implicit ACCEPT.

The caller moves candidate audio into a bounded worker, executes inference outside the WASAPI callback, zeroes the worker audio immediately after inference, clears transcript text before returning the operational resolution and applies a result only if its `activity_id` still matches the active Voice candidate.

## Addressability mapping

| Gate-STT result | Addressability behavior |
| --- | --- |
| `UNAVAILABLE` | `ABSTAIN` |
| `FAILED` | `ABSTAIN` |
| empty `FINAL` | `ABSTAIN` |
| unsupported language | `ABSTAIN` |
| confidence below the local floor | `ABSTAIN` |
| `NO_SPEECH` | `REJECT` |
| valid `FINAL` | build local evidence, then `ACCEPT`, `REJECT` or `ABSTAIN` |

An explicit click, hotkey or future dedicated Wake-Word detector is a separate local evidence source. A transcript alone must not authorize a sensitive side effect.

## Provider integration checklist

Before replacing `UnavailableGateStt`, the provider adapter must add tests for:

- deterministic German and English fixtures;
- silence and non-speech;
- low-confidence output;
- model-not-loaded and inference exception;
- bounded memory and queue behavior;
- stale result rejection by `activity_id`;
- no transcript in operational worker results;
- no raw-audio persistence;
- false accepts from television, streams and overlapping speakers;
- latency distributions on the target Windows hardware.

## Current implementation

`UnavailableGateStt` is intentionally the default. Therefore the normal Alpha is fail-closed until a measured, locally licensed model adapter is explicitly wired. `--dev-auto-accept` bypasses this contract only for the marked visual integration loop and is not an Addressability implementation.
