#include "birdie/voice/tts_output.hpp"

#include <algorithm>
#include <charconv>
#include <cstdlib>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace birdie::voice {
namespace {

constexpr std::size_t kMaximumIdentifierBytes = 256;
constexpr std::size_t kMaximumLanguageBytes = 32;
constexpr std::size_t kMaximumOutputTextBytes = 16 * 1024;

void wipe(std::string& value) noexcept {
  std::fill(value.begin(), value.end(), '\0');
  value.clear();
}

std::string environment_value(const char* name) {
  if (const char* value = std::getenv(name)) return value;
  return {};
}

long parse_long(const std::string& value, const long fallback,
                const long minimum, const long maximum) {
  if (value.empty()) return fallback;
  long parsed = fallback;
  const auto [end, error] = std::from_chars(
      value.data(), value.data() + value.size(), parsed);
  if (error != std::errc{} || end != value.data() + value.size()) {
    return fallback;
  }
  return std::clamp(parsed, minimum, maximum);
}

bool valid_request(const TtsRequest& request) {
  return !request.turn_id.empty() &&
         request.turn_id.size() <= kMaximumIdentifierBytes &&
         !request.output_id.empty() &&
         request.output_id.size() <= kMaximumIdentifierBytes &&
         !request.text.empty() &&
         request.text.size() <= kMaximumOutputTextBytes &&
         !request.language.empty() &&
         request.language.size() <= kMaximumLanguageBytes &&
         (request.data_classification == "content" ||
          request.data_classification == "sensitive");
}

TtsWorkerUpdate update_from_request(
    const TtsRequest& request,
    const TtsWorkerStage stage) {
  TtsWorkerUpdate update;
  update.stage = stage;
  update.turn_id = request.turn_id;
  update.output_id = request.output_id;
  update.language = request.language;
  update.data_classification = request.data_classification;
  return update;
}

#ifdef _WIN32
std::unique_ptr<ITtsOutput> create_windows_sapi_tts(
    long rate, unsigned long volume);
#endif

}  // namespace

TtsResult DisabledTtsOutput::speak(const TtsRequest&) {
  return {
      TtsStatus::Unavailable,
      0,
      "disabled",
      "none",
      "VOICE.TTS.UNAVAILABLE",
  };
}

TtsProviderConfig load_tts_provider_config_from_environment() {
  TtsProviderConfig config;
  const std::string provider = environment_value("BIRDIE_TTS_PROVIDER");
  if (!provider.empty()) config.provider = provider;
  config.rate = parse_long(
      environment_value("BIRDIE_TTS_RATE"), 0, -10, 10);
  config.volume = static_cast<unsigned long>(parse_long(
      environment_value("BIRDIE_TTS_VOLUME"), 100, 0, 100));
  return config;
}

TtsProviderSelection create_tts_provider(TtsProviderConfig config) {
  std::transform(
      config.provider.begin(), config.provider.end(), config.provider.begin(),
      [](const unsigned char value) {
        return static_cast<char>(std::tolower(value));
      });

#ifdef _WIN32
  if (config.provider == "windows-sapi" || config.provider == "sapi") {
    return {
        create_windows_sapi_tts(config.rate, config.volume),
        {
            config.provider,
            "windows-sapi",
            "READY",
            "system-default",
            "",
        },
    };
  }
#endif

  const bool explicitly_disabled =
      config.provider.empty() || config.provider == "disabled";
  return {
      std::make_unique<DisabledTtsOutput>(),
      {
          config.provider.empty() ? "disabled" : config.provider,
          "disabled",
          "UNAVAILABLE",
          "none",
          explicitly_disabled
              ? "VOICE.TTS.UNAVAILABLE"
              : "VOICE.TTS.PROVIDER_UNKNOWN",
      },
  };
}

TtsOutputWorker::TtsOutputWorker(
    ITtsOutput& provider,
    UpdateCallback callback)
    : provider_(provider),
      callback_(std::move(callback)),
      thread_([this] { run(); }) {}

TtsOutputWorker::~TtsOutputWorker() { stop(); }

