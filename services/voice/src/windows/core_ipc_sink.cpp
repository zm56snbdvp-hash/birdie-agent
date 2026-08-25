#include "birdie/voice/core_ipc_sink.hpp"

#ifdef _WIN32

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <ctime>
#include <deque>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <thread>
#include <type_traits>
#include <utility>
#include <variant>

namespace birdie::voice {
namespace {

using namespace std::chrono_literals;

std::string escape_json(const std::string_view input) {
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
  gmtime_s(&utc, &seconds);
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

bool is_best_effort(const std::string_view event_name) {
  return event_name == "voice.input.level" ||
         event_name == "voice.output.level";
}

std::string serialize_publish_request(const VoiceEvent& event,
                                      const std::string& session_id,
                                      const std::string& trace_id,
                                      const std::uint64_t sequence) {
  const std::string event_id = "voice-" + session_id + '-' +
                               std::to_string(sequence);
  const std::string request_id = "voice-request-" + session_id + '-' +
                                 std::to_string(sequence);

  std::ostringstream out;
  out << '{'
      << "\"type\":\"runtime.event.publish\","
      << "\"requestId\":\"" << escape_json(request_id) << "\","
      << "\"payload\":{"
      << "\"contract_version\":\"1.0\","
      << "\"kind\":\"event\","
      << "\"name\":\"" << escape_json(event.name) << "\","
      << "\"event_id\":\"" << escape_json(event_id) << "\","
      << "\"source\":\"birdie-voice\","
      << "\"timestamp_utc\":\"" << utc_now() << "\","
      << "\"monotonic_ms\":" << event.monotonic_ms << ','
      << "\"source_sequence\":" << sequence << ','
      << "\"trace_id\":\"" << escape_json(trace_id) << "\","
      << "\"session_id\":\"" << escape_json(session_id) << "\","
      << "\"turn_id\":";

  if (event.turn_id) {
    out << '"' << escape_json(*event.turn_id) << '"';
  } else {
    out << "null";
  }

  out << ",\"data_classification\":\"operational\",\"payload\":{";
  for (std::size_t index = 0; index < event.payload.size(); ++index) {
    if (index > 0) out << ',';
    out << '"' << escape_json(event.payload[index].first) << "\":"
        << value_to_json(event.payload[index].second);
  }
  out << "}}}\n";
  return out.str();
}

}  // namespace

class CoreIpcEventSink::Impl {
 public:
  Impl(std::string session_id, std::string trace_id, std::wstring pipe_name,
       const std::size_t best_effort_queue_limit)
      : session_id_(std::move(session_id)),
        trace_id_(std::move(trace_id)),
        pipe_name_(std::move(pipe_name)),
        best_effort_queue_limit_(std::max<std::size_t>(1,
                                                        best_effort_queue_limit)),
        worker_([this] { run(); }) {
    if (session_id_.empty() || trace_id_.empty() || pipe_name_.empty()) {
      throw std::invalid_argument("CoreIpcEventSink requires session, trace and pipe identifiers");
    }
  }

  ~Impl() {
    stop_.store(true, std::memory_order_release);
    wake_.notify_all();
    if (worker_.joinable()) worker_.join();
    disconnect();
  }

  void emit(const VoiceEvent& event) {
    const bool best_effort = is_best_effort(event.name);
    if (best_effort && !connected_.load(std::memory_order_acquire)) {
      dropped_best_effort_.fetch_add(1, std::memory_order_relaxed);
      return;
    }

    const auto sequence = sequence_.fetch_add(1, std::memory_order_relaxed) + 1;
    Pending pending{serialize_publish_request(event, session_id_, trace_id_,
                                              sequence),
                    best_effort};

    {
      std::scoped_lock lock(queue_mutex_);
      if (best_effort) {
        if (best_effort_queue_.size() >= best_effort_queue_limit_) {
          dropped_best_effort_.fetch_add(1, std::memory_order_relaxed);
          return;
        }
        best_effort_queue_.push_back(std::move(pending));
      } else {
        reliable_queue_.push_back(std::move(pending));
      }
    }
    wake_.notify_one();
  }

  [[nodiscard]] bool connected() const noexcept {
    return connected_.load(std::memory_order_acquire);
  }

  [[nodiscard]] std::uint64_t dropped_best_effort() const noexcept {
    return dropped_best_effort_.load(std::memory_order_relaxed);
  }

 private:
  struct Pending {
    std::string line;
    bool best_effort{false};
  };

