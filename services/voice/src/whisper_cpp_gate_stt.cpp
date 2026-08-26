#include "birdie/voice/whisper_cpp_gate_stt.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace birdie::voice {
namespace {

constexpr std::uint32_t kWhisperSampleRate = 16'000;

double unit(const double value, const double fallback = 0.0) noexcept {
  if (!std::isfinite(value)) return fallback;
  return std::clamp(value, 0.0, 1.0);
}

void wipe(std::string& value) noexcept {
  std::fill(value.begin(), value.end(), '\0');
  value.clear();
}

}  // namespace

WhisperCppGateStt::WhisperCppGateStt(
    WhisperCppGateSttConfig config,
    std::unique_ptr<IWhisperCppRuntime> runtime)
    : config_(std::move(config)), runtime_(std::move(runtime)) {
  if (!runtime_) {
    throw std::invalid_argument(
        "WhisperCppGateStt requires a runtime boundary");
  }
  if (config_.threads <= 0 || config_.maximum_tokens <= 0 ||
      config_.language.empty() ||
      !std::isfinite(config_.no_speech_threshold) ||
      config_.no_speech_threshold < 0.0 ||
      config_.no_speech_threshold > 1.0) {
    throw std::invalid_argument("invalid whisper.cpp Gate-STT config");
  }
}

GateSttResult WhisperCppGateStt::transcribe(
    const GateSttRequest& request) {
  GateSttResult result;
  result.model_id = model_id();

  if (request.samples.empty()) {
    result.status = GateSttStatus::NoSpeech;
    result.error_code = "VOICE.GATE_STT.EMPTY_AUDIO";
    return result;
  }
  if (request.sample_rate != kWhisperSampleRate || request.channels != 1) {
    result.status = GateSttStatus::Failed;
    result.error_code = "VOICE.GATE_STT.WHISPER_CPP_UNSUPPORTED_AUDIO";
    return result;
  }
  if (request.samples.size() >
      static_cast<std::size_t>(std::numeric_limits<int>::max())) {
    result.status = GateSttStatus::Failed;
    result.error_code = "VOICE.GATE_STT.WHISPER_CPP_AUDIO_TOO_LARGE";
    return result;
  }
  if (std::any_of(request.samples.begin(), request.samples.end(),
                  [](const float sample) {
                    return !std::isfinite(static_cast<double>(sample));
                  })) {
    result.status = GateSttStatus::Failed;
    result.error_code = "VOICE.GATE_STT.WHISPER_CPP_INVALID_PCM";
    return result;
  }
  if (!runtime_->ready()) {
    result.status = GateSttStatus::Unavailable;
    result.error_code = runtime_->error_code().empty()
        ? "VOICE.GATE_STT.WHISPER_CPP_UNAVAILABLE"
        : runtime_->error_code();
    return result;
  }

  const auto started = std::chrono::steady_clock::now();
  WhisperCppDecodeResult decoded;
  try {
    decoded = runtime_->decode(request.samples);
  } catch (...) {
    result.status = GateSttStatus::Failed;
    result.error_code = "VOICE.GATE_STT.WHISPER_CPP_EXCEPTION";
    return result;
  }
  const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started);

  result.latency_ms = static_cast<std::uint64_t>(
      std::max<std::int64_t>(0, elapsed.count()));
  result.language = decoded.language.empty() ? "und" : decoded.language;
  result.confidence = unit(decoded.confidence);
  result.no_speech_probability =
      unit(decoded.no_speech_probability, 1.0);
  result.error_code = decoded.error_code;

  switch (decoded.status) {
    case WhisperCppDecodeStatus::Transcript:
      result.status = GateSttStatus::Transcript;
      result.transcript = decoded.transcript;
      result.error_code.clear();
      break;
    case WhisperCppDecodeStatus::NoSpeech:
      result.status = GateSttStatus::NoSpeech;
      if (result.error_code.empty()) {
        result.error_code = "VOICE.GATE_STT.NO_SPEECH";
      }
      break;
    case WhisperCppDecodeStatus::Failed:
      result.status = GateSttStatus::Failed;
      if (result.error_code.empty()) {
        result.error_code = "VOICE.GATE_STT.WHISPER_CPP_FAILED";
      }
      break;
  }

  // The pipeline owns only the GateSttResult copy. Remove the decoder-local
  // transcript immediately so a second plaintext copy does not survive this
  // adapter boundary.
  wipe(decoded.transcript);
  return result;
}

bool WhisperCppGateStt::ready() const noexcept {
  return runtime_ && runtime_->ready();
}

std::string WhisperCppGateStt::model_id() const {
  return runtime_ ? runtime_->model_id() : "whisper.cpp/unavailable";
}

std::string WhisperCppGateStt::error_code() const {
  return runtime_ ? runtime_->error_code()
                  : "VOICE.GATE_STT.WHISPER_CPP_UNAVAILABLE";
}

const char* whisper_cpp_decode_status_name(
    const WhisperCppDecodeStatus status) noexcept {
  switch (status) {
    case WhisperCppDecodeStatus::Transcript: return "TRANSCRIPT";
    case WhisperCppDecodeStatus::NoSpeech: return "NO_SPEECH";
    case WhisperCppDecodeStatus::Failed: return "FAILED";
  }
  return "FAILED";
}

}  // namespace birdie::voice
