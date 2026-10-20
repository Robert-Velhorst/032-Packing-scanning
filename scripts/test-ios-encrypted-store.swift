import Foundation

private enum InjectedStoreFailure: Error { case stop }
@main enum EncryptedStoreChecks {
    static func main() throws {
        let fm = FileManager.default
        let temp = fm.temporaryDirectory.resolvingSymlinksInPath()
        let fixture = temp.appendingPathComponent("packing-ios-encrypted-store-" + UUID().uuidString, isDirectory: true)
        precondition(fixture.deletingLastPathComponent().path == temp.path)
        try fm.createDirectory(at: fixture, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: fixture) }
        func stage(_ message: String) { FileHandle.standardError.write(Data(("Encrypted store check: " + message + "\n").utf8)) }
        func check(_ value: Bool) { precondition(value) }
        func refuses(_ label: String, _ job: () throws -> Void) {
            do { try job(); preconditionFailure(label) } catch {}
        }
        func id() -> String { UUID().uuidString.lowercased() }
        let workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", account = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        let key = Data(0..<32), metadata = Data("private metadata fixture".utf8), points = Data("private point fixture".utf8)
        var now: TimeInterval = 100
        let authority = PackingCaptureAuthority(clock: { now })
        defer { withExtendedLifetime(authority) {} }
        func open() throws -> PackingCaptureAuthority.Access {
            try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        }
        stage("reject guest and prepare scoped store")
        let guest = try authority.selectGuest(expectedRevision: authority.state().revision)
        refuses("Guest must not open protected storage") { _ = try PackingEncryptedCaptureStore(directory: fixture, access: guest) }
        let access = try open(), store = try PackingEncryptedCaptureStore(directory: fixture, access: access)
        let first = id()
        stage("publish and authenticate encrypted files")
        try store.write(captureID: first, metadata: metadata, points: points)
        try check(store.readMetadata(captureID: first) == metadata)
        try check(store.readPoints(captureID: first) == points)
        let firstFolder = store.root.appendingPathComponent(first, isDirectory: true)
        for file in try fm.contentsOfDirectory(at: firstFolder, includingPropertiesForKeys: nil) {
            let data = try Data(contentsOf: file)
            check(data.starts(with: Data("PSC1".utf8)))
            check(data.range(of: metadata) == nil && data.range(of: points) == nil)
            try check((fm.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600)
            try check(file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        }
        refuses("Existing captures must never be overwritten") { try store.write(captureID: first, metadata: Data("new".utf8), points: points) }
        refuses("Traversal IDs must fail") { try store.write(captureID: "../outside", metadata: metadata, points: points) }
        refuses("Metadata bounds must precede staging") { try store.write(captureID: id(), metadata: Data(repeating: 0, count: 20001), points: points) }
        refuses("Point bounds must precede staging") { try store.write(captureID: id(), metadata: metadata, points: Data(repeating: 0, count: 8000001)) }
        stage("failure rollback contains only ciphertext")
        let failed = id()
        let failing = try PackingEncryptedCaptureStore(directory: fixture, access: access, beforePublish: {
            let pending = try fm.contentsOfDirectory(at: store.root, includingPropertiesForKeys: nil).filter { $0.lastPathComponent.hasPrefix(".pending-") }
            check(pending.count == 1)
            for file in try fm.contentsOfDirectory(at: pending[0], includingPropertiesForKeys: nil) {
                let data = try Data(contentsOf: file)
                check(data.starts(with: Data("PSC1".utf8)) && data.range(of: metadata) == nil && data.range(of: points) == nil)
            }
            throw InjectedStoreFailure.stop
        })
        refuses("Pre-publication failure must roll back") { try failing.write(captureID: failed, metadata: metadata, points: points) }
        check(!fm.fileExists(atPath: store.root.appendingPathComponent(failed).path))
        try check(fm.contentsOfDirectory(atPath: store.root.path) == [first])
        stage("occupied destination must survive publication race")
        let raced = id(), racedFolder = store.root.appendingPathComponent(raced, isDirectory: true)
        let racing = try PackingEncryptedCaptureStore(directory: fixture, access: access, beforePublish: {
            try fm.createDirectory(at: racedFolder, withIntermediateDirectories: false)
            try Data("keep".utf8).write(to: racedFolder.appendingPathComponent("unknown.txt"))
        })
        refuses("Exclusive directory rename must not replace a competing destination") { try racing.write(captureID: raced, metadata: metadata, points: points) }
        try check(Data(contentsOf: racedFolder.appendingPathComponent("unknown.txt")) == Data("keep".utf8))
        stage("expiry cancels publication and revokes original stores")
        let expired = id()
        let expiring = try PackingEncryptedCaptureStore(directory: fixture, access: access, beforePublish: { now += 300 })
        refuses("Expired writes must not publish") { try expiring.write(captureID: expired, metadata: metadata, points: points) }
        check(!fm.fileExists(atPath: store.root.appendingPathComponent(expired).path))
        refuses("Old stores must not read after expiry") { _ = try store.readMetadata(captureID: first) }
        refuses("Old stores must not delete after expiry") { _ = try store.delete(captureID: first) }
        let reopened = try PackingEncryptedCaptureStore(directory: fixture, access: open())
        try check(reopened.readMetadata(captureID: first) == metadata)
        stage("wrong keys and copied ciphertext must fail")
        let wrongAuthority = PackingCaptureAuthority()
        defer { withExtendedLifetime(wrongAuthority) {} }
        let wrongAccess = try wrongAuthority.openWorkspace(expectedRevision: wrongAuthority.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(repeating: 255, count: 32))
        let wrong = try PackingEncryptedCaptureStore(directory: fixture, access: wrongAccess)
        refuses("Wrong key must not read") { _ = try wrong.readMetadata(captureID: first) }
        refuses("Wrong key must not delete") { _ = try wrong.delete(captureID: first) }
        let copyID = id(), copied = reopened.root.appendingPathComponent(copyID, isDirectory: true)
        try fm.copyItem(at: firstFolder, to: copied)
        refuses("Cross-capture ciphertext must not authenticate") { _ = try reopened.readPoints(captureID: copyID) }
        let otherAuthority = PackingCaptureAuthority()
        defer { withExtendedLifetime(otherAuthority) {} }
        let otherID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
        let otherAccess = try otherAuthority.openWorkspace(expectedRevision: otherAuthority.state().revision, workspaceID: workspace, accountID: otherID, dataKey: key)
        let otherStore = try PackingEncryptedCaptureStore(directory: fixture, access: otherAccess)
        check(otherStore.root != reopened.root)
        try otherStore.write(captureID: first, metadata: Data("other account".utf8), points: points)
        try check(otherStore.delete(captureID: first))
        try check(reopened.readMetadata(captureID: first) == metadata)
        let workspaceAccess = try otherAuthority.openWorkspace(expectedRevision: otherAuthority.state().revision, workspaceID: otherID, accountID: account, dataKey: key)
        let workspaceStore = try PackingEncryptedCaptureStore(directory: fixture, access: workspaceAccess)
        check(workspaceStore.root != reopened.root)
        try workspaceStore.write(captureID: first, metadata: Data("other workspace".utf8), points: points)
        try check(workspaceStore.delete(captureID: first))
        try check(reopened.readMetadata(captureID: first) == metadata)
        let sealedPoints = firstFolder.appendingPathComponent("points.ply.sealed"), original = try Data(contentsOf: sealedPoints)
        var damaged = original; damaged[damaged.count - 1] ^= 1
        try damaged.write(to: sealedPoints)
        refuses("Changed tags must not release plaintext") { _ = try reopened.readPoints(captureID: first) }
        try original.write(to: sealedPoints)
        stage("preserve unknown files and reject links")
        let unknown = firstFolder.appendingPathComponent("unknown.txt")
        try Data("keep".utf8).write(to: unknown)
        refuses("Unknown capture children must not be deleted") { _ = try reopened.delete(captureID: first) }
        try fm.removeItem(at: unknown)
        let outside = fixture.appendingPathComponent("outside.txt")
        try Data("outside sentinel".utf8).write(to: outside)
        try fm.removeItem(at: sealedPoints)
        try fm.createSymbolicLink(at: sealedPoints, withDestinationURL: outside)
        refuses("Read must not follow symbolic links") { _ = try reopened.readPoints(captureID: first) }
        refuses("Delete must not follow symbolic links") { _ = try reopened.delete(captureID: first) }
        try fm.removeItem(at: sealedPoints)
        try fm.linkItem(at: outside, to: sealedPoints)
        refuses("Read must not accept hard-linked files") { _ = try reopened.readPoints(captureID: first) }
        try fm.removeItem(at: sealedPoints); try original.write(to: sealedPoints)
        try check(Data(contentsOf: outside) == Data("outside sentinel".utf8))
        stage("large bounded round trip and authenticated deletion")
        let largeID = id(), large = Data(repeating: 42, count: 8_000_000)
        try reopened.write(captureID: largeID, metadata: metadata, points: large)
        try check(reopened.readPoints(captureID: largeID) == large)
        try check(reopened.delete(captureID: largeID))
        try check(reopened.delete(captureID: first))
        try check(!reopened.delete(captureID: first))
        check(fm.fileExists(atPath: racedFolder.appendingPathComponent("unknown.txt").path))
        stage("relocated roots must fail closed")
        let old = reopened.root.appendingPathExtension("saved")
        try fm.moveItem(at: reopened.root, to: old)
        try fm.createSymbolicLink(at: reopened.root, withDestinationURL: fixture)
        refuses("Replaced roots must not read") { _ = try reopened.readMetadata(captureID: copyID) }
        refuses("Replaced roots must not write") { try reopened.write(captureID: id(), metadata: metadata, points: points) }
        print("iOS encrypted store checks passed: ciphertext-only publication, rollback, stale scopes, no overwrite, corruption, size bounds, links and isolated deletion.")
    }
}
