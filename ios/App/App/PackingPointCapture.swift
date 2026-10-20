import CryptoKit
import Foundation

enum PackingPointCaptureError: Error { case invalidMetadata, invalidPoints }

/** Validated internal source, not a dimension estimate or a shared ScanResult. */
struct PackingPointCapture {
    enum Target: String, Codable { case item, containerInterior = "container_interior" }
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
    }
    let id: String
    let target: Target
    let completedAt: Date
    let pointCount: Int
    let sourceSHA256: String
    let metadata: Data
    let points: Data

    private init(provenance: Provenance, metadata: Data, points: Data) {
        id = provenance.id; target = provenance.target
        completedAt = Date(timeIntervalSince1970: Double(provenance.completedAtMilliseconds) / 1000)
        pointCount = provenance.pointCount; sourceSHA256 = provenance.sourceSHA256
        self.metadata = metadata; self.points = points
    }

    static func complete(target: Target, points: Data, now: Date) throws -> PackingPointCapture {
        let count = try validatePoints(points)
        let time = try milliseconds(now)
        let provenance = Provenance(version: 1, id: UUID().uuidString.lowercased(), target: target,
            completedAtMilliseconds: time, format: "ply_point_cloud", units: "metres",
            coordinateFrame: "capture_local_right_handed", pointCount: count, sourceSHA256: digest(points))
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return PackingPointCapture(provenance: provenance, metadata: try encoder.encode(provenance), points: points)
    }

    static func restore(captureID: String, metadata: Data, points: Data, now: Date) throws -> PackingPointCapture {
        guard !metadata.isEmpty, metadata.count <= 20_000, points.count <= 8_000_000,
              UUID(uuidString: captureID)?.uuidString.lowercased() == captureID else {
            throw PackingPointCaptureError.invalidMetadata
        }
        let provenance = try JSONDecoder().decode(Provenance.self, from: metadata)
        guard provenance.version == 1, provenance.id == captureID,
              provenance.format == "ply_point_cloud", provenance.units == "metres",
              provenance.coordinateFrame == "capture_local_right_handed",
              provenance.completedAtMilliseconds >= 0,
              provenance.completedAtMilliseconds <= (try milliseconds(now)),
              provenance.sourceSHA256 == digest(points),
              provenance.pointCount == (try validatePoints(points)) else {
            throw PackingPointCaptureError.invalidMetadata
        }
        return PackingPointCapture(provenance: provenance, metadata: metadata, points: points)
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
    private static func validatePoints(_ data: Data) throws -> Int {
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
        for index in 0..<(count * 4) {
            let start = body.startIndex + index * 4
            let bits = UInt32(body[start]) | UInt32(body[start + 1]) << 8
                | UInt32(body[start + 2]) << 16 | UInt32(body[start + 3]) << 24
            let value = Float(bitPattern: bits)
            guard value.isFinite,
                  index % 4 == 3 ? (value >= 0.8 && value <= 1) : abs(value) <= 1.5 else {
                throw PackingPointCaptureError.invalidPoints
            }
        }
        return count
    }
}
