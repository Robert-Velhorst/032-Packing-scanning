# Recorded stacking limits and fragile protection

The item library now records an optional maximum additional static weight resting above an item, with separate source evidence. This is a planning constraint in the recorded orientation, not a measurement of pressure resistance, cushioning effectiveness or impact survival. Scans and photos do not establish strength.

## Traveller workflow

Under **My items → Edit item → Weight allowed above this item**, enter a limit in grams or ounces and choose its source. Zero means no stacking. A blank field means the ability to bear a load is unknown; the planner can still suggest a stack but clearly marks that support as unverified. The **Fragile** flag is stricter than any positive recorded limit: no planned item may rest on a fragile item.

Untouched dimensions, dimension evidence, weight, upper weight ranges and stacking-limit evidence keep their exact stored values when edited in another unit system. Changing or clearing a limit is an explicit edit and updates or removes its associated evidence. Source timestamps are not refreshed merely by opening or resaving a record.

All four current modes enforce fragile/no-stack constraints and recorded numerical limits. **Fragile protection** additionally requires the full occupied bottom footprint of a new placement to have support and favors robust supports before fragile items, subject to required-item priorities. Other modes retain the existing 65% footprint heuristic. Neither fraction proves tipping stability or center-of-gravity safety. Plan comparisons show actual placed/excluded counts rather than a fabricated protection score.

## Static-load model

The solver uses actual occupied horizontal contact between adopted shapes or saved rectangular bounds in the same bag. Objects in another bag do not transfer load. Side contact in the packing view can carry load when that axis is vertical in the reviewed travel position; each snapshot has its own contact graph. Adopted shapes include exposed interior undersides; an item beneath an overhang is not declared load-free merely because both bases are on the floor. Cyclic interlocking contacts are rejected because their load sharing is unverified. It follows contact paths through the whole stack, so an added top item can overload a support several levels below.

Each supporting item accounts for the upper saved weights of all distinct descendants above it, excluding its own weight. Where a bridge rests on several items, every support path accounts for the full weight: there is no assumed equal sharing or measured contact-pressure distribution. Shared descendants are counted once per ancestor. This conservative bound can exclude a physically workable arrangement; accurate sharing requires a validated mechanical model. Unknown or invalid descendant weights prevent satisfaction of a numerical stacking limit. A recorded range contributes its upper bound.

The plan, each packing step and printable sequence show the additional upper weight, number of items above, unknown weights and recorded limit/source. Top-view diagrams draw the current numbered step last so higher overlapping layers cannot hide it. Planned wrapping must be included in the entered item dimensions and weight. The current engine does not generate cushioning layers.

For adopted bag cavities, the opening-up packing snapshot and independently reviewed travel snapshot must both satisfy support and load checks. Traveller confirmation binds the closed travel base and applicable limits to the source, scale and travel end. The opening cap never supplies support. See [interior review](INTERIOR-RECONSTRUCTION.md).

## Existing packed positions and recovery

A newly conflicting locked stack is not silently moved or unconfirmed. Its bag is paused for new placements and the conflicting locks are listed outside the proposed sequence, with an explanation. Other eligible bags remain available. Saved coordinates and packed flags remain intact. The review exposes **Undo packed for …** or **Unlock …**, so the traveller can explicitly allow movement after physical checking. Switching to Fragile protection also calls out a saved stack with incomplete occupied base support. Merely changing mode does not erase its records.

Backups retain the mode, limits, evidence and locks. Restore validates numerical limits and evidence before replacing state, and rejects the entire malformed backup. These checks and recovery controls work offline.

## Evidence and limits

The current web/server suite passes 221 tests across 26 files. New travel-gravity cases independently check six signed axes, negative-wall support, legacy review gates, source/scale/end binding, two separate load graphs, transitively carried travel weight, occupied recesses, cyclic travel contacts and unchanged conflicting packed records in all modes. Stacking fixtures cover cumulative loads, full bridge bounds, shared-ancestor deduplication, exact limits, unknown weight, same-bag contact, fragile overrides, malformed records, all-mode exclusions, packed-lock preservation, alternative bags, full-support checks and repeatability. The container restriction fixtures also run all four modes.

Desktop/mobile Chrome checks at 1440×1000 and 375×812 use an isolated labelled example pack with synthetic measurements and limits. They verify editor rejection, 48-pixel load controls, exact unit/provenance round trips, required-item exclusion, step instructions, backup/restore, invalid-import rejection, conflicting packed locks, offline reload and explicit recovery. No camera, microphone or system print dialog is activated. The sample PDF is generated locally; its recorded limits are not measured product strength.

The research document links damage prevention with spatial planning and fragility. As a supporting cargo-packing principle, the [2014 IMO/ILO/UNECE CTU Code, annex 7, sections 3.2.3–3.2.4](https://assets.ippc.int/static/media/files/publication/en/2022/01/CTU_Code_January_2014.pdf) distinguishes fragile parcels, structural strength and load transfer. This is general cargo guidance, not certification of suitcase packing or of this algorithm. The app's no-load fragile rule and full-path bound are conservative design choices, not thresholds supplied by that source.

Continuous rotation between packing and travel, arbitrary tilts, pressure limits, validated load sharing, cushioning materials, transport accelerations, securing, deformation, bag orientation changes, validated irregular support/strength and physical damage-prevention acceptance remain unfinished requirements. A static estimate within a recorded limit is not proof that the object is safe in transit.

The preserved Android debug artifact and its actual signature, alignment and packaged-asset checks are recorded in [Android build verification](QA-ANDROID-BUILD.md#later-stacking-limit-build--2026-09-30). A desktop Node/Vite run with 30 and 60 identical synthetic rectangular items took 61–171 ms per mode and returned no stacking conflicts; this is not evidence of physical phone performance or irregular-geometry performance.
