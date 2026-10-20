import CryptoKit
import Darwin
import Foundation

enum PackingPendingBackupError: Error { case invalid, unavailable, full, expired, wrongScope, io }

/** Process-only keys, bounded encrypted chunks, no plaintext app-cache file. */
final class PackingPendingBackupStore: @unchecked Sendable {
    enum Purpose: String, Sendable {
        case backup, itemDraft, referencePhoto
        var maximumBytes: Int {
            switch self { case .backup: return 80 * 1024 * 1024; case .itemDraft: return 256 * 1024; case .referencePhoto: return 12 * 1024 * 1024 }
        }
    }
    struct Scope: Equatable, Sendable {
        let workspace: String?
        let account: String?
        var target: String { workspace ?? "guest" }
        fileprivate var identity: String { workspace.map { $0 + ":" + account! } ?? "guest" }
        init(workspace: String?, account: String?) throws {
            guard (workspace == nil) == (account == nil),
                  workspace == nil || (UUID(uuidString: workspace!)?.uuidString.lowercased() == workspace
                    && UUID(uuidString: account!)?.uuidString.lowercased() == account) else { throw PackingPendingBackupError.invalid }
            self.workspace = workspace; self.account = account
        }
        init(access: PackingCaptureAuthority.Access) throws {
            self = try access.checked { try Scope(workspace: access.workspaceID, account: access.accountID) }
        }
    }
    struct Receipt: Sendable { let ticket: String; let target: String }
    private final class Entry {
        let ticket: String
        let scope: Scope
        let created: TimeInterval
        let inode: UInt64
        var key: [UInt8]
        init(ticket: String, scope: Scope, created: TimeInterval, inode: UInt64, key: [UInt8]) {
            self.ticket = ticket; self.scope = scope; self.created = created; self.inode = inode; self.key = key
        }
        func erase() { for index in key.indices { key[index] = 0 }; key.removeAll() }
        deinit { erase() }
    }
    static let maximumBytes = 80 * 1024 * 1024
    static let chunkBytes = 64 * 1024
    static let lifetime: TimeInterval = 600
    private static let magic = Data("PPB1".utf8)
    private let lock = NSRecursiveLock()
    private let manager = FileManager.default
    private let clock: @Sendable () -> TimeInterval
    private let maximum: Int
    private let purpose: Purpose
    let root: URL
    private let rootInode: UInt64
    private var entries: [String: Entry] = [:]
    private var closed = false

