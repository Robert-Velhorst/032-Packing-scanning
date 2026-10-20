import Darwin
import Foundation

/** One process-only key store survives bridge reloads. All provider IO uses this serial worker. */
final class PackingBackupRuntime: @unchecked Sendable {
    static let shared = PackingBackupRuntime()
    let worker = DispatchQueue(label: "com.packingscanning.backup-provider")
    let budget = PackingCaptureQueueBudget()
    private var store: PackingPendingBackupStore? // worker only
    private var timer: DispatchSourceTimer?
    private init() {
        let timer = DispatchSource.makeTimerSource(queue: worker)
        timer.schedule(deadline: .now() + 60, repeating: 60)
        timer.setEventHandler { [weak self] in try? self?.store?.expire() }
        self.timer = timer; timer.resume()
    }
    func pendingStore() throws -> PackingPendingBackupStore {
        dispatchPrecondition(condition: .onQueue(worker))
        if let store { return store }
        let cache = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = try PackingBackupDirectory.prepare(parent: cache)
        let value = try PackingPendingBackupStore(directory: root); store = value; return value
    }
}

/** Startup erases only recognizable ciphertext in this app-owned, marked flat directory. */
enum PackingBackupDirectory {
    enum Kind {
        case backup, itemPhoto
        var directory: String { self == .backup ? "PackingPendingBackups-v1" : "PackingPendingItemPhotos-v1" }
        var marker: Data { Data((self == .backup ? "packing-ios-backup-cache-v1\n" : "packing-ios-item-photo-cache-v1\n").utf8) }
    }
    static func prepare(parent: URL, kind: Kind = .backup) throws -> URL {
        let marker = kind.marker
        let fm = FileManager.default, root = parent.appendingPathComponent(kind.directory, isDirectory: true)
        var before = stat()
        if lstat(root.path, &before) != 0 {
            guard errno == ENOENT else { throw PackingPendingBackupError.io }
            try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let descriptor = Darwin.open(root.appendingPathComponent(".owner").path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
            guard descriptor >= 0 else { throw PackingPendingBackupError.io }
            let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
            defer { try? handle.close() }; try handle.write(contentsOf: marker); try handle.synchronize()
        }
        let descriptor = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw PackingPendingBackupError.invalid }
        defer { Darwin.close(descriptor) }
        var owned = stat()
        guard fstat(descriptor, &owned) == 0, owned.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) else { throw PackingPendingBackupError.invalid }
        let markerFD = Darwin.openat(descriptor, ".owner", O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard markerFD >= 0 else { throw PackingPendingBackupError.invalid }
        let markerHandle = FileHandle(fileDescriptor: markerFD, closeOnDealloc: true); defer { try? markerHandle.close() }
        var info = stat()
        guard fstat(markerFD, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_nlink == 1,
              info.st_size == marker.count, try markerHandle.read(upToCount: marker.count + 1) == marker else { throw PackingPendingBackupError.invalid }
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var protectedRoot = root; try protectedRoot.setResourceValues(values)
        #if os(iOS)
        try fm.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: root.path)
        try fm.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: root.appendingPathComponent(".owner").path)
        #endif
        // No recursive removal. Unknown names, directories, links and malformed files remain untouched.
        for name in try fm.contentsOfDirectory(atPath: root.path) {
            let parts = name.split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count == 2, ["sealed", "partial"].contains(String(parts[1])),
                  UUID(uuidString: String(parts[0]))?.uuidString.lowercased() == String(parts[0]) else { continue }
            let file = Darwin.openat(descriptor, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
            guard file >= 0 else { continue }
            let handle = FileHandle(fileDescriptor: file, closeOnDealloc: true)
            defer { try? handle.close() }
            var original = stat(), current = stat()
            guard fstat(file, &original) == 0, original.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), original.st_nlink == 1,
                  original.st_size >= 4, original.st_size <= PackingPendingBackupStore.maximumBytes + 100_000,
                  try handle.read(upToCount: 4) == Data("PPB1".utf8),
                  fstatat(descriptor, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
                  current.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), current.st_nlink == 1,
                  current.st_dev == original.st_dev, current.st_ino == original.st_ino else { continue }
            guard Darwin.unlinkat(descriptor, name, 0) == 0 else { throw PackingPendingBackupError.io }
        }
        guard lstat(root.path, &before) == 0, before.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              before.st_dev == owned.st_dev, before.st_ino == owned.st_ino else { throw PackingPendingBackupError.invalid }
        return root
    }
}
