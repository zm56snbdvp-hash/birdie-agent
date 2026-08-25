#pragma once

#include "birdie/voice/voice_host.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

namespace birdie::voice {

#ifdef _WIN32

class CoreIpcEventSink final : public IEventSink {
 public:
  CoreIpcEventSink(std::string session_id, std::string trace_id,
                   std::wstring pipe_name = LR"(\\.\pipe\birdie.core.control.v1)",
                   std::size_t best_effort_queue_limit = 128);
  ~CoreIpcEventSink() override;

  CoreIpcEventSink(const CoreIpcEventSink&) = delete;
  CoreIpcEventSink& operator=(const CoreIpcEventSink&) = delete;

  void emit(const VoiceEvent& event) override;

  [[nodiscard]] bool connected() const noexcept;
  [[nodiscard]] std::uint64_t dropped_best_effort() const noexcept;

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

#endif

}  // namespace birdie::voice
