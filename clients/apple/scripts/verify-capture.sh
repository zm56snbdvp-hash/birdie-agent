#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
apple_dir="$(cd "$script_dir/.." && pwd)"
repo_dir="$(cd "$apple_dir/../.." && pwd)"
derived_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/birdie-capture.XXXXXX")"
trap 'rm -rf "$derived_root"' EXIT

cd "$repo_dir"
node --test test/apple-capture-contract.test.mjs

cd "$apple_dir"
xcodegen generate
test -z "$(git status --porcelain --untracked-files=all -- Config)"

destination_id="$(xcodebuild \
  -project Birdie.xcodeproj \
  -scheme BirdieCaptureTests \
  -showdestinations \
  | awk -F 'id:' '/platform:iOS Simulator/ && /name:iPhone/ { split($2, part, ","); gsub(/[[:space:]]/, "", part[1]); print part[1]; exit }')"
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
xcrun simctl install "$destination_id" "$birdie_app"
xcrun simctl launch "$destination_id" de.birdieandbreakfast.birdie
sleep 3
xcrun simctl terminate "$destination_id" de.birdieandbreakfast.birdie

xcodegen generate --spec project.personal.yml
test -z "$(git status --porcelain --untracked-files=all -- Config)"
xcodebuild -list -project BirdiePersonal.xcodeproj >/dev/null
