# Protected iOS depth capture screen

`PackingDepthViewController` supplies the camera and review screen around
`PackingDepthSource`. A native bridge caller must supply the original live
protected access, its matching encrypted store and a completion handler. The
controller does not select or unlock a workspace on the caller's behalf.

Start requires a foreground scene, protected-data availability, a live authority,
LiDAR scene-depth support and Camera authorization. Permission is requested only
after pressing Start. Denial has a visible message and does not run a session.
Permission and save callbacks carry generation tokens; closing or restarting
invalidates old callbacks. The screen returns completion at most once.

The RealityKit camera view shows retained surface points and the actual capture
box, whose origin and orientation come from the depth source. The user chooses
60 cm, 1.2 m or 2 m box sides before starting. Size cannot change during collection.
Point/count/viewpoint feedback and the source's finish gates control Review.
Collection has an additional two-minute native uptime limit even if no usable
depth frames arrive. Neither the UI timer nor source reads renews workspace idle.

Review freezes the source under its authority/collection locks before pausing
the camera. Queued frames cannot change the reviewed source. A separate non-AR
RealityKit view shows at most 2,000 representative retained points, with bounded
pan/pinch controls and VoiceOver rotation/reset actions. The preview consists of
small surface markers, not a filled occupied volume or a fit guarantee. It does
not include the captured camera image. Restart discards the in-memory source.

Save runs validated encrypted publication off the main thread, then rechecks
foreground/protected-data/authority and the callback token. A late success after
cancel is not delivered; cleanup attempts deletion only of that newly published
capture through its original store. Revoked authority or a cleanup failure can
leave an encrypted capture for later recovery, rather than deleting other data.
Backgrounding, protected-data loss, foreground loss during capture/review/save,
dismissal, source failure or expiry stop collection, hide camera/review and return
failure. The permission dialog's temporary inactive state does not itself cancel
the pending request; real backgrounding and data loss do.

Mac CI exercises the production flow-token policy and real CoreVideo source
freezing/preview/publication cases. Xcode compiles the actual UIKit/RealityKit
controller for simulator Debug and unsigned device Release. These are not camera,
GPU, permission-dialog, accessibility or touch acceptance tests.

The controller is not yet called from `PackingScanPlugin` or exposed to web UI.
The workspace handshake, shared result contract, saved quality metadata,
dimensions and reconstruction remain required before enabling protected scanning.
No screenshot or physical-device execution is claimed. Device tests must cover
orientation/iPad layout, large text/VoiceOver, review gestures, camera denial,
interruptions during permission/review/save, queued-frame races, memory and storage
limits, missing/poor depth and physical measurement/fit benchmarks.
