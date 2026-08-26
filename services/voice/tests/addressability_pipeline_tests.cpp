#include "birdie/voice/addressability_pipeline.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>

namespace {

using birdie::voice::AddressabilityContext;
using birdie::voice::AddressabilityDecision;
using birdie::voice::AddressabilityEvidencePipeline;
using birdie::voice::AddressabilityPipelineConfig;
using birdie::voice::GateSttRequest;
using birdie::voice::GateSttResult;
using birdie::voice::GateSttStatus;
using birdie::voice::IGateStt;
using birdie::voice::UnavailableGateStt;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

class ScriptedGateStt final : public IGateStt {
 public:
  explicit ScriptedGateStt(GateSttResult result)
      : result_(std::move(result)) {}

  GateSttResult transcribe(const GateSttRequest& request) override {
    ++calls;
    last_activity_id = request.activity_id;
    last_sample_count = request.samples.size();
    return result_;
  }

  int calls{0};
  std::string last_activity_id;
  std::size_t last_sample_count{0};

 private:
  GateSttResult result_;
};

GateSttRequest request(
    std::string activity_id = "activity-gate-1",
    const float amplitude = 0.12F,
    const std::uint32_t duration_ms = 800) {
  GateSttRequest result;
  result.activity_id = std::move(activity_id);
  result.sample_rate = 16'000;
  result.channels = 1;
  result.candidate_started_ms = 100;
  result.captured_through_ms = 100 + duration_ms;
  result.samples.assign(
      (static_cast<std::size_t>(result.sample_rate) * duration_ms) / 1'000,
      amplitude);
  return result;
}

GateSttResult transcript(
    std::string text,
    const double confidence = 0.93,
    const double no_speech_probability = 0.02) {
  GateSttResult result;
  result.status = GateSttStatus::Transcript;
  result.transcript = std::move(text);
  result.language = "de";
  result.confidence = confidence;
  result.no_speech_probability = no_speech_probability;
  result.latency_ms = 42;
  result.model_id = "scripted-local-test";
  result.error_code.clear();
  return result;
}

void test_explicit_activation_bypasses_gate_stt() {
  ScriptedGateStt stt(transcript("dieser Decoder darf nicht laufen"));
  AddressabilityEvidencePipeline pipeline(stt);
  AddressabilityContext context;
  context.explicit_activation = true;

  GateSttRequest explicit_request;
  explicit_request.activity_id = "activity-explicit";
  const auto evaluation = pipeline.evaluate(
      std::move(explicit_request), context);

  require(evaluation.gate_stt_status == GateSttStatus::Bypassed,
          "explicit activation must declare Gate-STT bypass");
  require(evaluation.result.decision == AddressabilityDecision::Accept,
          "explicit activation must accept without Gate-STT");
  require(evaluation.result.reason ==
              "ADDRESSABILITY.EXPLICIT_ACTIVATION",
          "explicit activation reason must remain stable");
  require(stt.calls == 0,
          "explicit activation must not invoke the local decoder");
}

void test_direct_address_accepts_with_independent_evidence() {
  ScriptedGateStt stt(transcript("Birdie, öffne bitte den Kalender"));
  AddressabilityEvidencePipeline pipeline(stt);
  AddressabilityContext context;
  context.media_likelihood = 0.05;
  context.overlap_likelihood = 0.05;

  const auto evaluation = pipeline.evaluate(request(), context);
  require(evaluation.result.decision == AddressabilityDecision::Accept,
          "direct address plus ASR and proximity must accept");
  require(evaluation.evidence.direct_address,
          "Birdie token must become direct-address evidence");
  require(evaluation.evidence.assistant_intent >= 0.9,
          "direct request must carry strong assistant intent");
  require(evaluation.result.positive_evidence_families >= 3,
          "ACCEPT must rely on multiple evidence families");
  require(stt.calls == 1 && stt.last_sample_count > 0,
          "pipeline must invoke local Gate-STT exactly once");
}

void test_triggerless_imperative_remains_uncertain() {
  ScriptedGateStt stt(transcript("Öffne den Kalender"));
  AddressabilityEvidencePipeline pipeline(stt);
  AddressabilityContext context;
  context.media_likelihood = 0.05;
  context.overlap_likelihood = 0.05;

  const auto evaluation = pipeline.evaluate(request(), context);
  require(evaluation.result.decision == AddressabilityDecision::Abstain,
          "imperative without direct address or context must not guess");
}

void test_follow_up_context_accepts_short_answer() {
  ScriptedGateStt stt(transcript("Ja", 0.84));
  AddressabilityEvidencePipeline pipeline(stt);
  AddressabilityContext context;
  context.follow_up_window = true;
  context.recently_active = true;
  context.media_likelihood = 0.05;
  context.overlap_likelihood = 0.05;

  const auto evaluation = pipeline.evaluate(request(), context);
  require(evaluation.result.decision == AddressabilityDecision::Accept,
          "structured follow-up context must accept a matching short answer");
  require(evaluation.evidence.follow_up_semantics_match,
          "short answer must be classified as follow-up semantics");
  require(evaluation.result.reason == "ADDRESSABILITY.FOLLOW_UP_MATCH",
          "follow-up acceptance reason must remain stable");
}

void test_media_veto_rejects_apparent_direct_request() {
  ScriptedGateStt stt(transcript("Birdie, starte die Musik"));
  AddressabilityEvidencePipeline pipeline(stt);
  AddressabilityContext context;
  context.media_likelihood = 0.95;
  context.overlap_likelihood = 0.05;

  const auto evaluation = pipeline.evaluate(request(), context);
  require(evaluation.result.decision == AddressabilityDecision::Reject,
          "strong media evidence must veto apparent direct address");
  require(evaluation.result.reason == "ADDRESSABILITY.MEDIA_VETO",
          "media veto reason must remain stable");
}

void test_unavailable_gate_stt_abstains_fail_closed() {
  UnavailableGateStt stt;
  AddressabilityEvidencePipeline pipeline(stt);

  const auto evaluation = pipeline.evaluate(request());
  require(evaluation.gate_stt_status == GateSttStatus::Unavailable,
          "unconfigured local engine must report unavailable");
  require(evaluation.result.decision == AddressabilityDecision::Abstain,
          "unavailable Gate-STT must fail closed with ABSTAIN");
  require(evaluation.result.reason ==
              "ADDRESSABILITY.GATE_STT_UNAVAILABLE",
          "unavailable reason must remain stable");
}

void test_no_speech_rejects_without_turn() {
  GateSttResult no_speech;
  no_speech.status = GateSttStatus::NoSpeech;
  no_speech.no_speech_probability = 0.99;
  no_speech.error_code.clear();
  ScriptedGateStt stt(std::move(no_speech));
  AddressabilityEvidencePipeline pipeline(stt);

  const auto evaluation = pipeline.evaluate(request());
  require(evaluation.result.decision == AddressabilityDecision::Reject,
          "Gate-STT no-speech must reject the candidate");
  require(evaluation.result.reason == "ADDRESSABILITY.NO_SPEECH",
          "no-speech reason must remain stable");
}

void test_oversized_gate_audio_never_reaches_decoder() {
  ScriptedGateStt stt(transcript("Birdie"));
  AddressabilityPipelineConfig config;
  config.maximum_gate_audio_ms = 500;
  AddressabilityEvidencePipeline pipeline(
      stt, birdie::voice::RuleBasedAddressabilityGate{}, config);

  const auto evaluation = pipeline.evaluate(request("activity-too-long", 0.1F, 800));
  require(evaluation.result.decision == AddressabilityDecision::Abstain,
          "oversized gate audio must abstain");
  require(stt.calls == 0,
          "oversized audio must be rejected before the local decoder");
}

}  // namespace

int main() {
  try {
    test_explicit_activation_bypasses_gate_stt();
    test_direct_address_accepts_with_independent_evidence();
    test_triggerless_imperative_remains_uncertain();
    test_follow_up_context_accepts_short_answer();
    test_media_veto_rejects_apparent_direct_request();
    test_unavailable_gate_stt_abstains_fail_closed();
    test_no_speech_rejects_without_turn();
    test_oversized_gate_audio_never_reaches_decoder();
    std::cout << "birdie-addressability-pipeline-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-addressability-pipeline-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
