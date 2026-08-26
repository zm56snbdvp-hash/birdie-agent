#pragma once

#include "birdie/voice/gate_stt.hpp"
#include "birdie/voice/voice_host.hpp"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace birdie::voice {

struct ConversationTranscript {
  GateSttStatus status{GateSttStatus::Unavailable};
  std::string activity_id;
  std::string utterance_id;
  std::string turn_id;
  std::string transcript;
  std::string language{"und"};
  double confidence{0.0};
  double no_speech_probability{1.0};
  std::uint64_t duration_ms{0};
  std::uint64_t latency_ms{0};
  std::uint64_t ended_ms{0};
  std::string model_id;
  std::string error_code{"VOICE.CONVERSATION_STT.UNAVAILABLE"};
};

class ConversationSttWorker final {
 public:
  using TranscriptCallback =
      std::function<void(ConversationTranscript transcript)>;

  ConversationSttWorker(IGateStt& local_stt,
                        TranscriptCallback callback);
  ~ConversationSttWorker();

  ConversationSttWorker(const ConversationSttWorker&) = delete;
  ConversationSttWorker& operator=(const ConversationSttWorker&) = delete;

  // At most one accepted utterance may wait behind the active decoder. A newer
  // accepted turn replaces and securely clears an older pending turn.
  bool submit(UtteranceAudio utterance);
  void discard_pending() noexcept;
  void stop() noexcept;

  [[nodiscard]] std::uint64_t dropped_jobs() const noexcept;

 private:
  void run() noexcept;

  IGateStt& local_stt_;
  TranscriptCallback callback_;

  mutable std::mutex mutex_;
  std::condition_variable wake_;
  std::optional<UtteranceAudio> pending_;
  bool stopping_{false};
  std::thread thread_;
  std::atomic<std::uint64_t> dropped_jobs_{0};
};

void secure_clear(UtteranceAudio& utterance) noexcept;
void secure_clear(ConversationTranscript& transcript) noexcept;

}  // namespace birdie::voice
