import Foundation

// Scan-port candidate; requires hosted qualification. Parse at SDK entry;
// retain no raw JS options or SDK object. Only the checked Sendable actor is
// handed to UI code. This does not claim guaranteed Foundation heap erasure.
actor PackingWorkspaceKey {
    private var bytes: Data?

    init(raw: Any?) {
        bytes = try? PackingCaptureBridgeValues.key(raw)
    }

    // Clear the actor's reference before returning the single-use value. The
    // UI caller must retain the existing deferred resetBytes and recheck all
    // foreground/revision/lease guards after this await, before opening storage.
    func take() -> Data? {
        let result = bytes
        bytes = nil
        return result
    }

    func erase() {
        if let count = bytes?.count { bytes?.resetBytes(in: 0..<count) }
        bytes = nil
    }

    deinit {
        if let count = bytes?.count { bytes?.resetBytes(in: 0..<count) }
    }
}
