#define NOMINMAX
#define _WIN32_WINNT 0x0A00

#include "birdie/voice/wasapi_capture.hpp"

#include <audioclient.h>
#include <mmdeviceapi.h>
#include <windows.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <thread>
#include <utility>
#include <vector>

namespace birdie::voice {
namespace {

using Microsoft::WRL::ComPtr;

std::string hresult_message(const char* operation, const HRESULT hr) {
  std::ostringstream out;
  out << operation << " failed (HRESULT 0x" << std::hex << std::uppercase
      << static_cast<unsigned long>(hr) << ')';
  return out.str();
}

std::uint64_t monotonic_ms() {
  return static_cast<std::uint64_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now().time_since_epoch())
          .count());
}

}  // namespace

struct WasapiCapture::Impl {
  std::atomic<bool> running{false};
  HANDLE stop_event{nullptr};
  std::thread worker;
  FrameCallback on_frame;
  ErrorCallback on_error;

  void report_error(std::string message) const {
    if (on_error) on_error(std::move(message));
  }

  void capture_loop() {
    const HRESULT com_hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool uninitialize_com = SUCCEEDED(com_hr);
    if (FAILED(com_hr) && com_hr != RPC_E_CHANGED_MODE) {
      report_error(hresult_message("CoInitializeEx", com_hr));
      running.store(false);
      return;
    }

    HANDLE audio_event = nullptr;
    ComPtr<IAudioClient> audio_client;

    auto finish = [&] {
      if (audio_client) audio_client->Stop();
      if (audio_event) CloseHandle(audio_event);
      if (uninitialize_com) CoUninitialize();
      running.store(false);
    };

    ComPtr<IMMDeviceEnumerator> enumerator;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                                  CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr)) {
      report_error(hresult_message("MMDeviceEnumerator", hr));
      finish();
      return;
    }

    ComPtr<IMMDevice> device;
    hr = enumerator->GetDefaultAudioEndpoint(eCapture, eCommunications, &device);
    if (FAILED(hr)) {
      report_error(hresult_message("GetDefaultAudioEndpoint", hr));
      finish();
      return;
    }

    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                          reinterpret_cast<void**>(audio_client.GetAddressOf()));
    if (FAILED(hr)) {
      report_error(hresult_message("Activate IAudioClient", hr));
      finish();
      return;
    }

    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    format.nChannels = 1;
    format.nSamplesPerSec = 16'000;
    format.wBitsPerSample = 32;
    format.nBlockAlign = static_cast<WORD>(format.nChannels * sizeof(float));
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    format.cbSize = 0;

    constexpr DWORD stream_flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                                   AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                                   AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    hr = audio_client->Initialize(AUDCLNT_SHAREMODE_SHARED, stream_flags, 0, 0,
                                  &format, nullptr);
    if (FAILED(hr)) {
      report_error(hresult_message("IAudioClient::Initialize", hr));
      finish();
      return;
    }

    audio_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!audio_event) {
      report_error("CreateEventW for WASAPI callback failed");
      finish();
      return;
    }

    hr = audio_client->SetEventHandle(audio_event);
    if (FAILED(hr)) {
      report_error(hresult_message("IAudioClient::SetEventHandle", hr));
      finish();
      return;
    }

    ComPtr<IAudioCaptureClient> capture_client;
    hr = audio_client->GetService(
        __uuidof(IAudioCaptureClient),
        reinterpret_cast<void**>(capture_client.GetAddressOf()));
    if (FAILED(hr)) {
      report_error(hresult_message("GetService IAudioCaptureClient", hr));
      finish();
      return;
    }

    hr = audio_client->Start();
    if (FAILED(hr)) {
      report_error(hresult_message("IAudioClient::Start", hr));
      finish();
      return;
    }

    std::vector<float> pending;
    pending.reserve(640);
    HANDLE handles[2] = {stop_event, audio_event};

    while (running.load()) {
      const DWORD wait_result = WaitForMultipleObjects(2, handles, FALSE, 500);
      if (wait_result == WAIT_OBJECT_0) break;
      if (wait_result != WAIT_OBJECT_0 + 1 && wait_result != WAIT_TIMEOUT) {
        report_error("WaitForMultipleObjects failed in WASAPI capture loop");
        break;
      }
      if (wait_result == WAIT_TIMEOUT) continue;

      UINT32 packet_frames = 0;
      hr = capture_client->GetNextPacketSize(&packet_frames);
      if (FAILED(hr)) {
        report_error(hresult_message("GetNextPacketSize", hr));
        break;
      }

      while (packet_frames > 0) {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        hr = capture_client->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(hr)) {
          report_error(hresult_message("IAudioCaptureClient::GetBuffer", hr));
          running.store(false);
          break;
        }

        const auto old_size = pending.size();
        pending.resize(old_size + frames);
        if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nullptr) {
          std::fill(pending.begin() + static_cast<std::ptrdiff_t>(old_size),
                    pending.end(), 0.0F);
        } else {
          std::memcpy(pending.data() + old_size, data,
                      static_cast<std::size_t>(frames) * sizeof(float));
        }
        capture_client->ReleaseBuffer(frames);

        constexpr std::size_t samples_per_frame = 160;  // 10 ms at 16 kHz.
        while (pending.size() >= samples_per_frame) {
          AudioFrame frame;
          frame.sample_rate = 16'000;
          frame.channels = 1;
          frame.monotonic_ms = monotonic_ms();
          frame.samples.assign(pending.begin(),
                               pending.begin() + samples_per_frame);
          pending.erase(pending.begin(), pending.begin() + samples_per_frame);
          if (on_frame) on_frame(std::move(frame));
        }

        hr = capture_client->GetNextPacketSize(&packet_frames);
        if (FAILED(hr)) {
          report_error(hresult_message("GetNextPacketSize", hr));
          running.store(false);
          break;
        }
      }
    }

    finish();
  }
};

WasapiCapture::WasapiCapture() : impl_(std::make_unique<Impl>()) {}
WasapiCapture::~WasapiCapture() { stop(); }

bool WasapiCapture::start(FrameCallback on_frame, ErrorCallback on_error,
                          std::string& error) {
  if (impl_->running.exchange(true)) {
    error = "WASAPI capture is already running";
    return false;
  }
  impl_->on_frame = std::move(on_frame);
  impl_->on_error = std::move(on_error);
  impl_->stop_event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!impl_->stop_event) {
    impl_->running.store(false);
    error = "Could not create WASAPI stop event";
    return false;
  }
  impl_->worker = std::thread([this] { impl_->capture_loop(); });
  return true;
}

void WasapiCapture::stop() noexcept {
  if (!impl_) return;
  impl_->running.store(false);
  if (impl_->stop_event) SetEvent(impl_->stop_event);
  if (impl_->worker.joinable()) impl_->worker.join();
  if (impl_->stop_event) {
    CloseHandle(impl_->stop_event);
    impl_->stop_event = nullptr;
  }
}

bool WasapiCapture::running() const noexcept {
  return impl_ && impl_->running.load();
}

}  // namespace birdie::voice
