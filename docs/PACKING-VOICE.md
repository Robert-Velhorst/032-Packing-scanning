# Packing controls and on-device voice

Implemented on 2026-09-30. English command recognition is optional and off by default. Touch controls remain available without a microphone or speech model. Compilation and automated controller checks do not establish physical speech recognition accuracy; see [the dated QA report](QA-PACKING-CONTROLS.md).

## Follow a plan

Choose **Pack step by step**. Each step shows the item, its saved reference photo where available, the bag, approximate layer, oriented dimensions and position. Measured and estimated properties retain their evidence labels. The rectangular model still cannot establish physical fit, cushioning or bag closure.

Each step has a numbered 3D model with rotate, zoom and reset controls, plus a top-view SVG diagram. Earlier planned items and confirmed items are identified separately in the legend. A solid dot marks the coordinate reference corner. Graphics failure leaves written instructions and the top-view alternative available. Navigation saves the selected item, so reopening packing resumes that step; removed items fall back to the first unpacked placement.

**Printable sequence** provides the same ordered placements and diagrams with bag contents, packed status, exclusions and warnings. Browser printing uses the system dialog. Android uses a native PrintManager adapter with a generic job title; phone execution remains unverified. Native iOS printing is unavailable and the interface explains the limitation. Opening the sequence never prints automatically. A printed copy does not update after replanning.

| Control | Result |
| --- | --- |
| Previous / Next / Skip | Change the displayed step without confirming or removing an item |
| Mark packed | Confirm this item and lock its planned position; advance to another unpacked step where available |
| Packed · continue | Advance without undoing an existing confirmation or replacing its saved position |
| Undo packed | Remove this item's confirmation and lock so it can move again |
| Lock placement | Preserve the current position without confirming the item packed |
| Does not fit | Ask for confirmation, then reject this specific placement and try an alternative |
| Item unavailable | Ask for confirmation, then omit this instance for this pack and remove its confirmation/lock |
| Reset failed attempts | Clear this pack's rejected-position feedback; retain packed and other locked positions |

Unavailable items stay visible in the plan checklist with an individual **Restore** button. Restoring an instance preserves earlier failed-position feedback. Items without a placement, or marked unavailable, cannot be newly confirmed packed through that checklist. A saved lock that no longer fits changed bag dimensions remains an explicit review issue; the planner does not silently move that item.

Failed-position feedback is stored locally and included in JSON backups. It excludes the same bag and bounding coordinates even if a rotation alias differs. The planner tries alternative bottom corners and orientations within its existing rectangular approximation. Failure does not establish that every physically possible placement was searched, and it does not remove a required item from the review list.

## Enable voice explicitly

Press **Enable voice** on the packing screen. Begin every command with **Packing**, for example “Packing, next”. Supported commands are:

`next`, `back`, `skip`, `packed`, `repeat`, `lock placement`, `does not fit`, `item unavailable`, `confirm`, `cancel`, and `stop listening`.

Only a complete recognised command with a reported confidence of at least 0.75 is accepted. Missing confidence, partial results, multiple-command phrases and uncertain recognition produce no packing change. Both failed-placement and unavailable changes require a separate confirmation; `Packing, cancel` dismisses the pending change. The confidence threshold is provisional and needs physical-device acceptance.

Listening stops when the screen closes or becomes hidden, when permission fails, when **Stop voice** is pressed, or after five minutes without an accepted command. Moving to another step cancels in-flight recognition so words about the previous item cannot change the new item. The app pauses recognition while it reads a step. Resuming from the background does not automatically reopen the microphone.

In an unlocked protected workspace, a complete accepted command also counts as activity for its five-minute idle window. The command waits for the original workspace's authority check, including native capture-lease renewal on Android, before changing a step or packing progress. A locked, expired, hidden or switched workspace refuses the command. If renewal is delayed, a screen/step change, playback pause, voice stop or idle expiry discards the pending result. A failed renewal stops listening; unlock the workspace if needed and explicitly enable voice again. The spoken stop command only stops listening; it does not renew workspace activity.

Partial results, unclear speech, missing/low confidence, recognizer restarts, support checks and automatic speech output do not renew the workspace. Touch and keyboard controls continue to count as activity. Silence still locks a protected workspace and removes the packing screen; guest packs have no protected-workspace idle lock. This is not a background keep-awake service.

No audio, transcript, analytics or voice history is saved by the application. It processes the recognition result transiently to select a command. The speech provider remains a platform dependency; provider diagnostics and OS behavior have not been independently audited.

## Platform gates and model downloads

- **Browser:** a secure context and both the local-recognition flag and local availability API are required. Every availability, installation and recognition request requires local processing. A browser with only remote recognition is rejected before microphone use. There is no remote fallback. This follows the [Web Speech specification](https://webaudio.github.io/web-speech-api/).
- **Android:** the native plugin uses `createOnDeviceSpeechRecognizer`, available from API 31, after checking device support. From API 33 it checks installed on-device English languages; API 31–32 language availability is checked by the recognizer when listening starts. The app can still run from API 24 with touch controls. It declares optional microphone hardware and requests microphone permission only for an explicitly started listening session. See [Android's SpeechRecognizer reference](https://developer.android.com/reference/android/speech/SpeechRecognizer) and [RecognitionSupport](https://developer.android.com/reference/android/speech/RecognitionSupport).
- **iOS:** no native voice adapter is implemented. Browser-style local support is checked, with touch controls when the required APIs are unavailable. Native iOS speech acceptance remains outstanding.

When the provider reports a downloadable English model, a separate **Download English speech model** button explains the provider download and variable size. Checking support never requests installation. Requesting a download does not prove it has finished and does not start listening. Enable voice again after installation. No model was downloaded during this QA run.

**Read this step aloud** selects an installed local English reading voice: browser `localService`, or Android TextToSpeech with no network requirement and no missing-data feature. If none is available, the app explains the limitation and retains the text. It does not substitute a remote/default voice. Native speech output and real audio quality have not been tested on hardware.

## Physical acceptance still required

On an explicitly authorised supported phone, test installed/missing models, offline listening, denied/revoked permission, uncertain or missing confidence, backgrounding, screen changes during an utterance, cancellation during permission requests, duplicate results, read-aloud interruption, and repeated commands in a realistic packing environment. With a protected workspace, continue for more than five minutes using only accepted commands; then verify locking after five minutes without activity. Verify refusal after native lease expiry and background locking while a renewal is pending. Verify that other packed coordinates and required-item status remain unchanged after each operation. Separately test unsupported devices and the native/WebView event bridge.

Full-product work remains: validated irregular geometry and scans, accounts/sharing, wider carrier coverage and native lookup service configuration, iOS compilation and voice support, device compatibility, physical fit and packing benchmarks. These controls do not constitute a completed MVP.
