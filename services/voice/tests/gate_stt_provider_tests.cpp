#include "birdie/voice/gate_stt_provider.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

using birdie::voice::GateSttProviderConfig;
using birdie::voice::GateSttRequest;
using birdie::voice::GateSttStatus;
using birdie::voice::create_gate_stt_provider;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

GateSttRequest request() {
  GateSttRequest value;
  value.activity_id = "activity-provider-selection";
  value.samples.assign(1'600, 0.05F);
  value.sample_rate = 16'000;
  value.channels = 1;
  return value;
}

void test_default_provider_is_unavailable() {
  GateSttProviderConfig config;
  auto selection = create_gate_stt_provider(config);

  require(selection.provider != nullptr,
          "provider selection must always return a concrete boundary");
  require(selection.info.active_provider == "unavailable",
          "default provider must stay fail-closed");
  require(selection.info.status == "UNAVAILABLE",
          "default provider status must be truthful");
  require(selection.provider->transcribe(request()).status ==
              GateSttStatus::Unavailable,
          "default provider must not accept local speech");
}

void test_unknown_provider_does_not_fallback_to_activation() {
  GateSttProviderConfig config;
  config.provider = "mystery-cloud-adapter";
  auto selection = create_gate_stt_provider(config);

  require(selection.info.requested_provider == "mystery-cloud-adapter",
          "requested provider must remain observable");
  require(selection.info.active_provider == "unavailable",
          "unknown provider must not be substituted silently");
  require(selection.info.error_code == "VOICE.GATE_STT.PROVIDER_UNKNOWN",
          "unknown provider must use a stable error code");
}

void test_whisper_cpp_requires_an_explicit_model_path() {
  GateSttProviderConfig config;
  config.provider = "whisper.cpp";
  auto selection = create_gate_stt_provider(config);

  require(selection.info.active_provider == "whisper.cpp",
          "whisper.cpp request must preserve selected provider identity");
  require(selection.info.status == "UNAVAILABLE",
          "missing model must keep whisper.cpp unavailable");
  require(selection.info.error_code ==
              "VOICE.GATE_STT.WHISPER_CPP_MODEL_PATH_REQUIRED",
          "missing model must be diagnosed before any inference");
  require(selection.provider->transcribe(request()).status ==
              GateSttStatus::Unavailable,
          "missing model must fail closed at runtime");
}

void test_invalid_whisper_config_is_contained() {
  GateSttProviderConfig config;
  config.provider = "whisper_cpp";
  config.whisper_cpp.model_path = "does-not-exist.bin";
  config.whisper_cpp.threads = 0;
  auto selection = create_gate_stt_provider(config);

  require(selection.info.active_provider == "unavailable",
          "invalid provider config must fall back only to unavailable");
  require(selection.info.error_code ==
              "VOICE.GATE_STT.PROVIDER_CONFIG_INVALID",
          "invalid provider config must expose a stable error code");
}

}  // namespace

int main() {
  try {
    test_default_provider_is_unavailable();
    test_unknown_provider_does_not_fallback_to_activation();
    test_whisper_cpp_requires_an_explicit_model_path();
    test_invalid_whisper_config_is_contained();
    std::cout << "birdie-gate-stt-provider-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-gate-stt-provider-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
