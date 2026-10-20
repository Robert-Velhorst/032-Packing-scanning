# iOS reference-photo preparation and encrypted item drafts

`PackingReferencePhoto` and `PackingPendingItemPhotoStore` implement the native
processing and storage path. They are compiled into the app, but this increment
does not register a `PackingPhoto` plugin or enable iOS photo controls. Camera and
library UI, runtime ownership/expiry, callback orchestration and device acceptance
remain required before enabling that capability.

The normalizer accepts an ImageIO image source of at most 12 MiB and 100 million
pixels. It decodes only the first frame into an orientation-correct thumbnail of
at most 2048 pixels on its longest side, then writes a fresh JPEG at quality 0.85.
It adds decoded pixels rather than copying source images/properties. EXIF/GPS,
source comments, animation and other source metadata do not accompany the new
reference image. A prepared value can only be created by this normalizer. ImageIO
format/HEIC support still depends on the actual platform/provider.

The handoff stores one incomplete editor draft, independently of saved packing
records. Its authenticated PIP1 bundle has the existing Android contract: an
eight-byte magic/length header, UTF-8 draft of at most 68 MiB minus eight bytes,
and an optional normalized JPEG of at most 12 MiB. The encrypted outer stream
uses a separate `itemPhoto` purpose, process-only keys and the pending core's
size, link, inode and complete-stream authentication checks. No plaintext cache
file is created. The original account/workspace or guest scope is frozen before
the provider UI; a fresh live matching lease is required for plaintext reads.

Cancellation makes the original encrypted draft resumable without a photo.
Completion publishes a new encrypted bundle before discarding the old draft.
Failed preparation leaves the original draft available for cancellation/recovery.
Replay of a cancellation after completion returns the same committed result;
duplicate completion is refused. A lock serializes mutable maps and transitions;
plaintext reads acquire the authority before the store, matching existing lock
order. Completion cannot renew the ten-minute lifetime measured from the first
draft. Backward/invalid native clocks refuse access and erase owned entry keys.
Restart loses all process keys and ticket metadata. UI/runtime integration must
reuse the same process store and supply marked private-cache startup cleanup.

The macOS checks exercise real ImageIO encode/decode, orientation/downsampling,
source metadata removal, animation-to-still conversion, malformed/oversized
source refusal, encrypted cancellation/completion, same-workspace reopening,
wrong-account/guest refusal, duplicate callbacks, concurrent cancel/complete,
original expiry and restart key loss under Thread Sanitizer. An actual Swift
handoff is checked by the TypeScript editor-draft validator; incomplete fields
and imperial values survive without becoming a saved item.

These checks and unsigned compilation do not establish camera/library UI,
permissions, real-device memory/latency, lifecycle, accessibility, HEIC/provider
acceptance or successful item saving. Those remain explicit release gates.

Apple documents [thumbnail creation](https://developer.apple.com/documentation/imageio/cgimagesourcecreatethumbnailatindex(_:_:_:))
and [adding decoded images and selected properties to a destination](https://developer.apple.com/documentation/imageio/cgimagedestinationaddimage(_:_:_:)).
