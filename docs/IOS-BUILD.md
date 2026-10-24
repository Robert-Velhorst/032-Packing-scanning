# iOS compilation and release boundary

The app uses Capacitor 8.5.3. Capacitor 8 requires [Xcode 26 or later and an iOS
15 deployment target](https://capacitorjs.com/docs/updating/8-0#ios).
Guided capture additionally requires the supported hardware and iOS 18 APIs
checked by `PackingScanPlugin`; the minimum app deployment version does not
mean every device supports scanning.

## Reproducible unsigned build

On a Mac with final Xcode 27.1 build 27A9275 and patched Node 24.22.1 or 26.12.1:

```sh
npm ci --ignore-scripts
DEVELOPER_DIR=/Applications/Xcode_27.1.app/Contents/Developer bash scripts/build-ios.sh
```

Use the actual installed Xcode path. The script checks the host and toolchain,
builds the real production web bundle, synchronizes it into the native project,
resolves its pinned Swift package dependency and compiles the App scheme in
Debug for the generic iOS simulator and in Release for generic iOS devices.
Both builds disable code signing. Derived data stays in the ignored
`ios/App/DerivedData` directory. The script does not install Xcode, accept
licenses, configure signing, submit an app or change system Xcode selection.
The same script is used by `.github/workflows/ios.yml`.

The workflow uses the standard `xcode-27` hosted runner label, selecting the
explicit Xcode 27.1 alias rather than the image default or a 27.2 prerelease.
[Apple's final release](https://developer.apple.com/news/releases/?id=10152026a)
is build 27A9275. GitHub's documented 27.1 installation has that same build
identity despite its Release Candidate directory name. The runtime preflight
requires the exact final version/build and both iOS SDKs at 27.1. It records
the actual Swift compiler; package tools-version 5.9 is a compatibility floor,
not an installed compiler version.

The runner image itself is a public preview; that describes the hosted image,
not Apple's selected compiler release. Its [documented label](https://github.com/actions/runner-images/issues/14404)
is used without selecting a larger paid runner. The job retains its existing
native checks, 30-minute limit, read-only permissions and diagnostic artifacts.
Only a successful exact-head native build qualifies this change. No operator
Xcode installation, global selection, code signing or deployment is performed.

CI keeps the account origin empty. For an intentional account-enabled native
build, set the public `PACKING_ACCOUNT_ORIGIN` as described in
[native accounts](NATIVE-ACCOUNTS.md) before synchronization. Never put a server
key, password, session or other credential in native build variables.

## Evidence and remaining work

The following checkpoint is historical and does not qualify `mobile-runtime.json`.

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
scan/packing trials remain required. iOS protected workspaces and the corresponding
encrypted capture storage need
their own implementation and acceptance before claiming parity with Android.
The [native voice adapter](IOS-VOICE.md) implements local recognition and spoken
steps; microphone, offline-provider and audio acceptance remain required.
The [native printing bridge](IOS-PRINTING.md) is implemented separately; system
dialog, pagination and printer/device acceptance remain required.
The [capture-file boundary](IOS-CAPTURE-FILES.md) adds scoped deletion,
backup/file-protection policy and interrupted-capture cleanup. It does not
complete protected-workspace or occupied-shape extraction parity.
See the [full release checkpoint](RELEASE-READINESS-20261020.md) and the README's
product acceptance criteria.
