# iOS encrypted pending-file core

`PackingPendingBackupStore` provides bounded encrypted handoff storage. It is
compiled into the iOS target but has no document/photo plugin or web capability
enabled yet. System picker coordination, export destination handling, runtime
authority sharing, startup orphan handling and photo/draft orchestration remain
required before enabling iOS file/photo controls.

Only native-created ticket files are addressed. The caller supplies an app-private
directory. The store checks canonical paths, its original root inode, exact file
inodes, regular-file type and single links. New encrypted files use exclusive,
no-follow creation, owner-only mode, iOS Complete file protection and backup
exclusion. No plaintext app-cache file is created. Untracked files are preserved;
the core itself does not guess ownership of abandoned files. The provider runtime
uses a separately marked, flat private cache and removes only recognized old
PPB1 ticket files before creating its process store. Unknown files, links and
unmarked directories are preserved.

Each entry has a random 256-bit key held only in memory. Authenticated context
binds purpose, ticket, account/workspace or guest scope, chunk index and terminal
marker. Plaintext chunks are at most 64 KiB. Short reads are aggregated, total
size is bounded (80 MiB backup, the existing Android draft budget of 68 MiB minus
8 framing bytes, and 12 MiB reference image), and no more
than two entries are retained per store. A final authenticated empty record and
EOF check reject truncation, reordering and appended bytes. A full verification
pass precedes any consumer output; the second pass also authenticates each chunk.
Provider write failures remove only the destination inode just created by this
export. A substituted pathname is preserved.

The synchronous core has one lock protecting all mutable fields and no suspension
points. In-flight stages reserve their ticket slots. Re-entrant close/discard
callbacks cannot publish a later ticket or emit further chunks after returning.
The provider integration keeps UIKit/Capacitor replies on the main actor and
performs provider IO on a serial worker. Callbacks must not acquire other
store/authority locks in reverse order.

Tickets expire at ten minutes without renewal, with a continuous native clock
that includes system sleep. Invalid/backward clocks refuse reads and erase owned
entry keys. Discard and close erase the owned key array before removing known
files. Erasure is best effort: Swift/Foundation/CryptoKit may make memory copies.
Keys and entry maps are never persisted, so a new store/process cannot read an
old ticket. A worker timer expires live tickets; startup cleanup covers recognized
ciphertext from a previous process without recovering its keys.

Import selection callbacks stage against the original scope after a provider
dialog locks the workspace. Later plaintext reads require a fresh live lease for
that same account/workspace; guest and other-account reads are refused. Explicit
export is authorized before opening the picker and use only its frozen
encrypted payload afterward. The plugin resolves the existing scan plugin
authority, including its validated protected namespace. It does not independently
prove server identity.

Mac checks exercise actual CryptoKit encryption, multi-chunk/short-read recovery,
complete authentication before output, final-tag/truncation/reorder/append
refusal, size and entry limits, reader failure rollback, scope/lease rebinding,
restart key loss, expiry, link refusal and unknown preservation. Thread Sanitizer
checks also contend stages/reads and exercise nested staging and callback close.
The [API privacy declarations](IOS-API-PRIVACY.md) cover the app's current native
uses and are checked in both built app bundles. Thread Sanitizer
and unsigned compilation are checks of this core; provider, lifecycle, actual
device memory/latency, accessibility and operator acceptance remain unverified.

Apple documents [directory selection and coordinated security-scoped access](https://developer.apple.com/documentation/uikit/providing-access-to-directories)
for direct provider access. A selected export folder can avoid plaintext app-cache
staging. The plugin uses an open-in-place file picker for import and a folder
picker for export, coordinates provider access, releases security scope, and
separates cancellation from success. Export filenames are native-generated UUIDs
and never overwrite an existing backup. A saved reply confirms local provider IO,
not remote cloud synchronization. No URL, bookmark, key or filesystem path is
returned to JavaScript. Photo selection remains separately gated until its own
native implementation exists. The native lifetime clock uses
[mach_continuous_time](https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time),
which continues during sleep.

The provider IO checks cover multi-chunk import/export, UTF-8 payload preservation,
existing-backup preservation, mid-write failure cleanup, replacement-inode
preservation, wrong scopes, corrupt ciphertext, empty/oversized/nonregular/link
inputs and startup ownership boundaries. These run on macOS with Thread Sanitizer.
The UIKit plugin is compiled for simulator and unsigned device SDKs; system-picker
UI, real iCloud/third-party providers, lifecycle and physical-device acceptance
remain unverified.
