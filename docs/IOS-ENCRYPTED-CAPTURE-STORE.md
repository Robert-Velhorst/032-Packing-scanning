# iOS protected point/metadata persistence

`PackingEncryptedCaptureStore` persists the authenticated envelopes from
[capture authority](IOS-CAPTURE-AUTHORITY.md). The native caller supplies an
app-private directory and a live protected access object. The store retains that
exact access; a later workspace selection cannot redirect its queued operations.
Guest authority is refused. Account/workspace UUIDs select separate directories
under `ProtectedScanCaptures-v1`; no key is persisted.

This module is compiled and tested directly. It is not yet exposed through the
iOS bridge, native scanning, workspace UI or retention. It stores bounded opaque
metadata and point bytes, not validated geometry. The caller still needs the
native provenance/PLY validation and a complete capture workflow. Object Capture
images, checkpoints and USDZ files are not encrypted by this module.

## Publication and reads

Only `capture.json.sealed` and `points.ply.sealed` are written. Encryption and
size/authority checks precede staging. A fresh private staging directory receives
only ciphertext, with exclusive no-follow file creation and owner-only file
permissions. Files are synchronized and closed, then the directory is synchronized.
Authority is checked again before publishing the complete directory with Apple's
[`renamex_np`/`RENAME_EXCL`](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stdio.h),
which refuses an existing destination. The parent directory is synchronized
before returning success; checked authority is revalidated at return.

Files and directories are excluded from backup, with complete file protection
applied on iOS. These policy assignments and OS sync returns do not establish
actual device-lock behavior, backup/transfer exclusion or power-loss durability.

On failure, rollback targets only the newly allocated directory inode and known
regular encrypted children. It cannot overwrite or remove a competing destination.
An unsafe replacement, cleanup failure or process loss can leave an encrypted
pending folder; no automatic orphan cleanup or recovery browser is implemented.
Existing completed captures remain separate. No plaintext staging file is created.

Reads require the original live access and physical canonical location. Exclusive
creation and no-follow reads reject links; regular-file/link-count and descriptor
size checks bound reads to the declared envelope limits. Authentication completes
before plaintext returns. There is no fallback to guest files or plaintext files.

## Removal and scope

Per-capture deletion requires a live access, exact known child names and successful
authentication of both stored files. Wrong keys, copied ciphertext, unexpected
children and unsafe locations refuse deletion. This favors preservation of damaged
or unknown material; it is not a complete workspace-erasure or retention service.
Other account/workspace roots and the guest capture directory are not selected.
Deletion does not claim secure erasure of flash storage or historical copies.

## Verification

Mac CI executes the production authority, CryptoKit and filesystem code against
an owned synthetic temporary tree. Tests cover authenticated round trips, on-disk
ciphertext/private permissions/backup flags, no overwrite, bounds, ciphertext-only
failure staging, rollback on expiry, competing publication, stale stores, wrong
keys, cross-capture copies, account/workspace isolation, corrupted tags, unknown
children, symbolic/hard links, an 8 MB round trip and relocated roots.

The real iOS targets must compile for simulator Debug and unsigned device Release.
Physical iOS filesystems, lock/process interruption, low-memory/low-storage behavior
and full bridge/camera/retention acceptance remain required. Native CI and opaque
storage tests do not establish those user workflows or full product readiness.
