import Foundation

enum PackingVoxelSolidError: Error, Equatable, LocalizedError {
    case invalidSource, ineligibleCapture, openShell, disconnected, tooComplex, ambiguousEdge, ambiguousVertex
    var errorDescription: String? {
        switch self {
        case .invalidSource: return "The saved points or their envelope are invalid. Recorded dimensions are unchanged."
        case .ineligibleCapture: return "Reconstruction needs an individual-object depth capture with enough observations and below the point limit. Bag walls and guest models cannot become occupied item shapes."
        case .openShell: return "The observed shell does not enclose enough interior cells. Capture missing sides or keep the rectangular estimate; no gaps were automatically closed."
        case .disconnected: return "Several disconnected shapes were observed. Isolate one object and capture it again; no source components were discarded."
        case .tooComplex: return "The reconstructed surface is too complex for this preview. Capture a simpler isolated object or use its envelope."
        case .ambiguousEdge, .ambiguousVertex: return "The surface has ambiguous edge or vertex contacts. Its watertight topology could not be established; keep the envelope estimate."
        }
    }
}

/** Observed shells only: no dilation, gap repair, component removal, or invented closure. */
struct PackingVoxelSolid: Sendable {
    static let method = "observed_voxel_shell_fill_v1"
    static let maxAxis = 46
    static let maxFaces = 20_000
    let grid: SIMD3<Int>
    let resolutionMm: Double
    let occupiedCells: [Int]
    let observedCellCount: Int
    let enclosedCellCount: Int
    let faceCount: Int

    private static let directions: [SIMD3<Int>] = [
        SIMD3(-1,0,0), SIMD3(1,0,0), SIMD3(0,-1,0), SIMD3(0,1,0), SIMD3(0,0,-1), SIMD3(0,0,1)]
    // Outward winding in right-handed x/y/z coordinates, matching Android VoxelSolid.
    private static let quads: [[SIMD3<Int>]] = [
        [SIMD3(0,0,0),SIMD3(0,0,1),SIMD3(0,1,1),SIMD3(0,1,0)],
        [SIMD3(1,0,0),SIMD3(1,1,0),SIMD3(1,1,1),SIMD3(1,0,1)],
        [SIMD3(0,0,0),SIMD3(1,0,0),SIMD3(1,0,1),SIMD3(0,0,1)],
        [SIMD3(0,1,0),SIMD3(0,1,1),SIMD3(1,1,1),SIMD3(1,1,0)],
        [SIMD3(0,0,0),SIMD3(0,1,0),SIMD3(1,1,0),SIMD3(1,0,0)],
        [SIMD3(0,0,1),SIMD3(1,0,1),SIMD3(1,1,1),SIMD3(0,1,1)]]

    static func reconstruct(points: [SIMD3<Double>], boundsMm: SIMD3<Double>) throws -> Self {
        guard (4...60_000).contains(points.count),
              (0..<3).allSatisfy({ boundsMm[$0].isFinite && boundsMm[$0] > 0 && boundsMm[$0] <= 10_000 })
        else { throw PackingVoxelSolidError.invalidSource }
        let resolution = max(10, ceil(max(boundsMm.x, max(boundsMm.y, boundsMm.z)) / Double(maxAxis)))
        let grid = SIMD3(Int(ceil(boundsMm.x / resolution)), Int(ceil(boundsMm.y / resolution)), Int(ceil(boundsMm.z / resolution)))
        let padded = grid &+ SIMD3(repeating: 2)
        let total = padded.x * padded.y * padded.z
        var observed = [Bool](repeating: false, count: total)
        var observedCount = 0
        for point in points {
            guard (0..<3).allSatisfy({ point[$0].isFinite && point[$0] >= -0.001 && point[$0] <= boundsMm[$0] + 0.001 })
            else { throw PackingVoxelSolidError.invalidSource }
            let cell = SIMD3(
                1 + min(grid.x - 1, max(0, Int(floor(point.x / resolution)))),
                1 + min(grid.y - 1, max(0, Int(floor(point.y / resolution)))),
                1 + min(grid.z - 1, max(0, Int(floor(point.z / resolution)))))
            let key = index(cell, padded)
            if !observed[key] { observed[key] = true; observedCount += 1 }
        }
        // Empty padding lets one seed reach every exterior-connected void.
        var exterior = [Bool](repeating: false, count: total)
        var queue = [Int](repeating: 0, count: total)
        var head = 0, tail = 1
        exterior[0] = true
        while head < tail {
            let position = coordinates(queue[head], padded); head += 1
            for direction in directions {
                let next = position &+ direction
                guard inside(next, padded) else { continue }
                let key = index(next, padded)
                if !observed[key] && !exterior[key] { exterior[key] = true; queue[tail] = key; tail += 1 }
            }
        }
        var solid = [Bool](repeating: false, count: grid.x * grid.y * grid.z)
        var enclosed = 0
        for cell in solid.indices {
            let source = index(coordinates(cell, grid) &+ SIMD3(repeating: 1), padded)
            if !exterior[source] { solid[cell] = true; if !observed[source] { enclosed += 1 } }
        }
        guard enclosed >= 8 else { throw PackingVoxelSolidError.openShell }
        let occupied = solid.indices.filter { solid[$0] }
        try connected(solid, grid, occupied.count)
        let faces = try validateSurface(solid, grid: grid)
        return Self(grid: grid, resolutionMm: resolution, occupiedCells: occupied,
                    observedCellCount: observedCount, enclosedCellCount: enclosed, faceCount: faces)
    }

