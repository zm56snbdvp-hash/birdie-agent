#include "birdie/voice/voice_host.hpp"

#include <string>
#include <utility>

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

void VoiceHost::handle_input_unavailable(std::string reason) {
  if (phase_ == VoicePhase::SpeechCandidate) {
    reject_activation(reason);
  } else if (phase_ == VoicePhase::Listening) {
    emit(
        "voice.input.cancelled",
        last_frame_ms_,
        {
            {"activity_id", activity_id_},
            {"reason", reason},
            {"barge_in", output_active_},
            {"output_id", active_output_id_},
        });
    finish_activity(last_frame_ms_, std::move(reason));
    reset_interaction(true);
  } else {
    reset_interaction(true);
  }

  gate_stt_activity_id_.clear();
  vad_.reset();
  last_level_event_ms_ = 0;
}

std::optional<GateSttRequest> VoiceHost::gate_stt_request() {
  if (muted_ || phase_ != VoicePhase::SpeechCandidate ||
      activity_id_.empty() || gate_stt_activity_id_ == activity_id_ ||
      last_frame_ms_ < candidate_started_ms_) {
    return std::nullopt;
  }

  const auto elapsed_ms = last_frame_ms_ - candidate_started_ms_;
  const bool complete_timed_prefix =
      elapsed_ms >= config_.gate_stt_minimum_candidate_ms;
  const bool complete_endpointed_prefix =
      accumulated_speech_ms_ >= config_.gate_stt_minimum_speech_ms &&
      accumulated_silence_ms_ >= config_.gate_stt_endpoint_silence_ms;
  if (!complete_timed_prefix && !complete_endpointed_prefix) {
    return std::nullopt;
  }
  return gate_stt_request(0);
}

std::optional<GateSttRequest> VoiceHost::gate_stt_request(
    const std::uint64_t minimum_candidate_ms) {
  if (muted_ || phase_ != VoicePhase::SpeechCandidate ||
      activity_id_.empty() || gate_stt_activity_id_ == activity_id_ ||
      last_frame_ms_ < candidate_started_ms_ ||
      last_frame_ms_ - candidate_started_ms_ < minimum_candidate_ms) {
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
  gate_stt_activity_id_ = activity_id_;
  return request;
}

}  // namespace birdie::voice
