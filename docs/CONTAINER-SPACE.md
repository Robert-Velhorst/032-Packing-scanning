# Recorded usable bag space

The bag editor supports up to 16 named rectangular areas that must remain empty, plus vertical clearance below the lid. These are traveller-entered restrictions, not automatically segmented scan geometry or proof that the lid will close.

In **My bags → Edit bag**, record the full bounds of a wheel housing, frame intrusion or unusable compartment under **Keep areas free**. Use the reference inside corner marked by the dark dot in the diagrams. Positions run along the bag's length, width and height: from left, from front and above the floor. Enclose an irregular intrusion conservatively; do not enter only its visible or narrowest part. Record the source as estimated, measured by you or confirmed by you. Each area keeps its own source, confidence, date and note.

Lid clearance keeps an entered thickness empty across the entire bag. It has separate measurement evidence. A blank field preserves legacy behavior; zero reserves no space, and a value equal to the inside height makes the whole bag unavailable. This does not simulate a curved lid, zipper, expansion panel, cushioning or safe closing force.

## Planning and review

- The deterministic planner subtracts unavailable areas before generating candidates and checks every placement against them and the reserved lid height. All four planning modes use these hard restrictions.
- Touching a recorded boundary is allowed within the planner's existing 0.01 mm numerical tolerance; this is not a physical error margin. Add the physical allowance needed when recording dimensions.
- Overlapping recorded areas are allowed. Capacity subtracts their union once, clipped below the reserved lid space. The displayed fill percentage uses this remaining recorded volume, not the original empty-box volume.
- Intrusion tops are not inferred to be load-bearing. Remaining space above an intrusion does not automatically provide a valid support surface.
- A newly conflicting locked or confirmed placement is excluded from the proposed sequence with an explicit undo-packed/unlock instruction. Its saved position and packed status remain unchanged until the traveller chooses to change them. Unaffected locks are retained.
- Invalid stored restrictions disable new placements in that bag and explain the correction needed. Other eligible bags remain available. Incomplete or out-of-bounds form edits cannot overwrite a valid saved record.

The 3D view shows translucent amber keep-free regions. Top-view diagrams show their projected footprints and list their vertical bounds; an apparent overlap in the top projection does not by itself establish a 3D collision. The printable sequence lists the restrictions once per bag and carries the amber outlines into step diagrams. Recorded limits remain available after offline reload.

Metric and imperial displays retain untouched stored millimetres and provenance. JSON backups include restrictions and their evidence. Restore validates them before replacing saved state; malformed restrictions reject the entire backup. Removing a record in the editor changes the draft and takes effect only when the bag is saved.

## Verification and remaining scope

The web/server suite passes 186 tests across 23 files. Analytic container tests cover overlapping volume, boundary contact, intrusion avoidance in every mode, lid exclusion, complete unavailability, malformed records, support assumptions, equivalent-region ordering and locks. Desktop/mobile Chrome checks at 1440×1000 and 375×812 exercise editing and rejection, evidence, exact unit round trips, the 3D/top/printed views, backup/restore, conflicting locks and offline reload. The generated sample PDF has three pages and lists keep-free inventory once per bag. These checks use the labelled example pack and entered synthetic restrictions; no camera, microphone, system print dialog or physical packing test was performed.

Recorded restrictions apply to adopted occupied-cell shapes and rectangular bounds. A restriction can occupy an open recess when no occupied cell overlaps it. Automatic intrusion detection, full compartment eligibility, physically validated geometry, stronger nesting search, material deformation, pressure limits, physically validated usable-interior reconstruction and physical closure acceptance remain unfinished product requirements.

The corresponding Android debug build, signature, alignment and packaged-asset checks are recorded in [Android build verification](QA-ANDROID-BUILD.md#later-recorded-container-space-build--2026-09-30). The APK has not been run on a physical device.

Explicitly adopted seeded bag cavities now also constrain usable volume, exact occupied collision, conservative downward entry and packing views. They retain all reconstructed free cells in the reviewed opening-up frame; unavailable-cell tops do not become supports. Separate reviewed travel-up direction, calibration, raw packed identities and offline derivatives are described in [interior reconstruction](INTERIOR-RECONSTRUCTION.md). Synthetic browser/native checks do not establish physical completeness, safe floor strength or closure.
