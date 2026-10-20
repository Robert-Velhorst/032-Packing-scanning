# iOS reviewed interior reconstruction

`PackingVoxelCavity` ports Android's seeded observed-interior model. It follows
one empty component selected by the user's seed. Observed cells are unavailable.
Only the explicitly reviewed opening end may remain open; reaching another
envelope face refuses the result. A missing floor or wall is never replaced by
the rectangular envelope. Sealed pockets without entry are refused, other
compartments are excluded, and no observations are trimmed or gaps patched.

Each axis has 3–46 cells. Cell sizes fit exactly inside the source envelope and
do not round capacity outward. The opening needs at least four cells and the
seeded component at least eight. The complete free boundary must pass the same
edge-winding, single vertex-fan and face-count limits as item reconstruction.
The selected opening is capped for mathematical boundary checking only.

The protected `reconstructInterior` bridge restores the original authenticated
PLY and metadata, checks uncapped bag-interior depth provenance, and processes
every saved point. Item, generic, guest and point-limit sources cannot become
cavities. Opening/seed arguments reject JavaScript Booleans, strings, fractional
axis/sign values and non-finite coordinates. The storage worker retains the
original lease and bounded request budget; the main-actor reply rechecks access.
Nothing rewrites the saved source or automatically adopts the result.

The shared web parser independently checks source identity/hash/count/envelope,
reviewed opening and seed, observed/free cells, empty-component traversal,
topology and volume. Saved iOS depth scans use the existing interior review UI.
Opening review, travel orientation and floor/support review remain explicit
steps before adopting the cavity. Item solids and bag cavities remain distinct.

The Mac workflow executes the production Swift code with all six reviewed ends,
intrusions, chosen partitions, non-integral bounds, missing walls/floor, a single
hole, wrong opening, wall seeds, sealed pockets, ambiguous contacts, malformed
bridge values and bounded-input refusals. It compares 18 sources and all
resulting free/opening/observed cells against production Android Java, including
mutual rejection. An encrypted saved source additionally feeds actual native
scan/preview/cavity JSON through the production TypeScript parsers and confirms
source immutability and revoked-access refusal. Web tests check lease forwarding,
review mismatch and delayed replies after lock.

These synthetic checks do not establish physical accuracy, usable capacity,
narrowest entry, loading/support safety or closure. Finite cells can miss narrow
gaps and hidden intrusions or thicken walls. Real WKWebView/device execution,
VoiceOver, on-device memory/latency, and independent physical scan/fit/closure
acceptance remain required. Signing, file/photo and retention parity are also
separate release work.
