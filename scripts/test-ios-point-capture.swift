import Foundation

@main enum PointCaptureChecks {
    static func main() throws {
        func refuses(_ label: String, _ work: () throws -> Void) {
            do { try work(); preconditionFailure(label) } catch {}
        }
        func cloud(count: Int = 4, coordinate: Float = 0.1, confidence: Float = 0.9) -> Data {
            var data = Data(("ply\nformat binary_little_endian 1.0\ncomment units metres; capture-local right-handed camera frame\nelement vertex \(count)\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n").utf8)
            for _ in 0..<count {
                for value in [coordinate, Float(0.2), Float(-0.3), confidence] {
                    var bits = value.bitPattern.littleEndian
                    withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
                }
            }
            return data
        }
        let now = Date(timeIntervalSince1970: 1_800_000_000.125), points = cloud()
        let capture = try PackingPointCapture.complete(target: .containerInterior, points: points, now: now)
        precondition(capture.pointCount == 4 && capture.points == points && capture.target == .containerInterior)
        precondition(capture.completedAt == now && capture.sourceSHA256.count == 64)
        // Independently generated with Node/OpenSSL over the header and four Float32 LE tuples.
        precondition(capture.sourceSHA256 == "5f83c54ab847e610a2ff30f19252a0d93f6b26efea210fced26157044f741115")
        let restored = try PackingPointCapture.restore(captureID: capture.id, metadata: capture.metadata, points: points, now: now)
        precondition(restored.sourceSHA256 == capture.sourceSHA256)
        let other = try PackingPointCapture.complete(target: .item, points: points, now: now)
        precondition(capture.id != other.id)
        let full = try PackingPointCapture.complete(target: .item, points: cloud(count: 60_000), now: now)
        precondition(full.pointCount == 60_000)
        for bad in [cloud(count: 3), cloud(count: 60_001), cloud(coordinate: .nan), cloud(coordinate: .infinity),
                    cloud(coordinate: 1.5001), cloud(coordinate: -1.5001), cloud(confidence: 0.799), cloud(confidence: 1.001),
                    cloud(confidence: .nan), points.dropLast(), points + Data([0]), Data(repeating: 0, count: 8_000_001)] {
            refuses("Malformed or unsupported points") { _ = try PackingPointCapture.complete(target: .item, points: Data(bad), now: now) }
        }
        let text = String(decoding: points.prefix(points.count - 64), as: UTF8.self)
        for changed in [text.replacingOccurrences(of: "binary_little_endian", with: "ascii"),
                        text.replacingOccurrences(of: "property float z", with: "property double z"),
                        text.replacingOccurrences(of: "element vertex 4", with: "element face 4"),
                        text.replacingOccurrences(of: "property float confidence", with: "element face 0\nproperty float confidence"),
                        text.replacingOccurrences(of: "element vertex 4", with: "element vertex 4\nelement vertex 4"),
                        text.replacingOccurrences(of: "end_header\n", with: "end_header\r\n")] {
            refuses("Unsupported PLY header") { _ = try PackingPointCapture.complete(target: .item, points: Data(changed.utf8) + points.suffix(64), now: now) }
        }
        for date in [Date(timeIntervalSince1970: -1), Date(timeIntervalSince1970: .nan), Date(timeIntervalSince1970: .infinity)] {
            refuses("Invalid native clock") { _ = try PackingPointCapture.complete(target: .item, points: points, now: date) }
        }
        refuses("Future completion date") {
            _ = try PackingPointCapture.restore(captureID: capture.id, metadata: capture.metadata, points: points, now: now.addingTimeInterval(-0.001))
        }
        var changedPoints = points; changedPoints[changedPoints.count - 1] ^= 1
        refuses("Hash mismatch") { _ = try PackingPointCapture.restore(captureID: capture.id, metadata: capture.metadata, points: changedPoints, now: now) }
        let alterations: [String: Any] = ["version": 2, "id": other.id, "target": "box", "pointCount": 5,
            "sourceSHA256": String(repeating: "0", count: 64), "format": "usdz", "units": "millimetres",
            "coordinateFrame": "model_local_right_handed", "completedAtMilliseconds": -1]
        for (field, value) in alterations {
            var object = try JSONSerialization.jsonObject(with: capture.metadata) as! [String: Any]
            object[field] = value
            let metadata = try JSONSerialization.data(withJSONObject: object)
            refuses("Metadata mismatch: " + field) { _ = try PackingPointCapture.restore(captureID: capture.id, metadata: metadata, points: points, now: now) }
        }
        for metadata in [Data("{}".utf8), Data("null".utf8), Data(repeating: 0, count: 20_001)] {
            refuses("Invalid metadata") { _ = try PackingPointCapture.restore(captureID: capture.id, metadata: metadata, points: points, now: now) }
        }
        print("iOS point capture checks passed: binary bounds, finite coordinates/confidence, identity, native completion time, point count and SHA-256 provenance.")
    }
}
