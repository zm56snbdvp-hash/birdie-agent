#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
apple_dir="$(cd "$script_dir/.." && pwd)"
repo_dir="$(cd "$apple_dir/../.." && pwd)"
derived_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/birdie-capture.XXXXXX")"
trap 'rm -rf "$derived_root"' EXIT

verify_config_clean() {
  git diff --exit-code -- Config
  local untracked
  untracked="$(git ls-files --others --exclude-standard -- Config)"
  if [[ -n "$untracked" ]]; then
    printf 'Unexpected untracked Config files:\n%s\n' "$untracked" >&2
    return 1
  fi
}

cd "$repo_dir"
node --test test/apple-capture-contract.test.mjs

cd "$apple_dir"
xcodegen generate
verify_config_clean

destination_id="$(xcrun simctl list --json devices available | python3 -c '
import json
import re
import sys

devices = json.load(sys.stdin).get("devices", {})
candidates = []
for runtime, entries in devices.items():
    match = re.search(r"\.iOS-(\d+)-(\d+)$", runtime)
    if not match:
        continue
    version = (int(match.group(1)), int(match.group(2)))
    if version < (18, 0):
        continue
    for entry in entries:
        if entry.get("isAvailable", True) and entry.get("name", "").startswith("iPhone"):
            candidates.append((version, entry["udid"]))
if not candidates:
    raise SystemExit("No available iOS 18+ iPhone simulator")
print(max(candidates)[1])
')"
test -n "$destination_id"

xcodebuild \
  -project Birdie.xcodeproj \
  -scheme Birdie \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$derived_root/standard" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

xcodebuild \
  -project Birdie.xcodeproj \
  -scheme BirdieCaptureTests \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$destination_id" \
  -derivedDataPath "$derived_root/tests" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  test

birdie_app="$derived_root/standard/Build/Products/Debug-iphonesimulator/Birdie.app"
test -d "$birdie_app/PlugIns/BirdieDrop.appex"
test -d "$birdie_app/Frameworks/CaptureCore.framework"
test ! -d "$birdie_app/PlugIns/BirdieDrop.appex/Frameworks"

xcrun simctl boot "$destination_id" 2>/dev/null || true
xcrun simctl bootstatus "$destination_id" -b
smoke_app="$derived_root/smoke/Birdie.app"
test "$smoke_app" = "$derived_root/smoke/Birdie.app"
mkdir -p "$(dirname "$smoke_app")"
ditto "$birdie_app" "$smoke_app"
# The existing Watch widget on main is not simulator-installable. Keep the verified
# build untouched and remove Watch only from this disposable iPhone launch copy.
if [[ -d "$smoke_app/Watch" ]]; then
  rm -r "$smoke_app/Watch"
fi
xcrun simctl install "$destination_id" "$smoke_app"
xcrun simctl launch "$destination_id" de.birdieandbreakfast.birdie
sleep 3
xcrun simctl terminate "$destination_id" de.birdieandbreakfast.birdie

xcodegen generate --spec project.personal.yml
verify_config_clean
xcodebuild -list -project BirdiePersonal.xcodeproj >/dev/null
