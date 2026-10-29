import CryptoKit
import Foundation

enum PackingCaptureAuthorityError: Error { case changed, invalidIdentity, invalidKey, guest, invalidFile, authentication }

/** Runtime-only authority. Retained accesses stay bound to their original, revocable selection. */
final class PackingCaptureAuthority {
    struct State: Equatable {
        let revision: String
        let lease: String?
        let protectedWorkspace: Bool
    }
    static let idleSeconds: TimeInterval = 300
    private let lock = NSRecursiveLock()
    private let clock: () -> TimeInterval
    private var revision = UUID().uuidString.lowercased()
    private var active: Access?

    init(clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) { self.clock = clock }
    deinit { revoke() }

    func state() -> State {
        lock.lock(); defer { lock.unlock() }
        expire()
        return State(revision: revision, lease: active?.lease, protectedWorkspace: active?.workspaceID != nil)
    }
    func selectGuest(expectedRevision: String) throws -> Access {
        lock.lock(); defer { lock.unlock() }
        try requireRevision(expectedRevision)
        let next = Access(owner: self, workspace: nil, account: nil, key: nil, now: clock())
        replace(next)
        return next
    }
    func openWorkspace(expectedRevision: String, workspaceID: String, accountID: String, dataKey: Data) throws -> Access {
        lock.lock(); defer { lock.unlock() }
        try requireRevision(expectedRevision)
        guard Self.canonical(workspaceID), Self.canonical(accountID) else { throw PackingCaptureAuthorityError.invalidIdentity }
        guard dataKey.count == 32 else { throw PackingCaptureAuthorityError.invalidKey }
        let next = Access(owner: self, workspace: workspaceID, account: accountID, key: Array(dataKey), now: clock())
        replace(next)
        return next
    }
    func access(lease: String) throws -> Access {
        lock.lock(); defer { lock.unlock() }
        expire()
        guard let active, active.lease == lease else { throw PackingCaptureAuthorityError.changed }
        try check(active)
        return active
    }
    @discardableResult func close(expectedRevision: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        expire()
        guard revision == expectedRevision else { return false }
        revoke()
        return true
    }
    func close() {
        lock.lock(); defer { lock.unlock() }
        revoke()
    }
    private func requireRevision(_ expected: String) throws {
        expire()
        guard revision == expected else { throw PackingCaptureAuthorityError.changed }
    }
    private func replace(_ next: Access) {
        revoke()
        active = next
        revision = next.lease
    }
    private func revoke() {
        active?.eraseKey()
        active?.closed = true
        active = nil
        revision = UUID().uuidString.lowercased()
    }
    private func expire(at instant: TimeInterval? = nil) {
        guard let active, active.workspaceID != nil else { return }
        let now = instant ?? clock()
        if !now.isFinite || now < active.lastInteraction || now - active.lastInteraction >= Self.idleSeconds { revoke() }
    }
    private func check(_ access: Access, at instant: TimeInterval? = nil) throws {
        expire(at: instant)
        guard !access.closed, active === access else { throw PackingCaptureAuthorityError.changed }
    }
    private static func canonical(_ id: String) -> Bool { UUID(uuidString: id)?.uuidString.lowercased() == id }

    // Immutable identity plus owner-lock-protected mutable authority/key state.
    // No caller may inspect or mutate that state without checked()/touch().
    final class Access: @unchecked Sendable {
        let lease = UUID().uuidString.lowercased()
        let workspaceID: String?
        let accountID: String?
        private weak var owner: PackingCaptureAuthority?
        fileprivate var closed = false
        fileprivate var lastInteraction: TimeInterval
        private var key: [UInt8]?
        private static let magic = Data([0x50, 0x53, 0x43, 0x31])
        private static let storeMarker = Data("packing-protected-store-key-v1".utf8)

        fileprivate init(owner: PackingCaptureAuthority, workspace: String?, account: String?, key: [UInt8]?, now: TimeInterval) {
            self.owner = owner; workspaceID = workspace; accountID = account; self.key = key; lastInteraction = now
        }
        fileprivate func eraseKey() {
            if key != nil { for index in key!.indices { key![index] = 0 } }
            key = nil
        }
        deinit { eraseKey() }

