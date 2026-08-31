#include "birdie/voice/voice_host.hpp"

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using birdie::voice::ActivationMode;
using birdie::voice::AddressabilityConfidenceBand;
using birdie::voice::AddressabilityDecision;
using birdie::voice::AddressabilityResult;
using birdie::voice::AudioFrame;
using birdie::voice::IEventSink;
using birdie::voice::PreRollBuffer;
using birdie::voice::UtteranceAudio;
using birdie::voice::VoiceConfig;
using birdie::voice::VoiceEvent;
using birdie::voice::VoiceHost;
using birdie::voice::VoicePhase;

struct RecordingSink final : IEventSink {
  std::vector<VoiceEvent> events;
  void emit(const VoiceEvent& event) override { events.push_back(event); }
};

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

bool has_event(const RecordingSink& sink, const std::string& name) {
  for (const auto& event : sink.events) {
    if (event.name == name) return true;
  }
  return false;
}

bool payload_bool(const VoiceEvent& event, const std::string& key) {
  for (const auto& [name, value] : event.payload) {
    if (name == key && std::holds_alternative<bool>(value)) {
      return std::get<bool>(value);
    }
  }
  return false;
}

AudioFrame frame(const float amplitude, const std::uint64_t at_ms,
                 const std::uint32_t sample_rate = 1'000,
                 const std::uint32_t frame_ms = 10) {
  AudioFrame result;
  result.sample_rate = sample_rate;
  result.channels = 1;
  result.monotonic_ms = at_ms;
  result.samples.assign((sample_rate * frame_ms) / 1000, amplitude);
  return result;
}

VoiceConfig test_config() {
  VoiceConfig config;
  config.sample_rate = 1'000;
  config.frame_ms = 10;
  config.pre_roll_ms = 30;
  config.level_interval_ms = 30;
  config.gate_stt_minimum_candidate_ms = 20;
  config.gate_stt_minimum_speech_ms = 20;
  config.gate_stt_endpoint_silence_ms = 10;
  config.activation_timeout_ms = 100;
  config.gate_stt_timeout_ms = 180;
  config.minimum_speech_ms = 20;
  config.silence_to_endpoint_ms = 30;
  config.maximum_utterance_ms = 500;
  config.speech_start_threshold = 0.60;
  config.speech_stop_threshold = 0.35;
  config.start_window_frames = 3;
  config.start_required_frames = 2;
  return config;
}

AddressabilityResult abstain_result() {
  return {
      AddressabilityDecision::Abstain,
      AddressabilityConfidenceBand::High,
      0.5,
      1,
      "ADDRESSABILITY.GATE_STT_UNAVAILABLE",
  };
}

void test_pre_roll_is_bounded_and_ordered() {
  PreRollBuffer buffer(1'000, 5);
  const std::vector<float> samples{1, 2, 3, 4, 5, 6, 7};
  buffer.push(samples);
  const auto snapshot = buffer.snapshot();
  require(snapshot.size() == 5, "pre-roll must retain only its capacity");
  require(snapshot[0] == 3 && snapshot[4] == 7,
          "pre-roll must preserve chronological order after wrapping");
  buffer.clear();
  require(buffer.size() == 0, "clear must release logical pre-roll content");
}

void test_activity_is_not_automatic_activation() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.phase() == VoicePhase::SpeechCandidate,
          "speech must enter candidate phase");
  require(has_event(sink, "voice.activity.started"),
          "candidate must emit voice.activity.started");
  require(!has_event(sink, "voice.activation.accepted"),
          "VAD alone must never accept activation");
  host.reject_activation("not_addressed");
  require(host.phase() == VoicePhase::Quiet,
          "rejected candidate must return to quiet");
  require(has_event(sink, "voice.activation.rejected"),
          "rejection must be explicit");
}

void test_candidate_snapshot_is_bounded_and_identified() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.set_output_active(true, "output-snapshot", "turn-snapshot");
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));

  const auto snapshot = host.gate_stt_request(0);
  require(snapshot.has_value(),
          "SpeechCandidate must expose one local Gate-STT snapshot");
  require(snapshot->activity_id == host.active_activity_id(),
          "snapshot must preserve activity identity");
  require(snapshot->samples.size() <= 30,
          "snapshot must remain bounded by configured pre-roll");
  require(snapshot->sample_rate == 1'000 && snapshot->channels == 1,
          "snapshot must preserve canonical audio format");
  require(snapshot->barge_in_candidate,
          "snapshot must preserve local barge-in context");
  require(!host.gate_stt_request(0).has_value(),
          "one activity must expose at most one PCM snapshot");
}

