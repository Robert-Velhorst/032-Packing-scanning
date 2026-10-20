#!/usr/bin/env bash
set -euo pipefail

task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_repo"
[[ "$(uname -s)" == Darwin ]] || { echo 'Photo UI checks require a Mac with Xcode.' >&2; exit 1; }
for task_tool in xcrun xcodebuild node; do command -v "$task_tool" >/dev/null; done
task_parent="$(cd -- "${RUNNER_TEMP:-${TMPDIR:-/tmp}}" && pwd -P)"
task_scratch="$(mktemp -d "$task_parent/packing-ios-ui.XXXXXXXX")"
task_device=''
task_name="PackingPhotoQA-$(node -p 'require("node:crypto").randomUUID()')"

cleanup() {
  # Only the uniquely named simulator created by this invocation can be removed.
  if [[ "$task_device" =~ ^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$ ]]; then
    if xcrun simctl list devices --json > "$task_scratch/devices-cleanup.json" &&
       node --input-type=module - "$task_scratch/devices-cleanup.json" "$task_device" "$task_name" <<'NODE'
import {readFileSync} from 'node:fs';
const [path,id,name]=process.argv.slice(2);
const found=Object.values(JSON.parse(readFileSync(path,'utf8')).devices).flat().find(device=>device.udid===id);
process.exit(found?.name===name?0:1);
NODE
    then
      xcrun simctl shutdown "$task_device" >/dev/null 2>&1 || true
      xcrun simctl delete "$task_device" || true
    else
      echo 'Simulator ownership could not be confirmed; preserving it.' >&2
    fi
  fi
  # Keep this invocation's synthetic fixtures/log/xcresult for CI artifact upload.
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -f "${1:-}" ]] || { echo 'Supply the actual Swift item-photo result JSON.' >&2; exit 1; }
node --input-type=module - "$1" "$task_scratch/reference.jpg" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const [source,destination]=process.argv.slice(2),value=JSON.parse(readFileSync(source,'utf8'));
if(typeof value.dataUrl!=='string'||!value.dataUrl.startsWith('data:image/jpeg;base64,'))throw Error('Missing native synthetic reference JPEG');
const bytes=Buffer.from(value.dataUrl.slice('data:image/jpeg;base64,'.length),'base64');
if(bytes.length<3||bytes.length>12*1024*1024||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('Invalid native reference JPEG');
writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
NODE
xcrun simctl list runtimes --json > "$task_scratch/runtimes.json"
task_runtime="$(node --input-type=module - "$task_scratch/runtimes.json" <<'NODE'
import {readFileSync} from 'node:fs';
const available=JSON.parse(readFileSync(process.argv[2],'utf8')).runtimes.filter(runtime=>runtime.isAvailable&&runtime.name.startsWith('iOS ')&&Number(runtime.version.split('.')[0])>=18);
available.sort((a,b)=>a.version.localeCompare(b.version,'en',{numeric:true}));
if(!available.length)throw Error('An installed iOS 18+ simulator runtime is required; this script does not download SDKs.');
process.stdout.write(available.at(-1).identifier);
NODE
)"
task_device="$(xcrun simctl create "$task_name" com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro "$task_runtime")"
[[ "$task_device" =~ ^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$ ]] || { echo 'Invalid created simulator identifier.' >&2; exit 1; }
xcrun simctl boot "$task_device"
xcrun simctl bootstatus "$task_device" -b
xcrun simctl addmedia "$task_device" "$task_scratch/reference.jpg"
xcodebuild \
  -project ios/App/App.xcodeproj -scheme PackingPhotoQA -configuration Debug \
  -sdk iphonesimulator -destination "platform=iOS Simulator,id=$task_device" \
  -destination-timeout 60 -derivedDataPath "$task_repo/ios/App/DerivedData" \
  -resultBundlePath "$task_scratch/photo-ui.xcresult" \
  -testLanguage en -testRegion US -parallel-testing-enabled NO \
  -test-timeouts-enabled YES -default-test-execution-time-allowance 120 \
  -maximum-test-execution-time-allowance 180 CODE_SIGNING_ALLOWED=NO test \
  2>&1 | tee "$task_scratch/photo-ui.log"