    private static func index(_ p: SIMD3<Int>, _ grid: SIMD3<Int>) -> Int { p.x + grid.x * (p.y + grid.y * p.z) }
    private static func coordinates(_ cell: Int, _ grid: SIMD3<Int>) -> SIMD3<Int> {
        SIMD3(cell % grid.x, (cell / grid.x) % grid.y, cell / (grid.x * grid.y))
    }
    private static func inside(_ p: SIMD3<Int>, _ grid: SIMD3<Int>) -> Bool {
        p.x >= 0 && p.x < grid.x && p.y >= 0 && p.y < grid.y && p.z >= 0 && p.z < grid.z
    }
    private static func connected(_ solid: [Bool], _ grid: SIMD3<Int>, _ expected: Int) throws {
        guard let first = solid.firstIndex(of: true) else { throw PackingVoxelSolidError.openShell }
        var visited = [Bool](repeating: false, count: solid.count)
        var queue = [Int](repeating: 0, count: solid.count)
        var head = 0, tail = 1
        queue[0] = first; visited[first] = true
        while head < tail {
            let position = coordinates(queue[head], grid); head += 1
            for direction in directions {
                let next = position &+ direction
                guard inside(next, grid) else { continue }
                let key = index(next, grid)
                if solid[key] && !visited[key] { visited[key] = true; queue[tail] = key; tail += 1 }
            }
        }
        guard tail == expected else { throw PackingVoxelSolidError.disconnected }
    }

    /** Validates every edge's opposite winding and every vertex's single closed surface fan. */
    static func validateSurface(_ solid: [Bool], grid: SIMD3<Int>) throws -> Int {
        guard (0..<3).allSatisfy({ (1...maxAxis).contains(grid[$0]) }), solid.count == grid.x * grid.y * grid.z
        else { throw PackingVoxelSolidError.invalidSource }
        let vertices = grid &+ SIMD3(repeating: 1)
        let vertexCount = vertices.x * vertices.y * vertices.z
        // Each positive-axis edge has one slot. State 1/2 is one direction, 3 is a paired edge.
        var edges = [UInt8](repeating: 0, count: vertexCount * 3)
        var neighbours = [UInt8](repeating: 0, count: vertexCount)
        var links = [UInt8](repeating: 0, count: vertexCount * 6)
        var faces = 0
        for cell in solid.indices where solid[cell] {
            let position = coordinates(cell, grid)
            for side in 0..<6 {
                let next = position &+ directions[side]
                if inside(next, grid) && solid[index(next, grid)] { continue }
                faces += 1
                guard faces <= maxFaces else { throw PackingVoxelSolidError.tooComplex }
                let quad = quads[side]
                for corner in 0..<4 {
                    let a = position &+ quad[corner], b = position &+ quad[(corner + 1) % 4]
                    let previous = position &+ quad[(corner + 3) % 4]
                    let vertex = index(a, vertices), other = index(b, vertices)
                    let second = slot(b &- a), first = slot(previous &- a)
                    let edge = min(vertex, other) * 3 + second / 2
                    let orientation: UInt8 = vertex < other ? 1 : 2
                    if edges[edge] == 0 { edges[edge] = orientation }
                    else if edges[edge] == 3 || edges[edge] == orientation { throw PackingVoxelSolidError.ambiguousEdge }
                    else { edges[edge] = 3 }
                    neighbours[vertex] |= UInt8((1 << first) | (1 << second))
                    links[vertex * 6 + first] |= UInt8(1 << second)
                    links[vertex * 6 + second] |= UInt8(1 << first)
                }
            }
        }
        guard edges.allSatisfy({ $0 == 0 || $0 == 3 }) else { throw PackingVoxelSolidError.ambiguousEdge }
        for vertex in 0..<vertexCount where neighbours[vertex] != 0 {
            let mask = neighbours[vertex]
            for direction in 0..<6 where mask & UInt8(1 << direction) != 0 {
                guard links[vertex * 6 + direction].nonzeroBitCount == 2 else { throw PackingVoxelSolidError.ambiguousVertex }
            }
            var reached: UInt8 = 0
            var frontier = UInt8(1 << mask.trailingZeroBitCount)
            while frontier != 0 {
                let direction = frontier.trailingZeroBitCount, bit = UInt8(1 << direction)
                frontier ^= bit
                if reached & bit != 0 { continue }
                reached |= bit; frontier |= links[vertex * 6 + direction] & ~reached
            }
            guard reached == mask else { throw PackingVoxelSolidError.ambiguousVertex }
        }
        return faces
    }
    private static func slot(_ delta: SIMD3<Int>) -> Int {
        if delta.x < 0 { return 0 }; if delta.x > 0 { return 1 }
        if delta.y < 0 { return 2 }; if delta.y > 0 { return 3 }
        return delta.z < 0 ? 4 : 5
    }
}
