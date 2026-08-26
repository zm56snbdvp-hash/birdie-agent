#include "birdie/voice/voice_host.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <ctime>
#include <iomanip>
#include <ostream>
#include <sstream>
#include <stdexcept>

namespace birdie::voice {
namespace {

std::string escape_json(const std::string& input) {
  std::ostringstream out;
  for (const unsigned char c : input) {
    switch (c) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (c < 0x20) {
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<int>(c) << std::dec;
        } else {
          out << static_cast<char>(c);
        }
    }
  }
  return out.str();
}

std::string utc_now() {
  const auto now = std::chrono::system_clock::now();
  const auto seconds = std::chrono::system_clock::to_time_t(now);
  const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch()) % 1000;
  std::tm utc{};
#ifdef _WIN32
  gmtime_s(&utc, &seconds);
#else
  gmtime_r(&seconds, &utc);
#endif
  std::ostringstream out;
  out << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S") << '.'
      << std::setw(3) << std::setfill('0') << millis.count() << 'Z';
  return out.str();
}

std::string value_to_json(const EventValue& value) {
  return std::visit([](const auto& item) -> std::string {
    using T = std::decay_t<decltype(item)>;
    if constexpr (std::is_same_v<T, std::string>) {
      return "\"" + escape_json(item) + "\"";
    } else if constexpr (std::is_same_v<T, bool>) {
      return item ? "true" : "false";
    } else if constexpr (std::is_same_v<T, double>) {
      std::ostringstream out;
      out << std::fixed << std::setprecision(6) << item;
      return out.str();
    } else {
      return std::to_string(item);
    }
  }, value);
}

std::uint32_t frame_duration_ms(const AudioFrame& frame) {
  if (frame.sample_rate == 0 || frame.channels == 0) return 0;
  const auto frames = frame.samples.size() / frame.channels;
  return static_cast<std::uint32_t>(std::max<std::uint64_t>(
      1, (static_cast<std::uint64_t>(frames) * 1000) / frame.sample_rate));
}

}  // namespace

JsonLineEventSink::JsonLineEventSink(std::ostream& output, std::string session_id,
                                     std::string trace_id)
    : output_(output),
      session_id_(std::move(session_id)),
      trace_id_(std::move(trace_id)) {}

void JsonLineEventSink::emit(const VoiceEvent& event) {
  std::scoped_lock lock(mutex_);
  const auto sequence = ++sequence_;
  const std::string classification = event.data_classification.empty()
      ? "operational"
      : event.data_classification;
  output_ << '{'
          << "\"contract_version\":\"1.0\","
          << "\"kind\":\"event\","
          << "\"name\":\"" << escape_json(event.name) << "\","
          << "\"event_id\":\"voice-" << sequence << "\","
          << "\"source\":\"birdie-voice\","
          << "\"timestamp_utc\":\"" << utc_now() << "\","
          << "\"monotonic_ms\":" << event.monotonic_ms << ','
          << "\"source_sequence\":" << sequence << ','
          << "\"trace_id\":\"" << escape_json(trace_id_) << "\","
          << "\"session_id\":\"" << escape_json(session_id_) << "\","
          << "\"turn_id\":";
  if (event.turn_id) {
    output_ << '"' << escape_json(*event.turn_id) << '"';
  } else {
    output_ << "null";
  }
  output_ << ",\"data_classification\":\""
          << escape_json(classification) << "\",\"payload\":{";
  for (std::size_t i = 0; i < event.payload.size(); ++i) {
    if (i > 0) output_ << ',';
    output_ << '"' << escape_json(event.payload[i].first) << "\":"
            << value_to_json(event.payload[i].second);
  }
  output_ << "}}\n";
  output_.flush();
}

PreRollBuffer::PreRollBuffer(const std::uint32_t sample_rate,
                             const std::uint32_t capacity_ms)
    : buffer_(std::max<std::size_t>(
          1, (static_cast<std::uint64_t>(sample_rate) * capacity_ms) / 1000),
          0.0F) {}

