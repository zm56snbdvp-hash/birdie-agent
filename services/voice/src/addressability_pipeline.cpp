#include "birdie/voice/addressability_pipeline.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace birdie::voice {
namespace {

class RequestWiper final {
 public:
  explicit RequestWiper(GateSttRequest& request) : request_(request) {}
  ~RequestWiper() { secure_clear(request_); }

  RequestWiper(const RequestWiper&) = delete;
  RequestWiper& operator=(const RequestWiper&) = delete;

 private:
  GateSttRequest& request_;
};

class ResultWiper final {
 public:
  explicit ResultWiper(GateSttResult& result) : result_(result) {}
  ~ResultWiper() { secure_clear(result_); }

  ResultWiper(const ResultWiper&) = delete;
  ResultWiper& operator=(const ResultWiper&) = delete;

 private:
  GateSttResult& result_;
};

double unit(const double value, const double fallback = 0.0) noexcept {
  if (!std::isfinite(value)) return fallback;
  return std::clamp(value, 0.0, 1.0);
}

void replace_all(std::string& value, const std::string_view from,
                 const std::string_view to) {
  std::size_t offset = 0;
  while ((offset = value.find(from, offset)) != std::string::npos) {
    value.replace(offset, from.size(), to);
    offset += to.size();
  }
}

std::string normalize_text(std::string text) {
  replace_all(text, "Ä", "ä");
  replace_all(text, "Ö", "ö");
  replace_all(text, "Ü", "ü");
  replace_all(text, "ẞ", "ß");

  std::string normalized;
  normalized.reserve(text.size());
  bool previous_space = true;
  for (const unsigned char byte : text) {
    if (byte < 0x80) {
      if (std::isalnum(byte) != 0) {
        normalized.push_back(static_cast<char>(std::tolower(byte)));
        previous_space = false;
      } else if (!previous_space) {
        normalized.push_back(' ');
        previous_space = true;
      }
    } else {
      normalized.push_back(static_cast<char>(byte));
      previous_space = false;
    }
  }
  while (!normalized.empty() && normalized.back() == ' ') {
    normalized.pop_back();
  }
  return normalized;
}

bool contains_token(const std::string_view text, const std::string_view token) {
  std::size_t offset = 0;
  while ((offset = text.find(token, offset)) != std::string_view::npos) {
    const bool left_boundary = offset == 0 || text[offset - 1] == ' ';
    const std::size_t right = offset + token.size();
    const bool right_boundary = right == text.size() || text[right] == ' ';
    if (left_boundary && right_boundary) return true;
    offset = right;
  }
  return false;
}

bool starts_with_any(
    const std::string_view text,
    const std::span<const std::string_view> prefixes) {
  return std::any_of(prefixes.begin(), prefixes.end(), [&](const auto prefix) {
    return text == prefix ||
           (text.size() > prefix.size() && text.starts_with(prefix) &&
            text[prefix.size()] == ' ');
  });
}

bool contains_any(
    const std::string_view text,
    const std::span<const std::string_view> phrases) {
  return std::any_of(phrases.begin(), phrases.end(), [&](const auto phrase) {
    return text.find(phrase) != std::string_view::npos;
  });
}

bool direct_address(const std::string_view normalized) {
  return contains_token(normalized, "birdie");
}

double assistant_intent(const std::string_view normalized,
                        const bool is_direct_address) {
  if (is_direct_address) return 0.98;

  static constexpr std::array<std::string_view, 10> direct_phrases{
      "kannst du", "könntest du", "koenntest du", "würdest du",
      "wuerdest du", "bitte", "can you", "could you", "would you",
      "please",
  };
  if (contains_any(normalized, direct_phrases)) return 0.90;

  static constexpr std::array<std::string_view, 20> command_starters{
      "öffne", "oeffne", "starte", "stoppe", "stopp", "beende",
      "zeige", "sag", "sage", "schreib", "schreibe", "erinnere",
      "stell", "stelle", "mach", "mache", "suche", "finde", "open",
      "show",
  };
  if (starts_with_any(normalized, command_starters)) return 0.86;

  static constexpr std::array<std::string_view, 14> question_starters{
      "was", "wie", "wann", "wo", "warum", "welche", "welcher",
      "welches", "wer", "wieviel", "wie viel", "what", "how", "when",
  };
  if (starts_with_any(normalized, question_starters)) return 0.72;

  return 0.18;
}

bool follow_up_semantics(const std::string_view normalized) {
  static constexpr std::array<std::string_view, 22> exact_follow_ups{
      "ja", "nein", "genau", "okay", "ok", "bitte", "weiter",
      "stopp", "stop", "abbrechen", "mach das", "mache das", "gern",
      "gerne", "passt", "richtig", "falsch", "yes", "no", "continue",
      "cancel", "do it",
  };
  return std::find(exact_follow_ups.begin(), exact_follow_ups.end(),
                   normalized) != exact_follow_ups.end();
}

double estimate_acoustic_proximity(const GateSttRequest& request) {
  if (request.samples.empty() || request.sample_rate == 0 ||
      request.channels == 0) {
    return 0.0;
  }

  const std::size_t samples_per_window = std::max<std::size_t>(
      request.channels,
      (static_cast<std::size_t>(request.sample_rate) * request.channels) / 50);
  double maximum_rms = 0.0;
  for (std::size_t offset = 0; offset < request.samples.size();
       offset += samples_per_window) {
    const std::size_t end =
        std::min(request.samples.size(), offset + samples_per_window);
    double sum = 0.0;
    for (std::size_t index = offset; index < end; ++index) {
      const double sample = static_cast<double>(request.samples[index]);
      sum += sample * sample;
    }
    const double count = static_cast<double>(end - offset);
    if (count > 0.0) maximum_rms = std::max(maximum_rms, std::sqrt(sum / count));
  }

  constexpr double quiet_rms = 0.008;
  constexpr double near_rms = 0.100;
  return unit((maximum_rms - quiet_rms) / (near_rms - quiet_rms));
}

AddressabilityResult terminal_result(
    const AddressabilityDecision decision,
    const AddressabilityConfidenceBand confidence_band,
    const double score,
    std::string reason) {
  return {
      decision,
      confidence_band,
      unit(score, 0.5),
      0,
      std::move(reason),
  };
}

}  // namespace

