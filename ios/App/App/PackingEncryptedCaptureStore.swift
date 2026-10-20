import Darwin
import CoreFoundation
import Foundation

enum PackingEncryptedStoreError: Error { case unsafePath, invalidCapture, occupied, io }

struct PackingScanRetentionPolicy: Sendable {
    let days: Int
    let afterID: String?
    static func parse(_ raw: [String: Any]) throws -> Self {
        guard let number = raw["days"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              [7.0,30,90].contains(number.doubleValue) else { throw PackingEncryptedStoreError.invalidCapture }
        var after: String?
        if let rawID = raw["afterId"] {
            guard let id = rawID as? String, UUID(uuidString: id)?.uuidString.lowercased() == id else { throw PackingEncryptedStoreError.invalidCapture }
            after = id
        }
        return Self(days: number.intValue, afterID: after)
    }
}

/** Opaque authenticated point/metadata storage, bound permanently to one live access. */
// Immutable selection/paths; all filesystem operations serialize through access.checked.
// Injected callbacks must themselves be Sendable. No mutable store field escapes that boundary.
final class PackingEncryptedCaptureStore: @unchecked Sendable {
    private let manager = FileManager.default
    private let access: PackingCaptureAuthority.Access
    let root: URL
    private let base: URL
    private let beforePublish: @Sendable () throws -> Void
    private let clock: @Sendable () -> Date
    // Immutable selection identity; comparing it does not acquire another authority's lock.
    let boundLease: String
    private static let names: Set<String> = ["capture.json.sealed", "points.ply.sealed"]

    init(directory: URL, access: PackingCaptureAuthority.Access, beforePublish: @escaping @Sendable () throws -> Void = {}, clock: @escaping @Sendable () -> Date = { Date() }) throws {
        try access.check()
        guard directory.isFileURL, let account = access.accountID, let workspace = access.workspaceID else {
            throw PackingCaptureAuthorityError.guest
        }
        self.access = access; self.beforePublish = beforePublish; self.clock = clock; boundLease = access.lease
        let privateBase = URL(fileURLWithPath: try Self.canonical(directory.path), isDirectory: true)
        base = privateBase
        let namespace = privateBase.appendingPathComponent("ProtectedScanCaptures-v1", isDirectory: true)
        root = namespace.appendingPathComponent(account, isDirectory: true).appendingPathComponent(workspace, isDirectory: true)
        try access.checked {
            try check(base, directory: true)
            for url in [namespace, namespace.appendingPathComponent(account, isDirectory: true), root] {
                if !manager.fileExists(atPath: url.path) { try manager.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
                try check(url, directory: true)
                try protect(url)
            }
            try ensureKeyCheck()
        }
    }

    private static func canonical(_ path: String) throws -> String {
        guard let pointer = realpath(path, nil) else { throw PackingEncryptedStoreError.unsafePath }
        defer { free(pointer) }
        return String(cString: pointer)
    }
    private func check(_ url: URL, directory: Bool) throws {
        guard url.isFileURL, try Self.canonical(url.path) == url.path,
              url.path == base.path || url.path.hasPrefix(base.path + "/") else { throw PackingEncryptedStoreError.unsafePath }
        let attributes = try manager.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == (directory ? .typeDirectory : .typeRegular),
              directory || (attributes[.referenceCount] as? NSNumber)?.intValue == 1 else { throw PackingEncryptedStoreError.unsafePath }
    }
    private func checkRoot() throws {
        try check(base, directory: true)
        try check(root, directory: true)
    }
    private func protect(_ url: URL) throws {
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var target = url; try target.setResourceValues(values)
        #if os(iOS)
        try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
    }
    private func captureURL(_ id: String) throws -> URL {
        guard UUID(uuidString: id)?.uuidString.lowercased() == id else { throw PackingEncryptedStoreError.invalidCapture }
        try checkRoot()
        return root.appendingPathComponent(id, isDirectory: true)
    }
    @discardableResult private func writeExclusive(_ data: Data, to url: URL) throws -> UInt64 {
        let descriptor = Darwin.open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard descriptor >= 0 else { throw PackingEncryptedStoreError.io }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        try protect(url)
        try handle.write(contentsOf: data)
        try handle.synchronize()
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_nlink == 1,
              (info.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG) else { throw PackingEncryptedStoreError.unsafePath }
        try handle.close()
        return UInt64(info.st_ino)
    }
    private func syncDirectory(_ url: URL) throws {
        let descriptor = Darwin.open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw PackingEncryptedStoreError.io }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        try handle.synchronize()
        try handle.close()
    }
    private func ensureKeyCheck() throws {
        let marker = root.appendingPathComponent(".keycheck")
        if manager.fileExists(atPath: marker.path) { try verifyKeyCheck(); return }
        guard try manager.contentsOfDirectory(atPath: root.path).isEmpty else { throw PackingEncryptedStoreError.unsafePath }
        let temporary = root.appendingPathComponent(".keycheck.pending-" + UUID().uuidString.lowercased())
        let writtenInode = try writeExclusive(access.sealStoreKeyCheck(), to: temporary)
        if renamex_np(temporary.path, marker.path, UInt32(RENAME_EXCL)) != 0 {
            let failure = errno
            // Only this newly written regular file is eligible for cleanup.
            do {
                try check(temporary, directory: false)
                guard (try manager.attributesOfItem(atPath: temporary.path)[.systemFileNumber] as? NSNumber)?.uint64Value == writtenInode else { throw PackingEncryptedStoreError.unsafePath }
                try manager.removeItem(at: temporary)
            } catch {}
            guard failure == EEXIST else { throw PackingEncryptedStoreError.io }
        }
        try syncDirectory(root)
        try verifyKeyCheck()
    }
    private func verifyKeyCheck() throws {
        try access.verifyStoreKeyCheck(readFile(root.appendingPathComponent(".keycheck"), maximum: 128))
    }
    private func inode(_ url: URL, directory: Bool = true) throws -> UInt64 {
        try check(url, directory: directory)
        guard let number = try manager.attributesOfItem(atPath: url.path)[.systemFileNumber] as? NSNumber else { throw PackingEncryptedStoreError.unsafePath }
        return number.uint64Value
    }
    /** Roll back only the newly allocated inode and recognized regular encrypted children. */
    private func rollback(_ url: URL, expectedInode: UInt64) {
        do {
            try checkRoot()
            guard try inode(url) == expectedInode else { return }
            let contents = try manager.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)
            guard Set(contents.map(\.lastPathComponent)).isSubset(of: Self.names) else { return }
            for child in contents { try check(child, directory: false) }
            try manager.removeItem(at: url)
        } catch { /* A keyless encrypted orphan is safer than deleting uncertain files. */ }
    }

