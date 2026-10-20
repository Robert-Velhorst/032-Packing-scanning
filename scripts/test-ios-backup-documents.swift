import Darwin
import Foundation

private enum SimulatedProviderError: Error { case offline }
@main enum BackupDocumentChecks {
    static func check(_ value: Bool, line: UInt = #line) {
        if !value { fatalError("Backup document assertion failed at line \(line)") }
    }
    static func refuses(_ action: () throws -> Void) {
        do { try action(); fatalError("Unsafe document operation accepted") } catch {}
    }
    static func main() throws {
        let fm = FileManager.default, parent = fm.temporaryDirectory.resolvingSymlinksInPath()
        let fixture = parent.appendingPathComponent("packing-ios-documents-" + UUID().uuidString, isDirectory: true)
        check(fixture.deletingLastPathComponent().path == parent.path)
        try fm.createDirectory(at: fixture, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: fixture) }
        func directory(_ name: String) throws -> URL {
            let url = fixture.appendingPathComponent(name, isDirectory: true)
            try fm.createDirectory(at: url, withIntermediateDirectories: false); return url
        }
        let cache = try directory("cache"), destination = try directory("provider")
        let root = try PackingBackupDirectory.prepare(parent: cache)
        let store = try PackingPendingBackupStore(directory: root)
        let guest = try PackingPendingBackupStore.Scope(workspace: nil, account: nil)
        let other = try PackingPendingBackupStore.Scope(workspace: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", account: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
        let payload = Data(("{\"items\":\"" + String(repeating: "private item photo 🌻", count: 12000) + "\"}").utf8)
        let source = fixture.appendingPathComponent("original.json")
        try payload.write(to: source)
        let receipt = try PackingBackupDocumentIO.importFile(source, store: store, scope: guest)
        let sealed = root.appendingPathComponent(receipt.ticket + ".sealed")
        let cipher = try Data(contentsOf: sealed)
        check(cipher.range(of: Data("private item photo".utf8)) == nil)
        let keep = destination.appendingPathComponent("existing-backup.json"), sentinel = Data("older backup".utf8)
        try sentinel.write(to: keep)
        let name = try PackingBackupDocumentIO.exportFile(to: destination, ticket: receipt.ticket, store: store, scope: guest)
        let second = try PackingBackupDocumentIO.exportFile(to: destination, ticket: receipt.ticket, store: store, scope: guest)
        check(name != second && name.hasPrefix("packing-scanning-backup-") && name.hasSuffix(".json"))
        try check(Data(contentsOf: destination.appendingPathComponent(name)) == payload)
        try check(Data(contentsOf: keep) == sentinel && Data(contentsOf: source) == payload)
        func names() throws -> Set<String> { Set(try fm.contentsOfDirectory(atPath: destination.path)) }
        let successful = try names()
        refuses { _ = try PackingBackupDocumentIO.exportFile(to: destination, ticket: receipt.ticket, store: store, scope: other) }
        try check(names() == successful)
        var chunks = 0
        refuses {
            _ = try PackingBackupDocumentIO.exportFile(to: destination, ticket: receipt.ticket, store: store, scope: guest) { handle, bytes in
                try handle.write(contentsOf: bytes); chunks += 1
                if chunks == 2 { throw SimulatedProviderError.offline }
            }
        }
        check(chunks == 2); try check(names() == successful)
        // Failed cleanup must preserve a provider replacement at the same pathname.
        var replacement: URL?
        refuses {
            _ = try PackingBackupDocumentIO.exportFile(to: destination, ticket: receipt.ticket, store: store, scope: guest) { _, _ in
                let created = try names().subtracting(successful); check(created.count == 1)
                let path = destination.appendingPathComponent(created.first!)
                // Keep the opened inode alive so the replacement cannot recycle its identity.
                try fm.removeItem(at: path); try sentinel.write(to: path); replacement = path
                throw SimulatedProviderError.offline
            }
        }
        try check(Data(contentsOf: replacement!) == sentinel)
        var corrupt = cipher; corrupt[corrupt.count - 1] ^= 1
        let writer = try FileHandle(forWritingTo: sealed)
        try writer.write(contentsOf: corrupt); try writer.close()
        let beforeCorrupt = try names()
        refuses { _ = try PackingBackupDocumentIO.exportFile(to: destination, ticket: receipt.ticket, store: store, scope: guest) }
        try check(names() == beforeCorrupt)
        try store.discard(ticket: receipt.ticket)
        let empty = fixture.appendingPathComponent("empty.json"); try Data().write(to: empty)
        refuses { _ = try PackingBackupDocumentIO.importFile(empty, store: store, scope: guest) }
        refuses { _ = try PackingBackupDocumentIO.importFile(destination, store: store, scope: guest) }
        let link = fixture.appendingPathComponent("link.json")
        try fm.createSymbolicLink(at: link, withDestinationURL: source)
        refuses { _ = try PackingBackupDocumentIO.importFile(link, store: store, scope: guest) }
        let hardlink = fixture.appendingPathComponent("hardlink.json"); try fm.linkItem(at: source, to: hardlink)
        refuses { _ = try PackingBackupDocumentIO.importFile(hardlink, store: store, scope: guest) }
        try fm.removeItem(at: hardlink)
        let huge = fixture.appendingPathComponent("huge.json"); try Data([1]).write(to: huge)
        let hugeHandle = try FileHandle(forWritingTo: huge)
        try hugeHandle.truncate(atOffset: UInt64(PackingPendingBackupStore.maximumBytes + 1)); try hugeHandle.close()
        refuses { _ = try PackingBackupDocumentIO.importFile(huge, store: store, scope: guest) }
        let fifo = fixture.appendingPathComponent("pipe.json"); check(mkfifo(fifo.path, mode_t(0o600)) == 0)
        refuses { _ = try PackingBackupDocumentIO.importFile(fifo, store: store, scope: guest) }
        refuses { _ = try PackingBackupDocumentIO.importFile(URL(string: "https://invalid.example/backup")!, store: store, scope: guest) }
        let destinationLink = fixture.appendingPathComponent("provider-link")
        try fm.createSymbolicLink(at: destinationLink, withDestinationURL: destination)
        refuses { _ = try PackingBackupDocumentIO.exportFile(to: destinationLink, ticket: receipt.ticket, store: store, scope: guest) }
        // Startup cleanup owns only marked-cache recognizable ciphertext. Unknown data remains.
        let stale = try PackingBackupDocumentIO.importFile(source, store: store, scope: guest)
        try check(fm.fileExists(atPath: root.appendingPathComponent(stale.ticket + ".sealed").path))
        let unknown = root.appendingPathComponent("notes.txt"); try sentinel.write(to: unknown)
        let malformed = root.appendingPathComponent(UUID().uuidString.lowercased() + ".sealed"); try sentinel.write(to: malformed)
        let outside = fixture.appendingPathComponent("outside"); try Data("PPB1private".utf8).write(to: outside)
        let staleLink = root.appendingPathComponent(UUID().uuidString.lowercased() + ".sealed")
        try fm.createSymbolicLink(at: staleLink, withDestinationURL: outside)
        let staleHardlink = root.appendingPathComponent(UUID().uuidString.lowercased() + ".sealed"); try fm.linkItem(at: outside, to: staleHardlink)
        let partial = root.appendingPathComponent(UUID().uuidString.lowercased() + ".partial"); try Data("PPB1incomplete".utf8).write(to: partial)
        _ = try PackingBackupDirectory.prepare(parent: cache)
        check(!fm.fileExists(atPath: root.appendingPathComponent(stale.ticket + ".sealed").path) && !fm.fileExists(atPath: partial.path))
        try check(Data(contentsOf: unknown) == sentinel && Data(contentsOf: malformed) == sentinel && Data(contentsOf: outside) == Data("PPB1private".utf8))
        check(fm.fileExists(atPath: staleLink.path) && fm.fileExists(atPath: staleHardlink.path))
        let unownedCache = try directory("unowned-cache"), unowned = unownedCache.appendingPathComponent("PackingPendingBackups-v1")
        try fm.createDirectory(at: unowned, withIntermediateDirectories: false)
        let unownedFile = unowned.appendingPathComponent(UUID().uuidString.lowercased() + ".sealed"); try Data("PPB1keep".utf8).write(to: unownedFile)
        refuses { _ = try PackingBackupDirectory.prepare(parent: unownedCache) }
        try check(Data(contentsOf: unownedFile) == Data("PPB1keep".utf8))
        print("Backup provider IO, exclusive exports, failure cleanup and owned startup cleanup passed.")
    }
}
