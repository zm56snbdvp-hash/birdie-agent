#include "birdie/voice/gate_stt.hpp"

#include <algorithm>

namespace birdie::voice {
namespace {

void wipe(std::string& value) noexcept {
  std::fill(value.begin(), value.end(), '\0');
  value.clear();
}

}  // namespace

GateSttResult UnavailableGateStt::transcribe(
    const GateSttRequest& request) {
  GateSttResult result;
  result.status = GateSttStatus::Unavailable;
  result.language = "und";
  result.confidence = 0.0;
  result.no_speech_probability = 1.0;
  result.model_id = "unconfigured-local-gate-stt";
  result.error_code = request.samples.empty()
      ? "VOICE.GATE_STT.EMPTY_AUDIO"
      : "VOICE.GATE_STT.UNAVAILABLE";
  return result;
}

void secure_clear(GateSttRequest& request) noexcept {
  std::fill(request.samples.begin(), request.samples.end(), 0.0F);
  request.samples.clear();
  request.samples.shrink_to_fit();
  wipe(request.activity_id);
  request.candidate_started_ms = 0;
  request.captured_through_ms = 0;
  request.barge_in_candidate = false;
}

void secure_clear(GateSttResult& result) noexcept {
  wipe(result.transcript);
  result.confidence = 0.0;
  result.no_speech_probability = 1.0;
  result.latency_ms = 0;
}

const char* gate_stt_status_name(const GateSttStatus status) noexcept {
  switch (status) {
    case GateSttStatus::Transcript: return "TRANSCRIPT";
    case GateSttStatus::NoSpeech: return "NO_SPEECH";
    case GateSttStatus::Unavailable: return "UNAVAILABLE";
    case GateSttStatus::Failed: return "FAILED";
  }
  return "FAILED";
}

}  // namespace birdie::voice
