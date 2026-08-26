#include "birdie/voice/addressability_pipeline.hpp"
#include "birdie/voice/addressability_worker.hpp"
#include "birdie/voice/conversation_stt_worker.hpp"
#include "birdie/voice/gate_stt_provider.hpp"
#include "birdie/voice/tts_output.hpp"
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
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <variant>

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

void wipe_event_strings(birdie::voice::VoiceEvent& event) noexcept {
  for (auto& [key, value] : event.payload) {
    if (auto* text = std::get_if<std::string>(&value)) {
      std::fill(text->begin(), text->end(), '\0');
      text->clear();
    }
    std::fill(key.begin(), key.end(), '\0');
    key.clear();
  }
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
    std::cout << "Birdie Voice Host v0.5\n"
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

  auto gate_stt_config =
      birdie::voice::load_gate_stt_provider_config_from_environment();
  if (development_auto_accept) {
    // The marked visual integration bypass must not initialize or retain a
    // production model that will never be consulted.
    gate_stt_config.provider = "unavailable";
  }
  auto gate_stt_selection =
      birdie::voice::create_gate_stt_provider(std::move(gate_stt_config));
  birdie::voice::SerializedGateStt local_stt(
      std::move(gate_stt_selection.provider));

  auto tts_selection = birdie::voice::create_tts_provider(
      birdie::voice::load_tts_provider_config_from_environment());

  std::atomic<bool> addressability_enabled{true};
  std::atomic<bool> conversation_stt_enabled{true};
  birdie::voice::ConversationSttWorker* conversation_worker_ptr = nullptr;

  birdie::voice::VoiceConfig config;
  // Production Barge-in remains disabled until an AEC reference path exists.
  config.barge_in_enabled = false;

  birdie::voice::VoiceHost host(
      config, sink, [&](birdie::voice::UtteranceAudio utterance) {
        const std::string activity_id = utterance.activity_id;
        const std::string utterance_id = utterance.utterance_id;
        const std::string turn_id = utterance.turn_id;
        const std::uint64_t ended_ms = utterance.ended_ms;
        const std::uint64_t duration_ms = utterance.duration_ms;
        const std::uint64_t sample_rate = utterance.sample_rate;

        sink.emit({
            "voice.utterance.captured",
            ended_ms,
            turn_id,
            {{"activity_id", activity_id},
             {"utterance_id", utterance_id},
             {"duration_ms", duration_ms},
             {"sample_rate", sample_rate}},
        });

        if (!conversation_stt_enabled.load(std::memory_order_acquire) ||
            conversation_worker_ptr == nullptr) {
          birdie::voice::secure_clear(utterance);
          sink.emit({
              "voice.input.cancelled",
              ended_ms,
              turn_id,
              {{"activity_id", activity_id},
               {"utterance_id", utterance_id},
               {"reason", std::string("conversation_stt_disabled")},
               {"error_code",
                std::string("VOICE.CONVERSATION_STT.DISABLED")}},
          });
          return;
        }

        if (!conversation_worker_ptr->submit(std::move(utterance))) {
          sink.emit({
              "voice.input.cancelled",
              ended_ms,
              turn_id,
              {{"activity_id", activity_id},
               {"utterance_id", utterance_id},
               {"reason", std::string("conversation_stt_saturated")},
               {"error_code",
                std::string("VOICE.CONVERSATION_STT.SATURATED")}},
          });
        }
      });
  std::mutex host_mutex;

  auto host_is_muted = [&] {
    std::scoped_lock lock(host_mutex);
    return host.muted();
  };
  auto set_host_muted = [&](const bool muted) {
    std::scoped_lock lock(host_mutex);
    host.set_muted(muted);
  };
  auto handle_input_unavailable = [&](std::string reason) {
    std::scoped_lock lock(host_mutex);
    host.handle_input_unavailable(std::move(reason));
  };

  birdie::voice::AddressabilityEvidencePipeline addressability_pipeline(
      local_stt);
  birdie::voice::AddressabilityWorker addressability_worker(
      addressability_pipeline,
      [&](birdie::voice::AddressabilityEvaluation evaluation) {
        if (!addressability_enabled.load(std::memory_order_acquire)) return;

        const auto mode = evaluation.evidence.follow_up_semantics_match
            ? birdie::voice::ActivationMode::FollowUp
            : birdie::voice::ActivationMode::WakeOnSpeak;
        bool applied = false;
        {
          std::scoped_lock lock(host_mutex);
          if (addressability_enabled.load(std::memory_order_acquire)) {
            applied = host.resolve_addressability(
                evaluation.activity_id, evaluation.result, mode);
          }
        }

        if (applied) {
          std::cerr
              << "[birdie-voice] addressability="
              << birdie::voice::addressability_decision_name(
                     evaluation.result.decision)
              << " gate_stt="
              << birdie::voice::gate_stt_status_name(
                     evaluation.gate_stt_status)
              << " reason=" << evaluation.result.reason
              << " score=" << evaluation.result.score << '\n';
        }
      });

  birdie::voice::ConversationSttWorker conversation_worker(
      local_stt,
      [&](birdie::voice::ConversationTranscript transcript) {
        if (!conversation_stt_enabled.load(std::memory_order_acquire)) {
          sink.emit({
              "voice.input.cancelled",
              transcript.ended_ms,
              transcript.turn_id,
              {{"activity_id", transcript.activity_id},
               {"utterance_id", transcript.utterance_id},
               {"reason", std::string("conversation_stt_invalidated")},
               {"stt_status",
                std::string(birdie::voice::gate_stt_status_name(
                    transcript.status))},
               {"error_code",
                transcript.error_code.empty()
                    ? std::string("VOICE.CONVERSATION_STT.INVALIDATED")
                    : transcript.error_code}},
          });
          birdie::voice::secure_clear(transcript);
          return;
        }

        if (transcript.status == birdie::voice::GateSttStatus::Transcript &&
            !transcript.transcript.empty()) {
          birdie::voice::VoiceEvent finalized{
              "voice.utterance.finalized",
              transcript.ended_ms,
              transcript.turn_id,
              {{"activity_id", transcript.activity_id},
               {"utterance_id", transcript.utterance_id},
               {"transcript", std::move(transcript.transcript)},
               {"language", transcript.language},
               {"confidence", transcript.confidence},
               {"no_speech_probability",
                transcript.no_speech_probability},
               {"duration_ms", transcript.duration_ms},
               {"stt_latency_ms", transcript.latency_ms},
               {"stt_model", transcript.model_id}},
              "content",
          };
          sink.emit(finalized);
          wipe_event_strings(finalized);
        } else {
          sink.emit({
              "voice.input.cancelled",
              transcript.ended_ms,
              transcript.turn_id,
              {{"activity_id", transcript.activity_id},
               {"utterance_id", transcript.utterance_id},
               {"reason",
                std::string(
                    transcript.status == birdie::voice::GateSttStatus::NoSpeech
                        ? "conversation_stt_no_speech"
                        : "conversation_stt_failed")},
               {"stt_status",
                std::string(birdie::voice::gate_stt_status_name(
                    transcript.status))},
               {"error_code", transcript.error_code}},
          });
        }
        birdie::voice::secure_clear(transcript);
      });
  conversation_worker_ptr = &conversation_worker;

  birdie::voice::TtsOutputWorker tts_worker(
      *tts_selection.provider,
      [&](birdie::voice::TtsWorkerUpdate update) {
        const std::uint64_t at = monotonic_ms();
        if (update.stage == birdie::voice::TtsWorkerStage::Started) {
          {
            std::scoped_lock lock(host_mutex);
            host.set_output_active(
                true, update.output_id, update.turn_id);
          }
          sink.emit({
              "voice.output.started",
              at,
              update.turn_id,
              {{"output_id", update.output_id},
               {"language", update.language},
               {"tts_provider", tts_selection.info.active_provider},
               {"tts_voice", tts_selection.info.voice_id},
               {"barge_in_enabled", config.barge_in_enabled}},
          });
        } else {
          {
            std::scoped_lock lock(host_mutex);
            host.set_output_active(false);
          }

          if (update.stage == birdie::voice::TtsWorkerStage::Completed) {
            sink.emit({
                "voice.output.completed",
                at,
                update.turn_id,
                {{"output_id", update.output_id},
                 {"duration_ms", update.duration_ms},
                 {"tts_provider", update.provider},
                 {"tts_voice", update.voice_id}},
            });
          } else if (
              update.stage == birdie::voice::TtsWorkerStage::Cancelled) {
            sink.emit({
                "voice.output.cancelled",
                at,
                update.turn_id,
                {{"output_id", update.output_id},
                 {"reason", std::string("tts_cancelled")},
                 {"error_code", update.error_code}},
            });
          } else {
            sink.emit({
                "voice.output.failed",
                at,
                update.turn_id,
                {{"output_id", update.output_id},
                 {"tts_provider", update.provider},
                 {"tts_voice", update.voice_id},
                 {"error_code",
                  update.error_code.empty()
                      ? std::string("VOICE.TTS.FAILED")
                      : update.error_code}},
            });
          }
        }
        birdie::voice::secure_clear(update);
      });

  if (development_auto_accept) {
    std::cerr << "[birdie-voice] WARNING: --dev-auto-accept is active; "
                 "all qualifying speech candidates are treated as addressed.\n";
  } else {
    std::cerr << "[birdie-voice] Local STT provider="
              << gate_stt_selection.info.active_provider
              << " status=" << gate_stt_selection.info.status
              << " model=" << gate_stt_selection.info.model_id;
    if (!gate_stt_selection.info.error_code.empty()) {
      std::cerr << " error=" << gate_stt_selection.info.error_code;
    }
    std::cerr << '\n';
  }
  std::cerr << "[birdie-voice] Local TTS provider="
            << tts_selection.info.active_provider
            << " status=" << tts_selection.info.status
            << " voice=" << tts_selection.info.voice_id;
  if (!tts_selection.info.error_code.empty()) {
    std::cerr << " error=" << tts_selection.info.error_code;
  }
  std::cerr << '\n';

  birdie::voice::WasapiCapture capture;
  std::atomic<bool> capture_faulted{false};
  bool capture_enabled = true;
  auto next_restart_attempt = std::chrono::steady_clock::now();
  auto next_ipc_liveness_probe = std::chrono::steady_clock::now();

  auto emit_privacy = [&](std::string microphone_state) {
    sink.emit({"voice.privacy.changed", monotonic_ms(), std::nullopt,
               {{"microphone_state", std::move(microphone_state)}}});
  };

  auto emit_component_ready = [&] {
    const std::string stt_status = development_auto_accept
        ? "BYPASSED"
        : gate_stt_selection.info.status;
    const std::string stt_provider = development_auto_accept
        ? "development-auto-accept"
        : gate_stt_selection.info.active_provider;
    sink.emit({"component.ready", monotonic_ms(), std::nullopt,
               {{"component", std::string("birdie-voice")},
                {"contract_version", std::string("1.0")},
                {"capture", std::string("WASAPI_SHARED_16K_MONO")},
                {"addressability", std::string("LOCAL_ACCEPT_REJECT_ABSTAIN")},
                {"gate_stt", stt_status},
                {"conversation_stt", stt_status},
                {"stt_provider", stt_provider},
                {"stt_model", gate_stt_selection.info.model_id},
                {"stt_error_code", gate_stt_selection.info.error_code},
                {"tts", tts_selection.info.status},
                {"tts_provider", tts_selection.info.active_provider},
                {"tts_voice", tts_selection.info.voice_id},
                {"barge_in", std::string("DISABLED_NO_AEC")},
                {"development_auto_accept", development_auto_accept}}});
  };

  auto start_capture = [&](std::string& error) {
    return capture.start(
        [&](birdie::voice::AudioFrame frame) {
          std::optional<birdie::voice::GateSttRequest> gate_request;
          {
            std::scoped_lock lock(host_mutex);
            if (host.output_active() && !config.barge_in_enabled) {
              return;
            }

            host.process(std::move(frame));

            if (development_auto_accept &&
                host.phase() == birdie::voice::VoicePhase::SpeechCandidate) {
              host.accept_activation(
                  birdie::voice::ActivationMode::Development, 0.99);
            } else if (!development_auto_accept &&
                       addressability_enabled.load(
                           std::memory_order_acquire) &&
                       host.phase() ==
                           birdie::voice::VoicePhase::SpeechCandidate) {
              gate_request = host.gate_stt_request();
            }
          }

          if (gate_request) {
            birdie::voice::AddressabilityContext context;
            addressability_worker.submit(
                std::move(*gate_request), std::move(context));
          }
        },
        [&](std::string message) {
          addressability_enabled.store(false, std::memory_order_release);
          conversation_stt_enabled.store(false, std::memory_order_release);
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
    addressability_enabled.store(false, std::memory_order_release);
    conversation_stt_enabled.store(false, std::memory_order_release);
    sink.emit({"component.health.changed", monotonic_ms(), std::nullopt,
               {{"component", std::string("birdie-voice")},
                {"status", std::string("UNAVAILABLE")},
                {"error_code", std::string("VOICE.INPUT.INIT_FAILED")},
                {"detail", start_error}}});
    emit_privacy("UNAVAILABLE");
    std::cerr << "Could not start Birdie Voice Host: " << start_error << '\n';
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    conversation_worker.stop();
    tts_worker.stop();
    return 3;
  }

  emit_component_ready();
  emit_privacy("ENABLED");

  bool previous_core_connection = false;
  while (!stop_requested.load(std::memory_order_acquire)) {
    while (auto command = core_sink.try_pop_command()) {
      if (command->name == "voice.output.play") {
        const std::string turn_id = command->turn_id;
        const std::string output_id = command->output_id;
        if (tts_selection.info.status != "READY") {
          sink.emit({
              "voice.output.failed",
              monotonic_ms(),
              turn_id,
              {{"output_id", output_id},
               {"tts_provider", tts_selection.info.active_provider},
               {"error_code",
                tts_selection.info.error_code.empty()
                    ? std::string("VOICE.TTS.UNAVAILABLE")
                    : tts_selection.info.error_code}},
          });
          std::fill(command->text.begin(), command->text.end(), '\0');
          command->text.clear();
          continue;
        }

        birdie::voice::TtsRequest request{
            std::move(command->turn_id),
            std::move(command->output_id),
            std::move(command->text),
            std::move(command->language),
            std::move(command->data_classification),
        };
        if (!tts_worker.submit(std::move(request))) {
          sink.emit({
              "voice.output.failed",
              monotonic_ms(),
              turn_id,
              {{"output_id", output_id},
               {"tts_provider", tts_selection.info.active_provider},
               {"error_code", std::string("VOICE.TTS.SATURATED")}},
          });
        }
        continue;
      }

      if (command->name != "voice.mute.set" ||
          !command->enabled.has_value()) {
        continue;
      }

      if (!*command->enabled) {
        addressability_enabled.store(false, std::memory_order_release);
        conversation_stt_enabled.store(false, std::memory_order_release);
        addressability_worker.discard_pending();
        conversation_worker.discard_pending();
        capture_enabled = false;
        capture.stop();
        set_host_muted(true);  // Confirms only after WASAPI is released.
        next_ipc_liveness_probe = std::chrono::steady_clock::now();
        std::cerr << "[birdie-voice] microphone disabled by user\n";
      } else {
        capture_enabled = true;
        if (capture.running()) {
          addressability_enabled.store(true, std::memory_order_release);
          conversation_stt_enabled.store(true, std::memory_order_release);
          if (host_is_muted()) {
            set_host_muted(false);
          } else {
            emit_privacy("ENABLED");
          }
        } else {
          std::string restart_error;
          if (start_capture(restart_error)) {
            addressability_enabled.store(true, std::memory_order_release);
            conversation_stt_enabled.store(true, std::memory_order_release);
            set_host_muted(false);
            std::cerr << "[birdie-voice] microphone enabled by user\n";
          } else {
            addressability_enabled.store(false, std::memory_order_release);
            conversation_stt_enabled.store(false, std::memory_order_release);
            set_host_muted(true);
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
      addressability_enabled.store(false, std::memory_order_release);
      conversation_stt_enabled.store(false, std::memory_order_release);
      addressability_worker.discard_pending();
      conversation_worker.discard_pending();
      capture.stop();
      handle_input_unavailable("capture_unavailable");
      next_restart_attempt =
          std::chrono::steady_clock::now() + std::chrono::seconds(1);
      next_ipc_liveness_probe = std::chrono::steady_clock::now();
    }

    if (capture_enabled && !capture.running() &&
        std::chrono::steady_clock::now() >= next_restart_attempt) {
      std::string restart_error;
      if (start_capture(restart_error)) {
        addressability_enabled.store(true, std::memory_order_release);
        conversation_stt_enabled.store(true, std::memory_order_release);
        if (host_is_muted()) {
          set_host_muted(false);
        } else {
          emit_privacy("ENABLED");
        }
        sink.emit({"component.health.changed", monotonic_ms(), std::nullopt,
                   {{"component", std::string("birdie-voice")},
                    {"status", std::string("READY")},
                    {"error_code", std::string("")}}});
      } else {
        addressability_enabled.store(false, std::memory_order_release);
        conversation_stt_enabled.store(false, std::memory_order_release);
        set_host_muted(true);
        emit_privacy("UNAVAILABLE");
        next_restart_attempt =
            std::chrono::steady_clock::now() + std::chrono::seconds(1);
      }
    }

    const auto now = std::chrono::steady_clock::now();
    if (!capture.running() && now >= next_ipc_liveness_probe) {
      // Input levels are explicitly best-effort. A zero-level probe therefore
      // detects a dead pipe without persisting data or growing the reliable
      // queue while Core is offline. The renderer treats it as silence.
      sink.emit({"voice.input.level", monotonic_ms(), std::nullopt,
                 {{"normalized_level", 0.0},
                  {"vad_probability", 0.0},
                  {"liveness_probe", true}}});
      next_ipc_liveness_probe = now + std::chrono::milliseconds(500);
    }

    const bool current_core_connection = core_sink.connected();
    if (current_core_connection != previous_core_connection) {
      std::cerr << "[birdie-voice] Birdie Core IPC "
                << (current_core_connection ? "connected" : "disconnected")
                << '\n';
      if (current_core_connection) {
        // A restarted Core begins OFFLINE. Replaying component.ready rehydrates
        // its canonical Presence state instead of leaving the desktop dark.
        emit_component_ready();
        const bool muted = host_is_muted();
        emit_privacy(capture_enabled && capture.running()
                         ? std::string("ENABLED")
                         : muted ? std::string("MUTED_BY_USER")
                                 : std::string("UNAVAILABLE"));
      }
      previous_core_connection = current_core_connection;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }

  addressability_enabled.store(false, std::memory_order_release);
  conversation_stt_enabled.store(false, std::memory_order_release);
  addressability_worker.discard_pending();
  conversation_worker.discard_pending();
  capture.stop();
  addressability_worker.stop();
  conversation_worker.stop();
  tts_worker.stop();
  set_host_muted(true);
  std::cerr << "[birdie-voice] dropped best-effort IPC events: "
            << core_sink.dropped_best_effort() << '\n';
  std::cerr << "[birdie-voice] dropped addressability jobs: "
            << addressability_worker.dropped_jobs() << '\n';
  std::cerr << "[birdie-voice] dropped conversation STT jobs: "
            << conversation_worker.dropped_jobs() << '\n';
  std::cerr << "[birdie-voice] rejected TTS jobs: "
            << tts_worker.rejected_jobs() << '\n';
  return 0;
#endif
}
