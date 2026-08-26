#include "birdie/voice/whisper_cpp_gate_stt.hpp"

#include <cstdlib>
#include <iostream>
#include <memory>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>

namespace {

using birdie::voice::GateSttRequest;
using birdie::voice::GateSttStatus;
using birdie::voice::IWhisperCppRuntime;
using birdie::voice::WhisperCppDecodeResult;
using birdie::voice::WhisperCppDecodeStatus;
using birdie::voice::WhisperCppGateStt;
using birdie::voice::WhisperCppGateSttConfig;

void require(const bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

class FakeRuntime final : public IWhisperCppRuntime {
 public:
  [[nodiscard]] bool ready() const noexcept override { return ready_value; }
  [[nodiscard]] std::string model_id() const override {
    return "whisper.cpp/fake-model.bin";
  }
  [[nodiscard]] std::string error_code() const override {
    return ready_value ? std::string{} : unavailable_error;
  }

  [[nodiscard]] WhisperCppDecodeResult decode(
      const std::span<const float> samples) override {
    calls += 1;
    last_sample_count = samples.size();
    if (throw_on_decode) throw std::runtime_error("fake decoder failure");
    return result;
  }

  bool ready_value{true};
  bool throw_on_decode{false};
  int calls{0};
  std::size_t last_sample_count{0};
  std::string unavailable_error{
      "VOICE.GATE_STT.WHISPER_CPP_NOT_BUILT"};
  WhisperCppDecodeResult result;
};

GateSttRequest request() {
  GateSttRequest value;
  value.activity_id = "activity-whisper-adapter";
  value.sample_rate = 16'000;
  value.channels = 1;
  value.samples.assign(3'200, 0.08F);
  value.candidate_started_ms = 100;
  value.captured_through_ms = 300;
  return value;
}

WhisperCppGateStt make_provider(
    std::unique_ptr<IWhisperCppRuntime> runtime) {
  WhisperCppGateSttConfig config;
  config.model_path = "fake-model.bin";
  return WhisperCppGateStt(config, std::move(runtime));
}

void test_transcript_mapping() {
  auto runtime = std::make_unique<FakeRuntime>();
  FakeRuntime* raw = runtime.get();
  raw->result.status = WhisperCppDecodeStatus::Transcript;
  raw->result.transcript = "Birdie, öffne den Kalender";
  raw->result.language = "de";
  raw->result.confidence = 0.91;
  raw->result.no_speech_probability = 0.03;
  raw->result.error_code.clear();

  auto provider = make_provider(std::move(runtime));
  const auto result = provider.transcribe(request());

  require(result.status == GateSttStatus::Transcript,
          "valid local decode must map to TRANSCRIPT");
  require(result.transcript == "Birdie, öffne den Kalender",
          "adapter must preserve transcript for the evidence pipeline");
  require(result.language == "de", "adapter must preserve language");
  require(result.confidence == 0.91,
          "adapter must preserve bounded confidence");
  require(result.no_speech_probability == 0.03,
          "adapter must preserve no-speech probability");
  require(result.model_id == "whisper.cpp/fake-model.bin",
          "adapter must expose a non-path model identifier");
  require(raw->calls == 1 && raw->last_sample_count == 3'200,
          "adapter must pass in-memory PCM exactly once");
}

void test_no_speech_mapping() {
  auto runtime = std::make_unique<FakeRuntime>();
  runtime->result.status = WhisperCppDecodeStatus::NoSpeech;
  runtime->result.no_speech_probability = 0.98;
  runtime->result.error_code = "VOICE.GATE_STT.NO_SPEECH";

  auto provider = make_provider(std::move(runtime));
  const auto result = provider.transcribe(request());
  require(result.status == GateSttStatus::NoSpeech,
          "decoder no-speech must map to Gate-STT NO_SPEECH");
  require(result.transcript.empty(),
          "no-speech result must never contain transcript text");
}

void test_unavailable_runtime_fails_closed() {
  auto runtime = std::make_unique<FakeRuntime>();
  FakeRuntime* raw = runtime.get();
  raw->ready_value = false;

  auto provider = make_provider(std::move(runtime));
  const auto result = provider.transcribe(request());
  require(result.status == GateSttStatus::Unavailable,
          "missing native runtime must be UNAVAILABLE");
  require(result.error_code ==
              "VOICE.GATE_STT.WHISPER_CPP_NOT_BUILT",
          "unavailable runtime must expose a stable operational code");
  require(raw->calls == 0,
          "unavailable runtime must not receive candidate PCM");
}

void test_invalid_audio_never_reaches_runtime() {
  auto runtime = std::make_unique<FakeRuntime>();
  FakeRuntime* raw = runtime.get();
  auto provider = make_provider(std::move(runtime));

  GateSttRequest invalid = request();
  invalid.sample_rate = 48'000;
  const auto result = provider.transcribe(invalid);
  require(result.status == GateSttStatus::Failed,
          "unsupported PCM format must fail before inference");
  require(raw->calls == 0,
          "invalid PCM must not cross the native runtime boundary");
}

void test_runtime_exception_is_contained() {
  auto runtime = std::make_unique<FakeRuntime>();
  runtime->throw_on_decode = true;
  auto provider = make_provider(std::move(runtime));

  const auto result = provider.transcribe(request());
  require(result.status == GateSttStatus::Failed,
          "native exception must become a failed Gate-STT result");
  require(result.error_code ==
              "VOICE.GATE_STT.WHISPER_CPP_EXCEPTION",
          "native exception must not leak implementation detail");
}

}  // namespace

int main() {
  try {
    test_transcript_mapping();
    test_no_speech_mapping();
    test_unavailable_runtime_fails_closed();
    test_invalid_audio_never_reaches_runtime();
    test_runtime_exception_is_contained();
    std::cout << "birdie-whisper-cpp-gate-stt-tests: PASS\n";
    return EXIT_SUCCESS;
  } catch (const std::exception& error) {
    std::cerr << "birdie-whisper-cpp-gate-stt-tests: FAIL: "
              << error.what() << '\n';
    return EXIT_FAILURE;
  }
}
