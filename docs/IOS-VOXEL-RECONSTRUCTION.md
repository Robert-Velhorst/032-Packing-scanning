# iOS observed-shell reconstruction

`PackingVoxelSolid.swift` ports Android's bounded `VoxelSolid` geometry kernel.
The iOS `reconstructCapture` bridge reads the original protected source and
validates its authenticated provenance before running the kernel. It uses every
saved point, not the sampled preview. Only individual-object ARKit captures below
the point limit qualify. Guest models, generic point records, bag-wall captures,
and capped sources are refused. The source and its metadata remain unchanged.

The existing saved-scan review flow parses the native result against its original
ID, hash, point count and envelope before constructing the surface. It enables
explicit item-shape adoption on the original iOS device. Bag interiors use the
separate [seeded cavity model](IOS-CAVITY-RECONSTRUCTION.md), which cannot be
substituted for occupied item geometry.

The bridge retains the original workspace lease on the serial storage worker,
limits pending requests, and rechecks access before returning JSON on the main
actor. A stale lease never redirects an operation into a newly selected workspace.
Geometry refusal returns a reconstruction-specific message while source/key or
authority failures retain the generic storage failure. No key or raw file path is
returned to JavaScript.

The kernel accepts up to 60,000 full-source points in envelope-local millimetres.
It uses at least 10 mm cells, increasing cell size to limit each axis to 46 cells.
An empty border and six-neighbour flood fill distinguish outside space from
enclosed cells. It never dilates observations, patches holes, drops disconnected
components, or fills exterior-connected concavities. At least eight interior
cells must be enclosed. Every exposed edge needs two opposite windings, every
surface vertex needs one closed fan, and the result is limited to 20,000 faces.
Output cells are sorted by `x + nx * (y + ny * z)` and input order is preserved.

The iOS workflow runs the actual Swift kernel against closed/open shells,
concavities, disconnected objects, duplicate/reversed observations, malformed
coordinates, the maximum grid, ambiguous edges/vertices and the face-count cap.
It then runs Android's production Java kernel against nine Swift-generated
sources and compares all occupied cells, grid dimensions, resolution, observed
and enclosed counts, and surface face count (or mutual rejection).

A separate encrypted-source test restores an 8,216-point capture, reconstructs it
without using its smaller preview, and checks that the original PLY and metadata
remain byte-identical. It refuses open shells, point-limit captures, generic
records and bag targets, and checks revoked and different-workspace reads. Actual
native scan, preview and reconstructed JSON pass the production TypeScript
parsers, including independent surface topology and volume construction. Web
boundary tests cover original lease forwarding, mismatched source hashes and
late replies after revocation.

These are synthetic algorithm checks. A closed voxel boundary does not prove
physical completeness, measurement accuracy, material rigidity, usable cavity,
or closure under load. Real WKWebView-to-native execution, memory/latency on a
supported device, VoiceOver and independent physical acceptance remain required.