    /** Caller provides a private directory. Existing untracked files are never erased here. */
    init(directory: URL, purpose: Purpose = .backup, maximum: Int? = nil,
         clock: @escaping @Sendable () -> TimeInterval = { PackingPendingBackupStore.continuousSeconds() }) throws {
        let limit = maximum ?? purpose.maximumBytes
        var info = stat()
        guard directory.isFileURL, limit > 0, limit <= purpose.maximumBytes,
              lstat(directory.path, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) else { throw PackingPendingBackupError.invalid }
        let canonical = try Self.canonical(directory.path)
        let privateRoot = URL(fileURLWithPath: canonical, isDirectory: true)
        try Self.check(privateRoot, directory: true)
        root = privateRoot
        rootInode = try Self.inode(privateRoot)
        self.maximum = limit; self.clock = clock; self.purpose = purpose
        try Self.protect(root)
    }
    deinit { try? close() }
    private static func continuousSeconds() -> TimeInterval {
        var scale = mach_timebase_info_data_t()
        mach_timebase_info(&scale)
        return Double(mach_continuous_time()) * Double(scale.numer) / Double(scale.denom) / 1_000_000_000
    }
    private static func canonical(_ path: String) throws -> String {
        guard let pointer = realpath(path, nil) else { throw PackingPendingBackupError.io }
        defer { free(pointer) }; return String(cString: pointer)
    }
    private static func inode(_ url: URL) throws -> UInt64 {
        guard let number = try FileManager.default.attributesOfItem(atPath: url.path)[.systemFileNumber] as? NSNumber else { throw PackingPendingBackupError.io }
        return number.uint64Value
    }
    private static func check(_ url: URL, directory: Bool) throws {
        guard try canonical(url.path) == url.path else { throw PackingPendingBackupError.invalid }
        let info = try FileManager.default.attributesOfItem(atPath: url.path)
        guard info[.type] as? FileAttributeType == (directory ? .typeDirectory : .typeRegular),
              directory || (info[.referenceCount] as? NSNumber)?.intValue == 1 else { throw PackingPendingBackupError.invalid }
    }
    private static func protect(_ url: URL) throws {
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var target = url; try target.setResourceValues(values)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
    }
    private func checkRoot() throws {
        try Self.check(root, directory: true)
        guard try Self.inode(root) == rootInode else { throw PackingPendingBackupError.invalid }
    }
    private func url(_ ticket: String, partial: Bool = false) throws -> URL {
        guard UUID(uuidString: ticket)?.uuidString.lowercased() == ticket else { throw PackingPendingBackupError.invalid }
        try checkRoot(); return root.appendingPathComponent(ticket + (partial ? ".partial" : ".sealed"))
    }
    private func removeOwned(_ path: URL, inode: UInt64) throws {
        try checkRoot(); try Self.check(path, directory: false)
        guard path.deletingLastPathComponent() == root, try Self.inode(path) == inode else { throw PackingPendingBackupError.invalid }
        guard Darwin.unlink(path.path) == 0 else { throw PackingPendingBackupError.io }
    }
    private func context(_ ticket: String, _ scope: Scope, _ index: Int, _ final: Bool) -> Data {
        Data("packing-ios-pending-v1:\(purpose.rawValue):\(ticket):\(scope.identity):\(index):\(final ? "end" : "data")".utf8)
    }
    private func available() throws { guard !closed else { throw PackingPendingBackupError.unavailable }; try checkRoot() }
    func expire() throws {
        lock.lock(); defer { lock.unlock() }
        let now = clock()
        for entry in Array(entries.values) where !now.isFinite || now < entry.created || now - entry.created >= Self.lifetime {
            try discard(ticket: entry.ticket)
        }
    }
    /** read must return at most the requested bytes; empty Data means EOF. */
    func stage(scope: Scope, read: (Int) throws -> Data) throws -> Receipt {
        lock.lock(); defer { lock.unlock() }
        try available(); try expire()
        guard entries.count < 2 else { throw PackingPendingBackupError.full }
        let created = clock(); guard created.isFinite else { throw PackingPendingBackupError.expired }
        let ticket = UUID().uuidString.lowercased(), partial = try url(ticket, partial: true), finished = try url(ticket)
        let descriptor = Darwin.open(partial.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard descriptor >= 0 else { throw PackingPendingBackupError.io }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var info = stat(); guard fstat(descriptor, &info) == 0 else { throw PackingPendingBackupError.io }
        let original = UInt64(info.st_ino)
        let key = SymmetricKey(size: .bits256)
        let entry = Entry(ticket: ticket, scope: scope, created: created, inode: original, key: key.withUnsafeBytes { Array($0) })
        var committed = false, published = false
        defer { if !committed { entry.erase(); try? removeOwned(published ? finished : partial, inode: original) } }
        try Self.protect(partial)
        try handle.write(contentsOf: Self.magic)
        var total = 0, index = 0, eof = false
        while true {
            var chunk = Data(); chunk.reserveCapacity(Self.chunkBytes)
            defer { chunk.resetBytes(in: 0..<chunk.count) }
            while !eof && chunk.count < Self.chunkBytes {
                let requested = Self.chunkBytes - chunk.count
                var next = try read(requested)
                defer { next.resetBytes(in: 0..<next.count) }
                guard next.count <= requested, next.count <= maximum - total - chunk.count else { throw PackingPendingBackupError.invalid }
                if next.isEmpty { eof = true; break }
                chunk.append(next)
            }
            let final = chunk.isEmpty
            guard !final || total > 0 else { throw PackingPendingBackupError.invalid }
            let now = clock()
            guard now.isFinite, now >= created, now - created < Self.lifetime else { throw PackingPendingBackupError.expired }
            let box = try AES.GCM.seal(chunk, using: key, authenticating: context(ticket, scope, index, final))
            guard let combined = box.combined else { throw PackingPendingBackupError.io }
            var length = UInt32(chunk.count).littleEndian
            try withUnsafeBytes(of: &length) { try handle.write(contentsOf: Data($0)) }
            try handle.write(contentsOf: combined)
            if final { break }
            total += chunk.count; index += 1
        }
        try handle.synchronize(); try handle.close(); try checkRoot()
        try Self.check(partial, directory: false)
        guard try Self.inode(partial) == original else { throw PackingPendingBackupError.invalid }
        guard renamex_np(partial.path, finished.path, UInt32(RENAME_EXCL)) == 0 else { throw PackingPendingBackupError.io }
        published = true
        try Self.check(finished, directory: false)
        guard try Self.inode(finished) == original else { throw PackingPendingBackupError.invalid }
        entries[ticket] = entry; committed = true
        return Receipt(ticket: ticket, target: scope.target)
    }
    private func exact(_ handle: FileHandle, _ size: Int) throws -> Data {
        var data = Data(); data.reserveCapacity(size)
        while data.count < size {
            guard let chunk = try handle.read(upToCount: size - data.count), !chunk.isEmpty else { throw PackingPendingBackupError.invalid }
            data.append(chunk)
        }
        return data
    }
    private func consume(_ handle: FileHandle, entry: Entry, body: (Data) throws -> Void) throws {
        guard try exact(handle, 4) == Self.magic else { throw PackingPendingBackupError.invalid }
        let key = SymmetricKey(data: entry.key)
        var total = 0, index = 0
        while true {
            let now = clock()
            guard now.isFinite, now >= entry.created, now - entry.created < Self.lifetime else { throw PackingPendingBackupError.expired }
            let length = try exact(handle, 4)
            let count = Int(UInt32(length[0]) | UInt32(length[1]) << 8 | UInt32(length[2]) << 16 | UInt32(length[3]) << 24)
            guard count <= Self.chunkBytes, count <= maximum - total else { throw PackingPendingBackupError.invalid }
            let final = count == 0, bytes = try exact(handle, count + 28)
            var chunk = try AES.GCM.open(AES.GCM.SealedBox(combined: bytes), using: key, authenticating: context(entry.ticket, entry.scope, index, final))
            defer { chunk.resetBytes(in: 0..<chunk.count) }
            guard chunk.count == count else { throw PackingPendingBackupError.invalid }
            if final {
                guard total > 0, (try handle.read(upToCount: 1) ?? Data()).isEmpty else { throw PackingPendingBackupError.invalid }
                return
            }
            try body(chunk); total += count; index += 1
        }
    }
    /** Verify the complete stream before exposing any plaintext to a destination. */
    func read(ticket: String, scope: Scope, consume body: (Data) throws -> Void) throws {
        lock.lock(); defer { lock.unlock() }
        try available(); try expire()
        let path = try url(ticket)
        guard let entry = entries[ticket] else { throw PackingPendingBackupError.expired }
        guard scope == entry.scope else { throw PackingPendingBackupError.wrongScope }
        try Self.check(path, directory: false)
        let descriptor = Darwin.open(path.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw PackingPendingBackupError.io }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true); defer { try? handle.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_nlink == 1,
              UInt64(info.st_ino) == entry.inode, info.st_size >= 69,
              info.st_size <= off_t(maximum + (maximum / Self.chunkBytes + 2) * 32 + 4) else { throw PackingPendingBackupError.invalid }
        try consume(handle, entry: entry, body: { _ in })
        try handle.seek(toOffset: 0)
        try consume(handle, entry: entry, body: body)
        try checkRoot(); try Self.check(path, directory: false)
        guard try Self.inode(path) == entry.inode else { throw PackingPendingBackupError.invalid }
    }
    func read(ticket: String, access: PackingCaptureAuthority.Access) throws -> Data {
        try access.checked {
            let scope = try Scope(access: access)
            var data = Data()
            try read(ticket: ticket, scope: scope) { data.append($0) }
            return data
        }
    }
    func discard(ticket: String) throws {
        lock.lock(); defer { lock.unlock() }
        guard UUID(uuidString: ticket)?.uuidString.lowercased() == ticket else { throw PackingPendingBackupError.invalid }
        guard let entry = entries.removeValue(forKey: ticket) else { return }
        entry.erase()
        try removeOwned(try url(ticket), inode: entry.inode)
    }
    func close() throws {
        lock.lock(); defer { lock.unlock() }
        closed = true
        var failed = false
        for id in Array(entries.keys) { do { try discard(ticket: id) } catch { failed = true } }
        if failed { throw PackingPendingBackupError.io }
    }
}
