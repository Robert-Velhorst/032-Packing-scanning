# iOS scan original-file boundary

`PackingCaptureFiles` owns the internal `Documents/ScanCaptures` directory used
by the iOS Object Capture prototype. New captures receive a canonical UUID
directory, Images/Checkpoints subdirectories and a versioned ownership marker.
Creation refuses an existing destination. No existing capture is overwritten,
moved or automatically migrated.

The internal root and new capture directories are explicitly excluded from
backup using Apple's
[`isExcludedFromBackup`](https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup).
The flag is also applied to framework-created files before returning a successful
capture. Success also requires a nonempty regular model file. These internal
originals are not exported user documents; ordinary
document operations can reset this flag, so it is reapplied at completion.
This change does not remove a historical backup or prove real iCloud/device
transfer behavior.

On iOS, newly prepared directories and every completed output also receive
[`FileProtectionType.complete`](https://developer.apple.com/documentation/foundation/fileprotectiontype/complete).
Apple defines this as device-lock protection. Historical files are not rewritten
by initialization. This is OS file protection for guest originals; it is **not**
the missing account-bound encrypted-workspace implementation or its key/lease
authority. Protected workspace and encrypted capture parity remain unfinished.

## Deletion and cancellation

Delete/clear use the same checked store as capture creation and completion.
They refuse while a scan is active. Roots must remain at their original
canonical location; symlinks, hard-linked files and unsupported entry types
are refused before policy mutation or deletion. Validation bounds each capture
to 20,000 entries and 16 nested levels.

Clear deletes only recognized capture directories. New captures require their
exact ownership marker. Historical captures are recognized only by the old
Images/Checkpoints layout with an optional Model.usdz and no other top-level
entries. Unknown files, UUID directories, invalid markers and linked trees
remain untouched. Validation happens before deletion; filesystem failure can
still leave a partially completed clear. This is not secure erasure or a way
to delete historical cloud backups.

Only one scan may open at a time, from an active scene with no other presented
controller. Backgrounding, protected-data loss or unexpected dismissal cancels
the scan. Cancellation also requests photogrammetry cancellation. Reconstruction
checks cancellation before starting and on every output, and the single-shot
completion refuses a late success. Cleanup is restricted to the owned scan
folder and is best effort; interrupted framework writers or deletion failures
can leave an incomplete owned capture. Device testing must establish actual
framework termination and storage behavior.

## Verification

Mac CI compiles and executes the production filesystem helper with synthetic
directories. Checks cover output backup flags, no-overwrite creation, invalid
IDs, missing captures, unknown-document preservation, legacy recognition,
malformed ownership, symlinks, hard links, nested links, clear and a replaced
root. The fixture owns its unique temporary tree and preserves outside-target
sentinels during all operations. These checks do not run the iOS protection branch.

The iOS app must additionally compile for simulator Debug and unsigned device
Release. On hardware, test camera permission/refusal, background/lock during
capture and reconstruction, cancel/dismiss/retry, double starts, cleanup failure,
actual backup/transfer exclusions and locked-device access to completed files.
Neither pure filesystem tests nor compilation prove those runtime properties,
scan accuracy, physical packing acceptance or production signing.
