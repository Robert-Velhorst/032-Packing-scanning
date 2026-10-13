# Android capture guidance and retained diagnostics

Checkpoint: 2026-10-01. Implemented and checked locally; physical Android camera acceptance is outstanding. This does not establish controlled-MVP readiness.

## Capture and review

The Android scan screen now gives a targeted next step while collecting depth. Item guidance prioritizes a missing opposite/side camera direction, then a higher or lower viewpoint. Only separated camera directions that contributed at least 30 retained points count. The coordinate directions belong to the starting camera frame, not independently measured object faces or gravity. Keep the object still and do not force an inaccessible view. The underside can remain missing.

Bag guidance asks for different views into the empty interior without directing a traveller behind its walls. Neither bag nor item guidance identifies a surface as fully captured. Existing minimum point/frame/view-spread, edge and envelope gates remain; these new heuristics do not invent extra points or label a scan physically complete.

The centre half of the raw depth image is sampled every three pixels. A sample counts as high confidence only with a supplied confidence value of at least 204/255 and depth from 150 to 4000 mm. Diagnostic samples are not object segmentation. Central background pixels can contribute; object points outside the central window may not. Counts include repeated pixel locations across fresh frames and do not represent distinct measured object pixels.

After at least three fresh frames, fewer than 10% qualifying central samples in the recent eight-frame window triggers advice to improve lighting, move slowly, change angle or use manual measurement. This threshold is a product heuristic, not a calibrated accuracy or blur test. No inference identifies a material as shiny, transparent or textureless; the advice names possible difficulties. Camera blur, sensor bias and surface completeness are not measured here.

The review dialogue includes missing-direction and aggregate sparse-depth cautions before **Use estimate**. **Scan more** resumes the same capture; **Restart capture** discards its diagnostic counters with its point cloud. Tracking-paused frames disable review, and the finish operation rechecks tracking. Capture directions and depth diagnostics can be expanded in the real saved-scan review. Older scans have no invented diagnostics.

## Implementation and privacy

[Google's raw-depth guide](https://developers.google.com/ar/develop/java/depth/raw-depth) documents sparse pixels, matching confidence images and repeated timestamps for reprojected data. The sampler still integrates distinct matching depth/confidence timestamps only. Its acquisition attempts are bounded to five per second, including temporarily unavailable images. Try-with-resources closes both images on every exit path.

Raw depth/confidence reads now respect each plane buffer's position, limit, row stride and pixel stride. Padded/interleaved planes and unsigned little-endian millimetres are handled without changing the buffer's position or byte order; invalid layouts stop capture through the existing fallback. This corrects reads that previously assumed zero buffer offsets.

A versioned `camera_depth_guidance_v1` aggregate is saved with scan quality: fresh frame count, examined/qualifying central samples, four-sector mask and higher/lower separated-view counts. No camera image, per-frame trajectory, GPS, recognition prediction, new permission, service or upload is added. Existing private point-cloud storage and protected workspace rules remain separate. Local backups retain validated scan metadata under their existing original-source-link rules. Account metadata uploads and household copies exclude scan records under their existing privacy boundaries. Calibration and adopted planning geometry stay independent.

Bridge and backup checks reject noninteger, nonfinite, unsupported, extra or contradictory diagnostics, including more contributed sectors/views than retained separated viewpoints or more retained frames than sampled fresh frames. A malformed saved record displays a review message rather than fabricated numeric coverage. Local data without this optional field remains compatible.

## Local verification and remaining acceptance

Ten new web tests cover diagnostics, platform/relational validation, legacy records, bag-specific advice and local-backup rejection. Ten new native unit tests cover fresh/repeated frames, sparse-window recovery, separated contributing camera directions, side/height heuristics, exact padded/offset image reads, truncation, confidence/range filtering and actual saved metadata beside unchanged PLY/dimensions.

The complete suite passes 478 web/server/tool tests in 52 files. All 107 Android unit tests executed with no failures/errors. Client/server/tool type checks, production web build and Android sync pass. Native debug/test assembly and lint pass; lint has zero errors and 27 warnings. The existing production chunk-size warning remains. Final package verification is recorded in the dated [Android build report](QA-ANDROID-BUILD.md).

CUA checks the real saved-scan component at measured 1440 × 1000 and 376 × 812 CSS sizes, using clearly labelled synthetic records. Sparse, several-direction, bag, legacy and invalid views remain readable; there is no horizontal document overflow or browser warning/error log. These are component checks, not native camera-screen or physical-depth execution.

A physical test phone remains absent from ADB. Install the saved APK and check low-texture, reflective, transparent, partially hidden and off-centre objects; different phone orientations, actual padded image buffers, repeated-depth frames and sparse/recovering conditions; and pause/resume/restart/cancel/locked workspace behavior. Inspect status visibility and scrolling on real small screens. Record false and missed guidance, then measure scan error against independent references. iOS guidance parity, direct image-quality detection and broader physical scan-to-plan acceptance remain unfinished.
