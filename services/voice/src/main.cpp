#include "birdie/voice/voice_host.hpp"

#ifdef _WIN32
#include "birdie/voice/core_ipc_sink.hpp"
#include "birdie/voice/wasapi_capture.hpp"
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <memory>
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

#ifdef _WIN32
class RuntimeEventSink final : public birdie::voice::IEventSink {
 public:
  RuntimeEventSink(birdie::voice::CoreIpcEventSink& core,
                   birdie::voice::JsonLineEventSink* diagnostic)
      : core_(core), diagnostic_(diagnostic) {}

  void emit(const birdie::voice::VoiceEvent& event) override {
    core_.emit(event);
    if (diagnostic_ != nullptr) diagnostic_->emit(event);
  }

 private:
  birdie::voice::CoreIpcEventSink& core_;
  birdie::voice::JsonLineEventSink* diagnostic_;
};
#endif

}  // namespace

int main(int argc, char** argv) {
  const bool capture_microphone = has_argument(argc, argv, "--mic");
  const bool development_auto_accept =
      has_argument(argc, argv, "--dev-auto-accept");
  const bool stdout_events = has_argument(argc, argv, "--stdout-events");

  if (!capture_microphone) {
    std::cout << "Birdie Voice Host v0.1\n"
              << "Usage: birdie-voice-host --mic [--dev-auto-accept] "
                 "[--stdout-events]\n";
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

  birdie::voice::CoreIpcEventSink core_sink(session_id, trace_id);
  std::unique_ptr<birdie::voice::JsonLineEventSink> diagnostic_sink;
  if (stdout_events) {
    diagnostic_sink = std::make_unique<birdie::voice::JsonLineEventSink>(
        std::cout, session_id, trace_id);
  }
  RuntimeEventSink sink(core_sink, diagnostic_sink.get());

  birdie::voice::VoiceConfig config;
  birdie::voice::VoiceHost host(
      config, sink, [](birdie::voice::UtteranceAudio utterance) {
        // Audio remains local. Gate-STT will emit voice.utterance.finalized only
        // after an accepted turn has been transcribed.
        std::cerr << "[birdie-voice] local utterance ready: id="
                  << utterance.utterance_id
                  << " duration_ms=" << utterance.duration_ms << '\n';
        std::fill(utterance.samples.begin(), utterance.samples.end(), 0.0F);
      });

  if (development_auto_accept) {
    std::cerr << "[birdie-voice] WARNING: --dev-auto-accept is active; "
                 "all qualifying speech candidates are treated as addressed.\n";
  }

  birdie::voice::WasapiCapture capture;
  std::atomic<bool> capture_faulted{false};
  bool capture_enabled = true;
  auto next_restart_attempt = std::chrono::steady_clock::now();

  auto emit_privacy = [&](std::string microphone_state) {
    sink.emit({"voice.privacy.changed", monotonic_ms(), std::nullopt,
               {{"microphone_state", std::move(microphone_state)}}});
  };

  auto start_capture = [&](std::string& error) {
    return capture.start(
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
                      {"error_code",
                       std::string("VOICE.INPUT.CAPTURE_FAILED")},
                      {"detail", std::move(message)}}});
          emit_privacy("UNAVAILABLE");
          capture_faulted.store(true, std::memory_order_release);
        },
        error);
  };

  std::string start_error;
  if (!start_capture(start_error)) {
    sink.emit({"component.health.changed", monotonic_ms(), std::nullopt,
               {{"component", std::string("birdie-voice")},
                {"status", std::string("UNAVAILABLE")},
                {"error_code", std::string("VOICE.INPUT.INIT_FAILED")},
                {"detail", start_error}}});
    emit_privacy("UNAVAILABLE");
    std::cerr << "Could not start Birdie Voice Host: " << start_error << '\n';
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    return 3;
  }

  sink.emit({"component.ready", monotonic_ms(), std::nullopt,
             {{"component", std::string("birdie-voice")},
              {"contract_version", std::string("1.0")},
              {"capture", std::string("WASAPI_SHARED_16K_MONO")},
              {"development_auto_accept", development_auto_accept}}});
  emit_privacy("ENABLED");

  bool previous_core_connection = false;
  while (!stop_requested.load(std::memory_order_acquire)) {
    while (auto command = core_sink.try_pop_command()) {
      if (command->name != "voice.mute.set") continue;

      if (!command->enabled) {
        capture_enabled = false;
        capture.stop();
        host.set_muted(true);  // Emits confirmation after WASAPI is released.
        std::cerr << "[birdie-voice] microphone disabled by user\n";
      } else {
        capture_enabled = true;
        if (capture.running()) {
          if (host.muted()) {
            host.set_muted(false);
          } else {
            emit_privacy("ENABLED");
          }
        } else {
          std::string restart_error;
          if (start_capture(restart_error)) {
            host.set_muted(false);
            std::cerr << "[birdie-voice] microphone enabled by user\n";
          } else {
            emit_privacy("UNAVAILABLE");
            sink.emit({"component.health.changed", monotonic_ms(),
                       std::nullopt,
                       {{"component", std::string("birdie-voice")},
                        {"status", std::string("DEGRADED")},
                        {"error_code",
                         std::string("VOICE.INPUT.RESTART_FAILED")},
                        {"detail", restart_error}}});
            next_restart_attempt =
                std::chrono::steady_clock::now() + std::chrono::seconds(1);
          }
        }
      }
    }

    if (capture_faulted.exchange(false, std::memory_order_acq_rel)) {
      capture.stop();
      next_restart_attempt =
          std::chrono::steady_clock::now() + std::chrono::seconds(1);
    }

    if (capture_enabled && !capture.running() &&
        std::chrono::steady_clock::now() >= next_restart_attempt) {
      std::string restart_error;
      if (start_capture(restart_error)) {
        if (host.muted()) host.set_muted(false);
        emit_privacy("ENABLED");
        sink.emit({"component.health.changed", monotonic_ms(), std::nullopt,
                   {{"component", std::string("birdie-voice")},
                    {"status", std::string("READY")},
                    {"error_code", std::string("")}}});
      } else {
        emit_privacy("UNAVAILABLE");
        next_restart_attempt =
            std::chrono::steady_clock::now() + std::chrono::seconds(1);
      }
    }

    const bool current_core_connection = core_sink.connected();
    if (current_core_connection != previous_core_connection) {
      std::cerr << "[birdie-voice] Birdie Core IPC "
                << (current_core_connection ? "connected" : "disconnected")
                << '\n';
      if (current_core_connection) {
        sink.emit({"component.health.changed", monotonic_ms(), std::nullopt,
                   {{"component", std::string("birdie-voice")},
                    {"status", std::string("READY")},
                    {"error_code", std::string("")}}});
        emit_privacy(capture_enabled && capture.running()
                         ? std::string("ENABLED")
                         : host.muted() ? std::string("MUTED_BY_USER")
                                        : std::string("UNAVAILABLE"));
      }
      previous_core_connection = current_core_connection;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }

  capture.stop();
  host.set_muted(true);
  std::cerr << "[birdie-voice] dropped best-effort IPC events: "
            << core_sink.dropped_best_effort() << '\n';
  return 0;
#endif
}