  void run() {
    auto reconnect_delay = 100ms;
    while (!stop_.load(std::memory_order_acquire)) {
      if (pipe_ == INVALID_HANDLE_VALUE) {
        if (!connect()) {
          std::unique_lock lock(queue_mutex_);
          wake_.wait_for(lock, reconnect_delay, [this] {
            return stop_.load(std::memory_order_acquire);
          });
          reconnect_delay = std::min(reconnect_delay * 2, 2s);
          continue;
        }
        reconnect_delay = 100ms;
      }

      std::optional<Pending> pending;
      {
        std::unique_lock lock(queue_mutex_);
        if (reliable_queue_.empty() && best_effort_queue_.empty()) {
          wake_.wait_for(lock, 100ms, [this] {
            return stop_.load(std::memory_order_acquire) ||
                   !reliable_queue_.empty() || !best_effort_queue_.empty();
          });
        }
        if (!reliable_queue_.empty()) {
          pending = std::move(reliable_queue_.front());
          reliable_queue_.pop_front();
        } else if (!best_effort_queue_.empty()) {
          pending = std::move(best_effort_queue_.front());
          best_effort_queue_.pop_front();
        }
      }

      if (stop_.load(std::memory_order_acquire)) break;
      if (!pending) {
        drain_available();
        continue;
      }

      if (!write_all(pending->line)) {
        {
          std::scoped_lock lock(queue_mutex_);
          if (pending->best_effort) {
            dropped_best_effort_.fetch_add(1, std::memory_order_relaxed);
          } else {
            reliable_queue_.push_front(std::move(*pending));
          }
        }
        disconnect();
        continue;
      }
      drain_available();
    }
  }

  bool connect() {
    if (!WaitNamedPipeW(pipe_name_.c_str(), 250)) return false;

    HANDLE handle = CreateFileW(pipe_name_.c_str(), GENERIC_READ | GENERIC_WRITE,
                                0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return false;

    DWORD mode = PIPE_READMODE_BYTE;
    if (!SetNamedPipeHandleState(handle, &mode, nullptr, nullptr)) {
      CloseHandle(handle);
      return false;
    }

    pipe_ = handle;
    connected_.store(true, std::memory_order_release);
    drain_available();
    return true;
  }

  bool write_all(const std::string& line) {
    std::size_t offset = 0;
    while (offset < line.size()) {
      DWORD written = 0;
      const DWORD remaining = static_cast<DWORD>(std::min<std::size_t>(
          line.size() - offset, static_cast<std::size_t>(MAXDWORD)));
      if (!WriteFile(pipe_, line.data() + offset, remaining, &written, nullptr) ||
          written == 0) {
        return false;
      }
      offset += written;
    }
    return true;
  }

  void drain_available() {
    if (pipe_ == INVALID_HANDLE_VALUE) return;
    char buffer[4096];
    for (;;) {
      DWORD available = 0;
      if (!PeekNamedPipe(pipe_, nullptr, 0, nullptr, &available, nullptr)) {
        disconnect();
        return;
      }
      if (available == 0) return;
      DWORD read = 0;
      const DWORD requested = std::min<DWORD>(available, sizeof(buffer));
      if (!ReadFile(pipe_, buffer, requested, &read, nullptr)) {
        disconnect();
        return;
      }
      if (read == 0) return;
    }
  }

  void disconnect() noexcept {
    connected_.store(false, std::memory_order_release);
    if (pipe_ != INVALID_HANDLE_VALUE) {
      CloseHandle(pipe_);
      pipe_ = INVALID_HANDLE_VALUE;
    }
  }

  std::string session_id_;
  std::string trace_id_;
  std::wstring pipe_name_;
  std::size_t best_effort_queue_limit_;

  std::atomic<bool> stop_{false};
  std::atomic<bool> connected_{false};
  std::atomic<std::uint64_t> sequence_{0};
  std::atomic<std::uint64_t> dropped_best_effort_{0};

  std::mutex queue_mutex_;
  std::condition_variable wake_;
  std::deque<Pending> reliable_queue_;
  std::deque<Pending> best_effort_queue_;
  std::thread worker_;
  HANDLE pipe_{INVALID_HANDLE_VALUE};
};

CoreIpcEventSink::CoreIpcEventSink(std::string session_id, std::string trace_id,
                                   std::wstring pipe_name,
                                   const std::size_t best_effort_queue_limit)
    : impl_(std::make_unique<Impl>(std::move(session_id), std::move(trace_id),
                                   std::move(pipe_name),
                                   best_effort_queue_limit)) {}

CoreIpcEventSink::~CoreIpcEventSink() = default;

void CoreIpcEventSink::emit(const VoiceEvent& event) { impl_->emit(event); }

bool CoreIpcEventSink::connected() const noexcept { return impl_->connected(); }

std::uint64_t CoreIpcEventSink::dropped_best_effort() const noexcept {
  return impl_->dropped_best_effort();
}

}  // namespace birdie::voice

#endif
