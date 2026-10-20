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
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(!((major===24&&minor>=22)||major>=26)){console.error("Use Node 24.22+ or 26+ for the project toolchain.");process.exit(1)}'
task_java_major="$(java -XshowSettings:properties -version 2>&1 | awk -F '= ' '/java.specification.version =/ {version=$2} END {print version}')"
if [[ "$task_java_major" != 21 ]]; then
  echo 'Select an installed Java 21 JDK before building Android.' >&2
  exit 1
fi
task_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$task_sdk" || ! -f "$task_sdk/platforms/android-36/android.jar" ]]; then
  echo 'Set ANDROID_HOME to an installed Android SDK containing platform 36.' >&2
  exit 1
fi
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
  :app:assembleRelease \
  :app:lintDebug \
  :app:lintRelease
