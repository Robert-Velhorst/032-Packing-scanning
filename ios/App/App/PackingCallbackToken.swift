import Capacitor
import Foundation
#if canImport(PackingSDKCallbacks)
import PackingSDKCallbacks
#endif

// A checked Sendable capability contains no SDK object, plugin or raw options.
struct PackingCallbackToken: Sendable {
    private let token: String

    var isPending: Bool { PackingCallbacksIsPending(token) }

    func authorize(_ access: PackingCaptureAuthority.Access, failureMessage: String, failureCode: String) throws {
        // Checked Sendable captures only the existing lock-protected access.
        // The SDK's opaque action is invoked synchronously on the SDK queue
        // inside that lock; it is never retained or sent to another actor.
        let guardResponse: @Sendable (@escaping () -> Void) -> Void = { action in
            _ = try? access.checked { action() }
        }
        guard PackingCallbacksSetDeliveryGuard(token, guardResponse, failureMessage, failureCode) else {
            throw PackingCaptureAuthorityError.changed
        }
    }

    init?(call: CAPPluginCall, sdkQueue: DispatchQueue, owner: String) {
        dispatchPrecondition(condition: .onQueue(sdkQueue))
        guard let token = PackingCallbacksRegister(call, sdkQueue, owner) else { return nil }
        self.token = token
    }

    @discardableResult func resolve() -> Bool {
        PackingCallbacksResolveNil(token)
    }

    // A JSON object is required. Application DTO encoding must preserve each
    // existing result contract before the adapter is wired into the real app.
    @discardableResult func resolveJSON(_ bytes: Data) -> Bool {
        PackingCallbacksResolveJSON(token, bytes)
    }

    @discardableResult func reject(_ message: String, _ code: String? = nil) -> Bool {
        PackingCallbacksReject(token, message, code)
    }
}

struct PackingSDKOwner: Sendable {
    let id: String

    func bind(_ plugin: CAPPlugin, sdkQueue: DispatchQueue) -> Bool {
        dispatchPrecondition(condition: .onQueue(sdkQueue))
        return PackingCallbacksBindOwner(plugin, sdkQueue, id)
    }

    func installRevocation(_ access: PackingCaptureAuthority.Access) -> Bool {
        let revoke: @Sendable () -> Void = { access.revokeCurrentLease() }
        return PackingCallbacksSetOwnerRevocation(id, revoke)
    }

    func notify(_ event: String, data: [String: Any]) -> Bool {
        guard let bytes = try? JSONSerialization.data(withJSONObject: data) else { return false }
        return PackingCallbacksNotifyOwner(id, event, bytes)
    }

    func close(_ message: String, _ code: String? = nil) {
        PackingCallbacksUnbindOwner(id, message, code)
    }
}
