#include "birdie/voice/voice_host.hpp"

#include <string>

namespace birdie::voice {

bool VoiceHost::resolve_addressability(
    const AddressabilityResult& result,
    const ActivationMode accepted_mode) {
  if (muted_ || phase_ != VoicePhase::SpeechCandidate) {
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

}  // namespace birdie::voice
