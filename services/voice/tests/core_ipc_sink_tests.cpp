#include "birdie/voice/core_ipc_sink.hpp"

#ifdef _WIN32

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <future>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

namespace {

using namespace std::chrono_literals;
using birdie::voice::CoreIpcEventSink;
using birdie::voice::VoiceEvent;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

std::wstring unique_pipe_name(const wchar_t* suffix) {
  return LR"(\\.\pipe\birdie.voice.ipc.test.)" +
         std::to_wstring(GetCurrentProcessId()) + L'.' +
         std::to_wstring(GetTickCount64()) + L'.' + suffix;
}

std::string read_line(HANDLE pipe) {
  std::string line;
  char byte = 0;
  for (;;) {
    DWORD read = 0;
    if (!ReadFile(pipe, &byte, 1, &read, nullptr) || read != 1) {
      throw std::runtime_error("named-pipe server could not read request");
    }
    if (byte == '\n') return line;
    line.push_back(byte);
    if (line.size() > 128 * 1024) {
      throw std::runtime_error("named-pipe request exceeded test limit");
    }
  }
}

void test_voice_event_is_published_to_core() {
  const std::wstring pipe_name = unique_pipe_name(L"publish");
  std::promise<std::string> received_promise;
  auto received = received_promise.get_future();
  std::atomic<bool> server_ready{false};

  std::thread server([&] {
    try {
      HANDLE pipe = CreateNamedPipeW(
          pipe_name.c_str(), PIPE_ACCESS_DUPLEX,
          PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1, 64 * 1024,
          64 * 1024, 0, nullptr);
      if (pipe == INVALID_HANDLE_VALUE) {
        throw std::runtime_error("CreateNamedPipeW failed");
      }
      server_ready.store(true, std::memory_order_release);
      const BOOL connected = ConnectNamedPipe(pipe, nullptr);
      if (!connected && GetLastError() != ERROR_PIPE_CONNECTED) {
        CloseHandle(pipe);
        throw std::runtime_error("ConnectNamedPipe failed");
      }

      const std::string line = read_line(pipe);
      const std::string ack =
          "{\"type\":\"runtime.event.ack\",\"requestId\":\"test\"}\n";
      DWORD written = 0;
      WriteFile(pipe, ack.data(), static_cast<DWORD>(ack.size()), &written,
                nullptr);
      FlushFileBuffers(pipe);
      DisconnectNamedPipe(pipe);
      CloseHandle(pipe);
      received_promise.set_value(line);
    } catch (...) {
      received_promise.set_exception(std::current_exception());
    }
  });

  while (!server_ready.load(std::memory_order_acquire)) {
    std::this_thread::sleep_for(5ms);
  }

  {
    CoreIpcEventSink sink("test-session", "test-trace", pipe_name, 4);
    const auto deadline = std::chrono::steady_clock::now() + 3s;
    while (!sink.connected() && std::chrono::steady_clock::now() < deadline) {
      std::this_thread::sleep_for(10ms);
    }
    require(sink.connected(), "voice sink must connect to Birdie Core pipe");

    sink.emit(VoiceEvent{
        "voice.activity.started",
        42,
        std::nullopt,
        {{"activity_id", std::string("activity-1")},
         {"confidence", 0.93},
         {"barge_in_candidate", true}},
    });

    require(received.wait_for(3s) == std::future_status::ready,
            "Birdie Core pipe must receive the Voice event");
  }

  server.join();
  const std::string line = received.get();
  require(line.find("\"type\":\"runtime.event.publish\"") !=
              std::string::npos,
          "message must use runtime.event.publish");
  require(line.find("\"name\":\"voice.activity.started\"") !=
              std::string::npos,
          "message must contain the canonical Voice event name");
  require(line.find("\"source\":\"birdie-voice\"") !=
              std::string::npos,
          "message must identify the Voice producer");
  require(line.find("\"contract_version\":\"1.0\"") !=
              std::string::npos,
          "message must carry the shared contract version");
  require(line.find("\"barge_in_candidate\":true") !=
              std::string::npos,
          "message must preserve typed payload values");
}

void test_disconnected_level_events_are_dropped() {
  CoreIpcEventSink sink("drop-session", "drop-trace",
                        unique_pipe_name(L"missing"), 2);
  sink.emit(VoiceEvent{"voice.input.level", 1, std::nullopt,
                       {{"normalized_level", 0.4}}});
  require(sink.dropped_best_effort() == 1,
          "best-effort audio levels must not queue while Core is offline");
}

}  // namespace

int main() {
  try {
    test_voice_event_is_published_to_core();
    test_disconnected_level_events_are_dropped();
    std::cout << "birdie-voice-ipc-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-voice-ipc-tests: FAIL: " << error.what() << '\n';
    return EXIT_FAILURE;
  }
}

#else
int main() { return EXIT_SUCCESS; }
#endif
