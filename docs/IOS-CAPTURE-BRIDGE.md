# iOS workspace and capture bridge

`PackingScanPlugin` implements the web application's revision/lease handshake on
iOS: get state, deliberately select guest storage or open a protected workspace,
lock the current revision, and touch a live selection after explicit interaction.
It starts locked. The web vault supplies account/workspace UUIDs and its unlocked
32-byte data key. This is local storage authority, not independent server sign-in
or proof of the caller's legal identity. An existing namespace's key-check marker
must authenticate before opening succeeds. Failure revokes the attempted selection
and does not switch to guest storage.

Key arguments must be exactly 32 integer numeric bytes from 0 through 255;
Booleans, strings, fractions and non-finite values are refused. The key field is
removed from the retained call before storage work and the borrowed Data copy is
overwritten on exit. Framework/transport/immutable copies may remain in memory;
this is not a secure-erasure guarantee. No key is persisted by the bridge.

The selected protected store lives under Application Support's private
`ProtectedScanCaptures-v1/account/workspace` namespace. It retains its original
authority. All scan, preview and deletion calls carry their original lease;
stale calls cannot redirect to a newly opened workspace. Guest scans use the
existing iOS 18 Object Capture route. Protected scans use the in-memory LiDAR
screen on a scene-depth-capable device and publish through encrypted storage.
There is no protected-to-guest camera or filesystem fallback.

Selection changes refuse an active capture. Explicit locking revokes the selected
authority. Background/protected-data loss revokes protected selections, while the
keyless guest lease survives resume; both camera controllers cancel on interruption.
`captureWorkspaceLocked` identifies the
previous opaque lease so the web session can close. Stale revision locks do not
close a newer selection. Both guest and protected completion handlers recheck
the captured authority after dismissal before returning a result. Guest cleanup
on a rejected late result targets only that newly created scan folder. Protected
publication can leave an encrypted capture after a late lock/failed rollback;
uncertain files are preserved for recovery.

Preview and protected cleanup run on a serial I/O worker with at most eight
pending requests, including replies queued for the UI. The original authority
brackets operations. Workers transfer only serialized JSON Data to a main-actor
reply object, which retains the SDK call, checks original authority again and
returns completion at most once. SDK calls do not cross into the storage worker.
UI selection/capture fields and completion closures are
main-actor isolated. The web capture client separately rejects delayed replies
after revocation. The access object uses an audited unchecked Sendable contract:
mutable key/lease state is protected by its owner's recursive lock, with immutable
selection identity. This is manual isolation, not compiler proof of every schedule.

Explicit Clear preflights exact known file pairs, regular-file/link constraints
and authentication for recognized UUID capture folders before deleting any.
Unknown top-level names and interrupted staging names remain untouched. A bounded
directory-size check refuses oversized clears. An I/O failure or authority change
during deletion can produce partial removal; success is not returned in that case.
This is not workspace erasure, orphan recovery or age-based retention.

The web bridge accepts iOS state replies and preserves real failures; only a
legacy UNIMPLEMENTED handshake falls back to guest-only behavior. Saved ARKit
point review and item-shape reconstruction are available through the original iOS
source. Reconstruction checks every saved point and the shared web parser binds
the result to the reviewed source before explicit adoption. See
[iOS reconstruction](IOS-VOXEL-RECONSTRUCTION.md). Bag interiors use a separate
[reviewed cavity path](IOS-CAVITY-RECONSTRUCTION.md) with explicit opening and seed.
iOS retention uses the opt-in [raw-source policy](IOS-SCAN-RETENTION.md). Native
backup/file/photo parity remains unfinished. Accounts/service deployment settings
are unchanged.

Mac checks execute production key/state encoding, revision/key authority, pending
request contention and scoped filesystem cleanup against synthetic fixtures.
Actual iOS targets compile the Capacitor handlers and camera controller. Mocked
web boundary tests verify lease forwarding and late-reply rejection. These do
not prove a real WKWebView-to-camera round trip or iPhone/iPad behavior. Permission,
locked/background interruption during capture/save/read, key mismatch, reload,
offline use, storage/memory limits, VoiceOver and physical fit/closure trials
remain required before production acceptance.
