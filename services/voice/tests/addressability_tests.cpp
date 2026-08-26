#include "birdie/voice/addressability.hpp"

#include <cstdlib>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {

using birdie::voice::AddressabilityDecision;
using birdie::voice::AddressabilityEvidence;
using birdie::voice::AddressabilityResult;
using birdie::voice::RuleBasedAddressabilityGate;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

void test_explicit_activation_accepts() {
  RuleBasedAddressabilityGate gate;
  AddressabilityEvidence evidence;
  evidence.explicit_activation = true;
  evidence.media_likelihood = 0.4;

  const AddressabilityResult result = gate.evaluate(evidence);
  require(result.decision == AddressabilityDecision::Accept,
          "explicit activation must accept");
  require(result.reason == "ADDRESSABILITY.EXPLICIT_ACTIVATION",
          "explicit activation reason must be stable");
}

void test_follow_up_context_accepts_short_reply() {
  RuleBasedAddressabilityGate gate;
  AddressabilityEvidence evidence;
  evidence.follow_up_window = true;
  evidence.follow_up_semantics_match = true;
  evidence.assistant_intent = 0.12;
  evidence.asr_confidence = 0.72;

  const AddressabilityResult result = gate.evaluate(evidence);
  require(result.decision == AddressabilityDecision::Accept,
          "matching follow-up must accept even without standalone intent");
  require(result.reason == "ADDRESSABILITY.FOLLOW_UP_MATCH",
          "follow-up reason must be stable");
}

void test_multiple_independent_signals_accept() {
  RuleBasedAddressabilityGate gate;
  AddressabilityEvidence evidence;
  evidence.assistant_intent = 0.95;
  evidence.acoustic_proximity = 0.92;
  evidence.asr_confidence = 0.88;
  evidence.speaker_match = 0.81;
  evidence.recently_active = true;

  const AddressabilityResult result = gate.evaluate(evidence);
  require(result.decision == AddressabilityDecision::Accept,
          "strong multi-signal evidence must accept");
  require(result.positive_evidence_families >= 2,
          "accept must be supported by independent evidence families");
}

void test_owner_voice_alone_does_not_accept() {
  RuleBasedAddressabilityGate gate;
  AddressabilityEvidence evidence;
  evidence.speaker_match = 0.99;
  evidence.assistant_intent = 0.38;
  evidence.acoustic_proximity = 0.35;
  evidence.asr_confidence = 0.55;

  const AddressabilityResult result = gate.evaluate(evidence);
  require(result.decision != AddressabilityDecision::Accept,
          "owner speaker match alone must never accept");
}

void test_ambiguous_request_abstains() {
  RuleBasedAddressabilityGate gate;
  AddressabilityEvidence evidence;
  evidence.assistant_intent = 0.64;
  evidence.acoustic_proximity = 0.52;
  evidence.asr_confidence = 0.61;
  evidence.speaker_match = 0.54;
  evidence.recently_active = true;
  evidence.media_likelihood = 0.18;

  const AddressabilityResult result = gate.evaluate(evidence);
  require(result.decision == AddressabilityDecision::Abstain,
          "ambiguous evidence must abstain instead of guessing");
  require(result.reason == "ADDRESSABILITY.UNCERTAIN",
          "abstain reason must be stable");
}

void test_media_and_overlap_are_vetoes() {
  RuleBasedAddressabilityGate gate;
  AddressabilityEvidence media;
  media.assistant_intent = 1.0;
  media.acoustic_proximity = 1.0;
  media.asr_confidence = 1.0;
  media.media_likelihood = 0.95;
  require(gate.evaluate(media).decision == AddressabilityDecision::Reject,
          "media evidence must veto apparent assistant intent");

  AddressabilityEvidence overlap;
  overlap.assistant_intent = 1.0;
  overlap.acoustic_proximity = 1.0;
  overlap.asr_confidence = 1.0;
  overlap.overlap_likelihood = 0.95;
  require(gate.evaluate(overlap).decision == AddressabilityDecision::Reject,
          "multiple-speaker overlap must veto apparent assistant intent");
}

void test_non_finite_inputs_are_safe() {
  RuleBasedAddressabilityGate gate;
  AddressabilityEvidence evidence;
  evidence.assistant_intent = std::numeric_limits<double>::quiet_NaN();
  evidence.acoustic_proximity = std::numeric_limits<double>::infinity();

  const AddressabilityResult result = gate.evaluate(evidence);
  require(result.decision == AddressabilityDecision::Reject,
          "non-finite inputs must not create an accidental activation");
}

}  // namespace

int main() {
  try {
    test_explicit_activation_accepts();
    test_follow_up_context_accepts_short_reply();
    test_multiple_independent_signals_accept();
    test_owner_voice_alone_does_not_accept();
    test_ambiguous_request_abstains();
    test_media_and_overlap_are_vetoes();
    test_non_finite_inputs_are_safe();
    std::cout << "birdie-addressability-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-addressability-tests: FAIL: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
