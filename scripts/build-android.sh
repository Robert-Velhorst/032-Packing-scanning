#!/usr/bin/env bash
set -euo pipefail

task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_repo"
case "$(uname -s)" in
  Linux|Darwin) ;;
  *) echo 'Use scripts/build-android.ps1 on Windows.' >&2; exit 1 ;;
esac
for task_tool in node npm java; do
  if ! command -v "$task_tool" >/dev/null 2>&1; then
    echo "Required tool is missing: $task_tool" >&2
    exit 1
  fi
done
node scripts/check-mobile-runtime.mjs android
if [[ ! -f node_modules/@capacitor/cli/bin/capacitor ]]; then
  echo 'Install the locked dependencies with npm ci before building Android.' >&2
  exit 1
fi

npm run build
node node_modules/@capacitor/cli/bin/capacitor sync android
cd android
bash ./gradlew --no-daemon --console=plain --max-workers=2 \
  :app:testDebugUnitTest \
  :app:assembleDebug \
  :app:assembleDebugAndroidTest \
  :app:assembleRelease \
  :app:lintDebug \
  :app:lintRelease
