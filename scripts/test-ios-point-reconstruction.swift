import Foundation

@main enum PointReconstructionChecks {
    static func ply(_ points: [SIMD3<Double>]) -> Data {
        var data = Data("ply\nformat binary_little_endian 1.0\nelement vertex \(points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n".utf8)
        for point in points { for value in [Float(point.x),Float(point.y),Float(point.z),1] {
            var bits = value.bitPattern.littleEndian
            withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
        } }
        return data
    }
    static func shell(_ side: Int) -> [SIMD3<Double>] {
        var points: [SIMD3<Double>] = []
        for z in 0..<side { for y in 0..<side { for x in 0..<side {
            if x == 0 || x == side-1 || y == 0 || y == side-1 || z == 0 || z == side-1 {
                points.append(SIMD3(Double(x)*0.01+0.005,Double(y)*0.01+0.005,Double(z)*0.01+0.005))
            }
        } } }
        return points
    }
    static func refuses(_ expected: PackingVoxelSolidError, _ action: () throws -> Void) {
        do { try action(); preconditionFailure("Invalid reconstruction accepted: \(expected)") }
        catch { precondition(error as? PackingVoxelSolidError == expected, "Unexpected error: \(error)") }
    }
    static func main() throws {
        let fm = FileManager.default, parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
        let root = parent.appendingPathComponent("packing-ios-point-reconstruction-" + UUID().uuidString, isDirectory: true)
        precondition(root.deletingLastPathComponent().path == parent.path)
        try fm.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: root) } // Only this run's unique synthetic fixture.
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let authority = PackingCaptureAuthority()
        let account = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        let key = Data(0..<32)
        let access = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        let store = try PackingEncryptedCaptureStore(directory: root, access: access, clock: { now })
        let quality = PackingPointCapture.DepthQuality(depthFrames: 6, viewCount: 3, capped: false)
        let points = shell(38), data = ply(points)
        precondition(points.count > 8000)
        let original = try store.savePointCapture(target: .item, points: data, depthQuality: quality)
        let restored = try store.readPointCapture(captureID: original.id)
        let preview = try restored.previewResult(), solid = try restored.reconstructedResult()
        precondition((preview["samplePointCount"] as! Int) < points.count)
        precondition((solid["sourcePointCount"] as! Int) == points.count && (solid["sourceHash"] as! String) == original.sourceSHA256)
        precondition((solid["occupiedCells"] as! [Int]).count == 38*38*38 && (solid["surfaceFaceCount"] as! Int) == 6*38*38)
        // Reconstruction never rewrites source, provenance, ID or completion time.
        let after = try store.readPointCapture(captureID: original.id)
        precondition(after.points == original.points && after.metadata == original.metadata)
        precondition(after.id == original.id && after.completedAt == original.completedAt)
        let small = shell(9)
        let generic = try PackingPointCapture.complete(target: .item, points: ply(small), now: now)
        refuses(.ineligibleCapture) { _ = try generic.reconstructedResult() }
        let bag = try store.savePointCapture(target: .containerInterior, points: ply(small), depthQuality: quality)
        refuses(.ineligibleCapture) { _ = try store.readPointCapture(captureID: bag.id).reconstructedResult() }
        let open = try store.savePointCapture(target: .item, points: ply(small.filter { $0.z < 0.08 }), depthQuality: quality)
        refuses(.openShell) { _ = try store.readPointCapture(captureID: open.id).reconstructedResult() }
        // Even a closed-looking source at the limit is incomplete for this operation.
        let cappedPoints = (0..<60_000).map { small[$0 % small.count] }
        let capped = try PackingPointCapture.complete(target: .item, points: ply(cappedPoints), now: now,
            depthQuality: .init(depthFrames: 6, viewCount: 3, capped: true))
        refuses(.ineligibleCapture) { _ = try capped.reconstructedResult() }
        let atLimit = try PackingPointCapture.complete(target: .item, points: ply(cappedPoints), now: now, depthQuality: quality)
        refuses(.ineligibleCapture) { _ = try atLimit.reconstructedResult() }
        authority.close(expectedRevision: access.lease)
        do { _ = try store.readPointCapture(captureID: original.id).reconstructedResult(); preconditionFailure("Revoked source read") }
        catch { precondition(error is PackingCaptureAuthorityError) }
        let other = try authority.openWorkspace(expectedRevision: authority.state().revision,
            workspaceID: "cccccccc-cccc-cccc-cccc-cccccccccccc", accountID: account, dataKey: key)
        let otherStore = try PackingEncryptedCaptureStore(directory: root, access: other, clock: { now })
        do { _ = try otherStore.readPointCapture(captureID: original.id).reconstructedResult(); preconditionFailure("Cross-workspace source") }
        catch {}
        if CommandLine.arguments.count > 1 {
            let fixture: [String: Any] = ["scan": try restored.scanResult(), "preview": preview, "solid": solid]
            try JSONSerialization.data(withJSONObject: fixture, options: [.sortedKeys]).write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        }
        withExtendedLifetime(authority) {}
        print("iOS saved-source reconstruction passed: all points, encrypted provenance, immutable source, open/capped/wrong-target refusal and original workspace isolation")
    }
}
