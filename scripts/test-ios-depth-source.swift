import CoreVideo
import Foundation
import simd

@main enum DepthSourceChecks {
    static func main() throws {
        func check(_ value: Bool) { precondition(value) }
        func refuses(_ label: String, _ work: () throws -> Void) {
            do { try work(); preconditionFailure(label) } catch {}
        }
        func buffer(_ format: OSType, width: Int = 192, height: Int = 144) -> CVPixelBuffer {
            var result: CVPixelBuffer?
            precondition(CVPixelBufferCreate(kCFAllocatorDefault, width, height, format,
                [kCVPixelBufferBytesPerRowAlignmentKey: 256] as CFDictionary, &result) == kCVReturnSuccess)
            return result!
        }
        let depth = buffer(kCVPixelFormatType_DepthFloat32), confidence = buffer(kCVPixelFormatType_OneComponent8)
        func fill(_ target: CVPixelBuffer, value: Float = 0.5, level: UInt8 = 2) {
            precondition(CVPixelBufferLockBaseAddress(target, []) == kCVReturnSuccess)
            defer { CVPixelBufferUnlockBaseAddress(target, []) }
            let base = CVPixelBufferGetBaseAddress(target)!, stride = CVPixelBufferGetBytesPerRow(target)
            for y in 0..<CVPixelBufferGetHeight(target) { for x in 0..<CVPixelBufferGetWidth(target) {
                if CVPixelBufferGetPixelFormatType(target) == kCVPixelFormatType_DepthFloat32 {
                    base.storeBytes(of: value, toByteOffset: y * stride + x * 4, as: Float.self)
                } else { base.storeBytes(of: level, toByteOffset: y * stride + x, as: UInt8.self) }
            } }
        }
        fill(depth); fill(confidence)
        let intrinsics = simd_float3x3(columns: (SIMD3(250, 0, 0), SIMD3(0, 250, 0), SIMD3(96, 72, 1)))
        func pose(_ degrees: Float) -> simd_float4x4 {
            var result = simd_float4x4(simd_quatf(angle: degrees * .pi / 180, axis: SIMD3(0, 1, 0)))
            result[3] = result * SIMD4(0, 0, 0.5, 1) + SIMD4(0, 0, -0.5, 0)
            return result
        }
        let manager = FileManager.default
        let parent = manager.temporaryDirectory.resolvingSymlinksInPath()
        let fixture = parent.appendingPathComponent("packing-ios-depth-" + UUID().uuidString, isDirectory: true)
        precondition(fixture.deletingLastPathComponent().path == parent.path)
        try manager.createDirectory(at: fixture, withIntermediateDirectories: false)
        defer { try? manager.removeItem(at: fixture) }
        var uptime: TimeInterval = 0
        let authority = PackingCaptureAuthority(clock: { uptime })
        defer { withExtendedLifetime(authority) {} }
        let workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", account = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        let access = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(0..<32))
        let store = try PackingEncryptedCaptureStore(directory: fixture, access: access)
        func source(_ extent: Float = 0.3) throws -> PackingDepthSource { try PackingDepthSource(access: access, halfExtent: extent) }
        func ingest(_ source: PackingDepthSource, timestamp: Double, degrees: Float = 0, normal: Bool = true) throws -> Bool {
            try source.ingest(depth: depth, confidence: confidence, intrinsics: intrinsics, imageSize: SIMD2(192, 144),
                cameraToWorld: pose(degrees), timestamp: timestamp, trackingNormal: normal)
        }
        let capture = try source()
        try check(!ingest(capture, timestamp: 0, normal: false))
        try check(ingest(capture, timestamp: 1))
        let firstCount = try capture.status().pointCount
        precondition(firstCount >= 300)
        try check(!ingest(capture, timestamp: 1))
        try check(capture.status().pointCount == firstCount)
        refuses("Incomplete capture must not publish") { _ = try capture.finish(target: .item, store: store) }
        for (offset, angle) in [Float(0), 35, 35, 70, 70].enumerated() {
            _ = try ingest(capture, timestamp: Double(offset + 2), degrees: angle)
        }
        let status = try capture.status()
        precondition(status.acceptedFrames == 6 && status.viewCount >= 3 && status.readinessIssue == nil)
        refuses("Unreviewed capture must not publish") { _ = try capture.finish(target: .item, store: store) }
        let preview = try capture.preview()
        precondition(!preview.points.isEmpty && preview.points.count <= 2000 && preview.captureToWorld != nil)
        try capture.freezeForReview()
        try check(!ingest(capture, timestamp: 7, degrees: 110))
        capture.trackingUnavailable() // Pausing the camera must not mutate a frozen review.
        try check(capture.status().pointCount == status.pointCount && capture.status().acceptedFrames == 6)
        // Another live authority with identical account/workspace/key is still a different selection.
        let other = PackingCaptureAuthority()
        defer { withExtendedLifetime(other) {} }
        let otherAccess = try other.openWorkspace(expectedRevision: other.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(0..<32))
        let otherStore = try PackingEncryptedCaptureStore(directory: fixture, access: otherAccess)
        refuses("Never redirect to another selection") { _ = try capture.finish(target: .item, store: otherStore) }
        let saved = try capture.finish(target: .item, store: store)
        try check(store.readPointCapture(captureID: saved.id).pointCount == status.pointCount)
        let headerEnd = saved.points.range(of: Data("end_header\n".utf8))!.upperBound
        func first(_ axis: Int) -> Float {
            saved.points.withUnsafeBytes { bytes in
                Float(bitPattern: UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: headerEnd + axis * 4, as: UInt32.self)))
            }
        }
        // Independently calculated pixel (38,28), 0.5 m depth, fx/fy 250, center (96,72).
        precondition(abs(first(0) + 0.116) < 0.00001 && abs(first(1) - 0.088) < 0.00001)
        precondition(abs(first(2)) < 0.00001 && first(3) == 1)
        let scaled = try source()
        var doubled = intrinsics; doubled[0].x *= 2; doubled[1].y *= 2; doubled[2].x *= 2; doubled[2].y *= 2
        for (offset, angle) in [Float(0), 0, 35, 35, 70, 70].enumerated() {
            _ = try scaled.ingest(depth: depth, confidence: confidence, intrinsics: doubled, imageSize: SIMD2(384, 288),
                cameraToWorld: pose(angle), timestamp: Double(offset + 1), trackingNormal: true)
        }
        try scaled.freezeForReview()
        let scaledSave = try scaled.finish(target: .item, store: store)
        precondition(scaledSave.sourceSHA256 == saved.sourceSHA256)
        refuses("Published capture cannot continue collecting") { _ = try ingest(capture, timestamp: 8) }
        let folder = store.root.appendingPathComponent(saved.id)
        for child in try manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
            precondition(child.pathExtension == "sealed")
            try check(Data(contentsOf: child).starts(with: Data("PSC1".utf8)))
        }
        // Pixel row padding is nonzero for this confidence buffer; only logical pixels are sampled.
        precondition(CVPixelBufferGetBytesPerRow(confidence) > CVPixelBufferGetWidth(confidence))
        for level in [UInt8(0), 1, 3, 255] {
            fill(confidence, level: level)
            let sparse = try source()
            try check(!ingest(sparse, timestamp: 1))
            try check(sparse.status().pointCount == 0)
        }
        fill(confidence)
        for invalid in [Float(0), 0.149, 2.001, .nan, .infinity] {
            fill(depth, value: invalid)
            let invalidSource = try source()
            try check(!ingest(invalidSource, timestamp: 1))
            try check(invalidSource.status().pointCount == 0)
        }
        fill(depth)
        let lost = try source(); _ = try ingest(lost, timestamp: 1)
        refuses("Tracking loss must end an anchored source") { _ = try ingest(lost, timestamp: 2, normal: false) }
        refuses("Relocalized source cannot resume") { _ = try ingest(lost, timestamp: 3) }
        let interrupted = try source(); _ = try ingest(interrupted, timestamp: 1); interrupted.cancel()
        refuses("Cancellation must prevent publication") { _ = try interrupted.finish(target: .item, store: store) }
        let timed = try source(); _ = try ingest(timed, timestamp: 1)
        refuses("Capture duration limit") { _ = try ingest(timed, timestamp: 122) }
        let malformed = try source()
        var badPose = matrix_identity_float4x4; badPose[0].x = 2
        refuses("Non-rigid camera pose") {
            _ = try malformed.ingest(depth: depth, confidence: confidence, intrinsics: intrinsics, imageSize: SIMD2(192, 144), cameraToWorld: badPose, timestamp: 1, trackingNormal: true)
        }
        let mismatch = try source()
        refuses("Mismatched pixel buffers") {
            _ = try mismatch.ingest(depth: depth, confidence: buffer(kCVPixelFormatType_OneComponent8, width: 96), intrinsics: intrinsics,
                imageSize: SIMD2(192, 144), cameraToWorld: pose(0), timestamp: 1, trackingNormal: true)
        }
        for extent in [Float(0), 1.501, .nan] { refuses("Invalid capture bounds") { _ = try source(extent) } }
        let concurrent = try source()
        for (offset, angle) in [Float(0), 0, 35, 35, 70, 70].enumerated() {
            _ = try ingest(concurrent, timestamp: Double(offset + 1), degrees: angle)
        }
        try concurrent.freezeForReview()
        DispatchQueue.concurrentPerform(iterations: 100) { index in
            do {
                if index % 2 == 0 { let value = try concurrent.status(); precondition(value.readinessIssue == nil) }
                else { let value = try concurrent.preview(); precondition(value.points.count <= 2000) }
            } catch { preconditionFailure("Concurrent frozen read failed: \(error)") }
        }
        DispatchQueue.concurrentPerform(iterations: 16) { _ in
            do {
                let independent = try store.savePointCapture(target: .item, points: saved.points)
                let read = try store.readPointCapture(captureID: independent.id)
                precondition(read.sourceSHA256 == saved.sourceSHA256)
                let deleted = try store.delete(captureID: independent.id); precondition(deleted)
            } catch { preconditionFailure("Concurrent store round trip failed: \(error)") }
        }
        DispatchQueue.concurrentPerform(iterations: 100) { index in
            if index % 5 == 0 { concurrent.cancel() }
            else { _ = try? concurrent.preview(); _ = try? concurrent.status() }
        }
        refuses("Concurrent cancellation ends source") { _ = try concurrent.status() }
        let stale = try source(); _ = try ingest(stale, timestamp: 1)
        let before = try manager.contentsOfDirectory(atPath: store.root.path).sorted()
        uptime = 300
        refuses("Native idle expiry") { _ = try stale.status() }
        refuses("Expired capture cannot publish") { _ = try stale.finish(target: .item, store: store) }
        try check(manager.contentsOfDirectory(atPath: store.root.path).sorted() == before)
        print("iOS depth source checks passed: padded CoreVideo buffers, projection, bounded high-confidence points, separated views, ciphertext publication, exact selection, interruption and expiry.")
    }
}
