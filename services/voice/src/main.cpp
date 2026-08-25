#include "birdie/voice/voice_host.hpp"

#ifdef _WIN32
#include "birdie/voice/wasapi_capture.hpp"
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <optional>
#include <string>
#include <thread>

namespace {

std::atomic<bool> stop_requested{false};

void handle_signal(int) { stop_requested.store(true); }

std::uint64_t monotonic_ms() {
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now().time_since_epoch())
          .count());
}

bool has_argument(const int argc, char** argv, const std::string& wanted) {
  for (int index = 1; index < argc; ++index) {
    if (argv[index] == wanted) return true;
  }
  return false;
}

}  // namespace

int main(int argc, char** argv) {
  const bool capture_microphone = has_argument(argc, argv, "--mic");
  const bool development_auto_accept =
      has_argument(argc, argv, "--dev-auto-accept");

  if (!capture_microphone) {
    std::cout << "Birdie Voice Host v0.1\n"
              << "Usage: birdie-voice-host --mic [--dev-auto-accept]\n";
    return 0;
  }

#ifndef _WIN32
  std::cerr << "WASAPI capture is available only on Windows.\n";
  return 2;
#else
  std::signal(SIGINT, handle_signal);
  std::signal(SIGTERM, handle_signal);

  const auto start_ms = monotonic_ms();
  const std::string session_id = "voice-session-" + std::to_string(start_ms);
  const std::string trace_id = "voice-trace-" + std::to_string(start_ms);
  birdie::voice::JsonLineEventSink sink(std::cout, session_id, trace_id);

  birdie::voice::VoiceConfig config;
  birdie::voice::VoiceHost host(
      config, sink, [](birdie::voice::UtteranceAudio utterance) {
        // This hand-off remains local. The next slice connects a local gate-STT
        // worker and emits voice.utterance.finalized only after transcription.
        std::cerr << "[birdie-voice] local utterance ready: id="
                  << utterance.utterance_id
                  << " duration_ms=" << utterance.duration_ms << '\n';
        std::fill(utterance.samples.begin(), utterance.samples.end(), 0.0F);
      });

  sink.emit({"component.ready", start_ms, std::nullopt,
             {{"component", std::string("birdie-voice")},
              {"contract_version", std::string("1.0")},
              {"capture", std::string("WASAPI_SHARED_16K_MONO")},
              {"development_auto_accept", development_auto_accept}}});

  if (development_auto_accept) {
    std::cerr << "[birdie-voice] WARNING: --dev-auto-accept is active; "
                 "all qualifying speech candidates are treated as addressed.\n";
  }

  birdie::voice::WasapiCapture capture;
  std::string start_error;
  const bool started = capture.start(
      [&](birdie::voice::AudioFrame frame) {
        host.process(std::move(frame));
        if (development_auto_accept &&
            host.phase() == birdie::voice::VoicePhase::SpeechCandidate) {
          host.accept_activation(birdie::voice::ActivationMode::Development,
                                 0.99);
        }
      },
      [&](std::string message) {
        sink.emit({"component.health.changed", monotonic_ms(), std::nullopt,
                   {{"component", std::string("birdie-voice")},
                    {"status", std::string("DEGRADED")},
                    {"error_code", std::string("VOICE.INPUT.CAPTURE_FAILED")},
                    {"detail", std::move(message)}}});
        stop_requested.store(true);
      },
      start_error);

  if (!started) {
    std::cerr << "Could not start Birdie Voice Host: " << start_error << '\n';
    return 3;
  }

  while (!stop_requested.load() && capture.running()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  host.set_muted(true);
  capture.stop();
  return 0;
#endif
}
