import Capacitor
import Foundation
import PackingSDKCallbacks
import Testing
@testable import PackingCallbackConsumer

@Suite(.serialized)
struct PackingCancellationCleanupTests {
    @Test func cancelledQueuedReplyCleansOnce() {
        let queue = DispatchQueue(label: "packing.cleanup.cancel")
        let owner = UUID().uuidString
        let cleaned = DispatchSemaphore(value: 0), rejected = DispatchSemaphore(value: 0)
        queue.async {
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "test", options: [:], success: { _, _ in
                Issue.record("Cancelled reply unexpectedly succeeded.")
            }, error: { _ in rejected.signal() })!
            guard let token = PackingCallbacksRegister(call, queue, owner) else {
                Issue.record("Registration failed."); rejected.signal(); return
            }
            #expect(PackingCallbacksSetGuardWithCancellation(token, { action in action() }, "Changed", "STORAGE_CHANGED", { cleaned.signal() }))
            #expect(PackingCallbacksResolveNil(token))
            #expect(PackingCallbacksCancelOwner(owner, "Changed", "STORAGE_CHANGED") == 1)
        }
        #expect(rejected.wait(timeout: .now() + 5) == .success)
        #expect(cleaned.wait(timeout: .now()) == .success)
        #expect(cleaned.wait(timeout: .now()) == .timedOut)
    }

    @Test func successfulReplyDoesNotClean() {
        let queue = DispatchQueue(label: "packing.cleanup.success")
        let owner = UUID().uuidString
        let cleaned = DispatchSemaphore(value: 0), delivered = DispatchSemaphore(value: 0)
        queue.async {
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "test", options: [:], success: { _, _ in delivered.signal() }, error: { _ in
                Issue.record("Live reply unexpectedly rejected."); delivered.signal()
            })!
            guard let token = PackingCallbacksRegister(call, queue, owner) else {
                Issue.record("Registration failed."); delivered.signal(); return
            }
            #expect(PackingCallbacksSetGuardWithCancellation(token, { action in action() }, "Changed", "STORAGE_CHANGED", { cleaned.signal() }))
            #expect(PackingCallbacksResolveNil(token))
        }
        #expect(delivered.wait(timeout: .now() + 5) == .success)
        #expect(cleaned.wait(timeout: .now()) == .timedOut)
    }

    @Test func cancelledBeforeGuardCannotInstallCleanup() {
        let queue = DispatchQueue(label: "packing.cleanup.install")
        let owner = UUID().uuidString
        let completed = DispatchSemaphore(value: 0), cleaned = DispatchSemaphore(value: 0)
        queue.async {
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "test", options: [:], success: { _, _ in
                Issue.record("Cancelled call unexpectedly succeeded.")
            }, error: { _ in completed.signal() })!
            guard let token = PackingCallbacksRegister(call, queue, owner) else {
                Issue.record("Registration failed."); completed.signal(); return
            }
            #expect(PackingCallbacksCancelOwner(owner, "Changed", "STORAGE_CHANGED") == 1)
            #expect(!PackingCallbacksSetGuardWithCancellation(token, { action in action() }, "Changed", "STORAGE_CHANGED", { cleaned.signal() }))
        }
        #expect(completed.wait(timeout: .now() + 5) == .success)
        // Caller must clean up on a failed installation; the registry does not own it.
        #expect(cleaned.wait(timeout: .now()) == .timedOut)
    }

    private func exerciseRejectedTerminal(_ mode: String) {
        let queue = DispatchQueue(label: "packing.cleanup." + mode)
        let owner = UUID().uuidString
        let cleaned = DispatchSemaphore(value: 0), rejected = DispatchSemaphore(value: 0)
        queue.async {
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "test", options: [:], success: { _, _ in
                Issue.record("Rejected response unexpectedly succeeded.")
            }, error: { _ in rejected.signal() })!
            guard let token = PackingCallbacksRegister(call, queue, owner) else {
                Issue.record("Registration failed."); rejected.signal(); return
            }
            #expect(PackingCallbacksSetGuardWithCancellation(token, { action in
                if mode != "denied" { action() }
            }, "Changed", "STORAGE_CHANGED", { cleaned.signal() }))
            if mode == "explicit" { #expect(PackingCallbacksReject(token, "Failure", "ERROR")) }
            else if mode == "invalid-json" { #expect(PackingCallbacksResolveJSON(token, Data("[]".utf8))) }
            else { #expect(PackingCallbacksResolveNil(token)) }
        }
        #expect(rejected.wait(timeout: .now() + 5) == .success)
        #expect(cleaned.wait(timeout: .now()) == .success)
        #expect(cleaned.wait(timeout: .now()) == .timedOut)
    }

    @Test func deniedGuardCleansExactlyOnce() { exerciseRejectedTerminal("denied") }
    @Test func explicitRejectionCleansExactlyOnce() { exerciseRejectedTerminal("explicit") }
    @Test func invalidJSONCleansExactlyOnce() { exerciseRejectedTerminal("invalid-json") }

    @Test func duplicateAuthorizationDoesNotDeleteLiveArtifact() {
        let queue = DispatchQueue(label: "packing.cleanup.duplicate-authorization")
        let owner = UUID().uuidString
        let cleanup = DispatchSemaphore(value: 0), delivered = DispatchSemaphore(value: 0)
        queue.async {
            let authority = PackingCaptureAuthority()
            guard let access = try? authority.selectGuest(expectedRevision: authority.state().revision) else {
                Issue.record("Could not create guest authority."); delivered.signal(); return
            }
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "test", options: [:], success: { _, _ in
                withExtendedLifetime(authority) {}
                delivered.signal()
            }, error: { _ in Issue.record("Live reply rejected."); delivered.signal() })!
            #expect(PackingCallbacksResetOwner(owner, "Reload", "STORAGE_CHANGED"))
            guard let reply = PackingScanReply(call: call, sdkQueue: queue, owner: owner) else {
                Issue.record("Reply registration failed."); delivered.signal(); return
            }
            do {
                try reply.authorize(access, failureMessage: "Changed", failureCode: "STORAGE_CHANGED", onDenied: { cleanup.signal() })
                do {
                    try reply.authorize(access, failureMessage: "Changed", failureCode: "STORAGE_CHANGED", onDenied: { cleanup.signal() })
                    Issue.record("A duplicate authorization unexpectedly succeeded.")
                } catch { }
                // The first authorization is still live; a second attempt must not
                // clean its artifact. The queued response must still be delivered.
                #expect(cleanup.wait(timeout: .now()) == .timedOut)
                #expect(reply.resolve())
            } catch { Issue.record("Initial authorization failed."); delivered.signal() }
        }
        #expect(delivered.wait(timeout: .now() + 5) == .success)
        #expect(cleanup.wait(timeout: .now()) == .timedOut)
        PackingCallbacksUnbindOwner(owner, "Closed", nil)
    }
}