        /** Only an accepted explicit interaction renews the idle window. */
        func touch() throws {
            guard let owner else { throw PackingCaptureAuthorityError.changed }
            owner.lock.lock(); defer { owner.lock.unlock() }
            let now = owner.clock()
            try owner.check(self, at: now)
            lastInteraction = now
            try owner.check(self)
        }
        /** Revoke only this exact current lease, using the existing owner/lock.
         * No new authority reference, key alias or unchecked conformance is added.
         * A stale capability must never close a newer selected workspace.
         */
        func revokeCurrentLease() {
            guard let owner else { return }
            owner.lock.lock(); defer { owner.lock.unlock() }
            guard owner.active === self else { return }
            owner.revoke()
        }
        func check() throws { try checked {} }
        func checked<T>(_ operation: () throws -> T) throws -> T {
            guard let owner else { throw PackingCaptureAuthorityError.changed }
            owner.lock.lock(); defer { owner.lock.unlock() }
            try owner.check(self)
            let result = try operation()
            try owner.check(self)
            return result
        }

        private func fileContext(_ id: String, _ name: String) throws -> (Data, Int) {
            guard PackingCaptureAuthority.canonical(id) else { throw PackingCaptureAuthorityError.invalidIdentity }
            let maximum: Int
            switch name {
            case "points.ply": maximum = 8_000_000
            case "capture.json": maximum = 20_000
            default: throw PackingCaptureAuthorityError.invalidFile
            }
            guard let workspaceID, let accountID else { throw PackingCaptureAuthorityError.guest }
            return (Data("packing-scanning-native-capture-v1:\(workspaceID):\(accountID):\(id):\(name)".utf8), maximum)
        }
        func seal(captureID: String, name: String, plaintext: Data) throws -> Data {
            try checked {
                let (context, maximum) = try fileContext(captureID, name)
                guard let key else { throw PackingCaptureAuthorityError.guest }
                guard plaintext.count <= maximum else { throw PackingCaptureAuthorityError.invalidFile }
                let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: Data(key)), authenticating: context)
                guard let combined = box.combined else { throw PackingCaptureAuthorityError.authentication }
                return Self.magic + combined
            }
        }
        func unseal(captureID: String, name: String, ciphertext: Data) throws -> Data {
            try checked {
                let (context, maximum) = try fileContext(captureID, name)
                guard let key else { throw PackingCaptureAuthorityError.guest }
                guard ciphertext.count >= 32, ciphertext.count <= maximum + 32, ciphertext.starts(with: Self.magic) else {
                    throw PackingCaptureAuthorityError.invalidFile
                }
                do {
                    let box = try AES.GCM.SealedBox(combined: ciphertext.dropFirst(4))
                    return try AES.GCM.open(box, using: SymmetricKey(data: Data(key)), authenticating: context)
                } catch { throw PackingCaptureAuthorityError.authentication }
            }
        }
        private func storeKeyContext() throws -> Data {
            guard let workspaceID, let accountID, key != nil else { throw PackingCaptureAuthorityError.guest }
            return Data("packing-scanning-ios-store-key-v1:\(workspaceID):\(accountID)".utf8)
        }
        func sealStoreKeyCheck() throws -> Data {
            try checked {
                let context = try storeKeyContext()
                guard let key else { throw PackingCaptureAuthorityError.guest }
                let box = try AES.GCM.seal(Self.storeMarker, using: SymmetricKey(data: Data(key)), authenticating: context)
                guard let combined = box.combined else { throw PackingCaptureAuthorityError.authentication }
                return Self.magic + combined
            }
        }
        func verifyStoreKeyCheck(_ data: Data) throws {
            try checked {
                let context = try storeKeyContext()
                guard let key, data.count == Self.storeMarker.count + 32, data.starts(with: Self.magic) else { throw PackingCaptureAuthorityError.invalidFile }
                do {
                    let box = try AES.GCM.SealedBox(combined: data.dropFirst(4))
                    let plaintext = try AES.GCM.open(box, using: SymmetricKey(data: Data(key)), authenticating: context)
                    guard plaintext == Self.storeMarker else { throw PackingCaptureAuthorityError.authentication }
                } catch { throw PackingCaptureAuthorityError.authentication }
            }
        }
    }
}
