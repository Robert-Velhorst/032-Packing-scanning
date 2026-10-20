# iOS observed-shell reconstruction

`PackingVoxelSolid.swift` ports Android's bounded `VoxelSolid` geometry kernel.
It is compiled into the iOS target, but is not yet connected to a native bridge
method or the reconstruction controls. Those controls remain Android-only until
the saved-source/provenance/authority path is implemented and verified.

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

These are synthetic algorithm checks. A closed voxel boundary does not prove
physical completeness, measurement accuracy, material rigidity, usable cavity,
or closure under load. Native protected-source binding, shared result parsing,
and real device/physical acceptance remain required before iOS adoption.
