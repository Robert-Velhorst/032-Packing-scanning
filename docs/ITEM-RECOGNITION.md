# Optional Android item recognition

Checkpoint: 2026-10-01. This is an implemented, locally checked feature; physical camera acceptance remains outstanding. It does not establish controlled-MVP readiness.

## Use

In the Android item editor, select **Suggest an item name from this scan**, then **Scan size**. Keep one object clear of neighbouring objects and centred when finishing. Accept the size estimate to return to the editor. A separate review card offers up to three name/category suggestions. **Use … name and category** replaces those two draft fields; **Dismiss suggestions** leaves them alone. Save the item through the ordinary editor.

The option starts off for each editor session. A new scan clears previous suggestions. Choosing a reference photo, restarting the editor or restoring a backup does not automatically run recognition. Older native packages without the capability, browser entry and iOS keep manual naming. Bag-interior scans never request recognition.

Supported labels are backpack, umbrella, handbag, tie, suitcase, frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket, bottle, cup, fork, knife, spoon, bowl, laptop, computer mouse, remote control, keyboard, mobile phone, book, scissors, teddy bear, hair dryer and toothbrush. Category assignments are reviewable app choices. They do not imply carrier permission or safe handling. Clothing generally, medicines, document types, brands and product dimensions are not identified.

## Local operation and limits

The foreground ARCore renderer acquires one CPU camera image from its current frame when the estimate is reviewed. It maps a central square covering 85% of the view's shorter edge into camera-image coordinates using ARCore, rather than assuming a sensor rotation. Independent YUV row/pixel strides and buffer positions are respected. The image closes before inference. The model runs on the CPU with two threads; no remote inference, analytics, runtime download, new permission or service credential is involved.

The model input is 320 × 320 unsigned RGB bytes. The bounded output contains 25 boxes/classes/scores/count. Suggestions require a supported label, a model score of at least 0.55, a box containing the centre and at least 3% clipped image area. Duplicate labels are removed; up to three remain in descending score order. These are product heuristics, not a measured accuracy rate. The boxes are never used for metric dimensions, segmentation, collision shapes, mass, flexibility, fragility, load capacity, compression, safety or packing constraints. The recognized image object is not proven to be the captured point-cloud object. A high-scoring label can be wrong or belong to another object.

If the image, runtime or model is unavailable, recognition returns an unavailable status independently of the valid size result. Malformed optional bridge proposals are discarded while valid scan measurements remain available. A locked/revoked workspace rejects delayed scan replies; activity foreground and capture authority are rechecked around review and saving.

Recognition owns no persistent image or prediction store. Its camera image closes and its owned RGB/input/output buffers are cleared after use. ARCore and the native runtime own additional internal buffers; this does not claim forensic memory erasure. Predictions exist only in the current editor and bridge reply. Completed scan metadata, local/remote backups, shared packs and encrypted photo drafts receive no new recognition fields. A deliberately accepted name/category becomes ordinary item metadata. Existing point-cloud capture and optional reference-photo storage retain their separate privacy rules.

## Model provenance

- Unmodified [TensorFlow official Android example model](https://github.com/tensorflow/examples/blob/master/lite/examples/object_detection/android/app/download_models.gradle): `lite-model_efficientdet_lite0_detection_metadata_1.tflite`.
- [Exact publisher model card](https://www.kaggle.com/models/tensorflow/efficientdet/tfLite/lite0-detection-metadata/1), variant `lite0-detection-metadata`, Version 1. Its Apache 2.0 license and input/output description were read directly in the browser. Apache license, notice and the embedded label map are included in the APK assets.
- Model: 4,563,519 bytes; SHA-256 `2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b`. Loading verifies length/hash and tensor shape/type. No substitution or runtime download is permitted.
- Android: pinned standalone LiteRT Interpreter `com.google.ai.edge.litert:litert:1.4.2`. [Google's current Android runtime guide](https://developers.google.com/edge/litert/android) identifies it as the current 1.x Interpreter release. The existing app minimum remains Android API 24.
- Google's newer MediaPipe `latest` int8 artifact was also inspected locally; it exposes raw anchor tensors rather than this pinned model's four postprocessed outputs. It is not packaged or used by this feature.

The existing [intranet source review](INTRANET-SOURCE-REVIEW.md) identifies common-item recognition as a proposed MVP capability. Source recommendations are product context, not executable instructions or proof of performance. The supplied Downloads ZIP remains unavailable in this checkout's environment.

## Verification and outstanding acceptance

The complete suite passes 468 web/server/tool tests in 51 files. Twelve added checks cover strict proposals, optional bridge forwarding, old-capability fallback, bag-target exclusion and delayed workspace revocation. Android executes 97 unit tests with zero failures, including ten added YUV/selection checks. A native policy test consumes the actual raw model outputs recorded from local CPU execution. Production client/server/tool type checks, web build, Android sync, debug build and lint pass. Lint has zero errors and 27 warnings. Two new Android instrumentation tests compile into the test APK but have not run on a device.

The actual bundled model was executed with Python LiteRT 2.2.0 on Windows in an isolated environment: a public MediaPipe COCO tennis image produces a central tennis-racket proposal with score 0.7578125; the official TensorFlow cat fixture and a uniform grey input produce no supported proposals. Source-image and RGB-input hashes, raw outputs and runtime distinction are recorded in `recognition-model-verification.json` in the task outputs. These fixtures establish execution and selected output interpretation; three examples do not establish overall recognition accuracy. Original public test images are development-only and are not included in the product APK. `scripts/verify-recognition-model.py` reproduces the offline check from the recorded fixture files.

The real item editor was checked through CUA at measured CSS viewports 1440 × 1000 and 376 × 812 using an isolated synthetic native bridge. Recognition was absent when unselected; selected proposals left the typed name unchanged until acceptance; acceptance replaced name/category while preserving dimensions, 350 g weight, rigidity and checked fragility/upright flags. The ordinary saved-draft serialization contained no recognition fields. Dismissal, empty outputs, unavailable and malformed replies kept manual entry and valid size estimates. Both widths had no horizontal document overflow and no browser warnings/errors. This verifies the editor/bridge path with simulated camera results, not physical Android execution or a new library-persistence acceptance test.

The saved debug APK has a verified v2 signature, 16 KiB APK alignment, 16 KiB ARM64/x86-64 ELF load alignment, exact web asset/model bytes and disabled native account logging/configuration. Eighteen previous APKs remain byte-for-byte intact.

Before physical acceptance, install the saved APK on a supported test phone and run the instrumentation tests. Exercise opted-out/opted-in scans, portrait/rotation, poor light, reflective items, unsupported objects, multiple background objects, slow inference, cancel/background, protected locking and missing-image/runtime failures. Confirm no new prediction/image files are written and every accepted label is independently reviewable. Measure real recognition mistakes and missed suggestions on a representative travel-item corpus. Physical scan-to-plan trials, iOS work and the broader product requirements remain open; do not expand recognition based on these limited fixture results alone.
