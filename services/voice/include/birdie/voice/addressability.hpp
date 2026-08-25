#pragma once

#include <cstddef>
#include <string>

namespace birdie::voice {

enum class AddressabilityDecision {
  Accept,
  Reject,
  Abstain,
};

enum class AddressabilityConfidenceBand {
  Low,
  Medium,
  High,
  Explicit,
};

struct AddressabilityEvidence {
  bool explicit_activation{false};
  bool follow_up_window{false};
  bool follow_up_semantics_match{false};
  bool recently_active{false};
  bool strong_negative_evidence{false};

  double assistant_intent{0.0};
  double acoustic_proximity{0.0};
  double asr_confidence{0.0};
  double speaker_match{0.0};
  double media_likelihood{0.0};
  double overlap_likelihood{0.0};
};

struct AddressabilityPolicy {
  double positive_family_threshold{0.65};
  double accept_threshold{0.72};
  double reject_threshold{0.24};
  double media_veto_threshold{0.78};
  double overlap_veto_threshold{0.82};
  std::size_t minimum_positive_families{2};
};

struct AddressabilityResult {
  AddressabilityDecision decision{AddressabilityDecision::Abstain};
  AddressabilityConfidenceBand confidence_band{
      AddressabilityConfidenceBand::Medium};
  double score{0.5};
  std::size_t positive_evidence_families{0};
  std::string reason{"ADDRESSABILITY.UNCERTAIN"};
};

class RuleBasedAddressabilityGate {
 public:
  explicit RuleBasedAddressabilityGate(
      AddressabilityPolicy policy = AddressabilityPolicy{});

  [[nodiscard]] AddressabilityResult evaluate(
      const AddressabilityEvidence& evidence) const;

 private:
  AddressabilityPolicy policy_;
};

[[nodiscard]] const char* addressability_decision_name(
    AddressabilityDecision decision) noexcept;
[[nodiscard]] const char* addressability_confidence_name(
    AddressabilityConfidenceBand confidence) noexcept;

}  // namespace birdie::voice
