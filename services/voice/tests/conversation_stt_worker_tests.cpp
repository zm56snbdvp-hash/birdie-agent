#include "birdie/voice/conversation_stt_worker.hpp"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <future>
#include <iostream>
#include <memory>
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
using birdie::voice::SerializedGateStt;
using birdie::voice::UtteranceAudio;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

UtteranceAudio utterance(const std::string& suffix, const float sample = 0.1F) {
  UtteranceAudio result;
  result.utterance_id = "utterance-" + suffix;
  result.activity_id = "activity-" + suffix;
  result.turn_id = "turn-" + suffix;
  result.samples.assign(16'000, sample);
  result.sample_rate = 16'000;
  result.duration_ms = 1'000;
  result.started_ms = 100;
  result.ended_ms = 1'100;
  return result;
}

class ScriptedStt final : public IGateStt {
 public:
  GateSttResult transcribe(const GateSttRequest& request) override {
    last_activity_id = request.activity_id;
    last_sample_count = request.samples.size();
    GateSttResult result;
    result.status = GateSttStatus::Transcript;
    result.transcript = "Birdie, öffne den Kalender";
    result.language = "de";
    result.confidence = 0.94;
    result.no_speech_probability = 0.02;
    result.latency_ms = 37;
    result.model_id = "scripted-full-stt";
    result.error_code.clear();
    return result;
  }

  std::string last_activity_id;
  std::size_t last_sample_count{0};
};

void test_successful_full_transcription_preserves_turn_metadata() {
  ScriptedStt provider;
  std::promise<ConversationTranscript> promise;
  auto future = promise.get_future();

  ConversationSttWorker worker(
      provider,
      [&](ConversationTranscript transcript) {
        promise.set_value(std::move(transcript));
      });

  require(worker.submit(utterance("one")),
          "valid accepted utterance must enter the worker");
  require(future.wait_for(3s) == std::future_status::ready,
          "full transcription callback timed out");

  const ConversationTranscript result = future.get();
  require(result.status == GateSttStatus::Transcript,
          "scripted local decoder must return Transcript");
  require(result.activity_id == "activity-one",
          "activity id must survive the worker boundary");
  require(result.utterance_id == "utterance-one",
          "utterance id must survive the worker boundary");
  require(result.turn_id == "turn-one",
          "turn id must survive the worker boundary");
  require(result.transcript == "Birdie, öffne den Kalender",
          "full transcript must reach the local callback");
  require(result.language == "de" && result.confidence > 0.9,
          "language and confidence must be preserved");
  require(provider.last_activity_id == "activity-one" &&
              provider.last_sample_count == 16'000,
          "provider must receive the complete accepted utterance PCM");

  worker.stop();
}

class BlockingStt final : public IGateStt {
 public:
  GateSttResult transcribe(const GateSttRequest& request) override {
    {
      std::scoped_lock lock(mutex);
      started = true;
      seen.push_back(request.activity_id);
    }
    started_cv.notify_all();

    std::unique_lock lock(mutex);
    release_cv.wait(lock, [&] { return released; });
    lock.unlock();

    GateSttResult result;
    result.status = GateSttStatus::Transcript;
    result.transcript = request.activity_id;
    result.language = "de";
    result.confidence = 0.9;
    result.no_speech_probability = 0.01;
    result.model_id = "blocking-test";
    result.error_code.clear();
    return result;
  }

  void wait_until_started() {
    std::unique_lock lock(mutex);
    started_cv.wait_for(lock, 3s, [&] { return started; });
    require(started, "blocking provider did not start");
  }

  void release() {
    {
      std::scoped_lock lock(mutex);
      released = true;
    }
    release_cv.notify_all();
  }

  std::mutex mutex;
  std::condition_variable started_cv;
  std::condition_variable release_cv;
  bool started{false};
  bool released{false};
  std::vector<std::string> seen;
};

void test_pending_queue_replaces_older_accepted_turn() {
  BlockingStt provider;
  std::mutex results_mutex;
  std::vector<std::string> completed;

  ConversationSttWorker worker(
      provider,
      [&](ConversationTranscript transcript) {
        std::scoped_lock lock(results_mutex);
        completed.push_back(transcript.activity_id);
      });

  require(worker.submit(utterance("first")), "first job must submit");
  provider.wait_until_started();
  require(worker.submit(utterance("second")), "second job must queue");
  require(worker.submit(utterance("third")), "third job must replace second");
  require(worker.dropped_jobs() == 1,
          "replaced pending utterance must increment dropped counter");

  provider.release();
  const auto deadline = std::chrono::steady_clock::now() + 3s;
  for (;;) {
    {
      std::scoped_lock lock(results_mutex);
      if (completed.size() >= 2) break;
    }
    if (std::chrono::steady_clock::now() >= deadline) {
      throw std::runtime_error("replacement queue test timed out");
    }
    std::this_thread::sleep_for(10ms);
  }

  worker.stop();
  std::scoped_lock lock(results_mutex);
  require(completed.size() == 2,
          "only active and newest pending utterance may complete");
  require(completed[0] == "activity-first",
          "active utterance must complete first");
  require(completed[1] == "activity-third",
          "newest pending utterance must replace older pending work");
}

class ConcurrencyProbeStt final : public IGateStt {
 public:
  GateSttResult transcribe(const GateSttRequest&) override {
    const int now = active.fetch_add(1) + 1;
    int observed = maximum.load();
    while (now > observed &&
           !maximum.compare_exchange_weak(observed, now)) {}
    std::this_thread::sleep_for(50ms);
    active.fetch_sub(1);

    GateSttResult result;
    result.status = GateSttStatus::NoSpeech;
    result.error_code = "VOICE.GATE_STT.NO_SPEECH";
    return result;
  }

  std::atomic<int> active{0};
  std::atomic<int> maximum{0};
};

void test_serialized_provider_prevents_concurrent_native_inference() {
  auto inner = std::make_unique<ConcurrencyProbeStt>();
  ConcurrencyProbeStt* probe = inner.get();
  SerializedGateStt serialized(std::move(inner));

  GateSttRequest request;
  request.activity_id = "activity-serialized";
  request.samples.assign(160, 0.1F);

  std::thread first([&] { (void)serialized.transcribe(request); });
  std::thread second([&] { (void)serialized.transcribe(request); });
  first.join();
  second.join();

  require(probe->maximum.load() == 1,
          "shared local model must never receive concurrent decode calls");
}

void test_invalid_utterance_fails_before_decoder() {
  ScriptedStt provider;
  ConversationSttWorker worker(provider, [](ConversationTranscript) {});
  UtteranceAudio invalid;
  invalid.utterance_id = "missing-audio";
  require(!worker.submit(std::move(invalid)),
          "invalid accepted utterance must fail before local inference");
  worker.stop();
}

}  // namespace

int main() {
  try {
    test_successful_full_transcription_preserves_turn_metadata();
    test_pending_queue_replaces_older_accepted_turn();
    test_serialized_provider_prevents_concurrent_native_inference();
    test_invalid_utterance_fails_before_decoder();
    std::cout << "birdie-conversation-stt-worker-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-conversation-stt-worker-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
