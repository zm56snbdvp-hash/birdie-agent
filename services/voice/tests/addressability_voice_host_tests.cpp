#include "birdie/voice/voice_host.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using birdie::voice::ActivationMode;
using birdie::voice::AddressabilityConfidenceBand;
using birdie::voice::AddressabilityDecision;
using birdie::voice::AddressabilityResult;
using birdie::voice::AudioFrame;
using birdie::voice::IEventSink;
using birdie::voice::UtteranceAudio;
using birdie::voice::VoiceConfig;
using birdie::voice::VoiceEvent;
using birdie::voice::VoiceHost;
using birdie::voice::VoicePhase;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

class CollectingSink final : public IEventSink {
 public:
  void emit(const VoiceEvent& event) override { events.push_back(event); }

  [[nodiscard]] bool contains(const std::string& name) const {
    return std::any_of(events.begin(), events.end(), [&](const VoiceEvent& event) {
      return event.name == name;
    });
  }

  std::vector<VoiceEvent> events;
};

AudioFrame frame(const float sample, const std::uint64_t at_ms) {
  AudioFrame result;
  result.samples.assign(160, sample);
  result.sample_rate = 16'000;
  result.channels = 1;
  result.monotonic_ms = at_ms;
  return result;
}

AddressabilityResult abstain_result() {
  AddressabilityResult result;
  result.decision = AddressabilityDecision::Abstain;
  result.confidence_band = AddressabilityConfidenceBand::Medium;
  result.score = 0.51;
  result.positive_evidence_families = 1;
  result.reason = "ADDRESSABILITY.UNCERTAIN";
  return result;
}

AddressabilityResult accept_result() {
  AddressabilityResult result;
  result.decision = AddressabilityDecision::Accept;
  result.confidence_band = AddressabilityConfidenceBand::High;
  result.score = 0.94;
  result.positive_evidence_families = 3;
  result.reason = "ADDRESSABILITY.MULTI_SIGNAL_ACCEPT";
  return result;
}

void test_abstain_clears_candidate_and_pre_roll() {
  CollectingSink sink;
  std::vector<UtteranceAudio> utterances;
  VoiceConfig config;
  config.start_window_frames = 3;
  config.start_required_frames = 2;
  config.minimum_speech_ms = 120;
  config.silence_to_endpoint_ms = 120;

  VoiceHost host(config, sink, [&](UtteranceAudio utterance) {
    utterances.push_back(std::move(utterance));
  });

  std::uint64_t at = 10;
  for (int index = 0; index < 3; ++index, at += 10) {
    host.process(frame(0.08F, at));
  }
  require(host.phase() == VoicePhase::SpeechCandidate,
          "first speech burst must create a candidate");
  require(host.resolve_addressability(abstain_result()),
          "ABSTAIN must resolve the active candidate");
  require(host.phase() == VoicePhase::Quiet,
          "ABSTAIN must return VoiceHost to Quiet");
  require(sink.contains("voice.activation.abstained"),
          "ABSTAIN must emit its canonical event");
  require(utterances.empty(),
          "ABSTAIN must not create an accepted utterance");

  // Start a separate accepted turn. If reset_interaction(true) did not clear the
  // old pre-roll, 0.08 samples from the abstained candidate would leak here.
  host.process(frame(0.0F, at));
  at += 10;
  for (int index = 0; index < 3; ++index, at += 10) {
    host.process(frame(0.12F, at));
  }
  require(host.phase() == VoicePhase::SpeechCandidate,
          "second speech burst must create a fresh candidate");
  require(host.resolve_addressability(
              accept_result(), ActivationMode::WakeOnSpeak),
          "second candidate must be accepted");
  require(host.phase() == VoicePhase::Listening,
          "accepted candidate must enter Listening");

  for (int index = 0; index < 12; ++index, at += 10) {
    host.process(frame(0.12F, at));
  }
  for (int index = 0; index < 14; ++index, at += 10) {
    host.process(frame(0.0F, at));
  }

  require(utterances.size() == 1,
          "fresh accepted turn must finalize exactly one utterance");
  const auto leaked = std::any_of(
      utterances.front().samples.begin(),
      utterances.front().samples.end(),
      [](const float sample) { return std::fabs(sample - 0.08F) < 0.0001F; });
  require(!leaked,
          "audio from an abstained candidate must not leak into the next turn");
}

void test_resolution_requires_active_candidate() {
  CollectingSink sink;
  VoiceHost host(VoiceConfig{}, sink, {});
  require(!host.resolve_addressability(abstain_result()),
          "addressability decision outside SpeechCandidate must be ignored");
  require(sink.events.empty(),
          "ignored decision must not emit lifecycle events");
}

}  // namespace

int main() {
  try {
    test_abstain_clears_candidate_and_pre_roll();
    test_resolution_requires_active_candidate();
    std::cout << "birdie-addressability-voice-host-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-addressability-voice-host-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
