import Foundation

private final class PendingClock: @unchecked Sendable {
    private let lock=NSLock(); private var now:TimeInterval=100
    var value:TimeInterval { lock.lock(); defer { lock.unlock() }; return now }
    func set(_ value:TimeInterval) { lock.lock(); defer { lock.unlock() }; now=value }
}
private enum ReaderFailure:Error { case stopped }
private final class PendingResults: @unchecked Sendable {
    private let lock=NSLock();private var entries:[String:Data]=[:];private var failures=0
    func record(_ ticket:String,_ data:Data) { lock.lock();defer { lock.unlock() };entries[ticket]=data }
    func failed() { lock.lock();defer { lock.unlock() };failures += 1 }
    var snapshot:([String:Data],Int) { lock.lock();defer { lock.unlock() };return (entries,failures) }
}
@main enum PendingBackupChecks {
    static func check(_ value:Bool,file:StaticString = #filePath,line:UInt = #line) {
        if !value { FileHandle.standardError.write(Data("Pending backup assertion failed at \(file):\(line)\n".utf8)); fatalError("Pending backup assertion failed") }
    }
    static func refuses(_ job:() throws -> Void) { do { try job(); fatalError("Unsafe pending backup accepted") } catch {} }
    static func main() throws {
        let fm=FileManager.default,parent=FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
        let fixture=parent.appendingPathComponent("packing-ios-pending-"+UUID().uuidString,isDirectory:true)
        check(fixture.deletingLastPathComponent().path==parent.path)
        try fm.createDirectory(at:fixture,withIntermediateDirectories:false)
        defer { try? fm.removeItem(at:fixture) }
        func directory(_ name:String) throws -> URL {
            let url=fixture.appendingPathComponent(name,isDirectory:true)
            try fm.createDirectory(at:url,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700]);return url
        }
        let clock=PendingClock(),store=try PackingPendingBackupStore(directory:directory("backup"),clock:{ clock.value })
        let authority=PackingCaptureAuthority(),workspace="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",account="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        let guest=try PackingPendingBackupStore.Scope(workspace:nil,account:nil)
        let access=try authority.openWorkspace(expectedRevision:authority.state().revision,workspaceID:workspace,accountID:account,dataKey:Data(0..<32))
        let scope=try PackingPendingBackupStore.Scope(access:access)
        let marker=Data("PRIVATE pending backup content never belongs in a plaintext cache file.".utf8)
        var payload=Data();for _ in 0..<3000 { payload.append(marker) }
        func stage(_ data:Data,scope: PackingPendingBackupStore.Scope?=nil,step:Int=Int.max) throws -> PackingPendingBackupStore.Receipt {
            var offset=0
            return try store.stage(scope:scope ?? guest) { count in
                let size=min(count,min(step,data.count-offset));defer { offset += size };return data.subdata(in:offset..<(offset+size))
            }
        }
        func contents(_ receipt:PackingPendingBackupStore.Receipt,_ target:PackingPendingBackupStore.Scope) throws -> Data {
            var data=Data();try store.read(ticket:receipt.ticket,scope:target) { data.append($0) };return data
        }
        func path(_ receipt:PackingPendingBackupStore.Receipt) -> URL { store.root.appendingPathComponent(receipt.ticket+".sealed") }
        func replace(_ url:URL,_ bytes:Data) throws {
            let handle=try FileHandle(forWritingTo:url);defer { try? handle.close() }
            try handle.truncate(atOffset:0);try handle.write(contentsOf:bytes);try handle.synchronize()
        }
        let first=try stage(payload,scope:scope,step:7),file=path(first),sealed=try Data(contentsOf:file)
        check(first.target==workspace && first.ticket.count==36 && sealed.range(of:marker)==nil)
        try check(contents(first,scope)==payload)
        try check(store.read(ticket:first.ticket,access:access)==payload)
        let second=try stage(Data("guest draft".utf8))
        refuses { _=try stage(Data([1])) }
        refuses { _=try contents(first,guest) }
        let wrongAccount=try PackingPendingBackupStore.Scope(workspace:workspace,account:"cccccccc-cccc-cccc-cccc-cccccccccccc")
        refuses { _=try contents(first,wrongAccount) }
        refuses { _=try PackingPendingBackupStore.Scope(workspace:workspace,account:nil) }
        authority.close(expectedRevision:access.lease)
        refuses { _=try store.read(ticket:first.ticket,access:access) }
        let reopened=try authority.openWorkspace(expectedRevision:authority.state().revision,workspaceID:workspace,accountID:account,dataKey:Data(0..<32))
        try check(store.read(ticket:first.ticket,access:reopened)==payload)
        let newProcess=try PackingPendingBackupStore(directory:store.root)
        refuses { _=try newProcess.read(ticket:first.ticket,access:reopened) }
        try newProcess.close();try check(contents(first,scope)==payload)
        // Whole-stream authentication precedes any consumer output, even for a corrupt final tag.
        var corrupt=sealed;corrupt[corrupt.count-1] ^= 1
        for bytes in [corrupt,Data(sealed.dropLast()),sealed+Data([1])] {
            try replace(file,bytes);var seen=0
            refuses { try store.read(ticket:first.ticket,scope:scope) { seen += $0.count } };check(seen==0)
        }
        // Equal-size data frames cannot be reordered: their authenticated indices differ.
        let frame=PackingPendingBackupStore.chunkBytes+32
        var reordered=sealed
        reordered.replaceSubrange(4..<(4+frame),with:sealed[(4+frame)..<(4+2*frame)])
        reordered.replaceSubrange((4+frame)..<(4+2*frame),with:sealed[4..<(4+frame)])
        try replace(file,reordered);refuses { _=try contents(first,scope) };try replace(file,sealed)
        // No file paths or externally supplied names can address this flat ticket store.
        refuses { _=try store.read(ticket:"../secret",access:reopened) }
        let original=fixture.appendingPathComponent("owned-ciphertext")
        try fm.moveItem(at:file,to:original);try fm.createSymbolicLink(at:file,withDestinationURL:original)
        refuses { _=try contents(first,scope) }
        try fm.removeItem(at:file);try fm.moveItem(at:original,to:file)
        let link=fixture.appendingPathComponent("owned-hard-link")
        try fm.linkItem(at:file,to:link);refuses { _=try contents(first,scope) };try fm.removeItem(at:link)
        try check(contents(first,scope)==payload)
        try store.discard(ticket:second.ticket)
        let before=try fm.contentsOfDirectory(atPath:store.root.path).sorted()
        refuses { _=try store.stage(scope:guest) { _ in throw ReaderFailure.stopped } }
        try check(fm.contentsOfDirectory(atPath:store.root.path).sorted()==before)
        refuses { _=try store.stage(scope:guest) { _ in Data() } }
        try check(fm.contentsOfDirectory(atPath:store.root.path).sorted()==before)
        let small=try PackingPendingBackupStore(directory:directory("bounded"),maximum:3,clock:{ clock.value })
        var position=0
        let exact=try small.stage(scope:guest) { count in
            let bytes=Data([1,2,3]);let n=min(count,3-position);defer { position += n };return bytes.subdata(in:position..<(position+n))
        }
        try check(small.read(ticket:exact.ticket,access:try authority.selectGuest(expectedRevision:authority.state().revision))==Data([1,2,3]))
        refuses { _=try small.stage(scope:guest) { _ in Data([1,2,3,4]) } }
        try check(fm.contentsOfDirectory(atPath:small.root.path).count==1)
        clock.set(700);refuses { _=try contents(first,scope) };check(!fm.fileExists(atPath:file.path))
        try store.close();refuses { _=try stage(Data([1])) }
        clock.set(100)
        let backward=try PackingPendingBackupStore(directory:directory("backward"),clock:{ clock.value })
        var emitted=false
        let backwards=try backward.stage(scope:guest) { _ in defer { emitted=true };return emitted ? Data() : Data([1]) }
        clock.set(99);refuses { try backward.read(ticket:backwards.ticket,scope:guest) { _ in } }
        let retainedRoot=backward.root
        try backward.close();try check(fm.contentsOfDirectory(atPath:retainedRoot.path).isEmpty)
        // Unknown files are not owned just because they share the cache directory.
        let unknown=store.root.appendingPathComponent("unknown.keep");try marker.write(to:unknown)
        let fresh=try PackingPendingBackupStore(directory:store.root);try fresh.close();try check(Data(contentsOf:unknown)==marker)
        let alias=fixture.appendingPathComponent("directory-alias");try fm.createSymbolicLink(at:alias,withDestinationURL:store.root)
        refuses { _=try PackingPendingBackupStore(directory:alias) }
        let concurrent=try PackingPendingBackupStore(directory:directory("concurrent"))
        let results=PendingResults()
        DispatchQueue.concurrentPerform(iterations:16) { iteration in
            do {
                let bytes=Data("parallel-\(iteration)".utf8);var done=false
                let receipt=try concurrent.stage(scope:guest) { _ in defer { done=true };return done ? Data() : bytes }
                results.record(receipt.ticket,bytes)
            } catch PackingPendingBackupError.full {} catch { results.failed() }
        }
        let staged=results.snapshot;check(staged.0.count==2 && staged.1==0)
        DispatchQueue.concurrentPerform(iterations:32) { _ in
            do {
                for (ticket,bytes) in staged.0 {
                    var read=Data();try concurrent.read(ticket:ticket,scope:guest) { read.append($0) }
                    if read != bytes { results.failed() }
                }
            } catch { results.failed() }
        }
        check(results.snapshot.1==0);try concurrent.close()
        let closing=try PackingPendingBackupStore(directory:directory("closing"))
        refuses { _=try closing.stage(scope:guest) { _ in try closing.close();return Data([1]) } }
        try check(fm.contentsOfDirectory(atPath:closing.root.path).isEmpty)
        let consuming=try PackingPendingBackupStore(directory:directory("consuming"))
        var emittedCount=0
        let consumeTicket=try consuming.stage(scope:guest) { size in
            let count=min(size,payload.count-emittedCount);defer { emittedCount += count };return payload.subdata(in:emittedCount..<(emittedCount+count))
        }
        var exposed=0
        refuses { try consuming.read(ticket:consumeTicket.ticket,scope:guest) { bytes in exposed += bytes.count;try consuming.close() } }
        check(exposed==PackingPendingBackupStore.chunkBytes)
        let nested=try PackingPendingBackupStore(directory:directory("nested"))
        var outerDone=false,innerDone=false,rejected=false
        _=try nested.stage(scope:guest) { _ in
            if outerDone { return Data() };outerDone=true
            _=try nested.stage(scope:guest) { _ in
                if innerDone { return Data() };innerDone=true
                do { _=try nested.stage(scope:guest) { _ in Data([1]) } } catch PackingPendingBackupError.full { rejected=true }
                return Data([2])
            }
            return Data([3])
        }
        check(rejected);try nested.close()
        try small.close();withExtendedLifetime(authority) {}
        print("iOS pending backup checks passed: encrypted chunks, short reads, full authentication, scope/lease binding, expiry, bounded input, link refusal, unknown preservation and process-only keys")
    }
}
