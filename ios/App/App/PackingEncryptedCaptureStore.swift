import Darwin
import Foundation

enum PackingEncryptedStoreError: Error { case unsafePath, invalidCapture, occupied, io }

/** Opaque authenticated point/metadata storage, bound permanently to one live access. */
final class PackingEncryptedCaptureStore {
    private let manager = FileManager.default
    private let access: PackingCaptureAuthority.Access
    let root: URL
    private let base: URL
    private let beforePublish: () throws -> Void
    private static let names: Set<String> = ["capture.json.sealed", "points.ply.sealed"]

    init(directory: URL, access: PackingCaptureAuthority.Access, beforePublish: @escaping () throws -> Void = {}) throws {
        try access.check()
        guard directory.isFileURL, let account = access.accountID, let workspace = access.workspaceID else {
            throw PackingCaptureAuthorityError.guest
        }
        self.access = access; self.beforePublish = beforePublish
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
    private func writeExclusive(_ data: Data, to url: URL) throws {
        let descriptor = Darwin.open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard descriptor >= 0 else { throw PackingEncryptedStoreError.io }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        try protect(url)
        try handle.write(contentsOf: data)
        try handle.synchronize()
        try handle.close()
    }
    private func syncDirectory(_ url: URL) throws {
        let descriptor = Darwin.open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw PackingEncryptedStoreError.io }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        try handle.synchronize()
        try handle.close()
    }
    private func inode(_ url: URL) throws -> UInt64 {
        try check(url, directory: true)
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

    func write(captureID: String, metadata: Data, points: Data) throws {
        var allocated: URL?
        var allocationInode: UInt64?
        do {
            try access.checked {
                let destination = try captureURL(captureID)
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
                try access.check(); try checkRoot()
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
        try access.checked { try access.unseal(captureID: captureID, name: "capture.json", ciphertext: readSealed("capture.json", captureID: captureID, maximum: 20000)) }
    }
    func readPoints(captureID: String) throws -> Data {
        try access.checked { try access.unseal(captureID: captureID, name: "points.ply", ciphertext: readSealed("points.ply", captureID: captureID, maximum: 8_000_000)) }
    }
    @discardableResult func delete(captureID: String) throws -> Bool {
        try access.checked {
            let folder = try captureURL(captureID)
            guard manager.fileExists(atPath: folder.path) else { return false }
            try check(folder, directory: true)
            let contents = try manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            guard Set(contents.map(\.lastPathComponent)) == Self.names else { throw PackingEncryptedStoreError.invalidCapture }
            for child in contents { try check(child, directory: false) }
            _ = try readMetadata(captureID: captureID)
            _ = try readPoints(captureID: captureID)
            try access.check(); try checkRoot()
            try manager.removeItem(at: folder)
            try syncDirectory(root)
            return true
        }
    }
}
