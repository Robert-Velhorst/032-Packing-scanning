import Foundation

enum PackingPendingItemPhotoError: Error { case invalid, pending, expired, finished, closed }

/** One encrypted editor handoff. Choosing or cancelling a photo never saves an item. */
final class PackingPendingItemPhotoStore: @unchecked Sendable {
    struct Receipt: Sendable { let ticket: String; let target: String; let selected: Bool }
    struct Content: Sendable { let draftJSON: String; var jpeg: Data? }
    private struct Entry {
        let scope: PackingPendingBackupStore.Scope
        let created: TimeInterval
        let request: String
        var ready = false
        var selected = false
    }
    static let maximumDraftBytes = PackingPendingBackupStore.maximumBytes - PackingReferencePhoto.maximumBytes - 8
    private let lock = NSRecursiveLock()
    private let encrypted: PackingPendingBackupStore
    private let clock: @Sendable () -> TimeInterval
    private var entries: [String: Entry] = [:]
    private var results: [String: String] = [:]
    private var closed = false
    init(directory: URL, clock: @escaping @Sendable () -> TimeInterval = { PackingPendingBackupStore.continuousSeconds() }) throws {
        self.clock = clock; encrypted = try PackingPendingBackupStore(directory: directory, purpose: .itemPhoto, clock: clock)
    }
    deinit { try? close() }
    private func receipt(_ ticket: String, _ entry: Entry) -> Receipt {
        Receipt(ticket: ticket, target: entry.scope.target, selected: entry.selected)
    }
    private func live(_ ticket: String) throws -> Entry {
        guard !closed else { throw PackingPendingItemPhotoError.closed }
        try expire()
        guard let entry = entries[ticket] else { throw PackingPendingItemPhotoError.expired }; return entry
    }
    func expire() throws {
        lock.lock(); defer { lock.unlock() }
        let now = clock()
        // Completion never renews the lifetime measured from the first draft preparation.
        for (ticket, entry) in Array(entries) where !now.isFinite || now < entry.created || now - entry.created >= PackingPendingBackupStore.lifetime {
            try discard(ticket: ticket)
        }
        try encrypted.expire()
    }
    private func stage(scope: PackingPendingBackupStore.Scope, draft: Data, jpeg: Data?) throws -> String {
        guard !draft.isEmpty, draft.count <= Self.maximumDraftBytes,
              (jpeg?.count ?? 0) <= PackingReferencePhoto.maximumBytes else { throw PackingPendingItemPhotoError.invalid }
        let size = UInt32(draft.count)
        let header = Data([0x50, 0x49, 0x50, 0x31, UInt8((size >> 24) & 255), UInt8((size >> 16) & 255), UInt8((size >> 8) & 255), UInt8(size & 255)])
        let parts = [header, draft, jpeg ?? Data()]; var part = 0, offset = 0
        return try encrypted.stage(scope: scope) { count in
            while part < parts.count && offset == parts[part].count { part += 1; offset = 0 }
            guard part < parts.count else { return Data() }
            let end = min(parts[part].count, offset + count); defer { offset = end }
            return parts[part].subdata(in: offset..<end)
        }.ticket
    }
    func prepare(scope: PackingPendingBackupStore.Scope, draftJSON: String) throws -> Receipt {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { throw PackingPendingItemPhotoError.closed }
        try expire(); guard entries.isEmpty else { throw PackingPendingItemPhotoError.pending }
        let created = clock(); guard created.isFinite else { throw PackingPendingItemPhotoError.expired }
        guard !draftJSON.isEmpty, draftJSON.utf8.count <= Self.maximumDraftBytes else { throw PackingPendingItemPhotoError.invalid }
        var bytes = Data(draftJSON.utf8); defer { bytes.resetBytes(in: 0..<bytes.count) }
        let ticket = try stage(scope: scope, draft: bytes, jpeg: nil)
        let entry = Entry(scope: scope, created: created, request: ticket); entries[ticket] = entry
        return receipt(ticket, entry)
    }
    func checkRequest(_ ticket: String) throws {
        lock.lock(); defer { lock.unlock() }
        let entry = try live(ticket)
        guard !entry.ready else { throw PackingPendingItemPhotoError.finished }
    }
    func cancelled(_ request: String) throws -> Receipt {
        lock.lock(); defer { lock.unlock() }
        if let ticket = results[request] { return try result(request: request, ticket: ticket) }
        var entry = try live(request); entry.ready = true; entries[request] = entry
        return receipt(request, entry)
    }
    /** Called after native decoding even if the provider has locked the original workspace. */
    func complete(_ request: String, photo: PackingPreparedReferencePhoto) throws -> Receipt {
        lock.lock(); defer { lock.unlock() }
        let entry = try live(request)
        guard !entry.ready else { throw PackingPendingItemPhotoError.finished }
        var bytes = Data(); try encrypted.read(ticket: request, scope: entry.scope) { bytes.append($0) }
        defer { bytes.resetBytes(in: 0..<bytes.count) }
        let content = try Self.parse(bytes)
        var draft = Data(content.draftJSON.utf8); defer { draft.resetBytes(in: 0..<draft.count) }
        let next = try stage(scope: entry.scope, draft: draft, jpeg: photo.bytes)
        do { _ = try live(request) }
        catch { try? encrypted.discard(ticket: next); throw error }
        var finished = Entry(scope: entry.scope, created: entry.created, request: request)
        finished.ready = true; finished.selected = true
        entries[next] = finished; results[request] = next; entries.removeValue(forKey: request)
        // The result is committed before old-file cleanup; a removed source can never lose the draft.
        try? encrypted.discard(ticket: request)
        return receipt(next, finished)
    }
    func result(request: String, ticket: String) throws -> Receipt {
        lock.lock(); defer { lock.unlock() }
        let entry = try live(ticket)
        guard entry.ready, entry.request == request else { throw PackingPendingItemPhotoError.invalid }
        return receipt(ticket, entry)
    }
    func read(ticket: String, access: PackingCaptureAuthority.Access) throws -> Content {
        // Keep the same lock order as the capture and pending-file cores: authority then store.
        try access.checked {
            lock.lock(); defer { lock.unlock() }
            let entry = try live(ticket)
            guard entry.ready else { throw PackingPendingItemPhotoError.pending }
            var bytes = try encrypted.read(ticket: ticket, access: access)
            defer { bytes.resetBytes(in: 0..<bytes.count) }
            let content = try Self.parse(bytes); _ = try live(ticket); return content
        }
    }
    private static func parse(_ bytes: Data) throws -> Content {
        guard bytes.count >= 8, bytes.prefix(4) == Data("PIP1".utf8) else { throw PackingPendingItemPhotoError.invalid }
        let size = Int(UInt32(bytes[4]) << 24 | UInt32(bytes[5]) << 16 | UInt32(bytes[6]) << 8 | UInt32(bytes[7]))
        guard size > 0, size <= maximumDraftBytes, size <= bytes.count - 8,
              bytes.count - 8 - size <= PackingReferencePhoto.maximumBytes,
              let draft = String(data: bytes.subdata(in: 8..<(8 + size)), encoding: .utf8) else { throw PackingPendingItemPhotoError.invalid }
        let photo = bytes.subdata(in: (8 + size)..<bytes.count)
        guard photo.isEmpty || (photo.count >= 3 && photo.prefix(3) == Data([0xff, 0xd8, 0xff])) else { throw PackingPendingItemPhotoError.invalid }
        return Content(draftJSON: draft, jpeg: photo.isEmpty ? nil : photo)
    }
    func discard(ticket: String) throws {
        lock.lock(); defer { lock.unlock() }
        // The lower store validates canonical tickets and removes only its tracked inode.
        entries.removeValue(forKey: ticket); results = results.filter { $0.value != ticket }
        try encrypted.discard(ticket: ticket)
    }
    func close() throws {
        lock.lock(); defer { lock.unlock() }
        closed = true; entries.removeAll(); results.removeAll(); try encrypted.close()
    }
}
