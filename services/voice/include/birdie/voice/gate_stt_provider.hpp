#pragma once

#include "birdie/voice/gate_stt.hpp"
#include "birdie/voice/whisper_cpp_gate_stt.hpp"

#include <memory>
#include <string>

namespace birdie::voice {

struct GateSttProviderConfig {
  std::string provider{"unavailable"};
  WhisperCppGateSttConfig whisper_cpp;
};

struct GateSttProviderInfo {
  std::string requested_provider{"unavailable"};
  std::string active_provider{"unavailable"};
  std::string status{"UNAVAILABLE"};
  std::string model_id{"unconfigured-local-gate-stt"};
  std::string error_code{"VOICE.GATE_STT.UNAVAILABLE"};
};

struct GateSttProviderSelection {
  std::unique_ptr<IGateStt> provider;
  GateSttProviderInfo info;
};

[[nodiscard]] GateSttProviderConfig
load_gate_stt_provider_config_from_environment();

[[nodiscard]] GateSttProviderSelection create_gate_stt_provider(
    GateSttProviderConfig config);

}  // namespace birdie::voice
