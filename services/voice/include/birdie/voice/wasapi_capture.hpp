#pragma once

#include "birdie/voice/voice_host.hpp"

#include <functional>
#include <memory>
#include <string>

namespace birdie::voice {

class WasapiCapture {
 public:
  using FrameCallback = std::function<void(AudioFrame)>;
  using ErrorCallback = std::function<void(std::string)>;

  WasapiCapture();
  ~WasapiCapture();
  WasapiCapture(const WasapiCapture&) = delete;
  WasapiCapture& operator=(const WasapiCapture&) = delete;

  bool start(FrameCallback on_frame, ErrorCallback on_error, std::string& error);
  void stop() noexcept;
  [[nodiscard]] bool running() const noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace birdie::voice
