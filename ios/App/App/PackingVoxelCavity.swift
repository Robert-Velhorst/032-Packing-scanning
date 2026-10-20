import CoreFoundation
import Foundation

enum PackingVoxelCavityError: Error, Equatable, LocalizedError {
    case invalidReview, invalidSource, ineligibleCapture, thin, wallSeed, unreviewedBoundary, noEntry, ambiguous
    var errorDescription: String? {
        switch self {
        case .invalidReview: return "Choose one source-end opening and a finite seed strictly inside the source envelope."
        case .invalidSource: return "The original points or their envelope are invalid. Recorded bag dimensions are unchanged."
        case .ineligibleCapture: return "Interior reconstruction needs an uncapped bag-interior depth capture with enough observations. Item surfaces and guest models cannot become usable cavities."
        case .thin: return "The source is too thin to distinguish walls from interior cells at this spacing."
        case .wallSeed: return "The selected seed touches an observed wall or object. Choose a point in the empty interior."
        case .unreviewedBoundary: return "The seeded space reaches an unreviewed boundary. A wall or floor may be missing. Capture it again; only the selected opening may remain open."
        case .noEntry: return "The seed does not connect enough empty cells to the selected opening. A hidden sealed pocket is not usable entry space."
        case .ambiguous: return "The seeded cavity has an ambiguous or overly complex boundary. Capture a clearer interior; no cells were trimmed or gaps patched."
        }
    }
}

struct PackingInteriorReview: Sendable {
    let axis: Int
    let sign: Int
    let seedMm: SIMD3<Double>
    /** Reject JavaScript Booleans, strings, fractions and missing/non-finite coordinates. */
    static func parse(_ raw: [String: Any]) throws -> Self {
        func number(_ value: Any?) throws -> Double {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite
            else { throw PackingVoxelCavityError.invalidReview }
            return number.doubleValue
        }
        let axis = try number(raw["openingAxis"]), sign = try number(raw["openingSign"])
        guard [0.0,1,2].contains(axis), [-1.0,1].contains(sign), let seed = raw["seedMm"] as? [String: Any]
        else { throw PackingVoxelCavityError.invalidReview }
        return try Self(axis: Int(axis), sign: Int(sign), seedMm: SIMD3(number(seed["x"]), number(seed["y"]), number(seed["z"])))
    }
}

/** One seeded empty component, bounded by actual observations and one reviewed opening plane. */
struct PackingVoxelCavity: Sendable {
    static let method = "seeded_observed_interior_v1"
    let grid: SIMD3<Int>
    let boundsMm: SIMD3<Double>
    let cellSizeMm: SIMD3<Double>
    let review: PackingInteriorReview
    let freeCells: [Int]
    let openingCells: [Int]
    let observedCells: [Int]
    let surfaceFaceCount: Int
    let estimatedVolumeMm3: Double
    private static let directions = [SIMD3(-1,0,0),SIMD3(1,0,0),SIMD3(0,-1,0),SIMD3(0,1,0),SIMD3(0,0,-1),SIMD3(0,0,1)]

    static func reconstruct(points: [SIMD3<Double>], boundsMm: SIMD3<Double>, review: PackingInteriorReview) throws -> Self {
        guard (4...60_000).contains(points.count), (0..<3).allSatisfy({ boundsMm[$0].isFinite && boundsMm[$0] > 0 && boundsMm[$0] <= 10_000 })
        else { throw PackingVoxelCavityError.invalidSource }
        guard (0...2).contains(review.axis), [-1,1].contains(review.sign),
              (0..<3).allSatisfy({ review.seedMm[$0].isFinite && review.seedMm[$0] > 0 && review.seedMm[$0] < boundsMm[$0] })
        else { throw PackingVoxelCavityError.invalidReview }
        let spacing = max(10, ceil(max(boundsMm.x, max(boundsMm.y, boundsMm.z)) / Double(PackingVoxelSolid.maxAxis)))
        let grid = SIMD3(Int(ceil(boundsMm.x / spacing)),Int(ceil(boundsMm.y / spacing)),Int(ceil(boundsMm.z / spacing)))
        guard (0..<3).allSatisfy({ (3...PackingVoxelSolid.maxAxis).contains(grid[$0]) }) else { throw PackingVoxelCavityError.thin }
        let total = grid.x * grid.y * grid.z
        var observed = [Bool](repeating: false, count: total)
        func cell(_ point: SIMD3<Double>) -> Int {
            let x = min(grid.x-1, max(0,Int(floor(point.x / boundsMm.x * Double(grid.x)))))
            let y = min(grid.y-1, max(0,Int(floor(point.y / boundsMm.y * Double(grid.y)))))
            let z = min(grid.z-1, max(0,Int(floor(point.z / boundsMm.z * Double(grid.z)))))
            return x + grid.x * (y + grid.y * z)
        }
        for point in points {
            guard (0..<3).allSatisfy({ point[$0].isFinite && point[$0] >= -0.001 && point[$0] <= boundsMm[$0] + 0.001 })
            else { throw PackingVoxelCavityError.invalidSource }
            observed[cell(point)] = true
        }
        let start = cell(review.seedMm)
        guard !observed[start] else { throw PackingVoxelCavityError.wallSeed }
        var free = [Bool](repeating: false, count: total), queue = [Int](repeating: 0, count: total)
        var head = 0, tail = 1, openingCount = 0
        free[start] = true; queue[0] = start
        while head < tail {
            let current = queue[head]; head += 1
            let p = SIMD3(current % grid.x, (current / grid.x) % grid.y, current / (grid.x * grid.y))
            for axis in 0..<3 {
                for sign in [-1,1] where p[axis] == (sign == 1 ? grid[axis]-1 : 0) {
                    guard review.axis == axis && review.sign == sign else { throw PackingVoxelCavityError.unreviewedBoundary }
                    openingCount += 1
                }
            }
            for direction in directions {
                let next = p &+ direction
                guard (0..<3).allSatisfy({ next[$0] >= 0 && next[$0] < grid[$0] }) else { continue }
                let key = next.x + grid.x * (next.y + grid.y * next.z)
                if !observed[key] && !free[key] { free[key] = true; queue[tail] = key; tail += 1 }
            }
        }
        guard tail >= 8, openingCount >= 4 else { throw PackingVoxelCavityError.noEntry }
        let faces: Int
        do { faces = try PackingVoxelSolid.validateSurface(free, grid: grid) }
        catch { throw PackingVoxelCavityError.ambiguous }
        let freeCells = free.indices.filter { free[$0] }
        let openingCells = freeCells.filter { key in
            let coordinate = review.axis == 0 ? key % grid.x : review.axis == 1 ? (key / grid.x) % grid.y : key / (grid.x * grid.y)
            return coordinate == (review.sign == 1 ? grid[review.axis]-1 : 0)
        }
        let sizes = SIMD3(boundsMm.x / Double(grid.x),boundsMm.y / Double(grid.y),boundsMm.z / Double(grid.z))
        return Self(grid: grid, boundsMm: boundsMm, cellSizeMm: sizes, review: review, freeCells: freeCells,
                    openingCells: openingCells, observedCells: observed.indices.filter { observed[$0] },
                    surfaceFaceCount: faces, estimatedVolumeMm3: Double(tail) * sizes.x * sizes.y * sizes.z)
    }
}