AddressabilityEvidencePipeline::AddressabilityEvidencePipeline(
    IGateStt& gate_stt,
    RuleBasedAddressabilityGate gate,
    AddressabilityPipelineConfig config)
    : gate_stt_(gate_stt),
      gate_(std::move(gate)),
      config_(std::move(config)) {
  if (config_.maximum_gate_audio_ms == 0 ||
      config_.maximum_transcript_bytes == 0 ||
      !std::isfinite(config_.no_speech_reject_threshold) ||
      config_.no_speech_reject_threshold < 0.0 ||
      config_.no_speech_reject_threshold > 1.0 ||
      !std::isfinite(config_.unknown_media_likelihood) ||
      config_.unknown_media_likelihood < 0.0 ||
      config_.unknown_media_likelihood > 1.0 ||
      !std::isfinite(config_.unknown_overlap_likelihood) ||
      config_.unknown_overlap_likelihood < 0.0 ||
      config_.unknown_overlap_likelihood > 1.0) {
    throw std::invalid_argument("invalid Birdie addressability pipeline config");
  }
}

AddressabilityEvaluation AddressabilityEvidencePipeline::evaluate(
    GateSttRequest request,
    const AddressabilityContext& context) {
  RequestWiper request_wiper(request);
  AddressabilityEvaluation evaluation;
  evaluation.activity_id = request.activity_id;

  if (request.activity_id.empty() || request.samples.empty() ||
      request.sample_rate == 0 || request.channels != 1) {
    evaluation.gate_stt_status = GateSttStatus::Failed;
    evaluation.gate_stt_error_code = "VOICE.GATE_STT.INVALID_AUDIO";
    evaluation.result = terminal_result(
        AddressabilityDecision::Abstain,
        AddressabilityConfidenceBand::Low,
        0.5,
        "ADDRESSABILITY.INVALID_GATE_AUDIO");
    return evaluation;
  }

  const std::uint64_t audio_frames = request.samples.size() / request.channels;
  const std::uint64_t audio_ms = (audio_frames * 1'000) / request.sample_rate;
  if (audio_ms > config_.maximum_gate_audio_ms) {
    evaluation.gate_stt_status = GateSttStatus::Failed;
    evaluation.gate_stt_error_code = "VOICE.GATE_STT.AUDIO_TOO_LONG";
    evaluation.result = terminal_result(
        AddressabilityDecision::Abstain,
        AddressabilityConfidenceBand::Low,
        0.5,
        "ADDRESSABILITY.GATE_AUDIO_TOO_LONG");
    return evaluation;
  }

  GateSttResult stt;
  try {
    stt = gate_stt_.transcribe(request);
  } catch (...) {
    stt.status = GateSttStatus::Failed;
    stt.error_code = "VOICE.GATE_STT.EXCEPTION";
  }
  ResultWiper result_wiper(stt);

  stt.confidence = unit(stt.confidence);
  stt.no_speech_probability = unit(stt.no_speech_probability, 1.0);
  if (stt.transcript.size() > config_.maximum_transcript_bytes) {
    stt.transcript.resize(config_.maximum_transcript_bytes);
  }

  evaluation.gate_stt_status = stt.status;
  evaluation.language = stt.language.empty() ? "und" : stt.language;
  evaluation.gate_stt_error_code = stt.error_code;
  evaluation.gate_stt_confidence = stt.confidence;
  evaluation.no_speech_probability = stt.no_speech_probability;
  evaluation.gate_stt_latency_ms = stt.latency_ms;

  if (stt.status == GateSttStatus::Unavailable) {
    evaluation.result = terminal_result(
        AddressabilityDecision::Abstain,
        AddressabilityConfidenceBand::Low,
        0.5,
        "ADDRESSABILITY.GATE_STT_UNAVAILABLE");
    return evaluation;
  }

  if (stt.status == GateSttStatus::Failed) {
    evaluation.result = terminal_result(
        AddressabilityDecision::Abstain,
        AddressabilityConfidenceBand::Low,
        0.5,
        "ADDRESSABILITY.GATE_STT_FAILED");
    return evaluation;
  }

  if (stt.status == GateSttStatus::NoSpeech ||
      stt.no_speech_probability >= config_.no_speech_reject_threshold) {
    evaluation.result = terminal_result(
        AddressabilityDecision::Reject,
        AddressabilityConfidenceBand::High,
        0.0,
        "ADDRESSABILITY.NO_SPEECH");
    return evaluation;
  }

  const std::string normalized = normalize_text(stt.transcript);
  if (normalized.empty()) {
    evaluation.result = terminal_result(
        AddressabilityDecision::Abstain,
        AddressabilityConfidenceBand::Low,
        0.5,
        "ADDRESSABILITY.EMPTY_GATE_TRANSCRIPT");
    return evaluation;
  }

  AddressabilityEvidence evidence;
  evidence.explicit_activation = context.explicit_activation;
  evidence.direct_address = direct_address(normalized);
  evidence.follow_up_window = context.follow_up_window;
  evidence.follow_up_semantics_match =
      context.follow_up_window && follow_up_semantics(normalized);
  evidence.recently_active = context.recently_active;
  evidence.assistant_intent =
      assistant_intent(normalized, evidence.direct_address);
  evidence.acoustic_proximity = unit(
      context.acoustic_proximity.value_or(estimate_acoustic_proximity(request)));
  evidence.asr_confidence = stt.confidence;
  evidence.speaker_match = unit(context.speaker_match.value_or(0.0));
  evidence.media_likelihood = unit(context.media_likelihood.value_or(
      config_.unknown_media_likelihood));
  evidence.overlap_likelihood = unit(context.overlap_likelihood.value_or(
      config_.unknown_overlap_likelihood));

  evaluation.evidence = evidence;
  evaluation.result = gate_.evaluate(evidence);
  return evaluation;
}

}  // namespace birdie::voice
