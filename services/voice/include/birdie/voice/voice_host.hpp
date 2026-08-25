#pragma once

#include <cstdint>
#include <functional>
#include <iosfwd>
#include <mutex>
#include <optional>
#include <span>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace birdie::voice {

enum class VoicePhase {
  Quiet,
  SpeechCandidate,
  Listening,
};

enum class ActivationMode {
  WakeWord,
  FollowUp,
  WakeOnSpeak,
  PushToTalk,
  Development,
};

using EventValue = std::variant<std::string, double, bool, std::uint64_t>;

struct AudioFrame {
  std::vector<float> samples;
  std::uint32_t sample_rate{16'000};
  std::uint16_t channels{1};
  std::uint64_t monotonic_ms{0};
};

struct VoiceEvent {
  std::string name;
  std::uint64_t monotonic_ms{0};
  std::optional<std::string> turn_id;
  std::vector<std::pair<std::string, EventValue>> payload;
};

struct UtteranceAudio {
  std::string utterance_id;
  std::vector<float> samples;
  std::uint32_t sample_rate{16'000};
  std::uint64_t duration_ms{0};
};

struct VoiceConfig {
  std::uint32_t sample_rate{16'000};
  std::uint32_t frame_ms{10};
  std::uint32_t pre_roll_ms{1'200};
  std::uint32_t level_interval_ms{34};
  std::uint32_t activation_timeout_ms{2'000};
  std::uint32_t minimum_speech_ms{120};
  std::uint32_t silence_to_endpoint_ms{450};
  std::uint32_t maximum_utterance_ms{30'000};
  double speech_start_threshold{0.60};
  double speech_stop_threshold{0.35};
  std::size_t start_window_frames{3};
  std::size_t start_required_frames{2};
};

class IEventSink {
 public:
  virtual ~IEventSink() = default;
  virtual void emit(const VoiceEvent& event) = 0;
};

class JsonLineEventSink final : public IEventSink {
 public:
  JsonLineEventSink(std::ostream& output, std::string session_id, std::string trace_id);
  void emit(const VoiceEvent& event) override;

 private:
  std::ostream& output_;
  std::string session_id_;
  std::string trace_id_;
  std::uint64_t sequence_{0};
  std::mutex mutex_;
};

class PreRollBuffer {
 public:
  PreRollBuffer(std::uint32_t sample_rate, std::uint32_t capacity_ms);

  void push(std::span<const float> samples);
  [[nodiscard]] std::vector<float> snapshot() const;
  void clear() noexcept;
  [[nodiscard]] std::size_t size() const noexcept;
  [[nodiscard]] std::size_t capacity() const noexcept;

 private:
  std::vector<float> buffer_;
  std::size_t write_index_{0};
  std::size_t size_{0};
};

class EnergyVad {
 public:
  [[nodiscard]] double probability(std::span<const float> samples);
  [[nodiscard]] double level(std::span<const float> samples) const;
  void reset() noexcept;

 private:
  double noise_floor_rms_{0.004};
};

class VoiceHost {
 public:
  using UtteranceCallback = std::function<void(UtteranceAudio)>;

  VoiceHost(VoiceConfig config, IEventSink& sink, UtteranceCallback on_utterance);

  void process(AudioFrame frame);
  bool accept_activation(ActivationMode mode, double confidence);
  bool reject_activation(std::string reason);
  void set_output_active(bool active, std::string output_id = {}, std::string turn_id = {});
  void set_muted(bool muted);

  [[nodiscard]] VoicePhase phase() const noexcept;
  [[nodiscard]] bool muted() const noexcept;
  [[nodiscard]] bool output_active() const noexcept;
  [[nodiscard]] const std::string& active_activity_id() const noexcept;

 private:
  void emit(std::string name, std::uint64_t monotonic_ms,
            std::vector<std::pair<std::string, EventValue>> payload = {},
            std::optional<std::string> turn_id = std::nullopt);
  void begin_candidate(std::uint64_t monotonic_ms, double confidence);
  void finish_activity(std::uint64_t monotonic_ms, std::string reason);
  void finalize_utterance(std::uint64_t monotonic_ms, std::string reason);
  void reset_interaction(bool clear_pre_roll) noexcept;
  [[nodiscard]] bool recent_window_accepts_start() const;
  [[nodiscard]] static std::string activation_mode_name(ActivationMode mode);

  VoiceConfig config_;
  IEventSink& sink_;
  UtteranceCallback on_utterance_;
  PreRollBuffer pre_roll_;
  EnergyVad vad_;

  VoicePhase phase_{VoicePhase::Quiet};
  bool muted_{false};
  bool output_active_{false};
  std::string active_output_id_;
  std::string active_output_turn_id_;

  std::vector<bool> recent_speech_;
  std::string activity_id_;
  std::string utterance_id_;
  std::vector<float> utterance_samples_;

  std::uint64_t id_sequence_{0};
  std::uint64_t candidate_started_ms_{0};
  std::uint64_t utterance_started_ms_{0};
  std::uint64_t last_frame_ms_{0};
  std::uint64_t last_level_event_ms_{0};
  std::uint32_t accumulated_speech_ms_{0};
  std::uint32_t accumulated_silence_ms_{0};
};

}  // namespace birdie::voice
