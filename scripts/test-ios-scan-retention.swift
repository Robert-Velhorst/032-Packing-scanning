import Foundation

private final class RetentionClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: 1_800_000_000)
    var date: Date { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ date: Date) { lock.lock(); defer { lock.unlock() }; value = date }
}
@main enum RetentionChecks {
    static func check(_ value:Bool) { precondition(value) }
    static func ply() -> Data {
        var points: [SIMD3<Float>] = []
        for z in 0..<9 { for y in 0..<9 { for x in 0..<9 {
            if x == 0 || x == 8 || y == 0 || y == 8 || z == 0 || z == 8 { points.append(SIMD3(Float(x)*0.01,Float(y)*0.01,Float(z)*0.01)) }
        } } }
        var data = Data("ply\nformat binary_little_endian 1.0\nelement vertex \(points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n".utf8)
        for p in points { for value in [p.x,p.y,p.z,1] { var bits=value.bitPattern.littleEndian; withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) } } }
        return data
    }
    static func refuses(_ job: () throws -> Void) { do { try job(); preconditionFailure("Unsafe retention accepted") } catch {} }
    static func main() throws {
        let fm=FileManager.default, parent=FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
        let root=parent.appendingPathComponent("packing-ios-retention-"+UUID().uuidString,isDirectory:true)
        precondition(root.deletingLastPathComponent().path==parent.path)
        try fm.createDirectory(at:root,withIntermediateDirectories:false); defer { try? fm.removeItem(at:root) }
        let clock=RetentionClock(), now=clock.date, points=ply(), key=Data(0..<32)
        let authority=PackingCaptureAuthority(), account="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", ws="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        func open(_ workspace:String?=nil) throws -> PackingCaptureAuthority.Access {
            try authority.openWorkspace(expectedRevision:authority.state().revision,workspaceID:workspace ?? ws,accountID:account,dataKey:key)
        }
        let access=try open(), store=try PackingEncryptedCaptureStore(directory:root,access:access,clock:{ clock.date })
        let policy=PackingScanRetentionPolicy(days:7,afterID:nil), quality=PackingPointCapture.DepthQuality(depthFrames:6,viewCount:3,capped:false)
        func capture(_ age:TimeInterval, depth:Bool=true) throws -> PackingPointCapture {
            let value=try PackingPointCapture.complete(target:.item,points:points,now:now.addingTimeInterval(-age),depthQuality:depth ? quality : nil)
            try store.write(captureID:value.id,metadata:value.metadata,points:value.points);return value
        }
        func raw(_ id:String) -> URL { store.root.appendingPathComponent(id).appendingPathComponent("points.ply.sealed") }
        let expired=try capture(8*86400), boundary=try capture(7*86400), recent=try capture(7*86400-1)
        let future=try capture(-86400), generic=try capture(10*86400,depth:false), unknown=try capture(9*86400)
        let extra=store.root.appendingPathComponent(unknown.id).appendingPathComponent("unknown.keep")
        try Data([42]).write(to:extra)
        let metadataBefore=try Data(contentsOf:store.root.appendingPathComponent(expired.id).appendingPathComponent("capture.json.sealed"))
        let reply=try store.pruneExpiredSources(policy), ids=reply["removedIds"] as! [String]
        precondition(Set(ids)==Set([expired.id,boundary.id]) && reply["deletedCount"] as! Int==2)
        precondition(reply["skippedCount"] as! Int==2 && reply["failedCount"] as! Int==1)
        precondition(!fm.fileExists(atPath:raw(expired.id).path) && !fm.fileExists(atPath:raw(boundary.id).path))
        for value in [recent,future,generic,unknown] { precondition(fm.fileExists(atPath:raw(value.id).path)) }
        let metadataAfter=try Data(contentsOf:store.root.appendingPathComponent(expired.id).appendingPathComponent("capture.json.sealed"))
        precondition(metadataBefore==metadataAfter)
        let again=try store.pruneExpiredSources(policy)
        precondition(again["deletedCount"] as! Int==0 && Set(again["removedIds"] as! [String])==Set(ids))
        refuses { _=try store.readPointCapture(captureID:expired.id) }
        try check(store.delete(captureID:expired.id))
        // A malformed file remains; Clear must refuse before removing any other capture.
        refuses { _=try store.clearCaptures() }
        precondition(fm.fileExists(atPath:store.root.appendingPathComponent(boundary.id).path))
        try fm.removeItem(at:extra) // Only this test's own synthetic unknown-file fixture.
        try check(store.clearCaptures()==5)
        try check(store.clearCaptures()==0)
        // Batch cursor and unrelated top-level entries are preserved.
        let keep=store.root.appendingPathComponent("unknown.keep");try Data([7]).write(to:keep)
        for _ in 0..<101 { _=try capture(100*86400) }
        let first=try store.pruneExpiredSources(.init(days:90,afterID:nil))
        precondition(first["checkedCount"] as! Int==100 && first["deletedCount"] as! Int==100)
        let second=try store.pruneExpiredSources(.init(days:90,afterID:first["nextCursor"] as? String))
        precondition(second["checkedCount"] as! Int==1 && second["deletedCount"] as! Int==1 && second["nextCursor"] is NSNull)
        try check(Data(contentsOf:keep)==Data([7]))
        let retained=try capture(20*86400)
        let other=try open("cccccccc-cccc-cccc-cccc-cccccccccccc")
        let otherStore=try PackingEncryptedCaptureStore(directory:root,access:other,clock:{ clock.date })
        refuses { _=try store.pruneExpiredSources(policy) }
        try check(otherStore.pruneExpiredSources(policy)["checkedCount"] as! Int==0)
        precondition(fm.fileExists(atPath:raw(retained.id).path))
        let protected=try PackingPointCapture.complete(target:.item,points:points,now:now.addingTimeInterval(-20*86400),depthQuality:quality)
        try otherStore.write(captureID:protected.id,metadata:protected.metadata,points:protected.points)
        let protectedRaw=otherStore.root.appendingPathComponent(protected.id).appendingPathComponent("points.ply.sealed")
        let ciphertext=try Data(contentsOf:protectedRaw)
        var corrupt=ciphertext; corrupt[corrupt.startIndex] ^= 1; try corrupt.write(to:protectedRaw)
        try check(otherStore.pruneExpiredSources(policy)["failedCount"] as! Int==1)
        precondition(fm.fileExists(atPath:protectedRaw.path))
        try ciphertext.write(to:protectedRaw)
        let savedRaw=root.appendingPathComponent("owned-point-fixture")
        try fm.moveItem(at:protectedRaw,to:savedRaw)
        try fm.createSymbolicLink(at:protectedRaw,withDestinationURL:savedRaw)
        try check(otherStore.pruneExpiredSources(policy)["failedCount"] as! Int==1)
        try check(Data(contentsOf:savedRaw)==ciphertext)
        try fm.removeItem(at:protectedRaw); try fm.moveItem(at:savedRaw,to:protectedRaw)
        let extraLink=root.appendingPathComponent("owned-hard-link-fixture")
        try fm.linkItem(at:protectedRaw,to:extraLink)
        try check(otherStore.pruneExpiredSources(policy)["failedCount"] as! Int==1)
        try check(Data(contentsOf:extraLink)==ciphertext)
        try fm.removeItem(at:extraLink)
        clock.set(Date(timeIntervalSince1970:0)); refuses { _=try otherStore.pruneExpiredSources(policy) }; clock.set(now)
        precondition(fm.fileExists(atPath:protectedRaw.path))
        authority.close(expectedRevision:other.lease)
        refuses { _=try otherStore.pruneExpiredSources(policy) }
        for value in [true,"7",0,1,7.5,Double.nan,NSNull()] as [Any] { refuses { _=try PackingScanRetentionPolicy.parse(["days":value]) } }
        for cursor in ["../source","AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",NSNull()] as [Any] { refuses { _=try PackingScanRetentionPolicy.parse(["days":7,"afterId":cursor]) } }
        let parsed=try PackingScanRetentionPolicy.parse(["days":30,"afterId":retained.id]);precondition(parsed.days==30 && parsed.afterID==retained.id)
        if CommandLine.arguments.count>1 { try JSONSerialization.data(withJSONObject:reply).write(to:URL(fileURLWithPath:CommandLine.arguments[1])) }
        withExtendedLifetime(authority) {}
        print("iOS retention passed: native age, preserved metadata, repeat confirmations, cleanup, bounded batches, malformed entries and original workspace isolation")
    }
}
