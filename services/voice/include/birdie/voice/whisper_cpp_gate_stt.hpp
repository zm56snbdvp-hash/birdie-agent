#pragma once

#include "birdie/voice/gate_stt.hpp"

#include <cstdint>
#include <memory>
#include <span>
#include <string>

namespace birdie::voice {

struct WhisperCppGateSttConfig {
  std::string model_path;
  std::string language{"auto"};
  int threads{4};
  bool use_gpu{true};
  bool flash_attention{true};
  int maximum_tokens{64};
  double no_speech_threshold{0.60};
};

enum class WhisperCppDecodeStatus {
  Transcript,
  NoSpeech,
  Failed,
};

struct WhisperCppDecodeResult {
  WhisperCppDecodeStatus status{WhisperCppDecodeStatus::Failed};
  std::string transcript;
  std::string language{"und"};
  double confidence{0.0};
  double no_speech_probability{1.0};
  std::string error_code{"VOICE.GATE_STT.WHISPER_CPP_FAILED"};
};

class IWhisperCppRuntime {
 public:
  virtual ~IWhisperCppRuntime() = default;

  [[nodiscard]] virtual bool ready() const noexcept = 0;
  [[nodiscard]] virtual std::string model_id() const = 0;
  [[nodiscard]] virtual std::string error_code() const = 0;

  // The production implementation passes normalized 16 kHz mono float PCM
  // directly into whisper.cpp. It must not persist, upload or log the audio.
  [[nodiscard]] virtual WhisperCppDecodeResult decode(
      std::span<const float> samples) = 0;
};

class WhisperCppGateStt final : public IGateStt {
 public:
  WhisperCppGateStt(
      WhisperCppGateSttConfig config,
      std::unique_ptr<IWhisperCppRuntime> runtime);

  [[nodiscard]] GateSttResult transcribe(
      const GateSttRequest& request) override;

  [[nodiscard]] bool ready() const noexcept;
  [[nodiscard]] std::string model_id() const;
  [[nodiscard]] std::string error_code() const;

 private:
  WhisperCppGateSttConfig config_;
  std::unique_ptr<IWhisperCppRuntime> runtime_;
};

// Always available as a linkable factory. Without
// BIRDIE_WITH_WHISPER_CPP=ON it returns a fail-closed runtime whose error code
// explains that the optional native backend was not compiled into the host.
[[nodiscard]] std::unique_ptr<IWhisperCppRuntime>
create_whisper_cpp_runtime(const WhisperCppGateSttConfig& config);

[[nodiscard]] const char* whisper_cpp_decode_status_name(
    WhisperCppDecodeStatus status) noexcept;

}  // namespace birdie::voice
