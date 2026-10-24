#!/usr/bin/env bash
set -euo pipefail

task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_repo"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'iOS compilation requires a Mac with final Xcode from mobile-runtime.json.' >&2
  exit 1
fi
for task_tool in node npm xcodebuild xcrun; do
  if ! command -v "$task_tool" >/dev/null 2>&1; then
    echo "Required tool is missing: $task_tool" >&2
    exit 1
  fi
done
node scripts/check-mobile-runtime.mjs ios
if [[ ! -f node_modules/@capacitor/cli/bin/capacitor ]]; then
  echo 'Install the locked dependencies with npm ci before building iOS.' >&2
  exit 1
fi

npm run build
node node_modules/@capacitor/cli/bin/capacitor sync ios
mkdir -p "$task_repo/ios/App/DerivedData"
xcrun swiftc -parse-as-library ios/App/App/PackingVoiceResult.swift scripts/test-ios-voice.swift \
  -o "$task_repo/ios/App/DerivedData/voice-result-checks"
"$task_repo/ios/App/DerivedData/voice-result-checks"
for task_sdk in iphonesimulator iphoneos; do
  if [[ "$task_sdk" == iphonesimulator ]]; then
    task_configuration=Debug
    task_destination='generic/platform=iOS Simulator'
  else
    task_configuration=Release
    task_destination='generic/platform=iOS'
  fi
  printf 'Building %s for %s\n' "$task_configuration" "$task_sdk"
  xcodebuild \
    -project ios/App/App.xcodeproj \
    -scheme App \
    -configuration "$task_configuration" \
    -sdk "$task_sdk" \
    -destination "$task_destination" \
    -derivedDataPath "$task_repo/ios/App/DerivedData" \
    CODE_SIGNING_ALLOWED=NO \
    build
done
