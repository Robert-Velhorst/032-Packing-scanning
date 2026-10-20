# iOS compilation and release boundary

The app uses Capacitor 8.5.3. Capacitor 8 requires [Xcode 26 or later and an iOS
15 deployment target](https://capacitorjs.com/docs/updating/8-0#ios). This app
requires **iOS/iPadOS 15.4 or later** because its real editing, backup and identity
paths use `structuredClone`, `Object.hasOwn` and `Array.at`.
[WebKit 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
introduced these APIs. The App/project deployment settings and explicit Safari/
iOS Vite targets match 15.4; lowering the native minimum alone would allow
installation with missing runtime APIs. Vite's syntax transformations do not
polyfill these APIs. Successful current-SDK builds still do not prove behavior
on the oldest supported OS; that runtime/device acceptance remains required.
Guided capture additionally requires the supported hardware and iOS 18 APIs
checked by `PackingScanPlugin`; the minimum app deployment version does not
mean every device supports scanning.

## Reproducible unsigned build

On a Mac with the required Xcode and Node 24.22+ or 26+:

```sh
npm ci --ignore-scripts
DEVELOPER_DIR=/Applications/Xcode_26.3.app/Contents/Developer bash scripts/build-ios.sh
```

Use the actual installed Xcode path. The script checks the host and toolchain,
builds the real production web bundle, synchronizes it into the native project,
resolves its pinned Swift package dependency and compiles the App scheme in
Debug for the generic iOS simulator and in Release for generic iOS devices.
Both builds disable code signing. Derived data stays in the ignored
`ios/App/DerivedData` directory. The script does not install Xcode, accept
licenses, configure signing, submit an app or change system Xcode selection.
The same script is used by `.github/workflows/ios.yml`.

The workflow explicitly selects Xcode 26.3 because the [standard macOS 15
runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md)
lists Xcode 16.4 as its default, which is too old for Capacitor 8. Its job is
limited to 30 minutes, uses read-only repository permissions and cancels an
obsolete run of the same workflow/ref. Only build diagnostics are retained for
seven days. A green run must include native `xcodebuild` success; the separate
CodeQL scan and JavaScript project-parser check do not establish that result.

CI keeps the account origin empty. For an intentional account-enabled native
build, set the public `PACKING_ACCOUNT_ORIGIN` as described in
[native accounts](NATIVE-ACCOUNTS.md) before synchronization. Never put a server
key, password, session or other credential in native build variables.

## Evidence and remaining work

Native foreground guards share an owning-window check. They use the window's
active scene when available and the application's active state for a scene-less
window. Missing/hidden windows and inactive/background states are refused; data
protection and original lease checks remain separate. Native workspace-selection
changes also cancel voice/print activity, independently of a delayed WebView
callback. These lifecycle paths still need simulator/device acceptance.

On 2026-10-20 the [native build run for source c208c03](https://github.com/Robert-Velhorst/032-Packing-scanning/actions/runs/39399554967)
completed successfully with Xcode 26.3 and Node 26.12.0: Debug simulator and
unsigned Release device builds both succeeded after bundling and synchronization.
The earlier run for 4bf7974 also completed both native build steps, but its job
was canceled during post-build cleanup when a newer push superseded it; that
earlier job is not recorded as a green workflow.

For later source changes, inspect the matching Actions run and its build log.
Successful unsigned simulator/device builds still do not establish
runtime behavior, native feature parity, release signing or App Store acceptance.

Physical iPhone/iPad camera and reconstruction, permissions, file providers,
Keychain persistence, offline behavior, lifecycle interruption and measured
scan/packing trials remain required. Protected-workspace authority, encrypted
capture persistence, depth capture, reconstruction, retention and backup-provider
implementations are described in their own source-specific documents. Native
reference-photo handoff and device acceptance remain required before claiming
feature parity with Android.
The [native voice adapter](IOS-VOICE.md) implements local recognition and spoken
steps; microphone, offline-provider and audio acceptance remain required.
The [native printing bridge](IOS-PRINTING.md) is implemented separately; system
dialog, pagination and printer/device acceptance remain required.
The [capture-file boundary](IOS-CAPTURE-FILES.md) adds scoped deletion,
backup/file-protection policy and interrupted-capture cleanup. It does not
establish full feature parity or physical occupied-shape accuracy.
See the [full release checkpoint](RELEASE-READINESS-20261020.md) and the README's
product acceptance criteria.
