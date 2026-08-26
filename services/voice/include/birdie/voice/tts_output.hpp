#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace birdie::voice {

enum class TtsStatus {
  Completed,
  Unavailable,
  Failed,
  Cancelled,
};

struct TtsRequest {
  std::string turn_id;
  std::string output_id;
  std::string text;
  std::string language{"und"};
  std::string data_classification{"content"};
};

struct TtsResult {
  TtsStatus status{TtsStatus::Unavailable};
  std::uint64_t duration_ms{0};
  std::string provider{"disabled"};
  std::string voice_id{"none"};
  std::string error_code{"VOICE.TTS.UNAVAILABLE"};
};

class ITtsOutput {
 public:
  virtual ~ITtsOutput() = default;
  [[nodiscard]] virtual TtsResult speak(const TtsRequest& request) = 0;
};

class DisabledTtsOutput final : public ITtsOutput {
 public:
  [[nodiscard]] TtsResult speak(const TtsRequest& request) override;
};

#ifdef _WIN32
[[nodiscard]] std::unique_ptr<ITtsOutput> create_windows_sapi_tts(
    long rate, unsigned long volume);
#endif

struct TtsProviderConfig {
  std::string provider{"disabled"};
  long rate{0};
  unsigned long volume{100};
};

struct TtsProviderInfo {
  std::string requested_provider{"disabled"};
  std::string active_provider{"disabled"};
  std::string status{"UNAVAILABLE"};
  std::string voice_id{"none"};
  std::string error_code{"VOICE.TTS.UNAVAILABLE"};
};

struct TtsProviderSelection {
  std::unique_ptr<ITtsOutput> provider;
  TtsProviderInfo info;
};

[[nodiscard]] TtsProviderConfig
load_tts_provider_config_from_environment();
[[nodiscard]] TtsProviderSelection create_tts_provider(
    TtsProviderConfig config);

enum class TtsWorkerStage {
  Started,
  Completed,
  Failed,
  Cancelled,
};

struct TtsWorkerUpdate {
  TtsWorkerStage stage{TtsWorkerStage::Failed};
  std::string turn_id;
  std::string output_id;
  std::string language{"und"};
  std::string data_classification{"content"};
  std::uint64_t duration_ms{0};
  std::string provider{"disabled"};
  std::string voice_id{"none"};
  std::string error_code;
};

class TtsOutputWorker final {
 public:
  using UpdateCallback = std::function<void(TtsWorkerUpdate update)>;

  TtsOutputWorker(ITtsOutput& provider, UpdateCallback callback);
  ~TtsOutputWorker();

  TtsOutputWorker(const TtsOutputWorker&) = delete;
  TtsOutputWorker& operator=(const TtsOutputWorker&) = delete;

  // One speech request may be active at a time. A second output is rejected so
  // its owning turn can fail explicitly instead of being silently queued.
  bool submit(TtsRequest request);
  void stop() noexcept;

  [[nodiscard]] bool busy() const noexcept;
  [[nodiscard]] std::uint64_t rejected_jobs() const noexcept;

 private:
  void run() noexcept;

  ITtsOutput& provider_;
  UpdateCallback callback_;

  mutable std::mutex mutex_;
  std::condition_variable wake_;
  std::optional<TtsRequest> pending_;
  bool active_{false};
  bool stopping_{false};
  std::thread thread_;
  std::atomic<std::uint64_t> rejected_jobs_{0};
};

void secure_clear(TtsRequest& request) noexcept;
void secure_clear(TtsWorkerUpdate& update) noexcept;

[[nodiscard]] const char* tts_status_name(TtsStatus status) noexcept;
[[nodiscard]] const char* tts_worker_stage_name(
    TtsWorkerStage stage) noexcept;

}  // namespace birdie::voice
