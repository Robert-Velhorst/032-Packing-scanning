import Foundation
import simd

@main enum EnvelopeChecks {
    static func main() throws {
        func check(_ value: Bool) { precondition(value) }
        func refuses(_ label: String, _ work: () throws -> Void) {
            do { try work(); preconditionFailure(label) } catch {}
        }
        func box(_ sides: SIMD3<Double>, _ angles: SIMD3<Double>) -> [SIMD3<Double>] {
            let q = simd_quatd(angle: angles.z, axis: SIMD3(0,0,1)) * simd_quatd(angle: angles.y, axis: SIMD3(0,1,0)) * simd_quatd(angle: angles.x, axis: SIMD3(1,0,0))
            var points: [SIMD3<Double>] = []
            for axis in 0..<3 { for face in [Double(-1), 1] { for a in 0..<8 { for b in 0..<8 {
                var p = SIMD3<Double>.zero; p[axis] = face * sides[axis] / 2
                p[(axis+1)%3] = (Double(a)/7 - 0.5) * sides[(axis+1)%3]
                p[(axis+2)%3] = (Double(b)/7 - 0.5) * sides[(axis+2)%3]
                p = q.act(p) + SIMD3(0.1,-0.07,0.02)
                points.append(SIMD3(Double(Float(p.x)), Double(Float(p.y)), Double(Float(p.z))))
            } } } }
            return points
        }
        func ply(_ points: [SIMD3<Double>]) -> Data {
            var data = Data(("ply\nformat binary_little_endian 1.0\nelement vertex \(points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n").utf8)
            for p in points { for value in [Float(p.x), Float(p.y), Float(p.z), 1] {
                var bits = value.bitPattern.littleEndian; withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
            } }
            return data
        }
        var fixtures: [([SIMD3<Double>], PackingScanEnvelope)] = []
        for (sides, angles) in [(SIMD3(0.4,0.2,0.1), SIMD3<Double>.zero),
            (SIMD3(0.4,0.2,0.1), SIMD3(0.36,0.19,0.63)), (SIMD3(0.2,0.2,0.2), SIMD3(Double.pi/12,.pi/6,.pi/4))] {
            let points = box(sides, angles), envelope = try PackingScanEnvelope.fit(points)
            for axis in 0..<3 { precondition(abs(envelope.dimensionsMm[axis] - (sides[axis] * 1000 + 5)) < 0.02) }
            precondition(envelope.dimensionsMm.x >= envelope.dimensionsMm.y && envelope.dimensionsMm.y >= envelope.dimensionsMm.z)
            precondition(abs(simd_dot(simd_cross(envelope.axes[0], envelope.axes[1]), envelope.axes[2]) - 1) < 1e-10)
            for point in points {
                let projected = envelope.projectMm(point)
                for axis in 0..<3 { precondition(projected[axis] >= 2.5 - 1e-6 && projected[axis] <= envelope.dimensionsMm[axis] - 2.5 + 1e-6) }
            }
            let reversed = try PackingScanEnvelope.fit(Array(points.reversed()))
            precondition(reversed.basis == envelope.basis && reversed.dimensionsMm == envelope.dimensionsMm)
            fixtures.append((points, envelope))
        }
        let sampleIndexes = Set((0..<1200).map { $0 * 4000 / 1199 })
        let skipped = (1..<3999).first { !sampleIndexes.contains($0) }!
        var outliers: [SIMD3<Double>] = []
        for index in 0..<4000 {
            let x = Double(index) / 10000 - 0.2
            outliers.append(SIMD3(Double(Float(x)), Double(Float(sin(Double(index)) * 0.02)), Double(Float(cos(Double(index)) * 0.015))))
        }
        let x = (outliers[skipped-1].x + outliers[skipped].x) / 2
        outliers.insert(SIMD3(Double(Float(x)), 0.45, 0.3), at: skipped)
        let containing = try PackingScanEnvelope.fit(outliers)
        for point in outliers {
            let p = containing.projectMm(point)
            for axis in 0..<3 { precondition(p[axis] >= -1e-6 && p[axis] <= containing.dimensionsMm[axis] + 1e-6) }
        }
        fixtures.append((outliers, containing))
        for invalid in [Array(repeating: SIMD3<Double>.zero, count: 4), [SIMD3(0,0,0),SIMD3(1,0,0),SIMD3(0,1,0),SIMD3(1,1,0)],
                        Array(repeating: SIMD3<Double>(.nan,0,0), count: 4), Array(repeating: SIMD3<Double>(2,0,0), count: 4)] {
            refuses("Degenerate or invalid points") { _ = try PackingScanEnvelope.fit(invalid) }
        }
        refuses("Invalid padding") { _ = try PackingScanEnvelope.fit(fixtures[0].0, paddingMetres: -.infinity) }
        let quality = PackingPointCapture.DepthQuality(depthFrames: 6, viewCount: 3, capped: false)
        let capture = try PackingPointCapture.complete(target: .item, points: ply(fixtures[1].0), now: Date(), depthQuality: quality)
        precondition(capture.envelope != nil && capture.depthQuality == quality)
        let result = try capture.scanResult(), preview = try capture.previewResult()
        precondition((result["record"] as? [String: Any])?["method"] as? String == "arkit_scene_depth")
        precondition(preview["sourceHash"] as? String == capture.sourceSHA256)
        let invalidCap = PackingPointCapture.DepthQuality(depthFrames: 6, viewCount: 3, capped: true)
        refuses("Point-limit diagnostic requires the actual point cap") {
            _ = try PackingPointCapture.complete(target: .item, points: capture.points, now: Date(), depthQuality: invalidCap)
        }
        let restored = try PackingPointCapture.restore(captureID: capture.id, metadata: capture.metadata, points: capture.points, now: Date())
        precondition(restored.envelope!.dimensionsMm == capture.envelope!.dimensionsMm)
        var lowerConfidence = capture.points
        let payload = lowerConfidence.range(of: Data("end_header\n".utf8))!.upperBound
        var confidenceBits = Float(0.9).bitPattern.littleEndian
        withUnsafeBytes(of: &confidenceBits) { lowerConfidence.replaceSubrange((payload+12)..<(payload+16), with: $0) }
        refuses("Probability-like point confidence must not become ARKit categorical-high data") {
            _ = try PackingPointCapture.complete(target: .item, points: lowerConfidence, now: Date(), depthQuality: quality)
        }
        let lowerGeneric = try PackingPointCapture.complete(target: .item, points: lowerConfidence, now: Date())
        var forged = try JSONSerialization.jsonObject(with: capture.metadata) as! [String: Any]
        forged["sourceSHA256"] = lowerGeneric.sourceSHA256
        let forgedMetadata = try JSONSerialization.data(withJSONObject: forged)
        refuses("Even matching hash/bounds must not reinterpret a probability as a high-category flag") {
            _ = try PackingPointCapture.restore(captureID: capture.id, metadata: forgedMetadata, points: lowerConfidence, now: Date())
        }
        for field in ["sensor", "method", "basis", "paddingMm", "dimensionsMm", "quality"] {
            var object = try JSONSerialization.jsonObject(with: capture.metadata) as! [String: Any]
            var depth = object["depth"] as! [String: Any]
            switch field {
            case "paddingMm": depth[field] = 0
            case "dimensionsMm": depth[field] = [1,2,3]
            case "quality": depth[field] = ["depthFrames": 5, "viewCount": 3, "capped": false]
            default: depth[field] = "invalid"
            }
            object["depth"] = depth
            let changed = try JSONSerialization.data(withJSONObject: object)
            refuses("Authenticated but contradictory depth metadata") {
                _ = try PackingPointCapture.restore(captureID: capture.id, metadata: changed, points: capture.points, now: Date())
            }
        }
        let flat = fixtures[0].0.map { SIMD3($0.x, $0.y, Double(0)) }
        refuses("Thin scans must not become depth captures") { _ = try PackingPointCapture.complete(target: .item, points: ply(flat), now: Date(), depthQuality: quality) }
        // Plain point-storage v1 stays readable and does not acquire invented depth quality.
        let generic = try PackingPointCapture.complete(target: .item, points: ply(flat), now: Date())
        refuses("Generic points cannot become a native depth result") { _ = try generic.scanResult() }
        refuses("Generic points cannot become an oriented depth preview") { _ = try generic.previewResult() }
        try check(PackingPointCapture.restore(captureID: generic.id, metadata: generic.metadata, points: generic.points, now: Date()).depthQuality == nil)
        if CommandLine.arguments.count >= 2 {
            var lines = ["packing-envelope-parity-v1", String(fixtures.count)]
            for (points, envelope) in fixtures {
                lines.append("\(points.count) \(envelope.basis)")
                lines.append("\(envelope.dimensionsMm.x) \(envelope.dimensionsMm.y) \(envelope.dimensionsMm.z)")
                for point in points { lines.append("\(Float(point.x)) \(Float(point.y)) \(Float(point.z))") }
            }
            try (lines.joined(separator: "\n") + "\n").write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
        }
        if CommandLine.arguments.count >= 3 {
            let data = try JSONSerialization.data(withJSONObject: ["scan": result, "preview": preview], options: [.sortedKeys])
            try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
        }
        print("iOS envelope checks passed: metric oriented bounds, handed axes, deterministic ordering, unsampled outlier containment, thin-source refusal and authenticated quality/bounds provenance.")
    }
}
