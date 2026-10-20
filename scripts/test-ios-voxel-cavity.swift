import Foundation

@main enum CavityChecks {
    static func walls(_ grid: SIMD3<Int>, _ bounds: SIMD3<Double>, _ axis: Int = 2, _ sign: Int = 1) -> [SIMD3<Double>] {
        var points: [SIMD3<Double>] = []
        for z in 0..<grid.z { for y in 0..<grid.y { for x in 0..<grid.x {
            let p = SIMD3(x,y,z)
            let wall = (0..<3).contains { a in [-1,1].contains { s in
                !(a == axis && s == sign) && p[a] == (s == 1 ? grid[a]-1 : 0)
            } }
            if wall { points.append(SIMD3((Double(x)+0.5)*bounds.x/Double(grid.x),(Double(y)+0.5)*bounds.y/Double(grid.y),(Double(z)+0.5)*bounds.z/Double(grid.z))) }
        } } }
        return points
    }
    static func ply(_ points: [SIMD3<Double>]) -> Data {
        var data = Data("ply\nformat binary_little_endian 1.0\nelement vertex \(points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n".utf8)
        for point in points { for value in [Float(point.x/1000),Float(point.y/1000),Float(point.z/1000),1] {
            var bits = value.bitPattern.littleEndian; withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
        } }
        return data
    }
    static func refuses(_ expected: PackingVoxelCavityError, _ job: () throws -> Void) {
        do { try job(); preconditionFailure("Accepted invalid cavity: \(expected)") }
        catch { precondition(error as? PackingVoxelCavityError == expected, "Unexpected rejection: \(error)") }
    }
    static func main() throws {
        let bounds = SIMD3<Double>(120,100,80), grid = SIMD3(12,10,8)
        let review = PackingInteriorReview(axis: 2, sign: 1, seedMm: SIMD3(85,55,45))
        let box = walls(grid,bounds)
        var parity: [String] = []
        func fixture(_ name: String, _ points: [SIMD3<Double>], _ suppliedBounds: SIMD3<Double>? = nil,
                     _ suppliedReview: PackingInteriorReview? = nil, _ error: PackingVoxelCavityError? = nil) throws -> PackingVoxelCavity? {
            let b = suppliedBounds ?? bounds, r = suppliedReview ?? review
            let result: PackingVoxelCavity?
            do { result = try PackingVoxelCavity.reconstruct(points: points, boundsMm: b, review: r); precondition(error == nil, name) }
            catch let caught { precondition(caught as? PackingVoxelCavityError == error && error != nil, "\(name): \(caught)"); result = nil }
            parity.append("\(name) \(points.count) \(result == nil ? 0 : 1)")
            parity.append("\(b.x) \(b.y) \(b.z) \(r.axis) \(r.sign) \(r.seedMm.x) \(r.seedMm.y) \(r.seedMm.z)")
            if let result {
                parity.append("\(result.grid.x) \(result.grid.y) \(result.grid.z) \(result.surfaceFaceCount) \(result.estimatedVolumeMm3)")
                for cells in [result.freeCells,result.openingCells,result.observedCells] { parity.append("\(cells.count) " + cells.map(String.init).joined(separator: " ")) }
            }
            for p in points { parity.append("\(p.x) \(p.y) \(p.z)") }
            return result
        }
        for axis in 0..<3 { for sign in [-1,1] {
            let result = try fixture("end-\(axis)-\(sign)", walls(grid,bounds,axis,sign), bounds,
                .init(axis: axis,sign: sign,seedMm: bounds/2))!
            var sides = grid &- SIMD3(repeating: 2); sides[axis] += 1
            precondition(result.freeCells.count == sides.x*sides.y*sides.z)
            precondition(result.openingCells.count == sides[(axis+1)%3]*sides[(axis+2)%3])
            precondition(result.surfaceFaceCount == 2*(sides.x*sides.y+sides.x*sides.z+sides.y*sides.z))
        } }
        let reversed = try fixture("reversed",Array(box.reversed()))!
        precondition(reversed.freeCells.count == 560 && box.first == SIMD3(5,5,5))
        var intrusion = box
        for z in 1...4 { for y in 3...6 { for x in 4...6 { intrusion.append(SIMD3(Double(x*10+5),Double(y*10+5),Double(z*10+5))) } } }
        let intruded = try fixture("intrusion",intrusion)!
        precondition(intruded.freeCells.count == 512 && Set(intruded.freeCells).isDisjoint(with: intruded.observedCells))
        let fractional = SIMD3<Double>(117,93,77)
        let fitted = try fixture("nonintegral",walls(grid,fractional),fractional)!
        precondition(fitted.boundsMm == fractional && fitted.freeCells.count == 560)
        var partition = box
        for y in 1..<9 { for z in 1..<8 { partition.append(SIMD3(65,Double(y*10+5),Double(z*10+5))) } }
        let chosen = try fixture("partition",partition,bounds,.init(axis: 2,sign: 1,seedMm: SIMD3(25,55,45)))!
        precondition(chosen.freeCells.count == 280 && chosen.openingCells.count == 40 && chosen.freeCells.allSatisfy { $0 % 12 < 6 })
        for axis in 0..<3 { _ = try fixture("missing-\(axis)",box.filter { $0[axis] >= 10 },bounds,review,.unreviewedBoundary) }
        _ = try fixture("hole",box.filter { $0 != SIMD3(5,35,35) },bounds,review,.unreviewedBoundary)
        _ = try fixture("wrong-end",box,bounds,.init(axis: 2,sign: -1,seedMm: review.seedMm),.unreviewedBoundary)
        _ = try fixture("wall-seed",box,bounds,.init(axis: 2,sign: 1,seedMm: SIMD3(5,55,45)),.wallSeed)
        _ = try fixture("sealed",walls(grid,bounds,-1,0),bounds,review,.noEntry)
        var ambiguous = box
        for z in 1..<8 { ambiguous.append(SIMD3(45,45,Double(z*10+5))); ambiguous.append(SIMD3(55,55,Double(z*10+5))) }
        _ = try fixture("ambiguous",ambiguous,bounds,review,.ambiguous)
        for seed in [SIMD3(0.0,50,40),SIMD3(120.0,50,40),SIMD3(60,Double.nan,40),SIMD3(60,50,Double.infinity)] {
            refuses(.invalidReview) { _ = try PackingVoxelCavity.reconstruct(points: box,boundsMm: bounds,review: .init(axis: 2,sign: 1,seedMm: seed)) }
        }
        refuses(.invalidSource) { _ = try PackingVoxelCavity.reconstruct(points: box+[SIMD3(-2,1,1)],boundsMm: bounds,review: review) }
        refuses(.invalidSource) { _ = try PackingVoxelCavity.reconstruct(points: Array(repeating: SIMD3(5.0,5,5),count: 60_001),boundsMm: bounds,review: review) }
        refuses(.thin) { _ = try PackingVoxelCavity.reconstruct(points: box,boundsMm: SIMD3(120,100,20),review: .init(axis: 2,sign: 1,seedMm: SIMD3(60,50,10))) }
        let raw: [String:Any] = ["openingAxis": 2,"openingSign": 1,"seedMm": ["x": 85,"y": 55,"z": 45]]
        let parsed = try PackingInteriorReview.parse(raw)
        precondition(parsed.seedMm == review.seedMm)
        for field in ["openingAxis","openingSign"] { for bad in [true,"1",0.5,Double.infinity,NSNull()] as [Any] {
            var changed = raw; changed[field] = bad
            refuses(.invalidReview) { _ = try PackingInteriorReview.parse(changed) }
        } }
        for field in ["x","y","z"] { for bad in [false,"5",Double.nan,NSNull()] as [Any] {
            var changed = raw; var seed = raw["seedMm"] as! [String:Any]; seed[field] = bad; changed["seedMm"] = seed
            refuses(.invalidReview) { _ = try PackingInteriorReview.parse(changed) }
        } }
        if CommandLine.arguments.count > 1 { try (parity.joined(separator: "\n")+"\n").write(toFile: CommandLine.arguments[1],atomically: true,encoding: .utf8) }
        try encryptedFixture(box,review: review)
        print("iOS cavity checks passed: six ends, intrusions, partitions, exact cells, escapes, topology, bridge values and encrypted-source provenance")
    }
    static func encryptedFixture(_ points: [SIMD3<Double>], review: PackingInteriorReview) throws {
        let fm = FileManager.default, parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
        let root = parent.appendingPathComponent("packing-ios-cavity-"+UUID().uuidString,isDirectory: true)
        precondition(root.deletingLastPathComponent().path == parent.path)
        try fm.createDirectory(at: root,withIntermediateDirectories: false); defer { try? fm.removeItem(at: root) }
        let now = Date(timeIntervalSince1970: 1_800_000_000), authority = PackingCaptureAuthority()
        let access = try authority.openWorkspace(expectedRevision: authority.state().revision,workspaceID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",accountID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",dataKey: Data(0..<32))
        let store = try PackingEncryptedCaptureStore(directory: root,access: access,clock: { now })
        let quality = PackingPointCapture.DepthQuality(depthFrames: 6,viewCount: 3,capped: false)
        let captured = try store.savePointCapture(target: .containerInterior,points: ply(points),depthQuality: quality)
        let restored = try store.readPointCapture(captureID: captured.id)
        // Source envelope includes its sampling margin; review uses that actual native frame.
        let bounds = restored.envelope!.dimensionsMm
        let actualReview = PackingInteriorReview(axis: 2,sign: 1,seedMm: bounds/2)
        let cavity = try restored.interiorResult(review: actualReview)
        let after = try store.readPointCapture(captureID: captured.id)
        precondition(after.points == captured.points && after.metadata == captured.metadata)
        let item = try PackingPointCapture.complete(target: .item,points: ply(points),now: now,depthQuality: quality)
        refuses(.ineligibleCapture) { _ = try item.interiorResult(review: actualReview) }
        let generic = try PackingPointCapture.complete(target: .containerInterior,points: ply(points),now: now)
        refuses(.ineligibleCapture) { _ = try generic.interiorResult(review: actualReview) }
        let cappedPoints = (0..<60_000).map { points[$0 % points.count] }
        let capped = try PackingPointCapture.complete(target: .containerInterior,points: ply(cappedPoints),now: now,
            depthQuality: .init(depthFrames: 6,viewCount: 3,capped: true))
        refuses(.ineligibleCapture) { _ = try capped.interiorResult(review: actualReview) }
        if CommandLine.arguments.count > 2 {
            let data = try JSONSerialization.data(withJSONObject: ["scan": restored.scanResult(),"preview": restored.previewResult(),"cavity": cavity,
                "review": ["openingAxis": actualReview.axis,"openingSign": actualReview.sign,"seedMm": ["x": actualReview.seedMm.x,"y": actualReview.seedMm.y,"z": actualReview.seedMm.z]]])
            try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
        }
        authority.close(expectedRevision: access.lease)
        do { _ = try store.readPointCapture(captureID: captured.id).interiorResult(review: review); preconditionFailure("Revoked cavity source") }
        catch { precondition(error is PackingCaptureAuthorityError) }
        withExtendedLifetime(authority) {}
    }
}
