# iOS in-memory LiDAR source

`PackingDepthSource` is the native input path for the encrypted point store. It
retains the original protected authority and only publishes through a store with
that exact selection lease. It never writes camera images or plaintext source
files. The existing guest Object Capture path is unchanged.

The source consumes actual CoreVideo depth/confidence buffers with camera
intrinsics, image resolution, rigid camera pose and fresh frame timestamps.
`PackingARDepthReceiver` adapts ARKit `sceneDepth` frames and cancels on session
interruption, failure or loss of normal tracking after anchoring. Depth format,
confidence format, dimensions, row strides, buffer sizes and calibration are
validated before reading. Padding is excluded. Camera intrinsics scale to depth
resolution; image-down/depth-forward coordinates convert to ARKit's right-handed
camera frame before the camera pose transforms points into the fixed capture frame.

Only ARKit's categorical **high** confidence is retained. Its PLY confidence value
of 1 encodes eligibility; it is not a calibrated probability, sensor error bound
or a claim of 100% accuracy. No depth interpolation or upsampling is performed.
See Apple's [depth example](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth)
and [confidence map contract](https://developer.apple.com/documentation/arkit/ardepthdata/confidencemap).

The first normal frame with valid central depth fixes the capture box at that
visible surface, using the starting camera orientation. This is not an estimate
of the object's center. Samples use the central 60% of the depth image, 0.15–2 m
depth, caller-selected half extent 0.05–1.5 m, 5 mm voxels and at most 60,000 points.
The source stops after 120 seconds of frame time. Repeated timestamps contribute
nothing. The finish gate requires 300 retained points, six contributing frames,
three viewpoints separated by at least 25 degrees, 60 degrees of viewpoint
spread and no more than 2% of retained points near the box edge. These are input
heuristics, not proof of object isolation, complete surfaces, dimensions or fit.

Publication serializes the bounded points in memory, validates the PLY through
`PackingPointCapture` and invokes encrypted staging/publication with native-owned
capture ID and completion time. A different live selection cannot redirect the
source, even with the same account/workspace/key. Successful publication ends
the source and clears its owned arrays. Cancellation and failed authority checks
end the source; array overwrites are best effort, not a secure-memory guarantee.
Incomplete captures can continue collecting. No source operation renews idle time.

Mac CI uses real padded CoreVideo buffers, production projection/voxel code,
CryptoKit and a unique synthetic filesystem tree. It checks publication and
read-back, identity binding, malformed buffers/poses, unsupported confidence and
depth values, repeated frames, tracking loss, cancellation, duration and expiry.
The iOS targets compile the actual ARKit delegate for simulator and device.

The [capture screen](IOS-DEPTH-SCREEN.md) and [bridge](IOS-CAPTURE-BRIDGE.md) connect
permission/device checks, visible bounds and point review, cancellation, workspace
selection and validated result/preview formatting to this source. Reconstruction
remains unimplemented. Physical LiDAR
projection, tracking, coverage, interruption, memory and storage behavior remain
unverified. Compiled integration is not device or full-product acceptance.