void test_candidate_waits_for_inflight_gate_stt_after_speech_ends() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.gate_stt_request(0).has_value(),
          "candidate must submit one Gate-STT request");

  host.process(frame(0.0F, 30));
  host.process(frame(0.0F, 40));
  host.process(frame(0.0F, 50));
  require(host.phase() == VoicePhase::SpeechCandidate,
          "candidate must remain active while Gate-STT is in flight");
  require(!has_event(sink, "voice.activation.rejected"),
          "endpoint silence must not race an in-flight Gate-STT result");

  const AddressabilityResult accepted{
      AddressabilityDecision::Accept,
      AddressabilityConfidenceBand::High,
      0.95,
      2,
      "ADDRESSABILITY.EXPLICIT_ACTIVATION",
  };
  require(host.resolve_addressability(accepted),
          "in-flight Gate-STT result must still resolve the candidate");
  require(host.phase() == VoicePhase::Listening,
          "accepted Gate-STT result must enter listening");
}

void test_inflight_gate_stt_preserves_the_complete_candidate() {
  RecordingSink sink;
  std::vector<UtteranceAudio> utterances;
  VoiceHost host(test_config(), sink, [&](UtteranceAudio utterance) {
    utterances.push_back(std::move(utterance));
  });
  host.process(frame(0.11F, 0));
  host.process(frame(0.12F, 10));
  host.process(frame(0.13F, 20));
  require(host.gate_stt_request(0).has_value(),
          "candidate must submit one Gate-STT request");

  host.process(frame(0.14F, 30));
  host.process(frame(0.15F, 40));
  host.process(frame(0.16F, 50));
  const AddressabilityResult accepted{
      AddressabilityDecision::Accept,
      AddressabilityConfidenceBand::High,
      0.95,
      2,
      "ADDRESSABILITY.EXPLICIT_ACTIVATION",
  };
  require(host.resolve_addressability(accepted),
          "late Gate-STT result must accept the active candidate");

  host.process(frame(0.0F, 60));
  host.process(frame(0.0F, 70));
  host.process(frame(0.0F, 80));
  require(utterances.size() == 1,
          "accepted candidate must finalize exactly one utterance");
  require(utterances.front().duration_ms >= 90,
          "audio spoken while Gate-STT is in flight must reach full STT");
  const auto& samples = utterances.front().samples;
  require(samples.size() >= 90,
          "complete candidate must retain every marked test frame");
  require(std::fabs(samples[0] - 0.11F) < 0.0001F &&
              std::fabs(samples[10] - 0.12F) < 0.0001F &&
              std::fabs(samples[20] - 0.13F) < 0.0001F &&
              std::fabs(samples[30] - 0.14F) < 0.0001F &&
              std::fabs(samples[40] - 0.15F) < 0.0001F &&
              std::fabs(samples[50] - 0.16F) < 0.0001F,
          "candidate audio order must survive an in-flight Gate-STT decode");
}

