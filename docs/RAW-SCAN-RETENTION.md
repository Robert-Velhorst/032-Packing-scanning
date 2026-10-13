# Original raw scan retention

The Android app can automatically remove original captured point clouds while retaining the dimensions and explicitly adopted item shapes or bag cavities used by a packing plan. This implements the configurable raw-data retention requirement in the supplied product brief. It is independent of reference-photo retention, manual source deletion, library deletion and trip deletion.

## Traveller workflow

1. Open **Settings → Original raw scans** in the unlocked workspace.
2. Keep originals indefinitely, or choose **7, 30 or 90 days after capture**. Keeping them is the default, including older backups with no policy.
3. Acknowledge that the policy also applies to existing captures that have reached that age, then select **Apply raw scan deletion policy**. The policy must be saved successfully before automatic cleanup begins.
4. Choose **Keep until I remove them** and apply **Stop future automatic scan deletion** to stop future cleanup. This cannot recover sources already removed.

Age starts at the native completed-capture date and uses the device clock. It is not calculated from a last preview, adoption, backup or WebView date. The original native source becomes unavailable for preview and reconstruction after removal. The editor explains this and keeps the saved dimensions, source details and adopted planning geometry. A new scan is needed to reconstruct again. Packing backups never contain original native point clouds and cannot recover them.

Checks run only while the current workspace is unlocked and the app is visible, including offline and on reopening. New checks wait for record saving and for editors, scans, pending photo/backup drafts and file handoffs to finish. An already started native batch can finish. There is no closed-app or locked-workspace background deletion service. While the app is closed or locked, an elapsed retention period does not guarantee immediate removal. If that guarantee is required, this implementation is insufficient.

## Scope and retained records

The native cleanup uses the current live capture authority. It never accepts a workspace path, account key, list of source IDs or source timestamps from the web interface, and never falls back to guest storage. A protected workspace checks authenticated encrypted capture provenance with that workspace/account authority before removal. The source metadata must establish an Android completed capture and a valid non-future date.

Only `points.ply` (guest) or `points.ply.sealed` (protected), and the corresponding unfinished point-file suffix, are eligible. The exact native capture metadata stays saved, encrypted in a protected workspace. Dates, dimensions, quality, adopted solid/cavity cells, source hashes and calibration provenance remain available as metadata or planning records. Library records, reference photos, bag records, forms, trips, completion and confirmed positions are preserved.

Invalid, incomplete, future-dated or unauthenticated metadata is kept for manual review. Unsafe source locations and unconfirmed removals fail closed. Cleanup does not renew the protected workspace's idle-unlock period. Explicit manual source deletion retains its established behavior of removing the complete capture, including metadata.

Each native batch processes at most 100 sorted capture folders and returns a continuation cursor. The app processes at most five batches per pass, then continues on subsequent visible checks, normally every minute. Directory inventory is still read before choosing the batch; this is a bounded processing count, not a constant-memory guarantee for an arbitrarily large capture library. A device clock change affects expiry; no server clock is consulted.

A confirmation distinguishes sources actually removed in that pass from sources already absent. Repeating a check confirms source absence without claiming a second removal. Retained native metadata allows the web record to recover its availability marker if the app closes between native removal and saving that marker. Cleanup retries failures while the workspace remains available. It cannot securely erase storage hardware, filesystem snapshots, OS/provider copies or previously exported material. No raw bytes are uploaded by this feature.

## Availability and acceptance

The production cleanup plugin is implemented for Android. Browser, iOS and older native installations disclose unavailable cleanup. They cannot claim to remove Android source files. They can stop an inherited policy; enabling it requires a supported native implementation.

Current software evidence and artifact verification are recorded in [Android build verification](QA-ANDROID-BUILD.md). Synthetic Java tests exercise the actual encrypted capture store and authority rules; browser checks use a simulated Capacitor boundary with the actual Java store, encrypted workspace and local account transport. These checks do not establish Android OS lifecycle, camera execution, physical scan accuracy, iOS support, clock accuracy or secure hardware erasure.

Before physical acceptance, use synthetic captures on supported phones to check expiry boundaries, app pause/lock/process loss, idle expiry, pending editors and file handoffs, cancellation, offline reopening, device clock changes, storage errors and large libraries. Confirm both that expired point bytes are gone and that the exact retained planning records and other workspaces remain usable. Do not use personal scans as an initial test fixture.
