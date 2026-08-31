#include "birdie/voice/conversation_stt_worker.hpp"

#include <algorithm>
#include <utility>

namespace birdie::voice {
namespace {

void wipe(std::string& value) noexcept {
  std::fill(value.begin(), value.end(), '\0');
  value.clear();
}

ConversationTranscript cancelled_transcript(
    const UtteranceAudio& utterance,
    std::string error_code) {
  ConversationTranscript transcript;
  transcript.status = GateSttStatus::Failed;
  transcript.activity_id = utterance.activity_id;
  transcript.utterance_id = utterance.utterance_id;
  transcript.turn_id = utterance.turn_id;
  transcript.duration_ms = utterance.duration_ms;
  transcript.ended_ms = utterance.ended_ms;
  transcript.error_code = std::move(error_code);
  return transcript;
}

}  // namespace

ConversationSttWorker::ConversationSttWorker(
    IGateStt& local_stt,
    TranscriptCallback callback)
    : local_stt_(local_stt),
      callback_(std::move(callback)),
      thread_([this] { run(); }) {}

ConversationSttWorker::~ConversationSttWorker() { stop(); }

bool ConversationSttWorker::submit(UtteranceAudio utterance) {
  if (utterance.activity_id.empty() || utterance.utterance_id.empty() ||
      utterance.turn_id.empty() || utterance.samples.empty() ||
      utterance.sample_rate == 0) {
    secure_clear(utterance);
    return false;
  }

  {
    std::scoped_lock lock(mutex_);
    if (stopping_ || pending_) {
      secure_clear(utterance);
      dropped_jobs_.fetch_add(1, std::memory_order_relaxed);
      return false;
    }
    pending_ = std::move(utterance);
  }
  wake_.notify_one();
  return true;
}

void ConversationSttWorker::discard_pending() noexcept {
  std::optional<ConversationTranscript> cancelled;
  {
    std::scoped_lock lock(mutex_);
    if (!pending_) return;
    cancelled = cancelled_transcript(
        *pending_, "VOICE.CONVERSATION_STT.CANCELLED");
    secure_clear(*pending_);
    pending_.reset();
    dropped_jobs_.fetch_add(1, std::memory_order_relaxed);
  }

  try {
    if (cancelled && callback_) callback_(std::move(*cancelled));
  } catch (...) {
    if (cancelled) secure_clear(*cancelled);
  }
}

void ConversationSttWorker::stop() noexcept {
  std::optional<ConversationTranscript> cancelled;
  {
    std::scoped_lock lock(mutex_);
    if (stopping_) return;
    stopping_ = true;
    if (pending_) {
      cancelled = cancelled_transcript(
          *pending_, "VOICE.CONVERSATION_STT.STOPPED");
      secure_clear(*pending_);
      pending_.reset();
      dropped_jobs_.fetch_add(1, std::memory_order_relaxed);
    }
  }

  try {
    if (cancelled && callback_) callback_(std::move(*cancelled));
  } catch (...) {
    if (cancelled) secure_clear(*cancelled);
  }

  wake_.notify_all();
  if (thread_.joinable()) thread_.join();
}

std::uint64_t ConversationSttWorker::dropped_jobs() const noexcept {
  return dropped_jobs_.load(std::memory_order_relaxed);
}

void ConversationSttWorker::run() noexcept {
  for (;;) {
    std::optional<UtteranceAudio> utterance;
    {
      std::unique_lock lock(mutex_);
      wake_.wait(lock, [this] { return stopping_ || pending_.has_value(); });
      if (stopping_ && !pending_) return;
      utterance = std::move(pending_);
      pending_.reset();
    }

    ConversationTranscript transcript;
    transcript.activity_id = utterance->activity_id;
    transcript.utterance_id = utterance->utterance_id;
    transcript.turn_id = utterance->turn_id;
    transcript.duration_ms = utterance->duration_ms;
    transcript.ended_ms = utterance->ended_ms;

    GateSttRequest request;
    request.activity_id = utterance->activity_id;
    request.samples = std::move(utterance->samples);
    request.sample_rate = utterance->sample_rate;
    request.channels = 1;
    request.candidate_started_ms = utterance->started_ms;
    request.captured_through_ms = utterance->ended_ms;
    request.barge_in_candidate = false;
    secure_clear(*utterance);

    GateSttResult result;
    try {
      result = local_stt_.transcribe(request);
    } catch (...) {
      result.status = GateSttStatus::Failed;
      result.error_code = "VOICE.CONVERSATION_STT.EXCEPTION";
    }
    secure_clear(request);

    transcript.status = result.status;
    transcript.transcript = std::move(result.transcript);
    transcript.language = result.language.empty() ? "und" : result.language;
    transcript.confidence = result.confidence;
    transcript.no_speech_probability = result.no_speech_probability;
    transcript.latency_ms = result.latency_ms;
    transcript.model_id = result.model_id;
    transcript.error_code = result.error_code;
    secure_clear(result);

    try {
      if (callback_) callback_(std::move(transcript));
    } catch (...) {
      secure_clear(transcript);
    }
  }
}

void secure_clear(UtteranceAudio& utterance) noexcept {
  std::fill(utterance.samples.begin(), utterance.samples.end(), 0.0F);
  std::vector<float>{}.swap(utterance.samples);
  wipe(utterance.activity_id);
  wipe(utterance.utterance_id);
  wipe(utterance.turn_id);
  utterance.sample_rate = 0;
  utterance.duration_ms = 0;
  utterance.started_ms = 0;
  utterance.ended_ms = 0;
}

void secure_clear(ConversationTranscript& transcript) noexcept {
  wipe(transcript.activity_id);
  wipe(transcript.utterance_id);
  wipe(transcript.turn_id);
  wipe(transcript.transcript);
  wipe(transcript.language);
  wipe(transcript.model_id);
  wipe(transcript.error_code);
  transcript.confidence = 0.0;
  transcript.no_speech_probability = 1.0;
  transcript.duration_ms = 0;
  transcript.latency_ms = 0;
  transcript.ended_ms = 0;
}

}  // namespace birdie::voice
