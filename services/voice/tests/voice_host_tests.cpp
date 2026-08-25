#include "birdie/voice/voice_host.hpp"

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using birdie::voice::ActivationMode;
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
  config.activation_timeout_ms = 100;
  config.minimum_speech_ms = 20;
  config.silence_to_endpoint_ms = 30;
  config.maximum_utterance_ms = 500;
  config.speech_start_threshold = 0.60;
  config.speech_stop_threshold = 0.35;
  config.start_window_frames = 3;
  config.start_required_frames = 2;
  return config;
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
  host.set_muted(true);
  require(host.muted(), "mute state must be authoritative");
  require(host.phase() == VoicePhase::Quiet,
          "mute must cancel the active candidate");
  require(has_event(sink, "voice.privacy.changed"),
          "mute must emit a privacy-state event");
}

}  // namespace

int main() {
  try {
    test_pre_roll_is_bounded_and_ordered();
    test_activity_is_not_automatic_activation();
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
