# Current Android build checks

Historical APK and unit-test checkpoints in [Android build evidence](QA-ANDROID-BUILD.md)
describe their recorded source/dependency versions. They do not establish that
the current Gradle, ARCore, LiteRT and Capacitor dependencies compile or pass.
The Android workflow provides an explicit current-source build check.

The previous current-source run showed that AGP 8.13.0 cannot run on Gradle 9.8.1
because the plugin uses an internal Problems API removed in Gradle 9.6. This
draft upgrades the plugin to AGP 9.4.1 and the wrapper to Gradle 9.8.2, which
satisfies the current AGP 9.4 minimum Gradle version. The wrapper verifies its
distribution against the [official checksum](https://services.gradle.org/distributions/gradle-9.8.2-bin.zip.sha256).
The repository's latest stable Capacitor release is still 8.5.3; upstream has
not confirmed that Capacitor 8 is tested with AGP 9.4.1. Treat the Android CI
build as a required compatibility check before merging. The earlier AGP 8.13.0
failure is [recorded in Actions](https://github.com/Robert-Velhorst/032-Packing-scanning/actions/runs/39399555082).

## Build command

On Linux/macOS with Node 24.22+ or 26+, Java 21 and Android SDK platform 36:

```sh
npm ci --ignore-scripts
export JAVA_HOME=/path/to/installed/java21
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME=/path/to/installed/android-sdk
bash scripts/build-android.sh
```

On Windows use the existing `scripts/build-android.ps1`, supplying its Java and
SDK paths and the desired app-specific tasks. Neither helper installs the SDK
or accepts licenses. The Gradle wrapper verifies its downloaded distribution
with the checked-in SHA-256. The app uses [SDK 36 as required for Capacitor
8](https://capacitorjs.com/docs/updating/8-0#android).

The shell helper builds the production web assets, synchronizes Android assets,
then runs app-specific native unit tests, debug assembly, unsigned release
assembly, instrumentation-test assembly, debug lint and release lint. Gradle uses at most two workers and no
persistent daemon. SDK tools/dependencies required by Gradle must already be
available under the operator's accepted SDK installation.

`.github/workflows/android.yml` uses the [standard Ubuntu 24.04 runner's
preinstalled Java 21 and SDK 36](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
It has read-only repository permissions, a 30-minute deadline, and cancels an
obsolete run of the same workflow/ref. Build logs, unit-test XML and lint
reports are retained for seven days. Signing keys and service credentials are
not configured; the account service origin is empty.

## Acceptance boundary

Adding the workflow is not a successful build result. Inspect the exact-head
Actions run and its native test/lint/build output. Debug signing and unsigned
release assembly are not production signing or Play Store acceptance.

The workflow does not run a phone/emulator, camera, depth sensor, microphone,
Android cryptographic provider, document provider or physical packing trial.
Device acceptance, release signing and the outstanding product requirements
remain separate gates. See [iOS compilation](IOS-BUILD.md) for the other native
platform and [release readiness](RELEASE-READINESS-20261020.md) for verified
hosting and backup evidence.

Reference photo metadata parsing now uses the maintained [AndroidX ExifInterface
1.4.2](https://developer.android.com/jetpack/androidx/releases/exifinterface),
following lint's warning about the older platform parser. The decoder still
samples before pixel allocation and re-encodes the oriented image to a bounded
JPEG without copying EXIF/GPS metadata. The existing device tests for bounded
PNG conversion, orientation and metadata exclusion are compiled by the workflow;
their execution still requires Android device/emulator acceptance.
