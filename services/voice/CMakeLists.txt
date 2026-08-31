cmake_minimum_required(VERSION 3.24)
project(birdie_voice VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(
  BIRDIE_WITH_WHISPER_CPP
  "Build the optional in-process whisper.cpp Gate-STT backend"
  OFF
)
set(
  BIRDIE_WHISPER_CPP_SOURCE_DIR
  ""
  CACHE PATH
  "Path to a local, reviewed whisper.cpp source checkout"
)

add_library(birdie_voice STATIC
  src/addressability.cpp
  src/addressability_pipeline.cpp
  src/addressability_voice_host.cpp
  src/addressability_worker.cpp
  src/conversation_stt_worker.cpp
  src/gate_stt.cpp
  src/gate_stt_provider.cpp
  src/tts_output.cpp
  src/voice_host.cpp
  src/whisper_cpp_gate_stt.cpp
  src/whisper_cpp_runtime.cpp
)

target_include_directories(birdie_voice PUBLIC include)
target_compile_features(birdie_voice PUBLIC cxx_std_20)

if(BIRDIE_WITH_WHISPER_CPP)
  if(
    NOT BIRDIE_WHISPER_CPP_SOURCE_DIR OR
    NOT EXISTS "${BIRDIE_WHISPER_CPP_SOURCE_DIR}/CMakeLists.txt" OR
    NOT EXISTS "${BIRDIE_WHISPER_CPP_SOURCE_DIR}/include/whisper.h"
  )
    message(FATAL_ERROR
      "BIRDIE_WITH_WHISPER_CPP=ON requires "
      "-DBIRDIE_WHISPER_CPP_SOURCE_DIR=<local whisper.cpp checkout>"
    )
  endif()

  # Birdie links the library directly so candidate PCM never needs a temporary
  # WAV file or localhost HTTP hop. Third-party examples, tests, server and
  # network-enabled helpers remain outside the Birdie build.
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build static third-party libraries" FORCE)
  set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
  set(WHISPER_CURL OFF CACHE BOOL "" FORCE)

  add_subdirectory(
    "${BIRDIE_WHISPER_CPP_SOURCE_DIR}"
    "${CMAKE_BINARY_DIR}/third_party/whisper.cpp"
    EXCLUDE_FROM_ALL
  )
  if(NOT TARGET whisper)
    message(FATAL_ERROR "Configured whisper.cpp checkout did not define target 'whisper'")
  endif()

  target_link_libraries(birdie_voice PRIVATE whisper)
  target_compile_definitions(birdie_voice PRIVATE BIRDIE_WITH_WHISPER_CPP=1)
endif()

if(WIN32)
  target_sources(
    birdie_voice
    PRIVATE
      src/windows/core_ipc_sink.cpp
      src/windows/sapi_tts.cpp
  )
  target_link_libraries(birdie_voice PRIVATE ole32 sapi)
endif()

if(MSVC)
  target_compile_options(birdie_voice PRIVATE /W4 /permissive-)
else()
  target_compile_options(birdie_voice PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(birdie-voice-host src/main.cpp)
target_link_libraries(birdie-voice-host PRIVATE birdie_voice)

if(WIN32)
  target_sources(birdie-voice-host PRIVATE src/windows/wasapi_capture.cpp)
  target_link_libraries(birdie-voice-host PRIVATE ole32 uuid)

  add_executable(birdie-voice-core-smoke tests/core_ipc_smoke.cpp)
  target_link_libraries(birdie-voice-core-smoke PRIVATE birdie_voice)
endif()

enable_testing()

add_executable(birdie-addressability-tests tests/addressability_tests.cpp)
target_link_libraries(birdie-addressability-tests PRIVATE birdie_voice)
add_test(NAME birdie-addressability-tests COMMAND birdie-addressability-tests)

add_executable(
  birdie-addressability-pipeline-tests
  tests/addressability_pipeline_tests.cpp
)
target_link_libraries(
  birdie-addressability-pipeline-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-addressability-pipeline-tests
  COMMAND birdie-addressability-pipeline-tests
)

add_executable(
  birdie-addressability-voice-host-tests
  tests/addressability_voice_host_tests.cpp
)
target_link_libraries(
  birdie-addressability-voice-host-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-addressability-voice-host-tests
  COMMAND birdie-addressability-voice-host-tests
)

add_executable(
  birdie-addressability-worker-tests
  tests/addressability_worker_tests.cpp
)
target_link_libraries(
  birdie-addressability-worker-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-addressability-worker-tests
  COMMAND birdie-addressability-worker-tests
)

add_executable(
  birdie-conversation-stt-worker-tests
  tests/conversation_stt_worker_tests.cpp
)
target_link_libraries(
  birdie-conversation-stt-worker-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-conversation-stt-worker-tests
  COMMAND birdie-conversation-stt-worker-tests
)

add_executable(
  birdie-conversation-stt-cancellation-tests
  tests/conversation_stt_cancellation_tests.cpp
)
target_link_libraries(
  birdie-conversation-stt-cancellation-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-conversation-stt-cancellation-tests
  COMMAND birdie-conversation-stt-cancellation-tests
)

add_executable(
  birdie-tts-output-tests
  tests/tts_output_tests.cpp
)
target_link_libraries(
  birdie-tts-output-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-tts-output-tests
  COMMAND birdie-tts-output-tests
)

add_executable(
  birdie-whisper-cpp-gate-stt-tests
  tests/whisper_cpp_gate_stt_tests.cpp
)
target_link_libraries(
  birdie-whisper-cpp-gate-stt-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-whisper-cpp-gate-stt-tests
  COMMAND birdie-whisper-cpp-gate-stt-tests
)

add_executable(
  birdie-gate-stt-provider-tests
  tests/gate_stt_provider_tests.cpp
)
target_link_libraries(
  birdie-gate-stt-provider-tests
  PRIVATE birdie_voice
)
add_test(
  NAME birdie-gate-stt-provider-tests
  COMMAND birdie-gate-stt-provider-tests
)

add_executable(birdie-voice-tests tests/voice_host_tests.cpp)
target_link_libraries(birdie-voice-tests PRIVATE birdie_voice)
add_test(NAME birdie-voice-tests COMMAND birdie-voice-tests)

if(WIN32)
  add_executable(birdie-voice-ipc-tests tests/core_ipc_sink_tests.cpp)
  target_link_libraries(birdie-voice-ipc-tests PRIVATE birdie_voice)
  add_test(NAME birdie-voice-ipc-tests COMMAND birdie-voice-ipc-tests)
endif()
