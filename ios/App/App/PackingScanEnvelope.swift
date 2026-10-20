import Foundation
import simd

enum PackingScanEnvelopeError: LocalizedError {
    case invalidPoints, invalidMargin, missingSide
    var errorDescription: String? {
        if case .missingSide = self { return "A side is missing or too thin for this depth scan. Capture more angles or measure it manually." }
        return "The captured geometry cannot provide usable bounds. Restart the scan or enter physical measurements."
    }
}

/** Same bounded candidate search as Android ScanEnvelope; all original points determine final bounds. */
struct PackingScanEnvelope: Sendable {
    static let method = "oriented_surface_envelope_v1"
    let axes: [SIMD3<Double>]
    let originMetres: SIMD3<Double>
    let dimensionsMm: SIMD3<Double>
    let basis: String
    let paddingMm: Double
    private var volume: Double { dimensionsMm.x * dimensionsMm.y * dimensionsMm.z }
    private static let identity: [SIMD3<Double>] = [SIMD3(1,0,0), SIMD3(0,1,0), SIMD3(0,0,1)]

    private init(points: [SIMD3<Double>], orientation: [SIMD3<Double>], padding: Double, basis: String) {
        let initial = Self.ranges(points, orientation)
        let sides = initial.high - initial.low
        let order = [0,1,2].sorted { sides[$0] == sides[$1] ? $0 < $1 : sides[$0] > sides[$1] }
        var sorted = order.map { orientation[$0] }
        if simd_dot(simd_cross(sorted[0], sorted[1]), sorted[2]) < 0 { sorted[2] = -sorted[2] }
        let range = Self.ranges(points, sorted)
        axes = sorted; self.basis = basis; paddingMm = padding * 1000
        dimensionsMm = (range.high - range.low + SIMD3(repeating: 2 * padding)) * 1000
        var origin = SIMD3<Double>.zero
        for index in 0..<3 { origin += sorted[index] * (range.low[index] - padding) }
        originMetres = origin
    }
    func projectMm(_ point: SIMD3<Double>) -> SIMD3<Double> {
        let delta = point - originMetres
        return SIMD3(simd_dot(delta, axes[0]), simd_dot(delta, axes[1]), simd_dot(delta, axes[2])) * 1000
    }
    static func fit(_ input: [SIMD3<Double>], paddingMetres: Double = 0.0025) throws -> PackingScanEnvelope {
        guard (4...60_000).contains(input.count), input.allSatisfy({ point in
            (0..<3).allSatisfy { point[$0].isFinite && abs(point[$0]) <= 1.5 }
        }) else { throw PackingScanEnvelopeError.invalidPoints }
        guard paddingMetres.isFinite, (0...0.05).contains(paddingMetres) else { throw PackingScanEnvelopeError.invalidMargin }
        let points = input.sorted { a, b in
            for axis in 0..<3 {
                if a[axis] != b[axis] { return a[axis] < b[axis] }
                if a[axis] == 0, a[axis].sign != b[axis].sign { return a[axis].sign == .minus }
            }
            return false
        }
        let principal = principalAxes(points)
        let principalRange = ranges(points, principal)
        for axis in 0..<3 {
            guard principalRange.high[axis] - principalRange.low[axis] >= 0.005 else { throw PackingScanEnvelopeError.missingSide }
        }
        var best = PackingScanEnvelope(points: points, orientation: identity, padding: paddingMetres, basis: "capture_aligned")
        let pca = PackingScanEnvelope(points: points, orientation: principal, padding: paddingMetres, basis: "principal_components")
        if pca.volume < best.volume * (1 - 1e-8) { best = pca }
        let count = min(points.count, 1200)
        let sample = (0..<count).map { points[$0 * (points.count - 1) / max(1, count - 1)] }
        var angles = SIMD3<Double>.zero, sampleBest = Double.infinity
        for a in 0..<6 { for b in 0..<6 { for c in 0..<6 {
            let candidate = SIMD3(Double(a), Double(b), Double(c)) * (.pi / 12)
            let volume = rangeVolume(sample, rotation(candidate))
            if volume < sampleBest * (1 - 1e-10) { sampleBest = volume; angles = candidate }
        } } }
        for step in [Double.pi / 36, .pi / 180, .pi / 900] {
            let centre = angles
            for a in -2...2 { for b in -2...2 { for c in -2...2 {
                let candidate = centre + SIMD3(Double(a), Double(b), Double(c)) * step
                let volume = rangeVolume(sample, rotation(candidate))
                if volume < sampleBest * (1 - 1e-10) { sampleBest = volume; angles = candidate }
            } } }
        }
        let searched = PackingScanEnvelope(points: points, orientation: rotation(angles), padding: paddingMetres, basis: "orientation_search")
        if searched.volume < best.volume * (1 - 1e-8) { best = searched }
        return best
    }
    private static func ranges(_ points: [SIMD3<Double>], _ axes: [SIMD3<Double>]) -> (low: SIMD3<Double>, high: SIMD3<Double>) {
        var low = SIMD3<Double>(repeating: .infinity), high = SIMD3<Double>(repeating: -.infinity)
        for point in points { for index in 0..<3 {
            let value = simd_dot(point, axes[index]); low[index] = min(low[index], value); high[index] = max(high[index], value)
        } }
        return (low, high)
    }
    private static func rangeVolume(_ points: [SIMD3<Double>], _ axes: [SIMD3<Double>]) -> Double {
        let range = ranges(points, axes), sides = range.high - range.low
        return sides.x * sides.y * sides.z
    }
    private static func rotation(_ angles: SIMD3<Double>) -> [SIMD3<Double>] {
        let cx = cos(angles.x), sx = sin(angles.x), cy = cos(angles.y), sy = sin(angles.y), cz = cos(angles.z), sz = sin(angles.z)
        return [SIMD3(cz*cy, sz*cy, -sy), SIMD3(cz*sy*sx-sz*cx, sz*sy*sx+cz*cx, cy*sx), SIMD3(cz*sy*cx+sz*sx, sz*sy*cx-cz*sx, cy*cx)]
    }
    private static func principalAxes(_ points: [SIMD3<Double>]) -> [SIMD3<Double>] {
        var mean = SIMD3<Double>.zero
        for point in points { mean += point / Double(points.count) }
        var covariance = Array(repeating: Array(repeating: Double(0), count: 3), count: 3)
        for point in points { for i in 0..<3 { for j in i..<3 {
            covariance[i][j] += (point[i] - mean[i]) * (point[j] - mean[j]) / Double(points.count)
        } } }
        for i in 0..<3 { for j in 0..<i { covariance[i][j] = covariance[j][i] } }
        var vectors = [[Double(1),0,0], [0,1,0], [0,0,1]]
        for _ in 0..<40 {
            var p = 0, q = 1
            for i in 0..<3 { for j in (i+1)..<3 {
                if abs(covariance[i][j]) > abs(covariance[p][q]) { p = i; q = j }
            } }
            if abs(covariance[p][q]) < 1e-14 { break }
            let angle = 0.5 * atan2(2 * covariance[p][q], covariance[q][q] - covariance[p][p])
            let c = cos(angle), s = sin(angle), pp = covariance[p][p], qq = covariance[q][q], pq = covariance[p][q]
            covariance[p][p] = c*c*pp - 2*s*c*pq + s*s*qq
            covariance[q][q] = s*s*pp + 2*s*c*pq + c*c*qq
            covariance[p][q] = 0; covariance[q][p] = 0
            for k in 0..<3 where k != p && k != q {
                let kp = covariance[k][p], kq = covariance[k][q]
                covariance[k][p] = c*kp-s*kq; covariance[p][k] = covariance[k][p]
                covariance[k][q] = s*kp+c*kq; covariance[q][k] = covariance[k][q]
            }
            for k in 0..<3 {
                let kp = vectors[k][p], kq = vectors[k][q]; vectors[k][p] = c*kp-s*kq; vectors[k][q] = s*kp+c*kq
            }
        }
        return (0..<3).map { SIMD3(vectors[0][$0], vectors[1][$0], vectors[2][$0]) }
    }
}
