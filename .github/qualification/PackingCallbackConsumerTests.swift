import Capacitor
import Foundation
import PackingSDKCallbacks
import Testing
@testable import PackingCallbackConsumer

private enum Observation: Sendable, Equatable {
    case nilResult
    case json(String)
    case rejected(String, String?, errorIsNil: Bool, dataIsNil: Bool)
    case invalid
}

private func exercise(_ action: @escaping @Sendable (PackingCallbackToken, DispatchQueue, String) -> Void) async -> Observation {
    await withCheckedContinuation { continuation in
        let queue = DispatchQueue(label: "packing.callback.qualification." + UUID().uuidString)
        let owner = UUID().uuidString
        queue.async {
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "qualification", options: [:], success: { result, _ in
                dispatchPrecondition(condition: .onQueue(queue))
                guard let dictionary = result?.data else { continuation.resume(returning: .nilResult); return }
                guard let bytes = try? JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys]),
                      let text = String(data: bytes, encoding: .utf8) else {
                    continuation.resume(returning: .invalid); return
                }
                continuation.resume(returning: .json(text))
            }, error: { error in
                dispatchPrecondition(condition: .onQueue(queue))
                continuation.resume(returning: .rejected(error?.message ?? "missing", error?.code,
                    errorIsNil: error?.error == nil, dataIsNil: error?.data == nil))
            })!
            guard let token = PackingCallbackToken(call: call, sdkQueue: queue, owner: owner) else {
                continuation.resume(returning: .invalid); return
            }
            action(token, queue, owner)
        }
    }
}

private func dummyCall(on queue: DispatchQueue) -> CAPPluginCall {
    dispatchPrecondition(condition: .onQueue(queue))
    return CAPPluginCall(callbackId: UUID().uuidString, methodName: "qualification", options: [:], success: { _, _ in
        dispatchPrecondition(condition: .onQueue(queue))
    }, error: { _ in
        dispatchPrecondition(condition: .onQueue(queue))
    })!
}

@Suite(.serialized)
struct PackingCallbackConsumerTests {
    @Test func nilAndEmptyObjectAreDistinct() async {
        let nilResult = await exercise { token, _, _ in _ = token.resolve() }
        let empty = await exercise { token, _, _ in _ = token.resolveJSON(Data("{}".utf8)) }
        #expect(nilResult == .nilResult)
        #expect(empty == .json("{}"))
    }

    @Test func typedTokenCanReturnFromMainActor() async {
        let result = await exercise { token, _, _ in
            Task { @MainActor in
                _ = token.resolveJSON(Data("{\"nested\":[1,true,null,{\"name\":\"packing\"}]}".utf8))
            }
        }
        #expect(result == .json("{\"nested\":[1,true,null,{\"name\":\"packing\"}]}"))
    }

    @Test func rejectionUsesRealSDKMessageCodeAndNilMetadata() async {
        let result = await exercise { token, _, _ in
            Task { @MainActor in _ = token.reject("Original selection changed.", "STORAGE_CHANGED") }
        }
        #expect(result == .rejected("Original selection changed.", "STORAGE_CHANGED", errorIsNil: true, dataIsNil: true))
    }

    @Test func invalidOrNonObjectJSONRejects() async {
        for input in ["not JSON", "[]", "42"] {
            let bytes = Data(input.utf8)
            let result = await exercise { token, _, _ in _ = token.resolveJSON(bytes) }
            #expect(result == .rejected("The native response could not be encoded.", "NATIVE_RESPONSE_INVALID", errorIsNil: true, dataIsNil: true))
        }
    }

    @Test func concurrentTerminalClaimsInvokeCallbackOnce() async {
        let result = await exercise { token, _, _ in
            DispatchQueue.concurrentPerform(iterations: 100) { _ in _ = token.resolve() }
        }
        // A second SDK callback would resume the checked continuation twice and
        // fail the test process, rather than being hidden by an expectation cap.
        #expect(result == .nilResult)
    }

    @Test func cancellationOverridesQueuedSuccessBeforeDelivery() async {
        let result = await exercise { token, _, owner in
            #expect(token.resolveJSON(Data("{\"private\":true}".utf8)))
            #expect(PackingCallbacksPendingForOwner(owner) == 1)
            #expect(PackingCallbacksCancelOwner(owner, "Workspace locked.", "STORAGE_CHANGED") == 1)
            #expect(!token.reject("Duplicate response."))
        }
        #expect(result == .rejected("Workspace locked.", "STORAGE_CHANGED", errorIsNil: true, dataIsNil: true))
    }

    @Test func ownerLimitIncludesClaimedButUndeliveredReplies() async {
        let bounded = await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "packing.callback.owner-capacity")
            queue.async {
                let owner = UUID().uuidString
                var accepted = 0
                for _ in 0..<16 {
                    if let token = PackingCallbacksRegister(dummyCall(on: queue), queue, owner) {
                        accepted += 1
                        #expect(PackingCallbacksResolveNil(token))
                    }
                }
                let rejected = PackingCallbacksRegister(dummyCall(on: queue), queue, owner) == nil
                let pending = PackingCallbacksPendingForOwner(owner)
                let cancelled = PackingCallbacksCancelOwner(owner, "Cancelled.", nil)
                let correctBefore = accepted == 16 && rejected && pending == 16 && cancelled == 16
                queue.async {
                    continuation.resume(returning: correctBefore && PackingCallbacksPendingForOwner(owner) == 0)
                }
            }
        }
        #expect(bounded)
    }

    @Test func cancellationIsOwnerScopedAndKeepAliveIsNotClaimed() async {
        let isolated = await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "packing.callback.owner-isolation")
            queue.async {
                let first = UUID().uuidString
                let second = UUID().uuidString
                let one = PackingCallbacksRegister(dummyCall(on: queue), queue, first)!
                let two = PackingCallbacksRegister(dummyCall(on: queue), queue, second)!
                let listener = dummyCall(on: queue)
                listener.keepAlive = true
                let listenerNotTaken = PackingCallbacksRegister(listener, queue, second) == nil && listener.keepAlive
                let cancelled = PackingCallbacksCancelOwner(first, "First owner closed.", nil)
                let otherPending = PackingCallbacksPendingForOwner(second)
                let firstNotClaimable = !PackingCallbacksResolveNil(one)
                let secondClaimed = PackingCallbacksResolveNil(two)
                let correctBefore = listenerNotTaken && cancelled == 1 && otherPending == 1 && firstNotClaimable && secondClaimed
                queue.async {
                    continuation.resume(returning: correctBefore && PackingCallbacksPendingForOwner(first) == 0 && PackingCallbacksPendingForOwner(second) == 0)
                }
            }
        }
        #expect(isolated)
    }

    @Test func globalCapacityIsBoundedAcrossDistinctOwners() async {
        let bounded = await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "packing.callback.global-capacity")
            queue.async {
                let owners = (0..<64).map { _ in UUID().uuidString }
                var accepted = 0
                for owner in owners {
                    if PackingCallbacksRegister(dummyCall(on: queue), queue, owner) != nil { accepted += 1 }
                }
                let rejected = PackingCallbacksRegister(dummyCall(on: queue), queue, UUID().uuidString) == nil
                let cancelled = owners.reduce(0) { $0 + PackingCallbacksCancelOwner($1, "Closed.", nil) }
                let correctBefore = accepted == 64 && rejected && cancelled == 64
                queue.async {
                    continuation.resume(returning: correctBefore && owners.allSatisfy { PackingCallbacksPendingForOwner($0) == 0 })
                }
            }
        }
        #expect(bounded)
    }
}
