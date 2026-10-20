import CoreFoundation
import Foundation

enum PackingCaptureBridgeValues {
    static func key(_ raw: Any?) throws -> Data {
        guard let values = raw as? [Any], values.count == 32 else { throw PackingCaptureAuthorityError.invalidKey }
        var bytes = Data(repeating: 0, count: 32)
        for (index, value) in values.enumerated() {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue <= 255,
                  number.doubleValue.rounded(.down) == number.doubleValue else {
                bytes.resetBytes(in: 0..<bytes.count); throw PackingCaptureAuthorityError.invalidKey
            }
            bytes[index] = UInt8(number.doubleValue)
        }
        return bytes
    }
    static func state(_ state: PackingCaptureAuthority.State) -> [String: Any] {
        ["version": 1, "revision": state.revision, "lease": state.lease.map { $0 as Any } ?? NSNull(), "protectedWorkspace": state.protectedWorkspace]
    }
    static func lockProtected(_ authority: PackingCaptureAuthority) {
        let state = authority.state()
        if state.protectedWorkspace { authority.close(expectedRevision: state.revision) }
    }
}

/** Lock-isolated pending count for native I/O; no plugin/UI object crosses the worker boundary. */
final class PackingCaptureQueueBudget: @unchecked Sendable {
    private let lock = NSLock()
    private var pending = 0
    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard pending < 8 else { return false }; pending += 1; return true
    }
    func release() { lock.lock(); defer { lock.unlock() }; precondition(pending > 0); pending -= 1 }
}
