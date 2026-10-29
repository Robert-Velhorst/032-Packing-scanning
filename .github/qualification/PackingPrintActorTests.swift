import Capacitor
import Foundation
import PackingSDKCallbacks
import Testing
import UIKit
@testable import PackingCallbackConsumer

private struct PrintOutcome: Sendable, Equatable {
    let message: String
    let code: String?
}

private func printRequest(_ action: @escaping @MainActor @Sendable (PackingPrintUIState, PackingCallbackToken) -> Void) async -> PrintOutcome {
    await withCheckedContinuation { continuation in
        let queue = DispatchQueue(label: "packing.print.actor." + UUID().uuidString)
        let owner = UUID().uuidString
        queue.async {
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "printSequence", options: [:], success: { _, _ in
                dispatchPrecondition(condition: .onQueue(queue))
                continuation.resume(returning: PrintOutcome(message: "unexpected success", code: nil))
            }, error: { error in
                dispatchPrecondition(condition: .onQueue(queue))
                continuation.resume(returning: PrintOutcome(message: error?.message ?? "missing", code: error?.code))
            })!
            let reply = PackingCallbackToken(call: call, sdkQueue: queue, owner: owner)!
            let state = PackingPrintUIState(owner: owner)
            Task { @MainActor in action(state, reply) }
        }
    }
}

// These are synthetic actor/notification controls, not physical printer or
// operating-system lifecycle acceptance. The original nine cases are unchanged.
@Suite(.serialized)
struct PackingPrintActorTests {
    @Test func missingWebViewRetainsOriginalPrintRejection() async {
        let result = await printRequest { state, reply in
            state.start(reply, webView: nil, presenter: nil)
        }
        #expect(result == PrintOutcome(message: "Return to the packing sequence before printing. The sequence remains available offline.", code: nil))
    }

    @Test func interruptionBeforeUIStartCannotOpenOrReplyAgain() async {
        let result = await printRequest { state, reply in
            #expect(reply.isPending)
            state.interrupted()
            #expect(!reply.isPending)
            state.start(reply, webView: nil, presenter: nil)
            #expect(!reply.resolve())
        }
        #expect(result == PrintOutcome(message: "Printing was interrupted. Return to the packing sequence and try again.", code: nil))
    }

    @Test func syntheticMainActorNotificationCancelsBeforeQueuedStart() async {
        let result = await printRequest { state, reply in
            NotificationCenter.default.addObserver(state, selector: #selector(PackingPrintUIState.interrupted),
                name: UIApplication.didEnterBackgroundNotification, object: nil)
            defer { NotificationCenter.default.removeObserver(state) }
            NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
            #expect(!reply.isPending)
            state.start(reply, webView: nil, presenter: nil)
        }
        #expect(result == PrintOutcome(message: "Printing was interrupted. Return to the packing sequence and try again.", code: nil))
    }
}