void PreRollBuffer::push(const std::span<const float> samples) {
  for (const float sample : samples) {
    buffer_[write_index_] = sample;
    write_index_ = (write_index_ + 1) % buffer_.size();
    size_ = std::min(size_ + 1, buffer_.size());
  }
}

std::vector<float> PreRollBuffer::snapshot() const {
  std::vector<float> result;
  result.reserve(size_);
  const std::size_t start = size_ == buffer_.size() ? write_index_ : 0;
  for (std::size_t i = 0; i < size_; ++i) {
    result.push_back(buffer_[(start + i) % buffer_.size()]);
  }
  return result;
}

void PreRollBuffer::clear() noexcept {
  std::fill(buffer_.begin(), buffer_.end(), 0.0F);
  write_index_ = 0;
  size_ = 0;
}

std::size_t PreRollBuffer::size() const noexcept { return size_; }
std::size_t PreRollBuffer::capacity() const noexcept { return buffer_.size(); }

double EnergyVad::level(const std::span<const float> samples) const {
  if (samples.empty()) return 0.0;
  double sum = 0.0;
  for (const float sample : samples) {
    const auto value = static_cast<double>(sample);
    sum += value * value;
  }
  const double rms = std::sqrt(sum / static_cast<double>(samples.size()));
  return std::clamp(rms / 0.18, 0.0, 1.0);
}

double EnergyVad::probability(const std::span<const float> samples) {
  if (samples.empty()) return 0.0;
  double sum = 0.0;
  for (const float sample : samples) {
    const auto value = static_cast<double>(sample);
    sum += value * value;
  }
  const double rms = std::sqrt(sum / static_cast<double>(samples.size()));
  if (rms < 0.03) {
    noise_floor_rms_ = std::clamp(noise_floor_rms_ * 0.995 + rms * 0.005,
                                  0.0005, 0.02);
  }
  const double floor = std::max(0.008, noise_floor_rms_ * 2.5);
  const double full_speech = std::max(0.08, floor + 0.05);
  return std::clamp((rms - floor) / (full_speech - floor), 0.0, 1.0);
}

void EnergyVad::reset() noexcept { noise_floor_rms_ = 0.004; }

VoiceHost::VoiceHost(VoiceConfig config, IEventSink& sink,
                     UtteranceCallback on_utterance)
    : config_(std::move(config)),
      sink_(sink),
      on_utterance_(std::move(on_utterance)),
      pre_roll_(config_.sample_rate, config_.pre_roll_ms) {
  if (config_.start_window_frames == 0 || config_.start_required_frames == 0 ||
      config_.start_required_frames > config_.start_window_frames) {
    throw std::invalid_argument("invalid VAD start window configuration");
  }
}

