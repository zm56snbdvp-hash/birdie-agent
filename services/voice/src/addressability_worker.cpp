#include "birdie/voice/addressability_worker.hpp"

#include <utility>

namespace birdie::voice {

AddressabilityWorker::AddressabilityWorker(
    AddressabilityEvidencePipeline& pipeline,
    EvaluationCallback callback)
    : pipeline_(pipeline), callback_(std::move(callback)) {
  if (!callback_) {
    throw std::invalid_argument(
        "AddressabilityWorker requires an evaluation callback");
  }
  thread_ = std::thread([this] { run(); });
}

AddressabilityWorker::~AddressabilityWorker() { stop(); }

bool AddressabilityWorker::submit(
    GateSttRequest request,
    AddressabilityContext context) {
  {
    std::scoped_lock lock(mutex_);
    if (stopping_) {
      secure_clear(request);
      return false;
    }
    if (pending_) {
      secure_clear(pending_->request);
      pending_.reset();
      dropped_jobs_.fetch_add(1, std::memory_order_relaxed);
    }
    pending_.emplace(Job{std::move(request), std::move(context)});
  }
  wake_.notify_one();
  return true;
}

void AddressabilityWorker::discard_pending() noexcept {
  std::scoped_lock lock(mutex_);
  if (!pending_) return;
  secure_clear(pending_->request);
  pending_.reset();
  dropped_jobs_.fetch_add(1, std::memory_order_relaxed);
}

void AddressabilityWorker::stop() noexcept {
  {
    std::scoped_lock lock(mutex_);
    if (!stopping_) {
      stopping_ = true;
      if (pending_) {
        secure_clear(pending_->request);
        pending_.reset();
        dropped_jobs_.fetch_add(1, std::memory_order_relaxed);
      }
    }
  }
  wake_.notify_all();
  if (thread_.joinable()) thread_.join();
}

std::uint64_t AddressabilityWorker::dropped_jobs() const noexcept {
  return dropped_jobs_.load(std::memory_order_relaxed);
}

void AddressabilityWorker::run() noexcept {
  for (;;) {
    std::optional<Job> job;
    {
      std::unique_lock lock(mutex_);
      wake_.wait(lock, [this] { return stopping_ || pending_.has_value(); });
      if (stopping_) return;
      job = std::move(pending_);
      pending_.reset();
    }

    const std::string activity_id = job->request.activity_id;
    AddressabilityEvaluation evaluation;
    try {
      evaluation = pipeline_.evaluate(
          std::move(job->request), job->context);
    } catch (...) {
      secure_clear(job->request);
      evaluation.activity_id = activity_id;
      evaluation.gate_stt_status = GateSttStatus::Failed;
      evaluation.gate_stt_error_code =
          "VOICE.ADDRESSABILITY.PIPELINE_EXCEPTION";
      evaluation.result = {
          AddressabilityDecision::Abstain,
          AddressabilityConfidenceBand::Low,
          0.5,
          0,
          "ADDRESSABILITY.PIPELINE_FAILED",
      };
    }

    try {
      callback_(std::move(evaluation));
    } catch (...) {
      // A consumer error must not terminate the Voice worker or leak the next
      // candidate. The next bounded job remains independently processable.
    }
  }
}

}  // namespace birdie::voice