bool TtsOutputWorker::submit(TtsRequest request) {
  if (!valid_request(request)) {
    secure_clear(request);
    rejected_jobs_.fetch_add(1, std::memory_order_relaxed);
    return false;
  }

  {
    std::scoped_lock lock(mutex_);
    if (stopping_ || active_ || pending_) {
      secure_clear(request);
      rejected_jobs_.fetch_add(1, std::memory_order_relaxed);
      return false;
    }
    pending_ = std::move(request);
  }
  wake_.notify_one();
  return true;
}

void TtsOutputWorker::stop() noexcept {
  std::optional<TtsWorkerUpdate> cancelled;
  {
    std::scoped_lock lock(mutex_);
    if (stopping_) return;
    stopping_ = true;
    if (pending_) {
      cancelled = update_from_request(*pending_, TtsWorkerStage::Cancelled);
      cancelled->provider = "disabled";
      cancelled->voice_id = "none";
      cancelled->error_code = "VOICE.TTS.STOPPED";
      secure_clear(*pending_);
      pending_.reset();
      rejected_jobs_.fetch_add(1, std::memory_order_relaxed);
    }
  }

  try {
    if (cancelled && callback_) callback_(std::move(*cancelled));
  } catch (...) {
    if (cancelled) secure_clear(*cancelled);
  }

  wake_.notify_all();
  if (thread_.joinable()) thread_.join();
}

bool TtsOutputWorker::busy() const noexcept {
  std::scoped_lock lock(mutex_);
  return active_ || pending_.has_value();
}

std::uint64_t TtsOutputWorker::rejected_jobs() const noexcept {
  return rejected_jobs_.load(std::memory_order_relaxed);
}

void TtsOutputWorker::run() noexcept {
  for (;;) {
    std::optional<TtsRequest> request;
    {
      std::unique_lock lock(mutex_);
      wake_.wait(lock, [this] { return stopping_ || pending_.has_value(); });
      if (stopping_ && !pending_) return;
      request = std::move(pending_);
      pending_.reset();
      active_ = true;
    }

    TtsWorkerUpdate started =
        update_from_request(*request, TtsWorkerStage::Started);
    try {
      if (callback_) callback_(std::move(started));
    } catch (...) {
      secure_clear(started);
    }

    TtsResult result;
    try {
      result = provider_.speak(*request);
    } catch (...) {
      result.status = TtsStatus::Failed;
      result.provider = "unknown";
      result.voice_id = "unknown";
      result.error_code = "VOICE.TTS.EXCEPTION";
    }

    TtsWorkerUpdate finished = update_from_request(
        *request,
        result.status == TtsStatus::Completed
            ? TtsWorkerStage::Completed
            : result.status == TtsStatus::Cancelled
                ? TtsWorkerStage::Cancelled
                : TtsWorkerStage::Failed);
    finished.duration_ms = result.duration_ms;
    finished.provider = result.provider;
    finished.voice_id = result.voice_id;
    finished.error_code = result.error_code;

    secure_clear(*request);
    {
      std::scoped_lock lock(mutex_);
      active_ = false;
    }

    try {
      if (callback_) callback_(std::move(finished));
    } catch (...) {
      secure_clear(finished);
    }
  }
}

void secure_clear(TtsRequest& request) noexcept {
  wipe(request.turn_id);
  wipe(request.output_id);
  wipe(request.text);
  wipe(request.language);
  wipe(request.data_classification);
}

void secure_clear(TtsWorkerUpdate& update) noexcept {
  wipe(update.turn_id);
  wipe(update.output_id);
  wipe(update.language);
  wipe(update.data_classification);
  wipe(update.provider);
  wipe(update.voice_id);
  wipe(update.error_code);
  update.duration_ms = 0;
}

const char* tts_status_name(const TtsStatus status) noexcept {
  switch (status) {
    case TtsStatus::Completed: return "COMPLETED";
    case TtsStatus::Unavailable: return "UNAVAILABLE";
    case TtsStatus::Failed: return "FAILED";
    case TtsStatus::Cancelled: return "CANCELLED";
  }
  return "FAILED";
}

const char* tts_worker_stage_name(const TtsWorkerStage stage) noexcept {
  switch (stage) {
    case TtsWorkerStage::Started: return "STARTED";
    case TtsWorkerStage::Completed: return "COMPLETED";
    case TtsWorkerStage::Failed: return "FAILED";
    case TtsWorkerStage::Cancelled: return "CANCELLED";
  }
  return "FAILED";
}

}  // namespace birdie::voice
