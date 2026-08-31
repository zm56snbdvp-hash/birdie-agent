#pragma once

#include "birdie/voice/addressability.hpp"
#include "birdie/voice/gate_stt.hpp"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <string>

namespace birdie::voice {

struct AddressabilityContext {
  bool explicit_activation{false};
  bool follow_up_window{false};
  bool recently_active{false};

  std::optional<double> acoustic_proximity;
  std::optional<double> speaker_match;
  std::optional<double> media_likelihood;
  std::optional<double> overlap_likelihood;
};

struct AddressabilityPipelineConfig {
  std::uint32_t maximum_gate_audio_ms{2'500};
  std::size_t maximum_transcript_bytes{512};
  double no_speech_reject_threshold{0.85};
  double unknown_media_likelihood{0.20};
  double unknown_overlap_likelihood{0.15};
};

struct AddressabilityEvaluation {
  std::string activity_id;
  GateSttStatus gate_stt_status{GateSttStatus::Unavailable};
  std::string language{"und"};
  std::string gate_stt_error_code;
  double gate_stt_confidence{0.0};
  double no_speech_probability{1.0};
  std::uint64_t gate_stt_latency_ms{0};
  AddressabilityEvidence evidence;
  AddressabilityResult result;
};

class AddressabilityEvidencePipeline {
 public:
  AddressabilityEvidencePipeline(
      IGateStt& gate_stt,
      RuleBasedAddressabilityGate gate = RuleBasedAddressabilityGate{},
      AddressabilityPipelineConfig config = AddressabilityPipelineConfig{});

  // The request is consumed by value so its raw PCM can be wiped before this
  // function returns. The returned evaluation never contains transcript text.
  [[nodiscard]] AddressabilityEvaluation evaluate(
      GateSttRequest request,
      const AddressabilityContext& context = AddressabilityContext{});

 private:
  IGateStt& gate_stt_;
  RuleBasedAddressabilityGate gate_;
  AddressabilityPipelineConfig config_;
};

}  // namespace birdie::voice
