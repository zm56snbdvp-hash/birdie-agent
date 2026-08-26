#include "birdie/voice/addressability.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace birdie::voice {
namespace {

double unit(const double value) noexcept {
  if (!std::isfinite(value)) return 0.0;
  return std::clamp(value, 0.0, 1.0);
}

AddressabilityConfidenceBand band_for_score(const double score) noexcept {
  if (score >= 0.78 || score <= 0.22) {
    return AddressabilityConfidenceBand::High;
  }
  if (score >= 0.62 || score <= 0.38) {
    return AddressabilityConfidenceBand::Medium;
  }
  return AddressabilityConfidenceBand::Low;
}

}  // namespace

RuleBasedAddressabilityGate::RuleBasedAddressabilityGate(
    AddressabilityPolicy policy)
    : policy_(std::move(policy)) {
  const auto valid_threshold = [](const double value) {
    return std::isfinite(value) && value >= 0.0 && value <= 1.0;
  };
  if (!valid_threshold(policy_.positive_family_threshold) ||
      !valid_threshold(policy_.accept_threshold) ||
      !valid_threshold(policy_.reject_threshold) ||
      !valid_threshold(policy_.media_veto_threshold) ||
      !valid_threshold(policy_.overlap_veto_threshold) ||
      policy_.reject_threshold >= policy_.accept_threshold ||
      policy_.minimum_positive_families == 0) {
    throw std::invalid_argument("invalid Birdie addressability policy");
  }
}

AddressabilityResult RuleBasedAddressabilityGate::evaluate(
    const AddressabilityEvidence& raw) const {
  const double intent = unit(raw.assistant_intent);
  const double proximity = unit(raw.acoustic_proximity);
  const double asr = unit(raw.asr_confidence);
  const double speaker = unit(raw.speaker_match);
  const double media = unit(raw.media_likelihood);
  const double overlap = unit(raw.overlap_likelihood);

  if (raw.explicit_activation) {
    return {
        AddressabilityDecision::Accept,
        AddressabilityConfidenceBand::Explicit,
        1.0,
        1,
        "ADDRESSABILITY.EXPLICIT_ACTIVATION",
    };
  }

  if (raw.strong_negative_evidence ||
      media >= policy_.media_veto_threshold ||
      overlap >= policy_.overlap_veto_threshold) {
    return {
        AddressabilityDecision::Reject,
        AddressabilityConfidenceBand::High,
        0.0,
        0,
        raw.strong_negative_evidence
            ? "ADDRESSABILITY.STRONG_NEGATIVE_EVIDENCE"
            : media >= policy_.media_veto_threshold
                ? "ADDRESSABILITY.MEDIA_VETO"
                : "ADDRESSABILITY.OVERLAP_VETO",
    };
  }

  if (raw.follow_up_window && raw.follow_up_semantics_match &&
      media < 0.55 && overlap < 0.55) {
    return {
        AddressabilityDecision::Accept,
        AddressabilityConfidenceBand::High,
        std::max(0.85, (intent + asr + 1.0) / 3.0),
        2,
        "ADDRESSABILITY.FOLLOW_UP_MATCH",
    };
  }

  std::size_t positive_families = 0;
  positive_families += raw.direct_address ? 1U : 0U;
  positive_families += intent >= policy_.positive_family_threshold ? 1U : 0U;
  positive_families += proximity >= policy_.positive_family_threshold ? 1U : 0U;
  positive_families += asr >= policy_.positive_family_threshold ? 1U : 0U;
  positive_families += speaker >= policy_.positive_family_threshold ? 1U : 0U;
  positive_families += raw.recently_active ? 1U : 0U;

  double score =
      (raw.direct_address ? 0.18 : 0.0) +
      intent * 0.34 +
      proximity * 0.18 +
      asr * 0.16 +
      speaker * 0.10 +
      (raw.recently_active ? 0.12 : 0.0) +
      (raw.follow_up_window ? 0.10 : 0.0) -
      media * 0.25 -
      overlap * 0.20;
  score = unit(score);

  if (score >= policy_.accept_threshold &&
      positive_families >= policy_.minimum_positive_families) {
    return {
        AddressabilityDecision::Accept,
        band_for_score(score),
        score,
        positive_families,
        "ADDRESSABILITY.MULTI_SIGNAL_ACCEPT",
    };
  }

  if (score <= policy_.reject_threshold) {
    return {
        AddressabilityDecision::Reject,
        band_for_score(score),
        score,
        positive_families,
        "ADDRESSABILITY.LOW_SCORE_REJECT",
    };
  }

  return {
      AddressabilityDecision::Abstain,
      band_for_score(score),
      score,
      positive_families,
      "ADDRESSABILITY.UNCERTAIN",
  };
}

const char* addressability_decision_name(
    const AddressabilityDecision decision) noexcept {
  switch (decision) {
    case AddressabilityDecision::Accept: return "ACCEPT";
    case AddressabilityDecision::Reject: return "REJECT";
    case AddressabilityDecision::Abstain: return "ABSTAIN";
  }
  return "ABSTAIN";
}

const char* addressability_confidence_name(
    const AddressabilityConfidenceBand confidence) noexcept {
  switch (confidence) {
    case AddressabilityConfidenceBand::Low: return "LOW";
    case AddressabilityConfidenceBand::Medium: return "MEDIUM";
    case AddressabilityConfidenceBand::High: return "HIGH";
    case AddressabilityConfidenceBand::Explicit: return "EXPLICIT";
  }
  return "LOW";
}

}  // namespace birdie::voice
