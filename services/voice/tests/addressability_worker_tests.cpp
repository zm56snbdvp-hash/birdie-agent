#include "birdie/voice/addressability_worker.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using namespace std::chrono_literals;
using birdie::voice::AddressabilityContext;
using birdie::voice::AddressabilityEvaluation;
using birdie::voice::AddressabilityEvidencePipeline;
using birdie::voice::AddressabilityWorker;
using birdie::voice::GateSttRequest;
using birdie::voice::GateSttResult;
using birdie::voice::GateSttStatus;
using birdie::voice::IGateStt;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

GateSttRequest request(std::string activity_id) {
  GateSttRequest result;
  result.activity_id = std::move(activity_id);
  result.samples.assign(8'000, 0.12F);
  result.sample_rate = 16'000;
  result.channels = 1;
  result.candidate_started_ms = 100;
  result.captured_through_ms = 600;
  return result;
}

class BlockingGateStt final : public IGateStt {
 public:
  GateSttResult transcribe(const GateSttRequest&) override {
    {
      std::unique_lock lock(mutex_);
      ++started_;
      started_changed_.notify_all();
      released_.wait(lock, [this] { return release_; });
    }

    GateSttResult result;
    result.status = GateSttStatus::Transcript;
    result.transcript = "Birdie öffne den Kalender";
    result.language = "de";
    result.confidence = 0.95;
    result.no_speech_probability = 0.01;
    result.error_code.clear();
    return result;
  }

  bool wait_until_started(const int count) {
    std::unique_lock lock(mutex_);
    return started_changed_.wait_for(
        lock, 3s, [&] { return started_ >= count; });
  }

  void release() {
    {
      std::scoped_lock lock(mutex_);
      release_ = true;
    }
    released_.notify_all();
  }

 private:
  std::mutex mutex_;
  std::condition_variable started_changed_;
  std::condition_variable released_;
  int started_{0};
  bool release_{false};
};

void test_latest_pending_candidate_wins() {
  BlockingGateStt stt;
  AddressabilityEvidencePipeline pipeline(stt);

  std::mutex callback_mutex;
  std::condition_variable callback_changed;
  std::vector<std::string> completed;

  AddressabilityWorker worker(
      pipeline,
      [&](AddressabilityEvaluation evaluation) {
        {
          std::scoped_lock lock(callback_mutex);
          completed.push_back(std::move(evaluation.activity_id));
        }
        callback_changed.notify_all();
      });

  AddressabilityContext context;
  context.media_likelihood = 0.05;
  context.overlap_likelihood = 0.05;

  require(worker.submit(request("activity-one"), context),
          "first candidate must be accepted by worker");
  require(stt.wait_until_started(1),
          "first candidate must reach Gate-STT worker thread");

  require(worker.submit(request("activity-two"), context),
          "second candidate must become pending");
  require(worker.submit(request("activity-three"), context),
          "third candidate must replace second pending candidate");
  require(worker.dropped_jobs() == 1,
          "replaced pending candidate must be counted and wiped");

  stt.release();
  {
    std::unique_lock lock(callback_mutex);
    require(callback_changed.wait_for(
                lock, 3s, [&] { return completed.size() >= 2; }),
            "first and latest candidate must complete");
  }

  worker.stop();
  require(completed.size() == 2,
          "bounded worker must produce exactly two evaluations");
  require(completed[0] == "activity-one",
          "in-flight candidate must complete first");
  require(completed[1] == "activity-three",
          "latest pending candidate must replace stale pending work");
}

}  // namespace

int main() {
  try {
    test_latest_pending_candidate_wins();
    std::cout << "birdie-addressability-worker-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-addressability-worker-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
