#include "birdie/voice/gate_stt_provider.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <string_view>
#include <utility>

namespace birdie::voice {
namespace {

std::string environment_value(const char* name, std::string fallback = {}) {
  const char* value = std::getenv(name);
  return value == nullptr ? std::move(fallback) : std::string(value);
}

std::string normalized(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](const unsigned char byte) {
                   return static_cast<char>(std::tolower(byte));
                 });
  return value;
}

bool environment_bool(const char* name, const bool fallback) {
  const std::string value = normalized(environment_value(name));
  if (value.empty()) return fallback;
  if (value == "1" || value == "true" || value == "yes" ||
      value == "on") {
    return true;
  }
  if (value == "0" || value == "false" || value == "no" ||
      value == "off") {
    return false;
  }
  return fallback;
}

int environment_int(const char* name, const int fallback,
                    const int minimum, const int maximum) {
  const std::string value = environment_value(name);
  if (value.empty()) return fallback;
  int parsed = fallback;
  const auto [end, error] =
      std::from_chars(value.data(), value.data() + value.size(), parsed);
  if (error != std::errc{} || end != value.data() + value.size()) {
    return fallback;
  }
  return std::clamp(parsed, minimum, maximum);
}

double environment_double(const char* name, const double fallback,
                          const double minimum, const double maximum) {
  const std::string value = environment_value(name);
  if (value.empty()) return fallback;
  char* end = nullptr;
  const double parsed = std::strtod(value.c_str(), &end);
  if (end != value.c_str() + value.size() || !std::isfinite(parsed)) {
    return fallback;
  }
  return std::clamp(parsed, minimum, maximum);
}

bool is_whisper_cpp(const std::string_view provider) {
  return provider == "whisper.cpp" || provider == "whisper_cpp" ||
         provider == "whispercpp" || provider == "whisper";
}

GateSttProviderSelection unavailable_selection(
    std::string requested_provider,
    std::string error_code = "VOICE.GATE_STT.UNAVAILABLE") {
  GateSttProviderSelection selection;
  selection.provider = std::make_unique<UnavailableGateStt>();
  selection.info.requested_provider = std::move(requested_provider);
  selection.info.active_provider = "unavailable";
  selection.info.status = "UNAVAILABLE";
  selection.info.model_id = "unconfigured-local-gate-stt";
  selection.info.error_code = std::move(error_code);
  return selection;
}

}  // namespace

GateSttProviderConfig load_gate_stt_provider_config_from_environment() {
  GateSttProviderConfig config;
  config.provider = normalized(environment_value(
      "BIRDIE_GATE_STT_PROVIDER", "unavailable"));
  config.whisper_cpp.model_path =
      environment_value("BIRDIE_GATE_STT_MODEL");
  config.whisper_cpp.language = normalized(environment_value(
      "BIRDIE_GATE_STT_LANGUAGE", "auto"));
  if (config.whisper_cpp.language.empty()) {
    config.whisper_cpp.language = "auto";
  }
  config.whisper_cpp.threads = environment_int(
      "BIRDIE_GATE_STT_THREADS", config.whisper_cpp.threads, 1, 64);
  config.whisper_cpp.use_gpu = environment_bool(
      "BIRDIE_GATE_STT_USE_GPU", config.whisper_cpp.use_gpu);
  config.whisper_cpp.flash_attention = environment_bool(
      "BIRDIE_GATE_STT_FLASH_ATTN", config.whisper_cpp.flash_attention);
  config.whisper_cpp.maximum_tokens = environment_int(
      "BIRDIE_GATE_STT_MAX_TOKENS",
      config.whisper_cpp.maximum_tokens, 1, 256);
  config.whisper_cpp.no_speech_threshold = environment_double(
      "BIRDIE_GATE_STT_NO_SPEECH_THRESHOLD",
      config.whisper_cpp.no_speech_threshold, 0.0, 1.0);
  return config;
}

GateSttProviderSelection create_gate_stt_provider(
    GateSttProviderConfig config) {
  const std::string requested = normalized(config.provider);
  if (requested.empty() || requested == "unavailable" ||
      requested == "none" || requested == "off") {
    return unavailable_selection(requested.empty() ? "unavailable" : requested);
  }

  if (!is_whisper_cpp(requested)) {
    return unavailable_selection(
        requested, "VOICE.GATE_STT.PROVIDER_UNKNOWN");
  }

  try {
    auto runtime = create_whisper_cpp_runtime(config.whisper_cpp);
    auto provider = std::make_unique<WhisperCppGateStt>(
        std::move(config.whisper_cpp), std::move(runtime));

    GateSttProviderSelection selection;
    selection.info.requested_provider = requested;
    selection.info.active_provider = "whisper.cpp";
    selection.info.status = provider->ready() ? "READY" : "UNAVAILABLE";
    selection.info.model_id = provider->model_id();
    selection.info.error_code = provider->error_code();
    selection.provider = std::move(provider);
    return selection;
  } catch (...) {
    return unavailable_selection(
        requested, "VOICE.GATE_STT.PROVIDER_CONFIG_INVALID");
  }
}

}  // namespace birdie::voice
