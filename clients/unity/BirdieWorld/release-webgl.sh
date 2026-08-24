#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
UNITY_VERSION="6000.0.76f1"
UNITY_BIN="/Applications/Unity/Hub/Editor/${UNITY_VERSION}/Unity.app/Contents/MacOS/Unity"
BUILD_DIR="$PROJECT_DIR/Builds/WebGL"
MODE="${1:---build-only}"

case "$MODE" in
  --build-only) ;;
  --production)
    echo "Local production release is blocked. Release only a reviewed CI artifact through the protected workflow." >&2
    exit 9
    ;;
  *)
    echo "Usage: ./release-webgl.sh [--build-only|--production]" >&2
    exit 1
    ;;
esac

if [[ ! -x "$UNITY_BIN" ]]; then
  echo "Unity ${UNITY_VERSION} not found at: $UNITY_BIN" >&2
  echo "Install Unity ${UNITY_VERSION} with Web Build Support in Unity Hub first." >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required to record the exact build source." >&2
  exit 2
fi

REPOSITORY_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel)"
SOURCE_SHA="$(git -C "$REPOSITORY_ROOT" rev-parse --verify HEAD)"
SOURCE_DIRTY=false
if [[ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain)" ]]; then
  SOURCE_DIRTY=true
fi

rm -rf "$BUILD_DIR"

"$UNITY_BIN" \
  -batchmode \
  -quit \
  -projectPath "$PROJECT_DIR" \
  -executeMethod BirdieWorld.Editor.BirdieWorldWebBuild.BuildWebGL \
  -logFile -

if [[ ! -f "$BUILD_DIR/index.html" ]]; then
  echo "Build finished without Builds/WebGL/index.html" >&2
  exit 3
fi

BUILD_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
printf '{\n  "sourceSha": "%s",\n  "sourceDirty": %s,\n  "unityVersion": "%s",\n  "builtAt": "%s"\n}\n' \
  "$SOURCE_SHA" "$SOURCE_DIRTY" "$UNITY_VERSION" "$BUILD_AT" > "$BUILD_DIR/birdieworld-build.json"

cat > "$BUILD_DIR/vercel.json" <<'JSON'
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
      ]
    }
  ]
}
JSON

cd "$BUILD_DIR"
if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  echo "A SHA-256 tool (sha256sum or shasum) is required." >&2
  exit 4
fi

while IFS= read -r file; do
  printf '%s  %s\n' "$(hash_file "$file")" "$file"
done < <(find . -type f ! -path './birdieworld-files.sha256' -print | LC_ALL=C sort) \
  > birdieworld-files.sha256
MANIFEST_SHA256="$(hash_file birdieworld-files.sha256)"

echo "BirdieWorld WebGL build ready: $BUILD_DIR"
echo "Review manifest SHA-256: $MANIFEST_SHA256"
