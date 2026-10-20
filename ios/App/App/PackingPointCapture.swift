import CryptoKit
import Foundation

enum PackingPointCaptureError: Error { case invalidMetadata, invalidPoints }

/** Validated internal source; depth records additionally retain source-derived envelope estimates. */
struct PackingPointCapture: Sendable {
    enum Target: String, Codable, Sendable { case item, containerInterior = "container_interior" }
    struct DepthQuality: Codable, Sendable, Equatable {
        let depthFrames: Int
        let viewCount: Int
        let capped: Bool
        func valid(pointCount: Int) -> Bool {
            pointCount >= 300 && (6...12000).contains(depthFrames) && viewCount >= 3 && viewCount <= min(depthFrames, 1000)
                && (!capped || pointCount == 60_000)
        }
    }
    private struct DepthMetadata: Codable {
        let sensor: String
        let quality: DepthQuality
        let method: String
        let basis: String
        let paddingMm: Double
        let dimensionsMm: [Double]
    }
    private struct Provenance: Codable {
        let version: Int
        let id: String
        let target: Target
        let completedAtMilliseconds: Int64
        let format: String
        let units: String
        let coordinateFrame: String
        let pointCount: Int
        let sourceSHA256: String
        let depth: DepthMetadata?
    }
    let id: String
    let target: Target
    let completedAt: Date
    let pointCount: Int
    let sourceSHA256: String
    let metadata: Data
    let points: Data
    let depthQuality: DepthQuality?
    let envelope: PackingScanEnvelope?

    /** Shared bridge payload. Generic point records cannot acquire invented depth provenance. */
    func scanResult() throws -> [String: Any] {
        guard let envelope, let quality = depthQuality else { throw PackingPointCaptureError.invalidMetadata }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var warnings = [
            "Depth geometry is an estimate. Check all dimensions physically; this is not a watertight mesh or a closure guarantee.",
            "Neighbouring objects may enter the capture, and hidden surfaces may be missing. Restart if the preview includes background geometry.",
            "The oriented envelope includes a 2.5 mm sampling margin on every face. This does not bound sensor error or hidden surfaces, and its sorted sides do not establish which side must remain upright.",
            "Only ARKit's high confidence category was retained. Its numeric eligibility flag is not a calibrated probability or measurement-accuracy guarantee."]
        if target == .containerInterior { warnings.append("Visible interior surfaces do not establish the usable cavity or narrowest opening. Measure and confirm these manually.") }
        if quality.capped { warnings.append("The capture reached its point limit; additional detail was omitted.") }
        let geometry: [String: Any] = ["format": "ply_point_cloud", "units": "metres", "coordinateFrame": "capture_local_right_handed", "pointCount": pointCount,
            "envelope": ["method": PackingScanEnvelope.method, "basis": envelope.basis, "paddingMm": envelope.paddingMm]]
        let qualityRecord: [String: Any] = ["depthFrames": quality.depthFrames, "viewCount": quality.viewCount, "confidenceThreshold": 1,
            "confidenceKind": "arkit_high_category", "pointLimitReached": quality.capped, "voxelSizeMm": 5]
        let record: [String: Any] = ["id": id, "target": target.rawValue, "createdAt": formatter.string(from: completedAt),
            "platform": "ios", "method": "arkit_scene_depth", "completedPasses": quality.viewCount, "modelStoredLocally": true,
            "geometry": geometry, "quality": qualityRecord]
        return ["record": record, "dimensionsMm": dimensions(envelope), "warnings": warnings]
    }
    func previewResult() throws -> [String: Any] {
        guard let envelope, depthQuality != nil else { throw PackingPointCaptureError.invalidMetadata }
        let decoded = try Self.decodePoints(points, highCategoryOnly: true)
        let step = max(1, Int(ceil(Double(decoded.count) / 8000)))
        var projected: [Double] = []; projected.reserveCapacity(min(8000, decoded.count) * 4)
        for index in stride(from: 0, to: decoded.count, by: step) {
            let p = envelope.projectMm(decoded[index]); projected.append(contentsOf: [p.x, p.y, p.z, 1])
        }
        return ["id": id, "target": target.rawValue, "format": "point_cloud_preview", "units": "millimetres",
            "sourceHash": sourceSHA256, "pointCount": pointCount, "samplePointCount": projected.count / 4, "pointsMm": projected,
            "envelope": ["method": PackingScanEnvelope.method, "basis": envelope.basis, "paddingMm": envelope.paddingMm, "dimensionsMm": dimensions(envelope)]]
    }
    private func dimensions(_ envelope: PackingScanEnvelope) -> [String: Double] {
        ["length": envelope.dimensionsMm.x, "width": envelope.dimensionsMm.y, "height": envelope.dimensionsMm.z]
    }

    private init(provenance: Provenance, metadata: Data, points: Data, envelope: PackingScanEnvelope?) {
        id = provenance.id; target = provenance.target
        completedAt = Date(timeIntervalSince1970: Double(provenance.completedAtMilliseconds) / 1000)
        pointCount = provenance.pointCount; sourceSHA256 = provenance.sourceSHA256
        self.metadata = metadata; self.points = points
        depthQuality = provenance.depth?.quality; self.envelope = envelope
    }

