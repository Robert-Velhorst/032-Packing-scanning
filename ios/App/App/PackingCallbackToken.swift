import Capacitor
import Foundation
#if canImport(PackingSDKCallbacks)
import PackingSDKCallbacks
#endif

// A checked Sendable capability contains no SDK object, plugin or raw options.
struct PackingCallbackToken: Sendable {
    private let token: String

    var isPending: Bool { PackingCallbacksIsPending(token) }

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