void test_default_gate_stt_waits_for_a_whisper_sized_prefix() {
  RecordingSink sink;
  VoiceHost host(VoiceConfig{}, sink, [](UtteranceAudio) {});
  std::uint64_t at = 10;
  for (int index = 0; index < 3; ++index, at += 10) {
    host.process(frame(0.10F, at, 16'000));
  }

  for (int index = 0; index < 50; ++index, at += 10) {
    host.process(frame(0.10F, at, 16'000));
  }
  require(!host.gate_stt_request().has_value(),
          "Gate-STT must not decode a clipped 500 ms speech prefix");

  for (int index = 0; index < 31; ++index, at += 10) {
    host.process(frame(0.10F, at, 16'000));
  }
  require(host.gate_stt_request().has_value(),
          "Gate-STT must become due after an 800 ms speech prefix");
}

void test_default_gate_stt_accepts_an_endpointed_wake_word_prefix() {
  RecordingSink sink;
  VoiceHost host(VoiceConfig{}, sink, [](UtteranceAudio) {});
  std::uint64_t at = 10;
  for (int index = 0; index < 3; ++index, at += 10) {
    host.process(frame(0.10F, at, 16'000));
  }
  for (int index = 0; index < 40; ++index, at += 10) {
    host.process(frame(0.10F, at, 16'000));
  }
  require(!host.gate_stt_request().has_value(),
          "an unfinished short prefix must not decode early");

  for (int index = 0; index < 12; ++index, at += 10) {
    host.process(frame(0.0F, at, 16'000));
  }
  require(host.gate_stt_request().has_value(),
          "a complete paused wake word must decode before rejection");
}

void test_candidate_waits_past_activation_timeout_for_gate_stt() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.gate_stt_request(0).has_value(),
          "candidate must submit one Gate-STT request");

  host.process(frame(0.0F, 120));
  require(host.phase() == VoicePhase::SpeechCandidate,
          "in-flight Gate-STT must outlive the acoustic activation timeout");
  require(!has_event(sink, "voice.activation.rejected"),
          "activation timeout must not cancel in-flight Gate-STT");

  const AddressabilityResult accepted{
      AddressabilityDecision::Accept,
      AddressabilityConfidenceBand::High,
      0.95,
      2,
      "ADDRESSABILITY.EXPLICIT_ACTIVATION",
  };
  require(host.resolve_addressability(accepted),
          "late Gate-STT result must still resolve the candidate");
  require(host.phase() == VoicePhase::Listening,
          "late accepted Gate-STT result must enter listening");
}

void test_inflight_gate_stt_has_a_bounded_wait() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.gate_stt_request(0).has_value(),
          "candidate must submit one Gate-STT request");

  host.process(frame(0.0F, 200));
  require(host.phase() == VoicePhase::Quiet,
          "an in-flight Gate-STT request must eventually time out");
  require(has_event(sink, "voice.activation.rejected"),
          "Gate-STT timeout must emit an explicit rejection");
}

void test_candidate_without_gate_stt_still_ends_on_silence() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));

  host.process(frame(0.0F, 30));
  host.process(frame(0.0F, 40));
  host.process(frame(0.0F, 50));
  require(host.phase() == VoicePhase::Quiet,
          "candidate without Gate-STT work must fail closed on silence");
  require(has_event(sink, "voice.activation.rejected"),
          "candidate without Gate-STT work must emit an explicit rejection");
}

void test_abstain_clears_candidate_snapshot() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.gate_stt_request(0).has_value(),
          "candidate must exist before ABSTAIN");

  require(host.resolve_addressability(abstain_result()),
          "ABSTAIN must resolve the active candidate");
  require(host.phase() == VoicePhase::Quiet,
          "ABSTAIN must return VoiceHost to Quiet");
  require(!host.gate_stt_request(0).has_value(),
          "ABSTAIN must remove access to candidate audio");
  require(has_event(sink, "voice.activation.abstained"),
          "ABSTAIN must emit the canonical lifecycle event");
}

void test_accept_preserves_pre_roll_and_endpoints() {
  RecordingSink sink;
  std::vector<UtteranceAudio> utterances;
  VoiceHost host(test_config(), sink,
                 [&](UtteranceAudio utterance) {
                   utterances.push_back(std::move(utterance));
                 });
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.accept_activation(ActivationMode::WakeOnSpeak, 0.94),
          "candidate should be accepted");
  require(host.phase() == VoicePhase::Listening,
          "accepted activation must enter listening");
  host.process(frame(0.2F, 30));
  host.process(frame(0.2F, 40));
  host.process(frame(0.0F, 50));
  host.process(frame(0.0F, 60));
  host.process(frame(0.0F, 70));
  require(host.phase() == VoicePhase::Quiet,
          "endpoint silence must close the utterance");
  require(utterances.size() == 1,
          "one accepted utterance must produce one local audio handoff");
  require(utterances[0].duration_ms >= 70,
          "utterance handoff must include pre-roll instead of clipping onset");
}

void test_output_activity_is_marked_as_barge_in_candidate() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.set_output_active(true, "output-1", "turn-old");
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.phase() == VoicePhase::SpeechCandidate,
          "speech during output must still become a candidate");
  bool marked = false;
  for (const auto& event : sink.events) {
    if (event.name == "voice.activity.started") {
      marked = payload_bool(event, "barge_in_candidate");
    }
  }
  require(marked, "candidate during output must carry barge-in evidence");
  require(host.accept_activation(ActivationMode::WakeOnSpeak, 0.99),
          "confirmed barge-in should be accepted");
  require(host.phase() == VoicePhase::Listening,
          "confirmed barge-in must enter listening");
}

void test_mute_clears_active_candidate() {
  RecordingSink sink;
  VoiceHost host(test_config(), sink, [](UtteranceAudio) {});
  host.process(frame(0.2F, 0));
  host.process(frame(0.2F, 10));
  host.process(frame(0.2F, 20));
  require(host.gate_stt_request(0).has_value(),
          "candidate must expose PCM before mute");
  host.set_muted(true);
  require(host.muted(), "mute state must be authoritative");
  require(host.phase() == VoicePhase::Quiet,
          "mute must cancel the active candidate");
  require(!host.gate_stt_request(0).has_value(),
          "mute must remove candidate audio access");
  require(has_event(sink, "voice.privacy.changed"),
          "mute must emit a privacy-state event");
}

}  // namespace

int main() {
  try {
    test_pre_roll_is_bounded_and_ordered();
    test_activity_is_not_automatic_activation();
    test_candidate_snapshot_is_bounded_and_identified();
    test_candidate_waits_for_inflight_gate_stt_after_speech_ends();
    test_inflight_gate_stt_preserves_the_complete_candidate();
    test_default_gate_stt_waits_for_a_whisper_sized_prefix();
    test_default_gate_stt_accepts_an_endpointed_wake_word_prefix();
    test_candidate_waits_past_activation_timeout_for_gate_stt();
    test_inflight_gate_stt_has_a_bounded_wait();
    test_candidate_without_gate_stt_still_ends_on_silence();
    test_abstain_clears_candidate_snapshot();
    test_accept_preserves_pre_roll_and_endpoints();
    test_output_activity_is_marked_as_barge_in_candidate();
    test_mute_clears_active_candidate();
    std::cout << "birdie-voice-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-voice-tests: FAIL: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
