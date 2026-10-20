import CoreVideo
import Foundation
import simd

enum PackingDepthSourceError: Error { case invalidFrame, stopped, incomplete, wrongWorkspace }

/** In-memory LiDAR source. Serialized by its lock and the original revocable authority. */
final class PackingDepthSource {
    struct Status {
        let pointCount: Int
        let acceptedFrames: Int
        let viewCount: Int
        let capped: Bool
        let readinessIssue: String?
    }
    struct Preview { let points: [SIMD3<Float>]; let captureToWorld: simd_float4x4? }
    private struct Cell: Hashable { let x: Int; let y: Int; let z: Int }
    private let access: PackingCaptureAuthority.Access
    private let halfExtent: Float
    private let lock = NSLock()
    private var stopped = false
    private var frozen = false
    private var worldToCapture: simd_float4x4?
    private var lastTimestamp: TimeInterval?
    private var firstTimestamp: TimeInterval?
    private var points: [SIMD4<Float>] = []
    private var cells: [Cell: Int] = [:]
    private var directions: [SIMD3<Float>] = []
    private var frames = 0
    private var edgePoints = 0
    private var capped = false

    init(access: PackingCaptureAuthority.Access, halfExtent: Float) throws {
        try access.check()
        guard access.workspaceID != nil, halfExtent.isFinite, (0.05...1.5).contains(halfExtent) else {
            throw PackingDepthSourceError.invalidFrame
        }
        self.access = access; self.halfExtent = halfExtent
    }
    deinit { erase() }
    private func erase() {
        for index in points.indices { points[index] = .zero }
        points.removeAll(); cells.removeAll(); directions.removeAll()
        worldToCapture = nil; lastTimestamp = nil; firstTimestamp = nil; frames = 0; edgePoints = 0; capped = false
    }
    func cancel() { lock.lock(); defer { lock.unlock() }; stopped = true; erase() }
    func trackingUnavailable() {
        lock.lock(); defer { lock.unlock() }
        if worldToCapture != nil && !frozen { stopped = true; erase() }
    }

    private static func rigid(_ value: simd_float4x4) -> Bool {
        for column in 0..<4 { for row in 0..<4 { if !value[column][row].isFinite { return false } } }
        guard abs(value[0].w) < 0.0001, abs(value[1].w) < 0.0001, abs(value[2].w) < 0.0001,
              abs(value[3].w - 1) < 0.0001 else { return false }
        let rotation = simd_float3x3(columns: (SIMD3(value[0].x, value[0].y, value[0].z),
            SIMD3(value[1].x, value[1].y, value[1].z), SIMD3(value[2].x, value[2].y, value[2].z)))
        for a in 0..<3 { for b in 0..<3 {
            if abs(simd_dot(rotation[a], rotation[b]) - (a == b ? 1 : 0)) > 0.002 { return false }
        } }
        return abs(simd_determinant(rotation) - 1) <= 0.002
            && max(max(abs(value[3].x), abs(value[3].y)), abs(value[3].z)) <= 1000
    }

