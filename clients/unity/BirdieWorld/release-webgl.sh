#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
UNITY_VERSION="6000.0.76f1"
UNITY_BIN="/Applications/Unity/Hub/Editor/${UNITY_VERSION}/Unity.app/Contents/MacOS/Unity"
BUILD_DIR="$PROJECT_DIR/Builds/WebGL"

if [[ ! -x "$UNITY_BIN" ]]; then
  echo "Unity ${UNITY_VERSION} not found at: $UNITY_BIN" >&2
  echo "Install Unity ${UNITY_VERSION} with Web Build Support in Unity Hub first." >&2
  exit 2
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

if ! command -v npx >/dev/null 2>&1; then
  echo "Node.js/npx is required for Vercel deployment." >&2
  exit 4
fi

if [[ "${1:-}" == "--build-only" ]]; then
  echo "BirdieWorld WebGL build ready: $BUILD_DIR"
  exit 0
fi

echo "Deploying BirdieWorld Beta to Vercel..."
npx --yes vercel@latest --prod --yes --name birdieworld-beta
