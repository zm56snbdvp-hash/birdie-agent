#include "birdie/voice/tts_output.hpp"

#ifdef _WIN32

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <sapi.h>

#include <algorithm>
#include <chrono>
#include <memory>
#include <string>
#include <utility>

namespace birdie::voice {
namespace {

std::wstring utf8_to_utf16(const std::string& value) {
  if (value.empty()) return {};
  const int length = MultiByteToWideChar(
      CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
      static_cast<int>(value.size()), nullptr, 0);
  if (length <= 0) return {};

  std::wstring result(static_cast<std::size_t>(length), L'\0');
  const int converted = MultiByteToWideChar(
      CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
      static_cast<int>(value.size()), result.data(), length);
  if (converted != length) return {};
  return result;
}

class ComScope final {
 public:
  ComScope() : result_(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)) {}
  ~ComScope() {
    if (SUCCEEDED(result_)) CoUninitialize();
  }

  [[nodiscard]] bool ready() const noexcept { return SUCCEEDED(result_); }

 private:
  HRESULT result_;
};

class WindowsSapiTts final : public ITtsOutput {
 public:
  WindowsSapiTts(const long rate, const unsigned long volume)
      : rate_(std::clamp(rate, -10L, 10L)),
        volume_(static_cast<USHORT>(std::min<unsigned long>(volume, 100))) {}

  TtsResult speak(const TtsRequest& request) override {
    const auto started = std::chrono::steady_clock::now();
    TtsResult result;
    result.provider = "windows-sapi";
    result.voice_id = "system-default";

    const std::wstring text = utf8_to_utf16(request.text);
    if (text.empty()) {
      result.status = TtsStatus::Failed;
      result.error_code = "VOICE.TTS.INVALID_UTF8";
      return result;
    }

    ComScope com;
    if (!com.ready()) {
      result.status = TtsStatus::Unavailable;
      result.error_code = "VOICE.TTS.COM_UNAVAILABLE";
      return result;
    }

    ISpVoice* voice = nullptr;
    HRESULT status = CoCreateInstance(
        CLSID_SpVoice, nullptr, CLSCTX_INPROC_SERVER,
        IID_ISpVoice, reinterpret_cast<void**>(&voice));
    if (FAILED(status) || voice == nullptr) {
      result.status = TtsStatus::Unavailable;
      result.error_code = "VOICE.TTS.SAPI_UNAVAILABLE";
      return result;
    }

    status = voice->SetRate(rate_);
    if (SUCCEEDED(status)) status = voice->SetVolume(volume_);
    if (SUCCEEDED(status)) {
      status = voice->Speak(text.c_str(), SPF_DEFAULT, nullptr);
    }
    voice->Release();

    result.duration_ms = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started)
            .count());

    if (FAILED(status)) {
      result.status = TtsStatus::Failed;
      result.error_code = "VOICE.TTS.SAPI_SPEAK_FAILED";
      return result;
    }

    result.status = TtsStatus::Completed;
    result.error_code.clear();
    return result;
  }

 private:
  long rate_{0};
  USHORT volume_{100};
};

}  // namespace

std::unique_ptr<ITtsOutput> create_windows_sapi_tts(
    const long rate, const unsigned long volume) {
  return std::make_unique<WindowsSapiTts>(rate, volume);
}

}  // namespace birdie::voice

#endif
