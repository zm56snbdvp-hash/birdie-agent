#pragma once

#include "birdie/voice/addressability_pipeline.hpp"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <thread>

namespace birdie::voice {

class AddressabilityWorker final {
 public:
  using EvaluationCallback =
      std::function<void(AddressabilityEvaluation evaluation)>;

  AddressabilityWorker(AddressabilityEvidencePipeline& pipeline,
                       EvaluationCallback callback);
  ~AddressabilityWorker();

  AddressabilityWorker(const AddressabilityWorker&) = delete;
  AddressabilityWorker& operator=(const AddressabilityWorker&) = delete;

  // The queue intentionally contains at most one pending candidate. A newer
  // candidate replaces and securely clears an older pending candidate.
  bool submit(GateSttRequest request,
              AddressabilityContext context = AddressabilityContext{});
  void discard_pending() noexcept;
  void stop() noexcept;

  [[nodiscard]] std::uint64_t dropped_jobs() const noexcept;

 private:
  struct Job {
    GateSttRequest request;
    AddressabilityContext context;
  };

  void run() noexcept;

  AddressabilityEvidencePipeline& pipeline_;
  EvaluationCallback callback_;

  mutable std::mutex mutex_;
  std::condition_variable wake_;
  std::optional<Job> pending_;
  bool stopping_{false};
  std::thread thread_;
  std::atomic<std::uint64_t> dropped_jobs_{0};
};

}  // namespace birdie::voice
