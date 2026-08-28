#!/usr/bin/env bash
set -euo pipefail

minimum_major="${MINIMUM_XCODE_MAJOR:-26}"

assert_major_at_least() {
  local label="$1"
  local version="$2"
  local major="${version%%.*}"

  [[ "$minimum_major" =~ ^[0-9]+$ ]]
  [[ "$major" =~ ^[0-9]+$ ]]
  if (( major < minimum_major )); then
    echo "$label $version is below required major version $minimum_major." >&2
    exit 1
  fi
}

xcode_version="$(xcodebuild -version | awk 'NR == 1 { print $2 }')"
assert_major_at_least "Xcode" "$xcode_version"

sdk_summary=""
for sdk in iphoneos iphonesimulator watchos watchsimulator; do
  sdk_version="$(xcrun --sdk "$sdk" --show-sdk-version)"
  assert_major_at_least "$sdk SDK" "$sdk_version"
  sdk_summary="${sdk_summary}${sdk}=${sdk_version} "
done

echo "Apple toolchain ready: Xcode $xcode_version; ${sdk_summary% }"