    /** Native-owned identity/time; invalid geometry never reaches staging. */
    func savePointCapture(target: PackingPointCapture.Target, points: Data, depthQuality: PackingPointCapture.DepthQuality? = nil) throws -> PackingPointCapture {
        try access.checked {
            let capture = try PackingPointCapture.complete(target: target, points: points, now: clock(), depthQuality: depthQuality)
            try write(captureID: capture.id, metadata: capture.metadata, points: capture.points)
            return capture
        }
    }
    func readPointCapture(captureID: String) throws -> PackingPointCapture {
        try access.checked {
            try PackingPointCapture.restore(captureID: captureID, metadata: readMetadata(captureID: captureID),
                points: readPoints(captureID: captureID), now: clock())
        }
    }

    // Opaque persistence primitive. Product point-cloud consumers must use the validated methods above.
    func write(captureID: String, metadata: Data, points: Data) throws {
        var allocated: URL?
        var allocationInode: UInt64?
        do {
            try access.checked {
                let destination = try captureURL(captureID)
                try verifyKeyCheck()
                guard !metadata.isEmpty, !points.isEmpty else { throw PackingEncryptedStoreError.invalidCapture }
                let sealedMetadata = try access.seal(captureID: captureID, name: "capture.json", plaintext: metadata)
                let sealedPoints = try access.seal(captureID: captureID, name: "points.ply", plaintext: points)
                try checkRoot()
                guard !manager.fileExists(atPath: destination.path) else { throw PackingEncryptedStoreError.occupied }
                let staging = root.appendingPathComponent(".pending-" + captureID + "-" + UUID().uuidString.lowercased(), isDirectory: true)
                try manager.createDirectory(at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                allocated = staging; allocationInode = try inode(staging)
                try protect(staging)
                try writeExclusive(sealedMetadata, to: staging.appendingPathComponent("capture.json.sealed"))
                try writeExclusive(sealedPoints, to: staging.appendingPathComponent("points.ply.sealed"))
                try syncDirectory(staging)
                try beforePublish()
                try access.check(); try checkRoot(); try verifyKeyCheck()
                if renamex_np(staging.path, destination.path, UInt32(RENAME_EXCL)) != 0 {
                    if errno == EEXIST { throw PackingEncryptedStoreError.occupied }
                    throw PackingEncryptedStoreError.io
                }
                allocated = destination
                try syncDirectory(root)
            }
        } catch {
            if let allocated, let allocationInode { rollback(allocated, expectedInode: allocationInode) }
            throw error
        }
    }

    private func readSealed(_ name: String, captureID: String, maximum: Int) throws -> Data {
        let folder = try captureURL(captureID)
        try check(folder, directory: true)
        let url = folder.appendingPathComponent(name + ".sealed")
        return try readFile(url, maximum: maximum)
    }
    private func readFile(_ url: URL, maximum: Int) throws -> Data {
        try check(url, directory: false)
        let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw PackingEncryptedStoreError.io }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG), info.st_nlink == 1,
              info.st_size >= 32, info.st_size <= off_t(maximum + 32) else { throw PackingEncryptedStoreError.invalidCapture }
        var data = Data()
        while let chunk = try handle.read(upToCount: min(65536, maximum + 33 - data.count)), !chunk.isEmpty {
            data.append(chunk)
            guard data.count <= maximum + 32 else { throw PackingEncryptedStoreError.invalidCapture }
        }
        try handle.close(); try checkRoot(); try check(url, directory: false)
        return data
    }
    func readMetadata(captureID: String) throws -> Data {
        try access.checked {
            try verifyKeyCheck()
            let data = try access.unseal(captureID: captureID, name: "capture.json", ciphertext: readSealed("capture.json", captureID: captureID, maximum: 20000))
            try verifyKeyCheck(); return data
        }
    }
    func readPoints(captureID: String) throws -> Data {
        try access.checked {
            try verifyKeyCheck()
            let data = try access.unseal(captureID: captureID, name: "points.ply", ciphertext: readSealed("points.ply", captureID: captureID, maximum: 8_000_000))
            try verifyKeyCheck(); return data
        }
    }
    /** Authenticate exactly owned files; retained metadata alone is valid only with typed depth provenance. */
    private func authenticatedFiles(captureID: String, now: Date) throws -> (URL, Bool) {
        let folder = try captureURL(captureID); try check(folder, directory: true)
        let files = try manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        let names = Set(files.map(\.lastPathComponent))
        guard names == Self.names || names == ["capture.json.sealed"] else { throw PackingEncryptedStoreError.invalidCapture }
        for file in files { try check(file, directory: false) }
        let metadata = try readMetadata(captureID: captureID)
        let hasPoints = names.contains("points.ply.sealed")
        if hasPoints { _ = try readPoints(captureID: captureID) }
        else { _ = try PackingPointCapture.validatedDepthCompletionDate(captureID: captureID, metadata: metadata, now: now) }
        return (folder, hasPoints)
    }
    /** Stream top-level names, retaining only the next 100 IDs and one lookahead ID. */
    private func retentionWindow(afterID: String?) throws -> [String] {
        try checkRoot(); try verifyKeyCheck()
        let original = try inode(root)
        guard let directory = Darwin.opendir(root.path) else { throw PackingEncryptedStoreError.io }
        defer { Darwin.closedir(directory) }
        var candidates: [String] = [], count = 0
        while true {
            errno = 0
            guard let entry = Darwin.readdir(directory) else {
                guard errno == 0 else { throw PackingEncryptedStoreError.io }
                break
            }
            count += 1
            guard count <= 1_000_000 else { throw PackingEncryptedStoreError.invalidCapture }
            if count % 128 == 0 { try access.check() }
            guard entry.pointee.d_namlen == 36 else { continue }
            let name = withUnsafeBytes(of: entry.pointee.d_name) { String(decoding: $0.prefix(36), as: UTF8.self) }
            guard name.utf8.count == 36, UUID(uuidString: name)?.uuidString.lowercased() == name,
                  afterID == nil || name > afterID! else { continue }
            var low = 0, high = candidates.count
            while low < high { let middle = (low + high) / 2; if candidates[middle] < name { low = middle + 1 } else { high = middle } }
            if low < 101 { candidates.insert(name, at: low); if candidates.count > 101 { candidates.removeLast() } }
        }
        try access.check(); try checkRoot(); try verifyKeyCheck()
        guard try inode(root) == original else { throw PackingEncryptedStoreError.unsafePath }
        return candidates
    }
    /** Explicit opt-in policy only; native age, original lease, no web paths or timestamps. */
    func pruneExpiredSources(_ policy: PackingScanRetentionPolicy) throws -> [String: Any] {
        try access.checked {
            guard [7,30,90].contains(policy.days), policy.afterID == nil || UUID(uuidString: policy.afterID!)?.uuidString.lowercased() == policy.afterID else {
                throw PackingEncryptedStoreError.invalidCapture
            }
            try checkRoot(); try verifyKeyCheck()
            let now = clock(), age = now.timeIntervalSince1970
            guard age.isFinite, age >= Double(policy.days) * 86400, age <= 253_402_300_799 else { throw PackingEncryptedStoreError.invalidCapture }
            let cutoff = now.addingTimeInterval(-Double(policy.days) * 86400)
            let ids = try retentionWindow(afterID: policy.afterID)
            let batch = Array(ids.prefix(100))
            var removed: [String] = [], deleted = 0, skipped = 0, failed = 0
            for id in batch {
                try autoreleasepool {
                    try access.check(); try checkRoot(); try verifyKeyCheck()
                    let completed: Date
                    do { completed = try PackingPointCapture.validatedDepthCompletionDate(captureID: id, metadata: readMetadata(captureID: id), now: now) }
                    catch { try access.check(); skipped += 1; return }
                    guard completed <= cutoff else { return }
                    do {
                        let (folder, hasPoints) = try authenticatedFiles(captureID: id, now: now)
                        if hasPoints {
                            let source = folder.appendingPathComponent("points.ply.sealed")
                            let original = try inode(source, directory: false)
                            try access.check(); try checkRoot(); try verifyKeyCheck(); try check(source, directory: false)
                            guard try inode(source, directory: false) == original else { throw PackingEncryptedStoreError.unsafePath }
                            guard Darwin.unlink(source.path) == 0 else { throw PackingEncryptedStoreError.io }
                            try syncDirectory(folder)
                            guard !manager.fileExists(atPath: source.path) else { throw PackingEncryptedStoreError.io }
                            deleted += 1
                        }
                        removed.append(id)
                    } catch { try access.check(); failed += 1 }
                }
            }
            try access.check(); try checkRoot(); try verifyKeyCheck()
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
            return ["version": 1,"confirmedAt": formatter.string(from: now),"removedIds": removed,"checkedCount": batch.count,
                    "deletedCount": deleted,"skippedCount": skipped,"failedCount": failed,"nextCursor": ids.count > batch.count ? batch.last! as Any : NSNull()]
        }
    }
    @discardableResult func delete(captureID: String) throws -> Bool {
        try access.checked {
            try verifyKeyCheck()
            guard manager.fileExists(atPath: try captureURL(captureID).path) else { return false }
            let (folder, _) = try authenticatedFiles(captureID: captureID, now: clock())
            try access.check(); try checkRoot()
            try manager.removeItem(at: folder)
            try syncDirectory(root)
            return true
        }
    }
    func clearCaptures() throws -> Int {
        try access.checked {
            try checkRoot(); try verifyKeyCheck()
            func visit(_ action: (String) throws -> Void) throws {
                var after: String?
                while true {
                    let ids = try retentionWindow(afterID: after), batch = Array(ids.prefix(100))
                    for id in batch { try autoreleasepool { try action(id) } }
                    guard ids.count > batch.count else { break }
                    after = batch.last
                }
            }
            // Complete global preflight before any deletion. Unknown/orphan names stay untouched.
            try visit { _ = try authenticatedFiles(captureID: $0, now: clock()) }
            var removed = 0
            try visit { if try delete(captureID: $0) { removed += 1 } }
            return removed
        }
    }
}