void VoiceHost::process(AudioFrame frame) {
  if (muted_ || frame.samples.empty()) return;
  last_frame_ms_ = frame.monotonic_ms;

  if (frame.sample_rate != config_.sample_rate || frame.channels != 1) {
    emit("component.health.changed", frame.monotonic_ms,
         {{"component", std::string("birdie-voice")},
          {"status", std::string("DEGRADED")},
          {"error_code", std::string("VOICE.INPUT.FORMAT_MISMATCH")}});
    return;
  }

  pre_roll_.push(frame.samples);
  const double input_level = vad_.level(frame.samples);
  const double vad_probability = vad_.probability(frame.samples);
  const auto duration_ms = frame_duration_ms(frame);

  if (last_level_event_ms_ == 0 ||
      frame.monotonic_ms - last_level_event_ms_ >= config_.level_interval_ms) {
    emit("voice.input.level", frame.monotonic_ms,
         {{"normalized_level", input_level},
          {"vad_probability", vad_probability}});
    last_level_event_ms_ = frame.monotonic_ms;
  }

  const bool start_speech = vad_probability >= config_.speech_start_threshold;
  recent_speech_.push_back(start_speech);
  if (recent_speech_.size() > config_.start_window_frames) {
    recent_speech_.erase(recent_speech_.begin());
  }

  if (phase_ == VoicePhase::Quiet) {
    if (recent_window_accepts_start()) {
      begin_candidate(frame.monotonic_ms, vad_probability);
    }
    return;
  }

  const bool continuing_speech = vad_probability >= config_.speech_stop_threshold;
  if (continuing_speech) {
    accumulated_speech_ms_ += duration_ms;
    accumulated_silence_ms_ = 0;
  } else {
    accumulated_silence_ms_ += duration_ms;
  }

  if (phase_ == VoicePhase::SpeechCandidate) {
    if (frame.monotonic_ms - candidate_started_ms_ >= config_.activation_timeout_ms) {
      reject_activation("activation_timeout");
    } else if (accumulated_silence_ms_ >=
               std::min<std::uint32_t>(250, config_.silence_to_endpoint_ms)) {
      reject_activation("speech_ended_before_activation");
    }
    return;
  }

  utterance_samples_.insert(utterance_samples_.end(), frame.samples.begin(),
                            frame.samples.end());
  const auto utterance_duration = static_cast<std::uint64_t>(
      (utterance_samples_.size() * 1000ULL) / config_.sample_rate);

  if (utterance_duration >= config_.maximum_utterance_ms) {
    finalize_utterance(frame.monotonic_ms, "maximum_duration");
  } else if (accumulated_silence_ms_ >= config_.silence_to_endpoint_ms &&
             accumulated_speech_ms_ >= config_.minimum_speech_ms) {
    finalize_utterance(frame.monotonic_ms, "endpoint_silence");
  }
}

bool VoiceHost::accept_activation(const ActivationMode mode,
                                  const double confidence) {
  if (phase_ != VoicePhase::SpeechCandidate || muted_) return false;
  phase_ = VoicePhase::Listening;
  utterance_id_ = "utt-" + std::to_string(++id_sequence_);
  turn_id_ = "turn-" + utterance_id_;
  utterance_started_ms_ = candidate_started_ms_;
  utterance_samples_ = pre_roll_.snapshot();
  accumulated_silence_ms_ = 0;

  emit("voice.activation.accepted", last_frame_ms_,
       {{"activity_id", activity_id_},
        {"utterance_id", utterance_id_},
        {"turn_id", turn_id_},
        {"activation_mode", activation_mode_name(mode)},
        {"confidence", std::clamp(confidence, 0.0, 1.0)},
        {"barge_in", output_active_},
        {"output_id", active_output_id_},
        {"interrupted_turn_id", active_output_turn_id_}},
       turn_id_);
  return true;
}

bool VoiceHost::reject_activation(std::string reason) {
  if (phase_ != VoicePhase::SpeechCandidate) return false;
  emit("voice.activation.rejected", last_frame_ms_,
       {{"activity_id", activity_id_}, {"reason", reason},
        {"barge_in", output_active_}, {"output_id", active_output_id_}},
       active_output_turn_id_.empty()
           ? std::nullopt
           : std::optional<std::string>(active_output_turn_id_));
  finish_activity(last_frame_ms_, std::move(reason));
  reset_interaction(true);
  return true;
}

void VoiceHost::set_output_active(const bool active, std::string output_id,
                                  std::string turn_id) {
  output_active_ = active;
  active_output_id_ = active ? std::move(output_id) : std::string{};
  active_output_turn_id_ = active ? std::move(turn_id) : std::string{};
}

void VoiceHost::set_muted(const bool muted) {
  if (muted_ == muted) return;
  muted_ = muted;
  if (muted_) {
    if (phase_ == VoicePhase::SpeechCandidate) {
      reject_activation("muted_by_user");
    } else if (phase_ == VoicePhase::Listening) {
      finish_activity(last_frame_ms_, "muted_by_user");
      reset_interaction(true);
    } else {
      pre_roll_.clear();
      recent_speech_.clear();
    }
  }
  emit("voice.privacy.changed", last_frame_ms_,
       {{"microphone_state",
         std::string(muted_ ? "MUTED_BY_USER" : "ENABLED")}});
}

