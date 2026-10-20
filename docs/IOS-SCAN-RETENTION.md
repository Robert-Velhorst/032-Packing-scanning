# iOS opt-in raw scan retention

Automatic source deletion remains off by default. In a supported protected iOS
workspace, the existing settings flow can opt into 7, 30 or 90 days. Guest USDZ
captures and generic point records are not included. Cleanup runs only while
the workspace is unlocked/visible, records are saved, and editors, file drafts
and camera capture are closed. Native calls independently require the original
lease, a strict numeric period and an optional canonical UUID cursor.

The native clock and authenticated completed depth metadata establish source
age. No web timestamp, deletion path or list of IDs is accepted. Each call
checks up to 100 sorted UUID entries and returns a cursor. Top-level directory
names are streamed while retaining at most 101 IDs, so retained metadata and
unrelated entries do not exhaust the batch window. A one-million-entry safety
limit refuses an excessive scan without mutating sources. Unknown entries remain untouched. Invalid,
incomplete, generic or future-dated metadata is skipped. Recent sources are kept.
An invalid native clock refuses the sweep. Supported policies include the exact
age boundary.

Only `points.ply.sealed` is removed, after authenticating both files and checking
exact known children, regular-file type, single link, original inode, root,
workspace key and live lease. Links, unknown children and corrupt ciphertext are
preserved with a failed confirmation. Source metadata remains byte-identical.
Delete/Clear recognize authenticated typed depth metadata after point removal.
Clear uses the same streamed selector for two passes: it preflights every
recognized capture before removing any, then reauthenticates each deletion.
Retained metadata does not exhaust a fixed folder-count limit. Unknown data stays
untouched. This is not orphan recovery or workspace erasure.

Confirmations include IDs whose expired source is already absent, so an
interrupted reply can be reconciled later. An I/O or authority failure can leave
partial source removal; no whole-sweep success is returned after a scope failure.
The existing storage worker and pending-request budget serialize calls, and the
main-actor reply checks the original lease again. Retained metadata allows a
later authorized sweep to confirm absence without recovering deleted points.

The shared parser checks the native receipt before changing record availability.
iOS receipts mark only matching ARKit source IDs; same-ID Android and guest
records remain unchanged. Dimensions, adopted geometry, photos, trips, packed
progress and settings retain their original values. Backups still exclude raw
native points and cannot recover deleted sources. Missing raw points disable
source review/reconstruction while preserving explicitly adopted geometry.

Mac checks cover age boundaries, metadata immutability, repeated confirmations,
metadata-only Delete/Clear, preflight preservation, 100/1 pagination, unrelated
entries/workspaces, strict policies/cursors, corrupt ciphertext, symbolic/hard
links, invalid clocks and revoked access. An actual native receipt passes the
production TypeScript parser and platform-scoped record update. These synthetic
checks and unsigned compilation do not establish actual device lifecycle,
filesystem interruption or operator acceptance.
