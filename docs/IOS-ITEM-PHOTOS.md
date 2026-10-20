# iOS reference-photo preparation and encrypted item drafts

`PackingReferencePhoto` and `PackingPendingItemPhotoStore` implement the native
processing and storage path. `PackingPhotoPlugin` connects them to library and
camera UI and the existing native workspace authority. The plugin is registered,
but the shared iOS capability gate stays disabled until the new native tests and
UIKit builds pass. Physical-device/provider acceptance remains a release gate.

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
size, link, inode and complete-stream authentication checks. The pending store creates only ciphertext files. The original account/workspace
or guest scope is frozen before
the provider UI; a fresh live matching lease is required for plaintext reads.

Cancellation makes the original encrypted draft resumable without a photo.
Completion publishes a new encrypted bundle before discarding the old draft.
Failed preparation leaves the original draft available for cancellation/recovery.
Replay of a cancellation after completion returns the same committed result;
duplicate completion is refused. A lock serializes mutable maps and transitions;
plaintext reads acquire the authority before the store, matching existing lock
order. Completion cannot renew the ten-minute lifetime measured from the first
draft. Backward/invalid native clocks refuse access and erase owned entry keys.
Restart loses all process keys and ticket metadata. The process runtime reuses one store across bridge reloads, expires it every minute
and uses its own marked private cache for known-ciphertext startup cleanup.
Backup and photo cache roots/markers are distinct; unknown files remain intact.

The macOS checks exercise real ImageIO encode/decode, orientation/downsampling,
source metadata removal, animation-to-still conversion, malformed/oversized
source refusal, encrypted cancellation/completion, same-workspace reopening,
wrong-account/guest refusal, duplicate callbacks, concurrent cancel/complete,
original expiry and restart key loss under Thread Sanitizer. An actual Swift
handoff is checked by the TypeScript editor-draft validator; incomplete fields
and imperial values survive without becoming a saved item.

## UIKit and provider path

The plugin freezes the original authorized draft target before staging, removes
its draft argument from the retained Capacitor call, and returns only a receipt
after selection/cancellation. If the workspace locks while preparing or presenting,
the encrypted draft remains resumable. MainActor owns calls, picker identities
and UI; workers receive scoped values/bytes. A one-operation guard and shared
queue budget bound pending work. Original operation IDs reject stale callbacks,
and ten-minute selection deadlines cancel provider progress. Read replies check
the original live lease and foreground state before and after JSON conversion.

The Photos picker shows images only and requests one selection. It uses a default
configuration without photo-library identifiers or broad photo-library permission.
NSItemProvider makes a temporary source copy and deletes it when its completion
handler returns. This integration reads only during that callback, bounds the
regular single-link source stream, does not retain its URL, and creates no extra
plaintext staging file. The system/provider controls the transient source copy;
it is not covered by the app's ciphertext-cache guarantee. A selected iCloud
asset may need a system-managed download. No app server upload is performed.

Camera selection asks for camera permission, then uses a full-screen AVFoundation
preview/shutter/cancel controller. JPEG bytes go directly to memory and the
normalizer. No camera-output/gallery file is created by this controller. On iOS
16+ it chooses a supported output dimension at most 2048 pixels when available,
otherwise the smallest supported size within 4096 pixels and 16 megapixels;
unavailable formats preserve the draft. iOS 15 uses standard photo delivery.
Capture has a 90-second deadline, and interruptions/background/protected-data
loss close the camera and preserve the draft. Session operations stay on their
own queue. Preview and JPEG orientation follow the window orientation. An opaque
app-window cover is shown while inactive; actual recents/snapshot behavior still
requires device testing and does not prevent user screenshots or screen recording.

Automated core tests and unsigned compilation do not establish real library/camera
UI, permission prompts, focus/framing/rotation, capture resolution on each device,
real-device memory/latency, interruption/resource release, accessibility, HEIC/cloud
provider acceptance or successful end-to-end item saving. Those remain explicit
release gates.

Apple documents [thumbnail creation](https://developer.apple.com/documentation/imageio/cgimagesourcecreatethumbnailatindex(_:_:_:))
and [adding decoded images and selected properties to a destination](https://developer.apple.com/documentation/imageio/cgimagedestinationaddimage(_:_:_:)).

Apple documents the [Photos picker](https://developer.apple.com/documentation/photokit/selecting-photos-and-videos-in-ios) and [item-provider temporary file lifetime](https://developer.apple.com/documentation/foundation/nsitemprovider/loadfilerepresentation(fortypeidentifier:completionhandler:)).
