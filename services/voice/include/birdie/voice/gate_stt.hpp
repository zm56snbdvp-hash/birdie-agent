#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace birdie::voice {

enum class GateSttStatus {
  Bypassed,
  Transcript,
  NoSpeech,
  Unavailable,
  Failed,
};

struct GateSttRequest {
  std::string activity_id;
  std::vector<float> samples;
  std::uint32_t sample_rate{16'000};
  std::uint16_t channels{1};
  std::uint64_t candidate_started_ms{0};
  std::uint64_t captured_through_ms{0};
  bool barge_in_candidate{false};
};

struct GateSttResult {
  GateSttStatus status{GateSttStatus::Unavailable};
  std::string transcript;
  std::string language{"und"};
  double confidence{0.0};
  double no_speech_probability{1.0};
  std::uint64_t latency_ms{0};
  std::string model_id;
  std::string error_code{"VOICE.GATE_STT.UNAVAILABLE"};
};

class IGateStt {
 public:
  virtual ~IGateStt() = default;

  // Implementations must run locally. Callers may execute this method on a
  // worker thread because a real decoder is expected to block.
  [[nodiscard]] virtual GateSttResult transcribe(
      const GateSttRequest& request) = 0;
};

class UnavailableGateStt final : public IGateStt {
 public:
  [[nodiscard]] GateSttResult transcribe(
      const GateSttRequest& request) override;
};

void secure_clear(GateSttRequest& request) noexcept;
void secure_clear(GateSttResult& result) noexcept;

[[nodiscard]] const char* gate_stt_status_name(
    GateSttStatus status) noexcept;

}  // namespace birdie::voice
