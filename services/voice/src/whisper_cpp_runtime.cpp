#include "birdie/voice/whisper_cpp_gate_stt.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <system_error>
#include <utility>

#ifdef BIRDIE_WITH_WHISPER_CPP
#include <whisper.h>
#endif

namespace birdie::voice {
namespace {

std::string safe_model_id(const std::string& model_path) {
  if (model_path.empty()) return "whisper.cpp/unconfigured";
  const std::filesystem::path path(model_path);
  const std::string filename = path.filename().string();
  return "whisper.cpp/" +
         (filename.empty() ? std::string("configured-model") : filename);
}

std::string configuration_error(const WhisperCppGateSttConfig& config) {
  if (config.model_path.empty()) {
    return "VOICE.GATE_STT.WHISPER_CPP_MODEL_PATH_REQUIRED";
  }
  std::error_code error;
  if (!std::filesystem::is_regular_file(config.model_path, error)) {
    return "VOICE.GATE_STT.WHISPER_CPP_MODEL_NOT_FOUND";
  }
  return {};
}

void trim(std::string& value) {
  const auto not_space = [](const unsigned char byte) {
    return std::isspace(byte) == 0;
  };
  const auto first = std::find_if(value.begin(), value.end(), not_space);
  const auto last = std::find_if(value.rbegin(), value.rend(), not_space).base();
  if (first >= last) {
    value.clear();
    return;
  }
  value.assign(first, last);
}

class UnavailableWhisperCppRuntime final : public IWhisperCppRuntime {
 public:
  UnavailableWhisperCppRuntime(std::string model_id, std::string error_code)
      : model_id_(std::move(model_id)),
        error_code_(std::move(error_code)) {}

  [[nodiscard]] bool ready() const noexcept override { return false; }
  [[nodiscard]] std::string model_id() const override { return model_id_; }
  [[nodiscard]] std::string error_code() const override {
    return error_code_;
  }

  [[nodiscard]] WhisperCppDecodeResult decode(
      std::span<const float>) override {
    WhisperCppDecodeResult result;
    result.status = WhisperCppDecodeStatus::Failed;
    result.error_code = error_code_;
    return result;
  }

 private:
  std::string model_id_;
  std::string error_code_;
};

#ifdef BIRDIE_WITH_WHISPER_CPP

void discard_whisper_log(enum ggml_log_level, const char*, void*) {}

struct WhisperContextDeleter {
  void operator()(whisper_context* context) const noexcept {
    if (context != nullptr) whisper_free(context);
  }
};

struct WhisperStateDeleter {
  void operator()(whisper_state* state) const noexcept {
    if (state != nullptr) whisper_free_state(state);
  }
};

using WhisperContextPtr =
    std::unique_ptr<whisper_context, WhisperContextDeleter>;
using WhisperStatePtr = std::unique_ptr<whisper_state, WhisperStateDeleter>;

class NativeWhisperCppRuntime final : public IWhisperCppRuntime {
 public:
  explicit NativeWhisperCppRuntime(WhisperCppGateSttConfig config)
      : config_(std::move(config)),
        model_id_(safe_model_id(config_.model_path)) {
    error_code_ = configuration_error(config_);
    if (!error_code_.empty()) return;

    // whisper.cpp logging is process-global. Birdie disables it because model
    // diagnostics are already represented by stable operational error codes and
    // no transcript text should ever reach stderr.
    whisper_log_set(discard_whisper_log, nullptr);

    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = config_.use_gpu;
    params.flash_attn = config_.flash_attention;

    context_.reset(whisper_init_from_file_with_params_no_state(
        config_.model_path.c_str(), params));
    if (!context_) {
      error_code_ = "VOICE.GATE_STT.WHISPER_CPP_MODEL_LOAD_FAILED";
    }
  }

  [[nodiscard]] bool ready() const noexcept override {
    return context_ != nullptr;
  }

  [[nodiscard]] std::string model_id() const override { return model_id_; }

  [[nodiscard]] std::string error_code() const override {
    return error_code_;
  }

