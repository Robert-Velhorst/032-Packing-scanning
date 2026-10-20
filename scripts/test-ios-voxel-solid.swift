import Foundation

@main struct VoxelSolidChecks {
    typealias Shape = (Int, Int, Int) -> Bool
    static func box(_ x: Int, _ y: Int, _ z: Int) -> Shape {
        { a, b, c in a >= 0 && a < x && b >= 0 && b < y && c >= 0 && c < z }
    }
    static func shell(_ size: SIMD3<Int>, _ shape: Shape) -> [SIMD3<Double>] {
        let directions = [SIMD3(-1,0,0),SIMD3(1,0,0),SIMD3(0,-1,0),SIMD3(0,1,0),SIMD3(0,0,-1),SIMD3(0,0,1)]
        var points: [SIMD3<Double>] = []
        for z in 0..<size.z { for y in 0..<size.y { for x in 0..<size.x where shape(x,y,z) {
            if directions.contains(where: { !shape(x + $0.x,y + $0.y,z + $0.z) }) {
                points.append(SIMD3(Double(x * 10 + 5),Double(y * 10 + 5),Double(z * 10 + 5)))
            }
        } } }
        return points
    }
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }
    static func rejects(_ expected: PackingVoxelSolidError, _ action: () throws -> Void) {
        do { try action(); preconditionFailure("Invalid geometry accepted: \(expected)") }
        catch { require(error as? PackingVoxelSolidError == expected, "Unexpected rejection: \(error)") }
    }
    static func main() throws {
        var parity: [String] = []
        func fixture(_ name: String, _ points: [SIMD3<Double>], _ bounds: SIMD3<Double>, _ expected: PackingVoxelSolidError? = nil) throws -> PackingVoxelSolid? {
            let result: PackingVoxelSolid?
            do {
                result = try PackingVoxelSolid.reconstruct(points: points, boundsMm: bounds)
                require(expected == nil, "Expected rejection: \(name)")
            } catch {
                require(error as? PackingVoxelSolidError == expected && expected != nil, "Unexpected error \(name): \(error)")
                result = nil
            }
            parity.append("\(name) \(points.count) \(result == nil ? 0 : 1)")
            parity.append("\(bounds.x) \(bounds.y) \(bounds.z)")
            if let result {
                parity.append("\(result.grid.x) \(result.grid.y) \(result.grid.z) \(result.resolutionMm) \(result.observedCellCount) \(result.enclosedCellCount) \(result.faceCount)")
                parity.append(result.occupiedCells.map(String.init).joined(separator: " "))
            }
            for point in points { parity.append("\(point.x) \(point.y) \(point.z)") }
            return result
        }
        let points = shell(SIMD3(9,9,9), box(9,9,9))
        let closed = try fixture("closed", points, SIMD3(repeating: 90))!
        require(closed.occupiedCells.count == 729 && closed.observedCellCount == 386 && closed.enclosedCellCount == 343 && closed.faceCount == 486, "Closed box volume/topology")
        let reverse = try fixture("reversed", Array(points.reversed()), SIMD3(repeating: 90))!
        require(reverse.occupiedCells == closed.occupiedCells && points.first == SIMD3(repeating: 5), "Stable order and source")
        let duplicate = try fixture("duplicates", points + points, SIMD3(repeating: 90))!
        require(duplicate.observedCellCount == closed.observedCellCount && duplicate.occupiedCells == closed.occupiedCells, "Duplicate observations change occupancy")
        let outer = box(12,10,6)
        let u = shell(SIMD3(12,10,6), { x,y,z in outer(x,y,z) && (x < 4 || x >= 8 || y < 3) })
        let concave = try fixture("concave", u, SIMD3(120,100,60))!
        require(concave.occupiedCells.count == 552 && !concave.occupiedCells.contains(5 + 12 * (5 + 10 * 3)), "Exterior concavity was filled")
        _ = try fixture("open", points.filter { $0.z < 80 }, SIMD3(repeating: 90), .openShell)
        let both = shell(SIMD3(15,6,6), { x,y,z in y >= 0 && y < 6 && z >= 0 && z < 6 && ((x >= 0 && x < 6) || (x >= 9 && x < 15)) })
        _ = try fixture("disconnected", both, SIMD3(150,60,60), .disconnected)
        let small = shell(SIMD3(6,6,6), box(6,6,6))
        _ = try fixture("sparse", small.map { $0 * 20 }, SIMD3(repeating: 1200), .openShell)
        let six = box(6,6,6)
        let edge = shell(SIMD3(6,6,6), { x,y,z in six(x,y,z) && !((x == 2 && y == 2) || (x == 3 && y == 3)) })
        _ = try fixture("ambiguous-edge", edge, SIMD3(repeating: 60), .ambiguousEdge)
        // Largest grid axis remains 46 even at 10 metres; no unbounded allocation.
        let large = shell(SIMD3(46,46,46), box(46,46,46)).map { $0 * 21.8 }
        let bounded = try fixture("bounded", large, SIMD3(repeating: 10_000))!
        require(bounded.grid == SIMD3(repeating: 46) && bounded.resolutionMm == 218 && bounded.faceCount == 12_696, "Grid bound")
        rejects(.invalidSource) { _ = try PackingVoxelSolid.reconstruct(points: points, boundsMm: SIMD3(.nan,90,90)) }
        rejects(.invalidSource) { _ = try PackingVoxelSolid.reconstruct(points: points, boundsMm: SIMD3(0,90,90)) }
        rejects(.invalidSource) { _ = try PackingVoxelSolid.reconstruct(points: points, boundsMm: SIMD3(10_001,90,90)) }
        rejects(.invalidSource) { _ = try PackingVoxelSolid.reconstruct(points: Array(repeating: SIMD3(repeating: 5), count: 60_001), boundsMm: SIMD3(repeating: 90)) }
        for bad in [SIMD3(Double.infinity,1,1),SIMD3(-0.002,1,1),SIMD3(90.002,1,1)] {
            rejects(.invalidSource) { _ = try PackingVoxelSolid.reconstruct(points: [bad] + points, boundsMm: SIMD3(repeating: 90)) }
        }
        var vertex = [Bool](repeating: false, count: 8); vertex[0] = true; vertex[7] = true
        rejects(.ambiguousVertex) { _ = try PackingVoxelSolid.validateSurface(vertex, grid: SIMD3(repeating: 2)) }
        var complex = [Bool](repeating: false, count: 27_000)
        for z in stride(from: 0, to: 30, by: 2) { for y in stride(from: 0, to: 30, by: 2) { for x in stride(from: 0, to: 30, by: 2) { complex[x + 30 * (y + 30 * z)] = true } } }
        rejects(.tooComplex) { _ = try PackingVoxelSolid.validateSurface(complex, grid: SIMD3(repeating: 30)) }
        rejects(.invalidSource) { _ = try PackingVoxelSolid.validateSurface([], grid: SIMD3(repeating: Int.max)) }
        if CommandLine.arguments.count > 1 { try (parity.joined(separator: "\n") + "\n").write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8) }
        print("iOS voxel reconstruction checks passed: closure, concavity, order, bounds, topology and refusals")
    }
}
