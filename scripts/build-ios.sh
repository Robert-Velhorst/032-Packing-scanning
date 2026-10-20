#!/usr/bin/env bash
set -euo pipefail

task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_repo"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'iOS compilation requires a Mac with Xcode 26 or later.' >&2
  exit 1
fi
for task_tool in node npm xcodebuild xcrun; do
  if ! command -v "$task_tool" >/dev/null 2>&1; then
    echo "Required tool is missing: $task_tool" >&2
    exit 1
  fi
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(!((major===24&&minor>=22)||major>=26)){console.error("Use Node 24.22+ or 26+ for the project toolchain.");process.exit(1)}'
task_xcode_version="$(xcodebuild -version)"
printf '%s\n' "$task_xcode_version"
task_xcode_major="$(printf '%s\n' "$task_xcode_version" | awk 'NR==1 {split($2,version,"."); print version[1]}')"
if [[ ! "$task_xcode_major" =~ ^[0-9]+$ ]] || (( task_xcode_major < 26 )); then
  echo 'Capacitor 8 requires Xcode 26 or later; select it with DEVELOPER_DIR.' >&2
  exit 1
fi
if [[ ! -f node_modules/@capacitor/cli/bin/capacitor ]]; then
  echo 'Install the locked dependencies with npm ci before building iOS.' >&2
  exit 1
fi

npm run build
node node_modules/@capacitor/cli/bin/capacitor sync ios
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$task_repo/ios/App/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  build