  [[nodiscard]] WhisperCppDecodeResult decode(
      const std::span<const float> samples) override {
    std::scoped_lock lock(mutex_);
    WhisperCppDecodeResult result;
    if (!context_) {
      result.error_code = error_code_.empty()
          ? "VOICE.GATE_STT.WHISPER_CPP_UNAVAILABLE"
          : error_code_;
      return result;
    }
    if (samples.empty() ||
        samples.size() >
            static_cast<std::size_t>(std::numeric_limits<int>::max())) {
      result.error_code = "VOICE.GATE_STT.WHISPER_CPP_INVALID_AUDIO";
      return result;
    }

    WhisperStatePtr state(whisper_init_state(context_.get()));
    if (!state) {
      result.error_code = "VOICE.GATE_STT.WHISPER_CPP_STATE_INIT_FAILED";
      return result;
    }

    whisper_full_params params =
        whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = config_.threads;
    params.translate = false;
    params.no_context = true;
    params.no_timestamps = true;
    params.single_segment = true;
    params.print_special = false;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.token_timestamps = false;
    params.max_tokens = config_.maximum_tokens;
    params.language = config_.language.c_str();
    params.detect_language = config_.language == "auto";
    params.suppress_blank = true;
    params.suppress_nst = true;
    params.temperature = 0.0F;
    params.temperature_inc = 0.0F;
    params.no_speech_thold =
        static_cast<float>(config_.no_speech_threshold);
    params.greedy.best_of = 1;

    const int status = whisper_full_with_state(
        context_.get(), state.get(), params, samples.data(),
        static_cast<int>(samples.size()));
    if (status != 0) {
      result.error_code = "VOICE.GATE_STT.WHISPER_CPP_INFERENCE_FAILED";
      return result;
    }

    const int language_id = whisper_full_lang_id_from_state(state.get());
    if (const char* language = whisper_lang_str(language_id);
        language != nullptr) {
      result.language = language;
    }

    const int segment_count =
        whisper_full_n_segments_from_state(state.get());
    double probability_sum = 0.0;
    std::size_t probability_count = 0;
    double maximum_no_speech_probability = 0.0;
    const whisper_token end_of_text = whisper_token_eot(context_.get());

    for (int segment = 0; segment < segment_count; ++segment) {
      if (const char* text =
              whisper_full_get_segment_text_from_state(state.get(), segment);
          text != nullptr) {
        result.transcript.append(text);
      }

      const double no_speech_probability =
          whisper_full_get_segment_no_speech_prob_from_state(
              state.get(), segment);
      if (std::isfinite(no_speech_probability)) {
        maximum_no_speech_probability = std::max(
            maximum_no_speech_probability,
            std::clamp(no_speech_probability, 0.0, 1.0));
      }

      const int token_count =
          whisper_full_n_tokens_from_state(state.get(), segment);
      for (int token = 0; token < token_count; ++token) {
        const whisper_token token_id =
            whisper_full_get_token_id_from_state(state.get(), segment, token);
        if (token_id >= end_of_text) continue;

        const double probability =
            whisper_full_get_token_p_from_state(state.get(), segment, token);
        if (!std::isfinite(probability)) continue;
        probability_sum += std::clamp(probability, 0.0, 1.0);
        probability_count += 1;
      }
    }

    trim(result.transcript);
    result.no_speech_probability = segment_count > 0
        ? maximum_no_speech_probability
        : 1.0;
    result.confidence = probability_count > 0
        ? probability_sum / static_cast<double>(probability_count)
        : 0.0;

    if (result.transcript.empty() || segment_count == 0 ||
        result.no_speech_probability >= config_.no_speech_threshold) {
      result.status = WhisperCppDecodeStatus::NoSpeech;
      result.transcript.clear();
      result.error_code = "VOICE.GATE_STT.NO_SPEECH";
      return result;
    }

    result.status = WhisperCppDecodeStatus::Transcript;
    result.error_code.clear();
    return result;
  }

 private:
  WhisperCppGateSttConfig config_;
  std::string model_id_;
  std::string error_code_;
  WhisperContextPtr context_;
  std::mutex mutex_;
};

#endif

}  // namespace

std::unique_ptr<IWhisperCppRuntime> create_whisper_cpp_runtime(
    const WhisperCppGateSttConfig& config) {
  const std::string model_id = safe_model_id(config.model_path);
  if (const std::string error = configuration_error(config); !error.empty()) {
    return std::make_unique<UnavailableWhisperCppRuntime>(model_id, error);
  }

#ifdef BIRDIE_WITH_WHISPER_CPP
  return std::make_unique<NativeWhisperCppRuntime>(config);
#else
  return std::make_unique<UnavailableWhisperCppRuntime>(
      model_id, "VOICE.GATE_STT.WHISPER_CPP_NOT_BUILT");
#endif
}

}  // namespace birdie::voice
