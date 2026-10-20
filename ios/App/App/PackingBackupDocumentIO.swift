import Darwin
import Foundation

enum PackingBackupDocumentError: Error, Sendable { case unavailable, invalid, writeFailed }

/** Called only inside an active security-scoped/coordinated provider claim. No web paths. */
enum PackingBackupDocumentIO {
    static func importFile(_ url: URL, store: PackingPendingBackupStore,
                           scope: PackingPendingBackupStore.Scope) throws -> PackingPendingBackupStore.Receipt {
        guard url.isFileURL else { throw PackingBackupDocumentError.invalid }
        let descriptor = Darwin.open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw PackingBackupDocumentError.unavailable }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true); defer { try? handle.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_nlink == 1, info.st_size > 0, info.st_size <= PackingPendingBackupStore.maximumBytes else {
            throw PackingBackupDocumentError.invalid
        }
        return try store.stage(scope: scope) { try handle.read(upToCount: $0) ?? Data() }
    }

    /** Exclusive creation in the selected directory. An error never overwrites an older backup. */
    static func exportFile(to folder: URL, ticket: String, store: PackingPendingBackupStore,
                           scope: PackingPendingBackupStore.Scope,
                           write: (FileHandle, Data) throws -> Void = { try $0.write(contentsOf: $1) }) throws -> String {
        guard folder.isFileURL else { throw PackingBackupDocumentError.invalid }
        let directory = Darwin.open(folder.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw PackingBackupDocumentError.unavailable }
        defer { Darwin.close(directory) }
        let name = "packing-scanning-backup-" + UUID().uuidString.lowercased() + ".json"
        let descriptor = Darwin.openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard descriptor >= 0 else { throw PackingBackupDocumentError.writeFailed }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true); defer { try? handle.close() }
        var created = stat()
        guard fstat(descriptor, &created) == 0 else { throw PackingBackupDocumentError.writeFailed }
        var finished = false
        defer {
            if !finished {
                var current = stat()
                if fstatat(directory, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
                   current.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), current.st_nlink == 1,
                   current.st_dev == created.st_dev, current.st_ino == created.st_ino {
                    _ = Darwin.unlinkat(directory, name, 0)
                }
            }
        }
        try store.read(ticket: ticket, scope: scope) { try write(handle, $0) }
        try handle.synchronize()
        var current = stat()
        guard fstatat(directory, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
              current.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), current.st_nlink == 1,
              current.st_dev == created.st_dev, current.st_ino == created.st_ino else { throw PackingBackupDocumentError.writeFailed }
        try handle.close(); finished = true
        return name
    }
}

/** NSFileCoordinator's synchronous accessor reports through a lock-bound result slot. */
private final class PackingCoordinatedResult<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, PackingBackupDocumentError>?
    func set(_ value: Result<Value, PackingBackupDocumentError>) { lock.lock(); defer { lock.unlock() }; result = value }
    func get() throws -> Value {
        lock.lock(); defer { lock.unlock() }
        guard let result else { throw PackingBackupDocumentError.unavailable }; return try result.get()
    }
}

enum PackingBackupProvider {
    static func importFile(_ url: URL, store: PackingPendingBackupStore,
                           scope: PackingPendingBackupStore.Scope) throws -> PackingPendingBackupStore.Receipt {
        guard url.isFileURL, url.startAccessingSecurityScopedResource() else { throw PackingBackupDocumentError.unavailable }
        defer { url.stopAccessingSecurityScopedResource() }
        let result = PackingCoordinatedResult<PackingPendingBackupStore.Receipt>()
        var error: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &error) { coordinated in
            do { result.set(.success(try PackingBackupDocumentIO.importFile(coordinated, store: store, scope: scope))) }
            catch { result.set(.failure(.invalid)) }
        }
        guard error == nil else { throw PackingBackupDocumentError.unavailable }; return try result.get()
    }
    static func exportFile(to folder: URL, ticket: String, store: PackingPendingBackupStore,
                           scope: PackingPendingBackupStore.Scope) throws {
        guard folder.isFileURL, folder.startAccessingSecurityScopedResource() else { throw PackingBackupDocumentError.unavailable }
        defer { folder.stopAccessingSecurityScopedResource() }
        let result = PackingCoordinatedResult<Bool>()
        var error: NSError?
        NSFileCoordinator().coordinate(writingItemAt: folder, options: .forMerging, error: &error) { coordinated in
            do { _ = try PackingBackupDocumentIO.exportFile(to: coordinated, ticket: ticket, store: store, scope: scope); result.set(.success(true)) }
            catch { result.set(.failure(.writeFailed)) }
        }
        guard error == nil else { throw PackingBackupDocumentError.writeFailed }; _ = try result.get()
    }
}
