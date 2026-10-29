import Foundation

// UNAPPLIED: lifecycle-only state for an app-created guest scan. Callers must
// create and register the scan on MainActor without an intervening suspension.
// Registry delivery and cancellation must have exactly one terminal outcome.
@MainActor
final class PackingGuestScanOwnership {
    enum Phase: Equatable {
        case awaitingCreation
        case owned(String)
        case abandoned
        case cleanupPending(String)
        case delivered(String)
    }
    private(set) var phase: Phase = .awaitingCreation
    private var claimedID: String?
    private let removeOwned: @MainActor (String) throws -> Void

    init(removeOwned: @escaping @MainActor (String) throws -> Void) {
        self.removeOwned = removeOwned
    }

    // Returns false for a cancelled, duplicate or noncanonical ID. If a scan
    // was created after cancellation was registered, its owned folder is removed.
    @discardableResult func registerCreated(_ id: String) throws -> Bool {
        guard claimedID == nil, UUID(uuidString: id)?.uuidString.lowercased() == id else { return false }
        claimedID = id
        switch phase {
        case .awaitingCreation:
            phase = .owned(id)
            return true
        case .abandoned:
            phase = .cleanupPending(id)
            try retryCleanup()
            return false
        case .owned, .cleanupPending, .delivered:
            return false
        }
    }

    // A delivered scan is no longer cleanup-owned. Only invoke after actual SDK
    // success delivery; enqueuing a response alone is insufficient.
    @discardableResult func markDelivered() -> Bool {
        guard case .owned(let id) = phase else { return false }
        phase = .delivered(id)
        return true
    }

    func abandon() throws {
        switch phase {
        case .awaitingCreation: phase = .abandoned
        case .owned(let id):
            phase = .cleanupPending(id)
            try retryCleanup()
        case .cleanupPending: try retryCleanup()
        case .abandoned, .delivered: break
        }
    }

    func retryCleanup() throws {
        guard case .cleanupPending(let id) = phase else { return }
        try removeOwned(id)
        phase = .abandoned
    }
}