VoicePhase VoiceHost::phase() const noexcept { return phase_; }
bool VoiceHost::muted() const noexcept { return muted_; }
bool VoiceHost::output_active() const noexcept { return output_active_; }
const std::string& VoiceHost::active_activity_id() const noexcept {
  return activity_id_;
}

void VoiceHost::emit(
    std::string name, const std::uint64_t monotonic_ms,
    std::vector<std::pair<std::string, EventValue>> payload,
    std::optional<std::string> turn_id) {
  sink_.emit(VoiceEvent{std::move(name), monotonic_ms, std::move(turn_id),
                        std::move(payload)});
}

void VoiceHost::begin_candidate(const std::uint64_t monotonic_ms,
                                const double confidence) {
  phase_ = VoicePhase::SpeechCandidate;
  activity_id_ = "activity-" + std::to_string(++id_sequence_);
  gate_stt_activity_id_.clear();
  candidate_started_ms_ = monotonic_ms;
  accumulated_speech_ms_ = static_cast<std::uint32_t>(
      config_.start_required_frames * config_.frame_ms);
  accumulated_silence_ms_ = 0;
  emit("voice.activity.started", monotonic_ms,
       {{"activity_id", activity_id_},
        {"confidence", std::clamp(confidence, 0.0, 1.0)},
        {"barge_in_candidate", output_active_},
        {"output_id", active_output_id_}},
       active_output_turn_id_.empty()
           ? std::nullopt
           : std::optional<std::string>(active_output_turn_id_));
}

void VoiceHost::finish_activity(const std::uint64_t monotonic_ms,
                                std::string reason) {
  if (activity_id_.empty()) return;
  emit("voice.activity.ended", monotonic_ms,
       {{"activity_id", activity_id_}, {"reason", std::move(reason)}});
}

void VoiceHost::finalize_utterance(const std::uint64_t monotonic_ms,
                                   std::string reason) {
  const auto duration_ms = static_cast<std::uint64_t>(
      (utterance_samples_.size() * 1000ULL) / config_.sample_rate);
  UtteranceAudio utterance{
      utterance_id_,
      std::move(utterance_samples_),
      config_.sample_rate,
      duration_ms,
      activity_id_,
      turn_id_,
      utterance_started_ms_,
      monotonic_ms,
  };
  finish_activity(monotonic_ms, std::move(reason));
  reset_interaction(true);
  if (on_utterance_) on_utterance_(std::move(utterance));
}

void VoiceHost::reset_interaction(const bool clear_pre_roll) noexcept {
  phase_ = VoicePhase::Quiet;
  std::fill(utterance_samples_.begin(), utterance_samples_.end(), 0.0F);
  utterance_samples_.clear();
  activity_id_.clear();
  gate_stt_activity_id_.clear();
  utterance_id_.clear();
  turn_id_.clear();
  recent_speech_.clear();
  candidate_started_ms_ = 0;
  utterance_started_ms_ = 0;
  accumulated_speech_ms_ = 0;
  accumulated_silence_ms_ = 0;
  if (clear_pre_roll) pre_roll_.clear();
}

bool VoiceHost::recent_window_accepts_start() const {
  if (recent_speech_.size() < config_.start_window_frames) return false;
  return static_cast<std::size_t>(
             std::count(recent_speech_.begin(), recent_speech_.end(), true)) >=
         config_.start_required_frames;
}

std::string VoiceHost::activation_mode_name(const ActivationMode mode) {
  switch (mode) {
    case ActivationMode::WakeWord: return "WAKE_WORD";
    case ActivationMode::FollowUp: return "FOLLOW_UP";
    case ActivationMode::WakeOnSpeak: return "WAKE_ON_SPEAK";
    case ActivationMode::PushToTalk: return "PUSH_TO_TALK";
    case ActivationMode::Development: return "DEVELOPMENT";
  }
  return "UNKNOWN";
}

}  // namespace birdie::voice
