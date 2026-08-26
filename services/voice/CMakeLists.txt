cmake_minimum_required(VERSION 3.24)
project(birdie_voice VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(birdie_voice STATIC
  src/addressability.cpp
  src/addressability_voice_host.cpp
  src/voice_host.cpp
)

target_include_directories(birdie_voice PUBLIC include)
target_compile_features(birdie_voice PUBLIC cxx_std_20)

if(WIN32)
  target_sources(birdie_voice PRIVATE src/windows/core_ipc_sink.cpp)
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

add_executable(birdie-voice-tests tests/voice_host_tests.cpp)
target_link_libraries(birdie-voice-tests PRIVATE birdie_voice)
add_test(NAME birdie-voice-tests COMMAND birdie-voice-tests)

if(WIN32)
  add_executable(birdie-voice-ipc-tests tests/core_ipc_sink_tests.cpp)
  target_link_libraries(birdie-voice-ipc-tests PRIVATE birdie_voice)
  add_test(NAME birdie-voice-ipc-tests COMMAND birdie-voice-ipc-tests)
endif()
