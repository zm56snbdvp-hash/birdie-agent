#include "birdie/voice/core_ipc_sink.hpp"

#ifdef _WIN32

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>
#include <thread>

namespace {

using namespace std::chrono_literals;
using birdie::voice::CoreIpcEventSink;
using birdie::voice::VoiceEvent;

std::uint64_t monotonic_ms() {
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now().time_since_epoch())
          .count());
}

}  // namespace

int main() {
  CoreIpcEventSink sink("voice-core-smoke-session", "voice-core-smoke-trace");
  const auto deadline = std::chrono::steady_clock::now() + 5s;
  while (!sink.connected() && std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(10ms);
  }
  if (!sink.connected()) {
    std::cerr << "birdie-voice-core-smoke: Core IPC unavailable\n";
    return EXIT_FAILURE;
  }

  std::uint64_t at = monotonic_ms();
  sink.emit(VoiceEvent{"component.ready", at++, std::nullopt,
                       {{"component", std::string("birdie-voice")},
                        {"contract_version", std::string("1.0")}}});
  sink.emit(VoiceEvent{"voice.activity.started", at++, std::nullopt,
                       {{"activity_id", std::string("activity-smoke")},
                        {"confidence", 0.99},
                        {"barge_in_candidate", false}}});
  sink.emit(VoiceEvent{"voice.activation.accepted", at++, std::nullopt,
                       {{"activation_mode", std::string("DEVELOPMENT")},
                        {"confidence", 0.99}}});
  sink.emit(VoiceEvent{"voice.utterance.finalized", at++,
                       std::string("turn-smoke"),
                       {{"utterance_id", std::string("utterance-smoke")},
                        {"transcript", std::string("Hallo Birdie")},
                        {"language", std::string("de-DE")},
                        {"confidence", 0.99}}});
  sink.emit(VoiceEvent{"voice.output.started", at++,
                       std::string("turn-smoke"),
                       {{"output_id", std::string("output-smoke")}}});
  sink.emit(VoiceEvent{"voice.output.completed", at++,
                       std::string("turn-smoke"),
                       {{"output_id", std::string("output-smoke")}}});

  std::this_thread::sleep_for(400ms);
  std::cout << "birdie-voice-core-smoke: events published\n";
  return EXIT_SUCCESS;
}

#else
int main() { return EXIT_SUCCESS; }
#endif
