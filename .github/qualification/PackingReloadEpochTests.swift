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

    @Test func teardownWaitsUntilActiveRevocationFinishes() async {
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
}