    /** Returns false for repeated frames, non-normal tracking or unavailable central depth. */
    @discardableResult func ingest(depth: CVPixelBuffer, confidence: CVPixelBuffer,
        intrinsics: simd_float3x3, imageSize: SIMD2<Int>, cameraToWorld: simd_float4x4,
        timestamp: TimeInterval, trackingNormal: Bool) throws -> Bool {
        do {
            return try access.checked {
                lock.lock(); defer { lock.unlock() }
                guard !stopped else { throw PackingDepthSourceError.stopped }
                guard !frozen else { return false }
                guard trackingNormal else {
                    if worldToCapture != nil { throw PackingDepthSourceError.stopped }
                    return false
                }
                guard timestamp.isFinite, timestamp >= 0, Self.rigid(cameraToWorld),
                      imageSize.x > 0, imageSize.y > 0, imageSize.x <= 16384, imageSize.y <= 16384 else {
                    throw PackingDepthSourceError.invalidFrame
                }
                if let lastTimestamp, timestamp <= lastTimestamp { return false }
                if let firstTimestamp, timestamp - firstTimestamp > 120 { throw PackingDepthSourceError.stopped }
                let width = CVPixelBufferGetWidth(depth), height = CVPixelBufferGetHeight(depth)
                guard width >= 8, height >= 8, width <= 2048, height <= 2048, width * height <= 1_048_576,
                      !CVPixelBufferIsPlanar(depth), !CVPixelBufferIsPlanar(confidence),
                      CVPixelBufferGetWidth(confidence) == width, CVPixelBufferGetHeight(confidence) == height,
                      CVPixelBufferGetPixelFormatType(depth) == kCVPixelFormatType_DepthFloat32,
                      CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8 else {
                    throw PackingDepthSourceError.invalidFrame
                }
                for column in 0..<3 { for row in 0..<3 {
                    guard intrinsics[column][row].isFinite else { throw PackingDepthSourceError.invalidFrame }
                } }
                guard intrinsics[0].x > 0, intrinsics[1].y > 0,
                      intrinsics[2].x >= 0, intrinsics[2].x < Float(imageSize.x),
                      intrinsics[2].y >= 0, intrinsics[2].y < Float(imageSize.y),
                      intrinsics[0].y == 0, intrinsics[0].z == 0, intrinsics[1].x == 0,
                      intrinsics[1].z == 0, intrinsics[2].z == 1 else { throw PackingDepthSourceError.invalidFrame }
                let depthStride = CVPixelBufferGetBytesPerRow(depth), confidenceStride = CVPixelBufferGetBytesPerRow(confidence)
                guard depthStride >= width * 4, confidenceStride >= width,
                      depthStride <= 32768, confidenceStride <= 32768,
                      CVPixelBufferGetDataSize(depth) >= depthStride * height,
                      CVPixelBufferGetDataSize(confidence) >= confidenceStride * height else { throw PackingDepthSourceError.invalidFrame }
                guard CVPixelBufferLockBaseAddress(depth, .readOnly) == kCVReturnSuccess else { throw PackingDepthSourceError.invalidFrame }
                defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
                guard CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess else { throw PackingDepthSourceError.invalidFrame }
                defer { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
                guard let depthBase = CVPixelBufferGetBaseAddress(depth), let confidenceBase = CVPixelBufferGetBaseAddress(confidence) else {
                    throw PackingDepthSourceError.invalidFrame
                }
                let scaleX = Float(width) / Float(imageSize.x), scaleY = Float(height) / Float(imageSize.y)
                let fx = intrinsics[0].x * scaleX, fy = intrinsics[1].y * scaleY
                let cx = intrinsics[2].x * scaleX, cy = intrinsics[2].y * scaleY
                func cameraPoint(_ x: Int, _ y: Int) -> SIMD4<Float>? {
                    // ARKit confidence is categorical. Keep only .high (2); PLY 1 is an eligibility flag, not a probability.
                    guard confidenceBase.load(fromByteOffset: y * confidenceStride + x, as: UInt8.self) == 2 else { return nil }
                    let metres = depthBase.loadUnaligned(fromByteOffset: y * depthStride + x * 4, as: Float.self)
                    guard metres.isFinite, metres >= 0.15, metres <= 2 else { return nil }
                    return SIMD4((Float(x) - cx) * metres / fx, -(Float(y) - cy) * metres / fy, -metres, 1)
                }
                if worldToCapture == nil {
                    guard let center = cameraPoint(width / 2, height / 2) else { return false }
                    var captureToWorld = cameraToWorld; captureToWorld[3] = cameraToWorld * center
                    worldToCapture = simd_inverse(captureToWorld)
                }
                guard let worldToCapture else { throw PackingDepthSourceError.invalidFrame }
                let cameraToCapture = worldToCapture * cameraToWorld
                lastTimestamp = timestamp; if firstTimestamp == nil { firstTimestamp = timestamp }
                var accepted = 0
                // Bound CPU/memory use even if a provider supplies larger depth maps.
                let stride = max(2, Int(ceil(sqrt(Double(width * height) / 20000))))
                for y in Swift.stride(from: height / 5, to: height * 4 / 5, by: stride) {
                    for x in Swift.stride(from: width / 5, to: width * 4 / 5, by: stride) {
                        guard let camera = cameraPoint(x, y) else { continue }
                        let p = cameraToCapture * camera
                        guard p.x.isFinite, p.y.isFinite, p.z.isFinite,
                              max(max(abs(p.x), abs(p.y)), abs(p.z)) <= halfExtent else { continue }
                        let cell = Cell(x: Int(floor(p.x / 0.005)), y: Int(floor(p.y / 0.005)), z: Int(floor(p.z / 0.005)))
                        if cells[cell] == nil {
                            if points.count >= 60_000 { capped = true; continue }
                            cells[cell] = points.count; points.append(SIMD4(p.x, p.y, p.z, 1))
                            if max(max(abs(p.x), abs(p.y)), abs(p.z)) > halfExtent - 0.015 { edgePoints += 1 }
                        }
                        accepted += 1
                    }
                }
                if accepted >= 30 {
                    frames += 1
                    let position = SIMD3(cameraToCapture[3].x, cameraToCapture[3].y, cameraToCapture[3].z)
                    if simd_length(position) >= 0.05 {
                        let direction = simd_normalize(position)
                        if !directions.contains(where: { simd_dot($0, direction) > cos(Float.pi * 25 / 180) }) { directions.append(direction) }
                    }
                }
                return true
            }
        } catch { cancel(); throw error }
    }

    private func readiness() -> String? {
        if points.count < 300 || frames < 6 || directions.count < 3 { return "Move slowly around the stationary object from at least three angles." }
        var spread: Float = 0
        for a in directions { for b in directions { spread = max(spread, acos(min(1, max(-1, simd_dot(a, b))))) } }
        if spread < Float.pi / 3 { return "Move farther around the object before finishing." }
        if edgePoints > points.count / 50 { return "The source reaches the capture-area edge. Restart with a larger area or remove neighbouring objects." }
        return nil
    }
    func status() throws -> Status {
        do { return try access.checked {
            lock.lock(); defer { lock.unlock() }
            guard !stopped else { throw PackingDepthSourceError.stopped }
            return Status(pointCount: points.count, acceptedFrames: frames, viewCount: directions.count, capped: capped, readinessIssue: readiness())
        } } catch { cancel(); throw error }
    }
    func preview() throws -> Preview {
        do { return try access.checked {
            lock.lock(); defer { lock.unlock() }
            guard !stopped else { throw PackingDepthSourceError.stopped }
            let step = max(1, Int(ceil(Double(points.count) / 2000)))
            return Preview(points: Swift.stride(from: 0, to: points.count, by: step).map {
                SIMD3(points[$0].x, points[$0].y, points[$0].z)
            }, captureToWorld: worldToCapture.map { simd_inverse($0) })
        } } catch { cancel(); throw error }
    }
    func freezeForReview() throws {
        try access.checked {
            lock.lock(); defer { lock.unlock() }
            guard !stopped else { throw PackingDepthSourceError.stopped }
            guard readiness() == nil else { throw PackingDepthSourceError.incomplete }
            frozen = true
        }
    }
    /** Publish only into the exact original workspace, with no plaintext file staging. */
    func finish(target: PackingPointCapture.Target, store: PackingEncryptedCaptureStore) throws -> PackingPointCapture {
        guard store.boundLease == access.lease else { throw PackingDepthSourceError.wrongWorkspace }
        do { return try access.checked {
            lock.lock(); defer { lock.unlock() }
            guard !stopped else { throw PackingDepthSourceError.stopped }
            guard frozen, readiness() == nil else { throw PackingDepthSourceError.incomplete }
            var ply = Data(("ply\nformat binary_little_endian 1.0\ncomment units metres; capture-local right-handed camera frame\nelement vertex \(points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n").utf8)
            for point in points { for axis in 0..<4 {
                var bits = point[axis].bitPattern.littleEndian
                withUnsafeBytes(of: &bits) { ply.append(contentsOf: $0) }
            } }
            let capture = try store.savePointCapture(target: target, points: ply)
            stopped = true; erase()
            return capture
        } } catch PackingDepthSourceError.incomplete { throw PackingDepthSourceError.incomplete }
        catch { cancel(); throw error }
    }
}

#if os(iOS)
import ARKit

/** Assign to an ARSession running .sceneDepth. Session ownership/permission/UI remain with its controller. */
final class PackingARDepthReceiver: NSObject, ARSessionDelegate {
    let source: PackingDepthSource
    init(source: PackingDepthSource) { self.source = source }
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard let depth = frame.sceneDepth, let confidence = depth.confidenceMap else { return }
        let normal: Bool
        if case .normal = frame.camera.trackingState { normal = true } else { normal = false }
        do { try source.ingest(depth: depth.depthMap, confidence: confidence,
            intrinsics: frame.camera.intrinsics,
            imageSize: SIMD2(Int(frame.camera.imageResolution.width), Int(frame.camera.imageResolution.height)),
            cameraToWorld: frame.camera.transform, timestamp: frame.timestamp, trackingNormal: normal) }
        catch { source.cancel() }
    }
    // Only the controller owns session start/stop. An old queued callback must never pause a restarted session.
    func sessionWasInterrupted(_ session: ARSession) { source.cancel() }
    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        if case .normal = camera.trackingState { return }
        source.trackingUnavailable()
    }
    func session(_ session: ARSession, didFailWithError error: Error) { source.cancel() }
}
#endif
