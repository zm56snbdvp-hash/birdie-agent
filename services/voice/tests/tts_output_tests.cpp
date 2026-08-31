#include "birdie/voice/tts_output.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <future>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

using namespace std::chrono_literals;
using birdie::voice::DisabledTtsOutput;
using birdie::voice::ITtsOutput;
using birdie::voice::TtsOutputWorker;
using birdie::voice::TtsProviderConfig;
using birdie::voice::TtsRequest;
using birdie::voice::TtsResult;
using birdie::voice::TtsStatus;
using birdie::voice::TtsWorkerStage;
using birdie::voice::TtsWorkerUpdate;
using birdie::voice::create_tts_provider;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

TtsRequest request(const std::string& suffix = "one") {
  return {
      "turn-" + suffix,
      "output-" + suffix,
      "Ich bin da.",
      "de-DE",
      "content",
  };
}

class ScriptedTts final : public ITtsOutput {
 public:
  TtsResult speak(const TtsRequest& request) override {
    received_text = request.text;
    received_turn = request.turn_id;
    return {
        TtsStatus::Completed,
        42,
        "scripted-tts",
        "test-voice",
        "",
    };
  }

  std::string received_text;
  std::string received_turn;
};

void test_completed_output_emits_metadata_only_lifecycle() {
  ScriptedTts provider;
  std::promise<void> completed;
  auto future = completed.get_future();
  std::mutex updates_mutex;
  std::vector<TtsWorkerUpdate> updates;

  TtsOutputWorker worker(
      provider,
      [&](TtsWorkerUpdate update) {
        const bool done = update.stage == TtsWorkerStage::Completed;
        {
          std::scoped_lock lock(updates_mutex);
          updates.push_back(std::move(update));
        }
        if (done) completed.set_value();
      });

  require(worker.submit(request()), "valid content output must submit");
  require(future.wait_for(3s) == std::future_status::ready,
          "TTS completion callback timed out");
  worker.stop();

  require(provider.received_text == "Ich bin da.",
          "provider must receive the local response text");
  require(provider.received_turn == "turn-one",
          "provider must receive canonical turn identity");

  std::scoped_lock lock(updates_mutex);
  require(updates.size() == 2,
          "successful speech must emit started and completed updates");
  require(updates[0].stage == TtsWorkerStage::Started,
          "first update must mark output started");
  require(updates[1].stage == TtsWorkerStage::Completed,
          "second update must mark output completed");
  require(updates[1].duration_ms == 42,
          "provider duration must be preserved");
  require(updates[1].provider == "scripted-tts" &&
              updates[1].voice_id == "test-voice",
          "completion must preserve operational provider metadata");
  require(updates[0].turn_id == "turn-one" &&
              updates[0].output_id == "output-one",
          "lifecycle metadata must preserve output identity");
}

class BlockingTts final : public ITtsOutput {
 public:
  TtsResult speak(const TtsRequest&) override {
    {
      std::scoped_lock lock(mutex);
      started = true;
    }
    started_cv.notify_all();

    std::unique_lock lock(mutex);
    release_cv.wait(lock, [&] { return released; });
    return {
        TtsStatus::Completed,
        100,
        "blocking-tts",
        "test-voice",
        "",
    };
  }

  void wait_started() {
    std::unique_lock lock(mutex);
    started_cv.wait_for(lock, 3s, [&] { return started; });
    require(started, "blocking TTS provider did not start");
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
};

void test_busy_worker_rejects_second_output_explicitly() {
  BlockingTts provider;
  std::promise<void> completed;
  auto future = completed.get_future();
  TtsOutputWorker worker(
      provider,
      [&](TtsWorkerUpdate update) {
        if (update.stage == TtsWorkerStage::Completed) completed.set_value();
      });

  require(worker.submit(request("active")), "first output must submit");
  provider.wait_started();
  require(worker.busy(), "worker must report active speech");
  require(!worker.submit(request("second")),
          "second output must be rejected instead of queued invisibly");
  require(worker.rejected_jobs() == 1,
          "rejected output must increment the counter");

  provider.release();
  require(future.wait_for(3s) == std::future_status::ready,
          "active speech did not complete");
  worker.stop();
}

void test_invalid_or_unclassified_content_never_reaches_provider() {
  ScriptedTts provider;
  TtsOutputWorker worker(provider, [](TtsWorkerUpdate) {});

  TtsRequest invalid = request("invalid");
  invalid.data_classification = "operational";
  require(!worker.submit(std::move(invalid)),
          "operationally-classified response text must be rejected");

  TtsRequest oversized = request("oversized");
  oversized.text.assign(16 * 1024 + 1, 'x');
  require(!worker.submit(std::move(oversized)),
          "oversized response text must be rejected");
  require(provider.received_text.empty(),
          "invalid output must fail before provider invocation");
  worker.stop();
}

void test_provider_selection_is_explicit_and_fail_closed() {
  auto disabled = create_tts_provider(TtsProviderConfig{});
  require(disabled.info.active_provider == "disabled" &&
              disabled.info.status == "UNAVAILABLE",
          "default TTS provider must be disabled");
  require(disabled.provider->speak(request()).status ==
              TtsStatus::Unavailable,
          "disabled provider must fail closed");

  TtsProviderConfig unknown_config;
  unknown_config.provider = "mystery";
  auto unknown = create_tts_provider(std::move(unknown_config));
  require(unknown.info.active_provider == "disabled" &&
              unknown.info.error_code == "VOICE.TTS.PROVIDER_UNKNOWN",
          "unknown TTS provider must fall back to disabled");

#ifdef _WIN32
  TtsProviderConfig sapi_config;
  sapi_config.provider = "windows-sapi";
  auto sapi = create_tts_provider(std::move(sapi_config));
  require(sapi.info.active_provider == "windows-sapi" &&
              sapi.info.status == "READY",
          "Windows SAPI must be selectable explicitly without speaking");
#endif
}

}  // namespace

int main() {
  try {
    test_completed_output_emits_metadata_only_lifecycle();
    test_busy_worker_rejects_second_output_explicitly();
    test_invalid_or_unclassified_content_never_reaches_provider();
    test_provider_selection_is_explicit_and_fail_closed();
    std::cout << "birdie-tts-output-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-tts-output-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
