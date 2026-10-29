import Capacitor
import Foundation

// Compile-only architectural probe. This does not implement the app adapter.
@MainActor
private final class PackingBoundaryProbeState {
    private let authority = PackingCaptureAuthority()

    // The authority is created here; no non-Sendable caller-owned value enters.
    nonisolated init() {}

    func currentRevision(matches expected: String?) -> Bool {
        authority.state().revision == expected
    }
}

final class PackingBoundaryProbePlugin: CAPPlugin {
    private let state = PackingBoundaryProbeState()

    @objc func inspectBoundary(_ call: CAPPluginCall) {
        guard let concreteBridge = bridge as? CapacitorBridge else {
            call.reject("The stock SDK bridge is unavailable.")
            return
        }
        // Verify the public getter in the actual published consumer framework.
        let sdkQueue = concreteBridge.dispatchQueue
        dispatchPrecondition(condition: .onQueue(sdkQueue))
        // Only a checked Sendable actor reference and String cross this boundary.
        let ui = state
        let revision = call.getString("revision")
        Task { @MainActor in
            _ = ui.currentRevision(matches: revision)
        }
        // The real SDK call remains on its original queue, including resolution.
        call.resolve()
    }
}
