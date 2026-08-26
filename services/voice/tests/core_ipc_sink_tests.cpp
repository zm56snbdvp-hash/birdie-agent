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
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>

namespace {

using namespace std::chrono_literals;
using birdie::voice::CoreCommand;
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

void write_all(HANDLE pipe, const std::string& message) {
  std::size_t offset = 0;
  while (offset < message.size()) {
    DWORD written = 0;
    if (!WriteFile(pipe, message.data() + offset,
                   static_cast<DWORD>(message.size() - offset), &written,
                   nullptr) || written == 0) {
      throw std::runtime_error("named-pipe server could not write response");
    }
    offset += written;
  }
}

void test_voice_event_and_core_command_round_trip() {
  const std::wstring pipe_name = unique_pipe_name(L"roundtrip");
  std::promise<std::pair<std::string, std::string>> received_promise;
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

      const std::string hello = read_line(pipe);
      write_all(
          pipe,
          "{\"type\":\"component.hello.ack\","
          "\"requestId\":\"voice-hello-test-session\","
          "\"payload\":{\"accepted\":true,\"role\":\"voice\","
          "\"contractVersion\":\"1.0\"}}\n");
      FlushFileBuffers(pipe);

      const std::string event = read_line(pipe);
      const std::string responses =
          "{\"type\":\"runtime.event.ack\",\"requestId\":\"test\"}\n"
          "{\"type\":\"voice.command\",\"requestId\":\"mic-off\","
          "\"payload\":{\"name\":\"voice.mute.set\",\"enabled\":false}}\n";
      write_all(pipe, responses);
      FlushFileBuffers(pipe);
      received_promise.set_value({hello, event});
      std::this_thread::sleep_for(250ms);
      DisconnectNamedPipe(pipe);
      CloseHandle(pipe);
    } catch (...) {
      received_promise.set_exception(std::current_exception());
    }
  });

  while (!server_ready.load(std::memory_order_acquire)) {
    std::this_thread::sleep_for(5ms);
  }

  std::optional<CoreCommand> command;
  {
    CoreIpcEventSink sink("test-session", "test-trace", pipe_name, 4);
    const auto deadline = std::chrono::steady_clock::now() + 3s;
    while (!sink.connected() && std::chrono::steady_clock::now() < deadline) {
      std::this_thread::sleep_for(10ms);
    }
    require(
        sink.connected(),
        "voice sink must report connected only after Core accepts hello");

    sink.emit(VoiceEvent{
        "voice.utterance.finalized",
        42,
        std::string("turn-content-1"),
        {{"activity_id", std::string("activity-1")},
         {"utterance_id", std::string("utterance-1")},
         {"transcript", std::string("Birdie, öffne den Kalender")},
         {"confidence", 0.93}},
        "content",
    });

    require(received.wait_for(3s) == std::future_status::ready,
            "Birdie Core pipe must receive hello and Voice event");

    const auto command_deadline = std::chrono::steady_clock::now() + 3s;
    while (!command && std::chrono::steady_clock::now() < command_deadline) {
      command = sink.try_pop_command();
      if (!command) std::this_thread::sleep_for(10ms);
    }
    require(command.has_value(), "Voice sink must queue Core control command");
  }

  server.join();
  const auto [hello, event] = received.get();
  require(hello.find("\"type\":\"component.hello\"") !=
              std::string::npos,
          "first Voice message must be component.hello");
  require(hello.find("\"role\":\"voice\"") != std::string::npos,
          "Voice hello must request voice role");
  require(hello.find("\"contractVersion\":\"1.0\"") !=
              std::string::npos,
          "Voice hello must carry contract version");

  require(event.find("\"type\":\"runtime.event.publish\"") !=
              std::string::npos,
          "message must use runtime.event.publish");
  require(event.find("\"name\":\"voice.utterance.finalized\"") !=
              std::string::npos,
          "message must contain the canonical finalized event name");
  require(event.find("\"source\":\"birdie-voice\"") !=
              std::string::npos,
          "message must identify the Voice producer");
  require(event.find("\"contract_version\":\"1.0\"") !=
              std::string::npos,
          "message must carry the shared contract version");
  require(event.find("\"turn_id\":\"turn-content-1\"") !=
              std::string::npos,
          "message must preserve the canonical turn id");
  require(event.find("\"data_classification\":\"content\"") !=
              std::string::npos,
          "content classification must survive the Windows IPC boundary");
  require(event.find("Birdie, öffne den Kalender") != std::string::npos,
          "content payload must be serialized for the authorized Core client");

  require(command->request_id == "mic-off",
          "Voice command must preserve request id");
  require(command->name == "voice.mute.set",
          "Voice command must use canonical command name");
  require(!command->enabled,
          "Voice command must preserve requested microphone state");
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
    test_voice_event_and_core_command_round_trip();
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
