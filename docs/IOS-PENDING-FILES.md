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
this component does not guess ownership of abandoned process files at startup.

Each entry has a random 256-bit key held only in memory. Authenticated context
binds purpose, ticket, account/workspace or guest scope, chunk index and terminal
marker. Plaintext chunks are at most 64 KiB. Short reads are aggregated, total
size is bounded (80 MiB backup, 256 KiB draft, 12 MiB reference image), and no more
than two entries are retained per store. A final authenticated empty record and
EOF check reject truncation, reordering and appended bytes. A full verification
pass precedes any consumer output; the second pass also authenticates each chunk.
Provider write failures still require exclusive-destination cleanup in the future
UI integration.

The synchronous core has one lock protecting all mutable fields and no suspension
points. In-flight stages reserve their ticket slots. Re-entrant close/discard
callbacks cannot publish a later ticket or emit further chunks after returning.
Production integration must keep UIKit/Capacitor replies on the main actor and
perform provider I/O on its explicitly chosen worker; callbacks must not acquire
other store/authority locks in reverse order.

Tickets expire at ten minutes without renewal, with a continuous native clock
that includes system sleep. Invalid/backward clocks refuse reads and erase owned
entry keys. Discard and close erase the owned key array before removing known
files. Erasure is best effort: Swift/Foundation/CryptoKit may make memory copies.
Keys and entry maps are never persisted, so a new store/process cannot read an
old ticket. Encrypted orphan cleanup is deliberately not supplied here.

Import selection callbacks will stage against the original scope after a provider
dialog locks the workspace. Later plaintext reads require a fresh live lease for
that same account/workspace; guest and other-account reads are refused. Explicit
export will be authorized before opening the picker and use only its frozen
encrypted payload afterward. This core does not itself implement those UIKit
callbacks or independently prove server identity.

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
staging; the forthcoming plugin must handle denied access, cancellation, exclusive
creation, partial writes and released scope. The native lifetime clock uses
[mach_continuous_time](https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time),
which continues during sleep.
