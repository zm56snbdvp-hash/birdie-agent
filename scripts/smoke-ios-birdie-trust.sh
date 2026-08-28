#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This smoke test requires macOS with Xcode and XcodeGen." >&2
  exit 2
fi

for tool in node python3 xcodegen xcodebuild xcrun; do
  command -v "$tool" >/dev/null || {
    echo "Required tool is missing: $tool" >&2
    exit 2
  }
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APPLE_ROOT="$REPOSITORY_ROOT/clients/apple"
XCODEGEN_SPEC="${BIRDIE_XCODEGEN_SPEC:-project.yml}"
XCODE_PROJECT="${BIRDIE_XCODE_PROJECT:-Birdie.xcodeproj}"
XCODE_SCHEME="${BIRDIE_XCODE_SCHEME:-Birdie}"
DERIVED_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/birdie-trust-derived-data.XXXXXX")"
trap 'rm -rf "$DERIVED_DATA_DIR"' EXIT

echo "Toolchain versions:"
node --version
xcodegen --version
xcodebuild -version

node --test "$REPOSITORY_ROOT/test/birdie-trust-contract.test.mjs"

(
  cd "$APPLE_ROOT"
  xcodegen generate --spec "$XCODEGEN_SPEC"
  xcodebuild \
    -project "$XCODE_PROJECT" \
    -scheme "$XCODE_SCHEME" \
    -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    build
  xcodebuild \
    -project "$XCODE_PROJECT" \
    -scheme "$XCODE_SCHEME" \
    -configuration Release \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    build
)

RELEASE_EXECUTABLE="$DERIVED_DATA_DIR/Build/Products/Release-iphonesimulator/Birdie.app/Birdie"
if [[ ! -x "$RELEASE_EXECUTABLE" ]]; then
  echo "Release executable was not produced: $RELEASE_EXECUTABLE" >&2
  exit 1
fi
if strings "$RELEASE_EXECUTABLE" | grep -E 'local_mock_only|debug-local-app-attest-key|MockApprovalClient|MockLiveMissionService|MockDeviceBindingClient'; then
  echo "Release binary contains a Birdie Trust DEBUG mock marker." >&2
  exit 1
fi

SIMULATOR_ID="$(
  xcrun simctl list devices available --json | python3 -c '
import json, sys
payload = json.load(sys.stdin)
candidates = []
for runtime, devices in sorted(payload.get("devices", {}).items()):
    if "iOS" not in runtime:
        continue
    for device in devices:
        if device.get("isAvailable") and str(device.get("name", "")).startswith("iPhone"):
            candidates.append(device["udid"])
if not candidates:
    raise SystemExit("No available iPhone simulator")
print(candidates[-1])
'
)"

(
  cd "$APPLE_ROOT"
  xcodebuild \
    -project "$XCODE_PROJECT" \
    -scheme "$XCODE_SCHEME" \
    -configuration Debug \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    -only-testing:BirdiePhoneTests \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    test
)

echo "Birdie Trust smoke test passed: contract, XcodeGen, unsigned Debug/Release builds, and unit tests."