    static func complete(target: Target, points: Data, now: Date, depthQuality: DepthQuality? = nil) throws -> PackingPointCapture {
        let decoded = try decodePoints(points, highCategoryOnly: depthQuality != nil), count = decoded.count
        if let depthQuality, !depthQuality.valid(pointCount: count) { throw PackingPointCaptureError.invalidMetadata }
        let envelope = try depthQuality.map { _ in try PackingScanEnvelope.fit(decoded) }
        let depth = envelope.map { DepthMetadata(sensor: "arkit_scene_depth", quality: depthQuality!, method: PackingScanEnvelope.method,
            basis: $0.basis, paddingMm: $0.paddingMm, dimensionsMm: [$0.dimensionsMm.x, $0.dimensionsMm.y, $0.dimensionsMm.z]) }
        let time = try milliseconds(now)
        let provenance = Provenance(version: depth == nil ? 1 : 2, id: UUID().uuidString.lowercased(), target: target,
            completedAtMilliseconds: time, format: "ply_point_cloud", units: "metres",
            coordinateFrame: "capture_local_right_handed", pointCount: count, sourceSHA256: digest(points), depth: depth)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return PackingPointCapture(provenance: provenance, metadata: try encoder.encode(provenance), points: points, envelope: envelope)
    }

    static func restore(captureID: String, metadata: Data, points: Data, now: Date) throws -> PackingPointCapture {
        guard !metadata.isEmpty, metadata.count <= 20_000, points.count <= 8_000_000,
              UUID(uuidString: captureID)?.uuidString.lowercased() == captureID else {
            throw PackingPointCaptureError.invalidMetadata
        }
        let provenance = try JSONDecoder().decode(Provenance.self, from: metadata)
        let decoded = try decodePoints(points, highCategoryOnly: provenance.depth != nil)
        guard (provenance.version == 1 && provenance.depth == nil || provenance.version == 2 && provenance.depth != nil), provenance.id == captureID,
              provenance.format == "ply_point_cloud", provenance.units == "metres",
              provenance.coordinateFrame == "capture_local_right_handed",
              provenance.completedAtMilliseconds >= 0,
              provenance.completedAtMilliseconds <= (try milliseconds(now)),
              provenance.sourceSHA256 == digest(points),
              provenance.pointCount == decoded.count else {
            throw PackingPointCaptureError.invalidMetadata
        }
        var envelope: PackingScanEnvelope?
        if let depth = provenance.depth {
            guard depth.sensor == "arkit_scene_depth", depth.quality.valid(pointCount: decoded.count),
                  depth.method == PackingScanEnvelope.method, depth.paddingMm == 2.5, depth.dimensionsMm.count == 3 else {
                throw PackingPointCaptureError.invalidMetadata
            }
            let fitted = try PackingScanEnvelope.fit(decoded)
            guard depth.basis == fitted.basis, (0..<3).allSatisfy({
                depth.dimensionsMm[$0].isFinite && abs(depth.dimensionsMm[$0] - fitted.dimensionsMm[$0]) <= 0.001
            }) else { throw PackingPointCaptureError.invalidMetadata }
            envelope = fitted
        }
        return PackingPointCapture(provenance: provenance, metadata: metadata, points: points, envelope: envelope)
    }

    private static func milliseconds(_ date: Date) throws -> Int64 {
        let value = date.timeIntervalSince1970 * 1000
        guard value.isFinite, value >= 0, value <= 253_402_300_799_999 else {
            throw PackingPointCaptureError.invalidMetadata
        }
        return Int64(value.rounded(.down))
    }
    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /** Bounded binary PLY dialect shared with Android's native depth writer. */
    private static func decodePoints(_ data: Data, highCategoryOnly: Bool = false) throws -> [SIMD3<Double>] {
        guard data.count <= 8_000_000,
              let range = data.prefix(4096).range(of: Data("end_header\n".utf8)) else {
            throw PackingPointCaptureError.invalidPoints
        }
        let headerLength = data.distance(from: data.startIndex, to: range.upperBound)
        guard let header = String(data: data.prefix(headerLength), encoding: .ascii) else {
            throw PackingPointCaptureError.invalidPoints
        }
        let lines = header.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count >= 9, lines.count <= 21, lines[0] == "ply",
              lines[1] == "format binary_little_endian 1.0",
              lines[lines.count - 2] == "end_header", lines.last == "" else {
            throw PackingPointCaptureError.invalidPoints
        }
        var count: Int?
        var properties: [String] = []
        for line in lines.dropFirst(2).dropLast(2) {
            if line.hasPrefix("comment ") { continue }
            if line.hasPrefix("element vertex "), count == nil, properties.isEmpty {
                let digits = line.dropFirst(15)
                guard !digits.isEmpty, digits.allSatisfy({ $0 >= "0" && $0 <= "9" }),
                      let parsed = Int(digits), (4...60_000).contains(parsed) else {
                    throw PackingPointCaptureError.invalidPoints
                }
                count = parsed
            } else if line.hasPrefix("property "), count != nil { properties.append(String(line)) }
            else { throw PackingPointCaptureError.invalidPoints }
        }
        guard let count, properties == ["property float x", "property float y", "property float z", "property float confidence"],
              data.count == headerLength + count * 16 else { throw PackingPointCaptureError.invalidPoints }
        // Decode bytes explicitly: Data storage has no Float/UInt32 alignment guarantee.
        let body = data.dropFirst(headerLength)
        var decoded: [SIMD3<Double>] = []; decoded.reserveCapacity(count)
        var position = SIMD3<Double>.zero
        for index in 0..<(count * 4) {
            let start = body.startIndex + index * 4
            let bits = UInt32(body[start]) | UInt32(body[start + 1]) << 8
                | UInt32(body[start + 2]) << 16 | UInt32(body[start + 3]) << 24
            let value = Float(bitPattern: bits)
            guard value.isFinite,
                  index % 4 == 3 ? (value >= 0.8 && value <= 1) : abs(value) <= 1.5 else {
                throw PackingPointCaptureError.invalidPoints
            }
            if index % 4 == 3 && highCategoryOnly && value != 1 { throw PackingPointCaptureError.invalidPoints }
            if index % 4 < 3 { position[index % 4] = Double(value) }
            else { decoded.append(position) }
        }
        return decoded
    }
}
