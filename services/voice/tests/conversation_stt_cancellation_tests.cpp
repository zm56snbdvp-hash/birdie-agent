#include "birdie/voice/conversation_stt_worker.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

using namespace std::chrono_literals;
using birdie::voice::ConversationSttWorker;
using birdie::voice::ConversationTranscript;
using birdie::voice::GateSttRequest;
using birdie::voice::GateSttResult;
using birdie::voice::GateSttStatus;
using birdie::voice::IGateStt;
using birdie::voice::UtteranceAudio;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

UtteranceAudio utterance(const std::string& suffix) {
  UtteranceAudio result;
  result.activity_id = "activity-" + suffix;
  result.utterance_id = "utterance-" + suffix;
  result.turn_id = "turn-" + suffix;
  result.samples.assign(16'000, 0.1F);
  result.sample_rate = 16'000;
  result.duration_ms = 1'000;
  result.started_ms = 10;
  result.ended_ms = 1'010;
  return result;
}

class BlockingStt final : public IGateStt {
 public:
  GateSttResult transcribe(const GateSttRequest& request) override {
    {
      std::scoped_lock lock(mutex_);
      started_ = true;
    }
    started_cv_.notify_all();

    std::unique_lock lock(mutex_);
    release_cv_.wait(lock, [&] { return released_; });
    lock.unlock();

    GateSttResult result;
    result.status = GateSttStatus::Transcript;
    result.transcript = request.activity_id;
    result.language = "de";
    result.confidence = 0.9;
    result.no_speech_probability = 0.01;
    result.model_id = "blocking-cancellation-test";
    result.error_code.clear();
    return result;
  }

  void wait_until_started() {
    std::unique_lock lock(mutex_);
    started_cv_.wait_for(lock, 3s, [&] { return started_; });
    require(started_, "active full-STT job did not start");
  }

  void release() {
    {
      std::scoped_lock lock(mutex_);
      released_ = true;
    }
    release_cv_.notify_all();
  }

 private:
  std::mutex mutex_;
  std::condition_variable started_cv_;
  std::condition_variable release_cv_;
  bool started_{false};
  bool released_{false};
};

void test_discard_pending_reports_exact_cancelled_turn() {
  BlockingStt provider;
  std::mutex results_mutex;
  std::condition_variable results_cv;
  std::vector<ConversationTranscript> results;

  ConversationSttWorker worker(
      provider,
      [&](ConversationTranscript transcript) {
        {
          std::scoped_lock lock(results_mutex);
          results.push_back(std::move(transcript));
        }
        results_cv.notify_all();
      });

  require(worker.submit(utterance("active")), "active job must submit");
  provider.wait_until_started();
  require(worker.submit(utterance("pending")), "pending job must submit");

  worker.discard_pending();
  {
    std::unique_lock lock(results_mutex);
    results_cv.wait_for(lock, 3s, [&] { return !results.empty(); });
    require(!results.empty(), "pending cancellation callback timed out");
    require(results.front().status == GateSttStatus::Failed,
            "discarded pending turn must be represented as failed input");
    require(results.front().activity_id == "activity-pending",
            "cancellation must preserve pending activity id");
    require(results.front().utterance_id == "utterance-pending",
            "cancellation must preserve pending utterance id");
    require(results.front().turn_id == "turn-pending",
            "cancellation must preserve pending turn id");
    require(results.front().error_code ==
                "VOICE.CONVERSATION_STT.CANCELLED",
            "pending cancellation error code must be stable");
  }

  provider.release();
  {
    std::unique_lock lock(results_mutex);
    results_cv.wait_for(lock, 3s, [&] { return results.size() >= 2; });
    require(results.size() == 2,
            "active decoder result must still complete after pending cancel");
    require(results[1].turn_id == "turn-active",
            "active and pending turn identities must never be mixed");
    require(results[1].status == GateSttStatus::Transcript,
            "active transcription must complete normally");
  }

  worker.stop();
}

}  // namespace

int main() {
  try {
    test_discard_pending_reports_exact_cancelled_turn();
    std::cout << "birdie-conversation-stt-cancellation-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-conversation-stt-cancellation-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
