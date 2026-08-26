#include "birdie/voice/voice_host.hpp"

#include <string>

namespace birdie::voice {

bool VoiceHost::resolve_addressability(
    const AddressabilityResult& result,
    const ActivationMode accepted_mode) {
  return resolve_addressability(activity_id_, result, accepted_mode);
}

bool VoiceHost::resolve_addressability(
    const std::string_view expected_activity_id,
    const AddressabilityResult& result,
    const ActivationMode accepted_mode) {
  if (muted_ || phase_ != VoicePhase::SpeechCandidate ||
      expected_activity_id.empty() || expected_activity_id != activity_id_) {
    return false;
  }

  switch (result.decision) {
    case AddressabilityDecision::Accept:
      return accept_activation(accepted_mode, result.score);

    case AddressabilityDecision::Reject:
      return reject_activation(result.reason);

    case AddressabilityDecision::Abstain:
      emit(
          "voice.activation.abstained",
          last_frame_ms_,
          {
              {"activity_id", activity_id_},
              {"reason", result.reason},
              {"score", result.score},
              {"confidence_band",
               std::string(addressability_confidence_name(
                   result.confidence_band))},
              {"positive_evidence_families",
               static_cast<std::uint64_t>(
                   result.positive_evidence_families)},
          });
      finish_activity(last_frame_ms_, "addressability_abstained");
      reset_interaction(true);
      return true;
  }

  return false;
}

std::optional<GateSttRequest> VoiceHost::gate_stt_request() const {
  if (muted_ || phase_ != VoicePhase::SpeechCandidate ||
      activity_id_.empty()) {
    return std::nullopt;
  }

  GateSttRequest request;
  request.activity_id = activity_id_;
  request.samples = pre_roll_.snapshot();
  request.sample_rate = config_.sample_rate;
  request.channels = 1;
  request.candidate_started_ms = candidate_started_ms_;
  request.captured_through_ms = last_frame_ms_;
  request.barge_in_candidate = output_active_;
  return request;
}

}  // namespace birdie::voice
