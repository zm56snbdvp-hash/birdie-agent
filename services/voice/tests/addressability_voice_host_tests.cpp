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
    return count(name) > 0;
  }

  [[nodiscard]] std::size_t count(const std::string& name) const {
    return static_cast<std::size_t>(std::count_if(
        events.begin(), events.end(), [&](const VoiceEvent& event) {
          return event.name == name;
        }));
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

void create_candidate(VoiceHost& host, std::uint64_t& at, const float sample) {
  for (int index = 0; index < 3; ++index, at += 10) {
    host.process(frame(sample, at));
  }
  require(host.phase() == VoicePhase::SpeechCandidate,
          "speech burst must create an addressability candidate");
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
  create_candidate(host, at, 0.08F);
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
  create_candidate(host, at, 0.12F);
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

void test_gate_stt_snapshot_and_stale_resolution() {
  CollectingSink sink;
  VoiceHost host(VoiceConfig{}, sink, [](UtteranceAudio) {});
  std::uint64_t at = 10;
  create_candidate(host, at, 0.10F);

  require(!host.gate_stt_request().has_value(),
          "default Gate-STT age must be checked before copying PCM");
  const auto request = host.gate_stt_request(0);
  require(request.has_value(),
          "active candidate must expose a bounded Gate-STT request when due");
  require(request->activity_id == host.active_activity_id(),
          "Gate-STT request must carry the current activity id");
  require(!request->samples.empty(),
          "Gate-STT request must contain local candidate PCM");
  require(request->samples.size() <= 16'000 * 1'200 / 1'000,
          "Gate-STT request must stay within configured pre-roll capacity");
  require(!host.gate_stt_request(0).has_value(),
          "one activity must issue at most one Gate-STT PCM snapshot");

  require(!host.resolve_addressability(
              "activity-stale", abstain_result()),
          "stale asynchronous result must not resolve a newer candidate");
  require(host.phase() == VoicePhase::SpeechCandidate,
          "stale result must leave current candidate untouched");

  require(host.resolve_addressability(
              request->activity_id, abstain_result()),
          "matching activity id must resolve current candidate");
  require(host.phase() == VoicePhase::Quiet,
          "matching ABSTAIN must return VoiceHost to Quiet");
  require(!host.gate_stt_request(0).has_value(),
          "resolved candidate must no longer expose Gate-STT audio");
}

void test_candidate_input_loss_rejects_and_clears_audio() {
  CollectingSink sink;
  VoiceHost host(VoiceConfig{}, sink, [](UtteranceAudio) {});
  std::uint64_t at = 10;
  create_candidate(host, at, 0.10F);
  require(host.gate_stt_request(0).has_value(),
          "candidate must expose one Gate-STT snapshot before failure");

  host.handle_input_unavailable("capture_unavailable");

  require(host.phase() == VoicePhase::Quiet,
          "capture loss must clear a pending candidate");
  require(!host.muted(),
          "device loss must not be misreported as user mute");
  require(sink.contains("voice.activation.rejected"),
          "candidate capture loss must emit a rejection lifecycle event");
  require(!host.gate_stt_request(0).has_value(),
          "capture loss must remove all candidate PCM access");
}

void test_listening_input_loss_cancels_without_utterance_handoff() {
  CollectingSink sink;
  std::vector<UtteranceAudio> utterances;
  VoiceHost host(VoiceConfig{}, sink, [&](UtteranceAudio utterance) {
    utterances.push_back(std::move(utterance));
  });
  std::uint64_t at = 10;
  create_candidate(host, at, 0.10F);
  require(host.resolve_addressability(accept_result()),
          "candidate must enter Listening before capture loss");
  require(host.phase() == VoicePhase::Listening,
          "accepted candidate must be listening");

  host.handle_input_unavailable("capture_unavailable");

  require(host.phase() == VoicePhase::Quiet,
          "capture loss must leave Listening immediately");
  require(!host.muted(),
          "capture loss remains distinct from user mute");
  require(sink.contains("voice.input.cancelled"),
          "accepted input loss must emit voice.input.cancelled");
  require(utterances.empty(),
          "partial audio must never reach accepted utterance handoff");
  require(!host.gate_stt_request(0).has_value(),
          "cancelled input must expose no Gate-STT PCM");
}

void test_output_only_input_loss_preserves_output_state() {
  CollectingSink sink;
  VoiceHost host(VoiceConfig{}, sink, [](UtteranceAudio) {});
  host.set_output_active(true, "output-live", "turn-live");
  require(host.output_active(), "test requires active output");
  require(host.phase() == VoicePhase::Quiet,
          "output alone must not create an input candidate");

  host.handle_input_unavailable("capture_unavailable");

  require(host.output_active(),
          "microphone loss must not stop an unrelated active output");
  require(host.phase() == VoicePhase::Quiet,
          "input reset must leave output-only VoiceHost input quiet");
  require(sink.count("voice.input.cancelled") == 0,
          "no input cancellation event is needed without active input");
  require(sink.count("voice.activation.rejected") == 0,
          "output-only input loss must not fabricate a candidate rejection");
}

void test_resolution_requires_active_candidate() {
  CollectingSink sink;
  VoiceHost host(VoiceConfig{}, sink, {});
  require(!host.resolve_addressability(abstain_result()),
          "addressability decision outside SpeechCandidate must be ignored");
  require(!host.gate_stt_request(0).has_value(),
          "Quiet VoiceHost must not expose Gate-STT audio");
  require(sink.events.empty(),
          "ignored decision must not emit lifecycle events");
}

}  // namespace

int main() {
  try {
    test_abstain_clears_candidate_and_pre_roll();
    test_gate_stt_snapshot_and_stale_resolution();
    test_candidate_input_loss_rejects_and_clears_audio();
    test_listening_input_loss_cancels_without_utterance_handoff();
    test_output_only_input_loss_preserves_output_state();
    test_resolution_requires_active_candidate();
    std::cout << "birdie-addressability-voice-host-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-addressability-voice-host-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
