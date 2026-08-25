#include "birdie/voice/voice_host.hpp"

#include <utility>

namespace birdie::voice {

void VoiceHost::resolve_addressability(
    const AddressabilityResult& result,
    const ActivationMode accepted_mode) {
  if (phase_ != VoicePhase::SpeechCandidate &&
      phase_ != VoicePhase::BargeInCandidate) {
    return;
  }

  switch (result.decision) {
    case AddressabilityDecision::Accept:
      accept_activation(accepted_mode, result.score);
      return;

    case AddressabilityDecision::Reject:
      reject_activation(result.reason);
      return;

    case AddressabilityDecision::Abstain:
      sink_.emit({
          "voice.activation.abstained",
          last_frame_ms_,
          std::nullopt,
          {
              {"reason", result.reason},
              {"score", result.score},
              {"confidence_band",
               std::string(addressability_confidence_name(
                   result.confidence_band))},
              {"positive_evidence_families",
               static_cast<std::uint64_t>(
                   result.positive_evidence_families)},
          },
      });
      sink_.emit({
          "voice.activity.ended",
          last_frame_ms_,
          std::nullopt,
          {
              {"activity_id", activity_id_},
              {"reason", std::string("addressability_abstained")},
          },
      });

      phase_ = VoicePhase::Dormant;
      active_samples_.clear();
      consecutive_speech_frames_ = 0;
      consecutive_silence_frames_ = 0;
      speech_frames_ = 0;
      activity_id_.clear();
      utterance_id_.clear();
      pending_turn_id_.clear();
      return;
  }
}

}  // namespace birdie::voice
