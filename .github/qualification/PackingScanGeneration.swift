// UNSAFE DRAFT: guard-installation failure does not prove cleanup ownership; do not integrate.
// See scan-cleanup-authorization-race-review.json.
import Capacitor
import Foundation
#if canImport(PackingSDKCallbacks)
import PackingSDKCallbacks
#endif

// UNAPPLIED: app-owned, immutable metadata only. The callback registry remains
// responsible for SDK object confinement and owner-generation validation.
struct PackingScanGeneration: Sendable, Equatable {
    let owner: String
    let epoch: String

    func installRevocation(_ access: PackingCaptureAuthority.Access) -> Bool {
        let revoke: @Sendable () -> Void = { access.revokeCurrentLease() }
        return PackingCallbacksSetRevocationForEpoch(owner, epoch, revoke)
    }

    func notify(_ event: String, data: [String: Any]) -> Bool {
        guard let bytes = try? JSONSerialization.data(withJSONObject: data) else { return false }
        return PackingCallbacksNotifyOwnerForEpoch(owner, epoch, event, bytes)
    }
}

// No CAPPluginCall, plugin, raw options, or key crosses the actor boundary.
struct PackingScanReply: Sendable {
    private let token: String
    let generation: PackingScanGeneration

    init?(call: CAPPluginCall, sdkQueue: DispatchQueue, owner: String) {
        dispatchPrecondition(condition: .onQueue(sdkQueue))
        guard let token = PackingCallbacksRegister(call, sdkQueue, owner) else { return nil }
        guard let epoch = PackingCallbacksTokenEpoch(token) else {
            // The owner was absent or reset/cancelled between registration and
            // metadata capture. Reject if still pending; cancellation may win.
            _ = PackingCallbacksReject(token, "The capture workspace changed.", "STORAGE_CHANGED")
            return nil
        }
        self.token = token
        self.generation = PackingScanGeneration(owner: owner, epoch: epoch)
    }

    var isPending: Bool { PackingCallbacksIsPending(token) }

    func authorize(_ access: PackingCaptureAuthority.Access, failureMessage: String,
                   failureCode: String, onDenied: (@Sendable () -> Void)? = nil) throws {
        let guardResponse: @Sendable (@escaping () -> Void) -> Void = { action in
            _ = try? access.checked { action() }
        }
        guard PackingCallbacksSetGuardWithCancellation(token, guardResponse, failureMessage, failureCode, onDenied) else {
            // A rejected second installation does not transfer ownership of the
            // first reply's artifact. Creation/cancellation must be coordinated
            // separately before this candidate can be integrated.
            throw PackingCaptureAuthorityError.changed
        }
    }

    @discardableResult func resolve() -> Bool { PackingCallbacksResolveNil(token) }
    @discardableResult func resolveJSON(_ bytes: Data) -> Bool { PackingCallbacksResolveJSON(token, bytes) }
    @discardableResult func reject(_ message: String, _ code: String? = nil) -> Bool {
        PackingCallbacksReject(token, message, code)
    }
}
