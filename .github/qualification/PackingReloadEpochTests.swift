import Capacitor
import Foundation
import PackingSDKCallbacks
import Testing

@Suite(.serialized)
struct PackingReloadEpochTests {
    @Test func resetChangesEmptyOwnerEpoch() {
        let owner = UUID().uuidString
        #expect(PackingCallbacksResetOwner(owner, "Reloaded", "STORAGE_CHANGED"))
        let first = PackingCallbacksOwnerEpoch(owner)
        #expect(first != nil)
        #expect(PackingCallbacksResetOwner(owner, "Reloaded", "STORAGE_CHANGED"))
        #expect(PackingCallbacksOwnerEpoch(owner) != first)
        PackingCallbacksUnbindOwner(owner, "Closed", nil)
    }

    @Test func staleRevocationInstallationFailsClosed() {
        let owner = UUID().uuidString
        #expect(PackingCallbacksResetOwner(owner, "Reloaded", "STORAGE_CHANGED"))
        let old = PackingCallbacksOwnerEpoch(owner)!
        #expect(PackingCallbacksResetOwner(owner, "Reloaded", "STORAGE_CHANGED"))
        let invoked = DispatchSemaphore(value: 0)
        #expect(!PackingCallbacksSetRevocationForEpoch(owner, old) { invoked.signal() })
        #expect(invoked.wait(timeout: .now()) == .success)
        PackingCallbacksUnbindOwner(owner, "Closed", nil)
    }

    @Test func staleEventIsRejectedAfterReset() async {
        let result = await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "packing.reload.event")
            queue.async {
                let owner = UUID().uuidString
                let plugin = CAPPlugin()
                #expect(PackingCallbacksBindOwner(plugin, queue, owner))
                let old = PackingCallbacksOwnerEpoch(owner)!
                #expect(PackingCallbacksResetOwner(owner, "Reloaded", "STORAGE_CHANGED"))
                let accepted = PackingCallbacksNotifyOwnerForEpoch(owner, old, "captureWorkspaceLocked", Data("{}".utf8))
                PackingCallbacksUnbindOwner(owner, "Closed", nil)
                withExtendedLifetime(plugin) {}
                continuation.resume(returning: accepted)
            }
        }
        #expect(!result)
    }

    @Test func teardownWaitsUntilActiveRevocationFinishes() {
        let owner = UUID().uuidString
        #expect(PackingCallbacksResetOwner(owner, "Reloaded", "STORAGE_CHANGED"))
        let epoch = PackingCallbacksOwnerEpoch(owner)!
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let resetDone = DispatchSemaphore(value: 0)
        let teardownDone = DispatchSemaphore(value: 0)
        #expect(PackingCallbacksSetRevocationForEpoch(owner, epoch) {
            entered.signal()
            _ = release.wait(timeout: .now() + 5)
        })
        DispatchQueue.global().async {
            _ = PackingCallbacksResetOwner(owner, "Reloaded", "STORAGE_CHANGED")
            resetDone.signal()
        }
        #expect(entered.wait(timeout: .now() + 5) == .success)
        DispatchQueue.global().async {
            PackingCallbacksUnbindOwner(owner, "Closed", "STORAGE_CHANGED")
            teardownDone.signal()
        }
        #expect(teardownDone.wait(timeout: .now() + 0.1) == .timedOut)
        #expect(PackingCallbacksOwnerEpoch(owner) == nil)
        release.signal()
        #expect(resetDone.wait(timeout: .now() + 5) == .success)
        #expect(teardownDone.wait(timeout: .now() + 5) == .success)
        #expect(PackingCallbacksOwnerEpoch(owner) == nil)
    }

    // The queue is occupied until teardown has entered its revoker, so the
    // previously accepted event is delivered only while teardown is active.
    @Test func queuedEventDoesNotFireDuringTeardown() {
        let queue = DispatchQueue(label: "packing.reload.teardown.event")
        let owner = UUID().uuidString
        let enteredRevoker = DispatchSemaphore(value: 0)
        let releaseRevoker = DispatchSemaphore(value: 0)
        let teardownDone = DispatchSemaphore(value: 0)
        let eventDelivered = DispatchSemaphore(value: 0)
        let drained = DispatchSemaphore(value: 0)
        queue.async {
            let plugin = CAPPlugin()
            let listener = CAPPluginCall(callbackId: UUID().uuidString, methodName: "listener", options: [:], success: { _, _ in
                eventDelivered.signal()
            }, error: { _ in })!
            plugin.addEventListener("captureWorkspaceLocked", listener: listener)
            #expect(PackingCallbacksBindOwner(plugin, queue, owner))
            guard let epoch = PackingCallbacksOwnerEpoch(owner) else {
                releaseRevoker.signal()
                drained.signal()
                return
            }
            #expect(PackingCallbacksSetRevocationForEpoch(owner, epoch) {
                enteredRevoker.signal()
                _ = releaseRevoker.wait(timeout: .now() + 10)
            })
            #expect(PackingCallbacksNotifyOwnerForEpoch(owner, epoch, "captureWorkspaceLocked", Data("{}".utf8)))
            DispatchQueue.global().async {
                PackingCallbacksUnbindOwner(owner, "Closed", "STORAGE_CHANGED")
                teardownDone.signal()
            }
            #expect(enteredRevoker.wait(timeout: .now() + 5) == .success)
            queue.async {
                withExtendedLifetime(plugin) { withExtendedLifetime(listener) {} }
                drained.signal()
            }
        }
        #expect(drained.wait(timeout: .now() + 5) == .success)
        #expect(eventDelivered.wait(timeout: .now()) == .timedOut)
        releaseRevoker.signal()
        #expect(teardownDone.wait(timeout: .now() + 5) == .success)
    }

    @Test func activeOwnerDeliversQueuedEvent() {
        let queue = DispatchQueue(label: "packing.reload.event.positive")
        let owner = UUID().uuidString
        let observed = DispatchSemaphore(value: 0)
        let drained = DispatchSemaphore(value: 0)
        queue.async {
            let plugin = CAPPlugin()
            let listener = CAPPluginCall(callbackId: UUID().uuidString, methodName: "listener", options: [:], success: { _, _ in
                observed.signal()
            }, error: { _ in })!
            plugin.addEventListener("captureWorkspaceLocked", listener: listener)
            #expect(PackingCallbacksBindOwner(plugin, queue, owner))
            if let epoch = PackingCallbacksOwnerEpoch(owner) {
                #expect(PackingCallbacksNotifyOwnerForEpoch(owner, epoch, "captureWorkspaceLocked", Data("{}".utf8)))
            } else { Issue.record("Missing owner epoch") }
            queue.async {
                withExtendedLifetime(plugin) { withExtendedLifetime(listener) {} }
                PackingCallbacksUnbindOwner(owner, "Closed", nil)
                drained.signal()
            }
        }
        #expect(drained.wait(timeout: .now() + 5) == .success)
        #expect(observed.wait(timeout: .now()) == .success)
    }
}
