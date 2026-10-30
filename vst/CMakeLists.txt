cmake_minimum_required(VERSION 3.22)
project(Hybrid8VST VERSION 0.1.0 LANGUAGES C CXX)

# Optional, local-only VST3 build of Hybrid.8. Not part of `npm run build` or CI: run `npm run vst:build`.
#
# The plugin is the webvst host (https://github.com/lwojas/webvst: a JUCE WebView that fakes Web Audio for the page and
# runs webdsp's native engine on the DAW's audio thread) with Hybrid.8 as its client. webvst is a sibling checkout, like
# webdsp, and none of its sources are copied here: this file only declares one more plugin from them, the way webvst's own
# CMakeLists does for WebSeq and WebTracker. See docs/dev/vst.md.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(HYBRID8_WEBVST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../webvst" CACHE PATH "Path to a webvst checkout")
# The engine the page is built against (package.json: "webdsp": "file:../webdsp"), so page and plugin agree.
set(HYBRID8_WEBDSP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../webdsp" CACHE PATH "Path to a webdsp checkout")
cmake_path(NORMAL_PATH HYBRID8_WEBVST_DIR)
cmake_path(NORMAL_PATH HYBRID8_WEBDSP_DIR)

if(NOT EXISTS "${HYBRID8_WEBVST_DIR}/src/PluginEditor.cpp")
  message(FATAL_ERROR "webvst not found at ${HYBRID8_WEBVST_DIR}. Clone it beside Hybrid8 (git clone https://github.com/lwojas/webvst ../webvst) or pass -DHYBRID8_WEBVST_DIR=<path>")
endif()
if(NOT EXISTS "${HYBRID8_WEBDSP_DIR}/native/src/engine.h")
  message(FATAL_ERROR "webdsp not found at ${HYBRID8_WEBDSP_DIR}. Clone it beside Hybrid8 (git clone https://github.com/lwojas/webdsp ../webdsp) or pass -DHYBRID8_WEBDSP_DIR=<path>")
endif()

# JUCE: the same version webvst pins. A webvst build that already fetched it is reused (no download, works offline).
include(FetchContent)
if(NOT DEFINED FETCHCONTENT_SOURCE_DIR_JUCE AND EXISTS "${HYBRID8_WEBVST_DIR}/build/_deps/juce-src/CMakeLists.txt")
  set(FETCHCONTENT_SOURCE_DIR_JUCE "${HYBRID8_WEBVST_DIR}/build/_deps/juce-src")
  message(STATUS "Reusing JUCE from ${FETCHCONTENT_SOURCE_DIR_JUCE}")
endif()
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 9.0.4
  GIT_SHALLOW ON)
FetchContent_MakeAvailable(JUCE)

# The page shim is a real .js file, embedded as BinaryData::shim_js.
juce_add_binary_data(WebVstData SOURCES "${HYBRID8_WEBVST_DIR}/src/shim.js")

# The page this plugin opens. Default: the hosted app (GitHub Pages, deployed from main), like webvst's own plugins. For development point
# it at a dev server (`npm run dev` / `npm run vst:serve`, port 5175) with WEBVST_URL_HYBRID8 (or WEBVST_URL) in the DAW's environment, or
# rebuild with -DHYBRID8_DEFAULT_URL=http://localhost:5175/ . (A cached value in an existing build directory wins over this default.)
set(HYBRID8_DEFAULT_URL "https://lwojas.github.io/Omni8/" CACHE STRING "URL the plugin editor loads by default")

juce_add_plugin(Hybrid8
  PRODUCT_NAME "Hybrid8"
  COMPANY_NAME "lwojas"
  PLUGIN_MANUFACTURER_CODE Lwjs
  PLUGIN_CODE Hyb8
  FORMATS VST3
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  NEEDS_WEB_BROWSER TRUE
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(Hybrid8 PRIVATE
  "${HYBRID8_WEBVST_DIR}/src/EngineHost.cpp"
  "${HYBRID8_WEBVST_DIR}/src/SessionState.cpp"
  "${HYBRID8_WEBVST_DIR}/src/HostFiles.cpp"
  "${HYBRID8_WEBVST_DIR}/src/PluginProcessor.cpp"
  "${HYBRID8_WEBVST_DIR}/src/PluginEditor.cpp")

target_include_directories(Hybrid8 PRIVATE "${HYBRID8_WEBVST_DIR}/src")
target_include_directories(Hybrid8 SYSTEM PRIVATE "${HYBRID8_WEBDSP_DIR}/native/src")

# WEBVST_APP_ID stamps the saved state: this plugin refuses another app's state (and the other way round).
target_compile_definitions(Hybrid8 PUBLIC
  WEBVST_APP_ID="hybrid8"
  WEBVST_DEFAULT_URL="${HYBRID8_DEFAULT_URL}"
  JUCE_WEB_BROWSER=1
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(Hybrid8 PRIVATE
  WebVstData
  juce::juce_audio_utils
  juce::juce_gui_extra
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

# macOS: a CLEAN build leaves the bundle with a broken code signature (JUCE signs it, then writes
# Contents/Resources/moduleinfo.json), which Ableton Live's scanner refuses silently. Re-sign the finished bundle as the
# very last step, ad hoc (enough to load on this machine). Same fix as webvst's CMakeLists.txt.
if(APPLE)
  add_custom_command(TARGET Hybrid8_VST3 POST_BUILD
    COMMAND codesign --force --sign - --timestamp=none "$<GENEX_EVAL:$<TARGET_PROPERTY:Hybrid8_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
    COMMAND codesign --verify --strict "$<GENEX_EVAL:$<TARGET_PROPERTY:Hybrid8_VST3,JUCE_PLUGIN_ARTEFACT_FILE>>"
    COMMENT "Signing Hybrid8.vst3 (after moduleinfo.json was added)"
    VERBATIM)
endif()

# Headless end-to-end test (opt-in): the real EngineHost behind a stdin/stdout harness, driven by vst/test/e2e.test.ts, which runs the
# page's own code (Groovebox, controller, MIDI) through webvst's shim. `npm run vst:e2e`.
option(HYBRID8_BUILD_E2E "Build the headless end-to-end harness" OFF)
if(HYBRID8_BUILD_E2E)
  juce_add_console_app(Hybrid8Harness PRODUCT_NAME "Hybrid8Harness")
  target_sources(Hybrid8Harness PRIVATE
    test/harness.cpp
    "${HYBRID8_WEBVST_DIR}/src/EngineHost.cpp"
    "${HYBRID8_WEBVST_DIR}/src/SessionState.cpp"
    "${HYBRID8_WEBVST_DIR}/src/HostFiles.cpp")
  target_include_directories(Hybrid8Harness PRIVATE "${HYBRID8_WEBVST_DIR}/src")
  target_include_directories(Hybrid8Harness SYSTEM PRIVATE "${HYBRID8_WEBDSP_DIR}/native/src")
  target_link_libraries(Hybrid8Harness PRIVATE
    juce::juce_core juce::juce_events juce::juce_audio_basics
    PUBLIC juce::juce_recommended_config_flags)
endif()
