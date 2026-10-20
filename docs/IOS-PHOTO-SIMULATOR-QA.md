# iOS photo and backup simulator acceptance

`PackingPhotoQA` is a separate Xcode UI-test scheme. It drives the actual bundled
WebView, registered native plugins, system picker and device storage through the
ordinary app UI. No test-only JavaScript endpoint, storage shortcut or production
launch hook is added.

The four cases cover:

- Cancel library selection, resume the unchanged incomplete draft, then cancel
  the editor without creating an item.
- Select the synthetic native-generated JPEG, resume its draft, save an item,
  terminate/relaunch the app, reopen the saved item and check that its rendered
  reference image is predominantly the expected red fixture. The screenshot is
  retained in the test result; merely finding an image element is insufficient.
- Deny camera permission when prompted, or cancel an available camera screen,
  then recover the unsaved draft without a photo. This does not test a physical
  camera or shutter result.
- Cancel the native backup destination picker and observe cancellation rather
  than a saved-file confirmation.

The cases use guest storage. Protected-account UI, physical-camera focus/framing,
cloud providers, older supported OS versions, actual-device lifecycle/latency,
accessibility, signing and distribution remain separate acceptance gates. Native
core tests independently check scope isolation, encryption, expiry, image limits
and metadata removal. Neither layer substitutes for physical scan/packing trials.

On a Mac, first run `bash scripts/build-ios.sh` and the native core checks that
produce `item-photo-result.json`, then run:

```sh
bash scripts/test-ios-photo-ui.sh /absolute/path/to/item-photo-result.json
```

The script requires an already installed iOS 18+ simulator runtime and the iPhone
16 Pro device type. It does not download SDKs, alter signing or use a physical
phone. It creates a fresh simulator with a unique name, imports only the synthetic
JPEG, runs the tests sequentially with bounded test durations, and verifies the
created simulator's ID and name before shutting it down/deleting it. Existing
simulators and their data are preserved. Its own synthetic fixtures, log and
`photo-ui.xcresult` remain under a unique temporary directory for diagnostics.
CI retains the result/log for seven days.

Project parsing, XML parsing and shell syntax can be checked on Windows. They do
not execute these tests. Only a completed matching Mac run with passing XCTest
cases establishes simulator acceptance; an unsigned app build alone does not.
