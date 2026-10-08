# Packing controls and voice verification — 2026-09-30

Large packing controls, confirmed failed-placement replanning, unavailable-item recovery, optional local English recognition and local spoken-step adapters are implemented. The Android debug app builds with the native voice plugin. Actual speech/audio, native bridge behavior and physical packing remain unverified.

## Automated and build evidence

| Check | Result and boundary |
| --- | --- |
| Web tests | 61 passed across nine files: existing planner/scan/carrier/measurement tests plus nine packing-progress, twelve voice-session, three browser-local-recognition and two local-reading tests |
| Voice-session tests | Explicit enable; unavailable-model gate; cancellation during support/permission checks; stale step/result rejection; duplicate, partial, ambiguous and low/missing-confidence rejection; pause during reading; permission failure; recoverable silence; five-minute idle stop; spoken stop. Injected drivers test controller behavior, not real recognition |
| Replanning tests | Different coordinates after failure with another packed position unchanged; no-alternative required item retained for review; invalid saved lock never silently moved; duplicate feedback and JSON round trip; unavailable idempotence; base items share layer 1; packed confirmation requires a placement and preserves existing locks |
| Reading/privacy tests | Remote/default voice rejected; local English voice selected when a remote voice appears first. These checks use injected synthesis objects and produce no audio |
| Production type check and web build | Passed; existing JavaScript chunk over 500 KB warning remains |
| Capacitor sync | Passed for Android and iOS assets; no iOS compilation |
| Android unit tests | Eight geometry/storage tests passed, zero failures/errors/skips. No native voice runtime tests |
| Android build | Full `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug` passed after the final native changes; the final web wording was subsequently rebuilt, synced and repackaged with `:app:assembleDebug` |
| Android static checks | Zero errors, 21 warnings; no error baseline/suppression added. Warning categories remain documented in [the original build report](QA-ANDROID-BUILD.md) |
| APK signature and alignment | Signature verification passed with Android Debug certificate and Signature Scheme v2; `zipalign -c -P 16 -v 4` passed. This does not prove runtime compatibility on a 16 KB-page device |
| Current web assets in APK | All seven `dist/` files matched the packaged `assets/public/` entries by SHA-256 |
| Packaged manifest | App ID `com.packingscanning.app`, version 0.1.0/code 1, minimum API 24, target API 36; microphone permission declared, microphone hardware optional, speech/TTS service queries present and backup disabled |

## Actual browser checks

Performed through Chrome DevTools on `http://127.0.0.1:5173/` in an isolated context using the three-item example pack. Only this context's example records were changed. No microphone input was captured, no model download requested and no spoken audio played.

| Journey | Observed result |
| --- | --- |
| Enter packing mode | Three steps and semantic progress control; current heading receives focus |
| Enable voice with missing local model | Browser reported English model `downloadable`; interface explained the missing model and offered an explicit download. Microphone permission stayed `prompt`; recognition was not started |
| Mark laptop packed | Progress became 1/3, laptop coordinates were locked, and the next unpacked item was selected |
| Failed placement before confirmation | Stored rejected/unavailable arrays and other packed coordinates remained unchanged |
| Confirm trainers' failed placement | Previous rectangular placement was stored as rejected; trainers remained available and moved from `(220,0,0)` to `(220,150,0)` mm; laptop's complete flag and full locked placement stayed identical |
| Request unavailable, then cancel | Confirm button received focus; cancellation returned focus to the current heading and left stored unavailable records unchanged |
| Confirm trainers unavailable | Trainers left the step sequence; progress became 1/2; laptop confirmation and position remained unchanged |
| Packed · continue | Did not duplicate or undo laptop confirmation or change its coordinates |
| Undo packed and Skip | Undo removed only laptop confirmation/lock; Skip changed the step without marking it packed |
| Restore unavailable | Checklist showed unavailable status and disabled packed confirmation; Restore returned trainers to the three-item plan and retained failed-position feedback |
| Reload persistence | Restored availability, repacked laptop confirmation, identical lock coordinates and rejection history remained in IndexedDB after a full reload |
| Keyboard confirmation/cancellation | Tab moved from the focused confirmation button to Cancel; Enter dismissed the change, returning focus to the current step heading with a visible focus outline |
| Console/network | No warning/error messages after the final reload and interactions; 43 recorded local requests returned 200/304. This does not verify external-provider privacy or release-mode network behavior |

Laptop coordinates preserved during the failed-placement and unavailable/restore checks: bag `sample-cabin-case`, position `(0,0,0)`, oriented dimensions `220×320×25` mm, rotation 90, layer 1.

## Responsive and accessibility checks

Screenshots and live element measurements were inspected at 375×812 mobile/touch, 768×1024 and 1440×1000. The packing screen had no horizontal overflow at these widths; its button/command-summary targets had minimum measured height 48 pixels. The final 375-pixel check also confirmed 30-pixel item heading and 14-pixel instruction text. Side-by-side base items are labelled layer 1 rather than separate layers.

The progress control exposes minimum, maximum and current values; the current list item has `aria-current=step`; confirmation and cancellation manage focus; feedback uses status announcements. No full axe audit, screen-reader acceptance, Android accessibility run, broad device matrix, zoom/reflow audit or visual-regression comparison was performed. No approved screenshot baseline exists, so visual regression is **inconclusive**. The browser viewport checks do not establish native-phone usability.

## Review artifact and reproducibility

Separately preserved review APK: `packing-scanning-0.1.0-android-voice-debug-2026-09-30.apk` in this task's `outputs/` folder.

- Size: **7,911,556 bytes**.
- SHA-256: `951fce849cb39c593d8c5e4e213e71fd8413db46c686617a1963dc14bff2bd02`.
- Locally signed debug test package; not installed, released, submitted or published.
- The earlier scanner-only APK and its historical hash are preserved in [the original build report](QA-ANDROID-BUILD.md).

Build with `npm test`, `npm run build`, `npm run cap:sync`, then `scripts/build-android.ps1`. The ignored `.local-tools/` folder retains native build/package logs, APK signature/alignment logs, decoded manifest and `apk-voice-verification.json`. Unit-test XML and lint outputs remain under `android/app/build/`.

For command behavior, platform requirements and the physical-device checklist, use [Packing controls and on-device voice](PACKING-VOICE.md). Native speech recognition, TTS, microphone permission/lifecycle behavior, speech model download and the WebView bridge still need acceptance on authorised hardware. Native iOS voice, iOS compilation, accounts/sharing, live carrier retrieval, validated irregular geometry/scans and physical packing benchmarks remain outstanding. The full product goal remains incomplete.
