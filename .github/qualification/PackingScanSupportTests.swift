import Capacitor
import Foundation
import PackingSDKCallbacks
import Testing
@testable import PackingCallbackConsumer

private enum ScanReply: Sendable, Equatable {
    case result(String)
    case rejected(String?)
}

private func guardedRequest(_ access: PackingCaptureAuthority.Access,
    action: @escaping @Sendable (PackingCallbackToken) -> Void) async -> ScanReply {
    await withCheckedContinuation { continuation in
        let queue = DispatchQueue(label: "packing.scan.guard." + UUID().uuidString)
        queue.async {
            let call = CAPPluginCall(callbackId: UUID().uuidString, methodName: "scan", options: [:], success: { result, _ in
                dispatchPrecondition(condition: .onQueue(queue))
                continuation.resume(returning: .result(result?.data?["value"] as? String ?? "nil"))
            }, error: { error in
                dispatchPrecondition(condition: .onQueue(queue))
                continuation.resume(returning: .rejected(error?.code))
            })!
            let token = PackingCallbackToken(call: call, sdkQueue: queue, owner: UUID().uuidString)!
            try! token.authorize(access, failureMessage: "The selection changed.", failureCode: "STORAGE_CHANGED")
            action(token)
        }
    }
}

@Suite(.serialized)
struct PackingScanSupportTests {
    @Test func freshWorkspaceKeyIsSingleUse() async {
        let key = PackingWorkspaceKey(raw: (0..<32).map { NSNumber(value: $0) })
        var first = await key.take()
        #expect(first == Data((0..<32).map(UInt8.init)))
        #expect(await key.take() == nil)
        if let count = first?.count { first?.resetBytes(in: 0..<count) }
    }

    @Test func originalKeyParserRejectsWrongCountBooleansAndFractions() async {
        let short = PackingWorkspaceKey(raw: Array(repeating: NSNumber(value: 0), count: 31))
        let booleans = PackingWorkspaceKey(raw: Array(repeating: NSNumber(value: true), count: 32))
        let fractions = PackingWorkspaceKey(raw: Array(repeating: NSNumber(value: 1.5), count: 32))
        let overflow = PackingWorkspaceKey(raw: Array(repeating: NSNumber(value: 256), count: 32))
        #expect(await short.take() == nil)
        #expect(await booleans.take() == nil)
        #expect(await fractions.take() == nil)
        #expect(await overflow.take() == nil)
    }

    @Test func erasedPendingKeyCannotBeTaken() async {
        let key = PackingWorkspaceKey(raw: Array(repeating: NSNumber(value: 23), count: 32))
        await key.erase()
        #expect(await key.take() == nil)
        #expect(await key.take() == nil)
    }

    @Test @MainActor func staleRevokerCannotCloseNewerSelection() throws {
        let authority = PackingCaptureAuthority()
        let first = try authority.selectGuest(expectedRevision: authority.state().revision)
        let second = try authority.selectGuest(expectedRevision: authority.state().revision)
        first.revokeCurrentLease()
        try second.check()
        #expect(authority.state().lease == second.lease)
        second.revokeCurrentLease()
        #expect(authority.state().lease == nil)
        #expect(throws: PackingCaptureAuthorityError.self) { try second.check() }
    }

    @Test @MainActor func revokedLeaseIsRejectedAtQueuedSDKDelivery() async throws {
        let authority = PackingCaptureAuthority()
        let access = try authority.selectGuest(expectedRevision: authority.state().revision)
        let reply = await guardedRequest(access) { token in
            #expect(token.resolveJSON(Data("{\"value\":\"private\"}".utf8)))
            access.revokeCurrentLease()
        }
        #expect(reply == .rejected("STORAGE_CHANGED"))
    }

    @Test @MainActor func liveLeaseStillDeliversNormally() async throws {
        let authority = PackingCaptureAuthority()
        let access = try authority.selectGuest(expectedRevision: authority.state().revision)
        let reply = await guardedRequest(access) { token in
            #expect(token.resolveJSON(Data("{\"value\":\"valid\"}".utf8)))
        }
        #expect(reply == .result("valid"))
        try access.check()
    }

    @Test @MainActor func ownerTeardownRevokesSynchronously() async throws {
        let authority = PackingCaptureAuthority()
        let access = try authority.openWorkspace(expectedRevision: authority.state().revision,
            workspaceID: UUID().uuidString.lowercased(), accountID: UUID().uuidString.lowercased(), dataKey: Data(repeating: 7, count: 32))
        let revoked = await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "packing.scan.teardown")
            queue.async {
                let plugin = CAPPlugin()
                let owner = PackingSDKOwner(id: UUID().uuidString)
                #expect(owner.bind(plugin, sdkQueue: queue))
                #expect(owner.installRevocation(access))
                owner.close("Plugin closed.", "STORAGE_CHANGED")
                continuation.resume(returning: (try? access.check()) == nil)
                withExtendedLifetime(plugin) {}
            }
        }
        #expect(revoked)
        #expect(authority.state().lease == nil)
    }

    @Test @MainActor func missingOwnerImmediatelyRevokesOrphanLease() throws {
        let authority = PackingCaptureAuthority()
        let access = try authority.selectGuest(expectedRevision: authority.state().revision)
        let owner = PackingSDKOwner(id: UUID().uuidString)
        #expect(!owner.installRevocation(access))
        #expect(throws: PackingCaptureAuthorityError.self) { try access.check() }
        #expect(authority.state().lease == nil)
    }

    @Test func realSDKEventListenerReceivesOwnerEventOnSDKQueue() async {
        let observed = await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "packing.scan.event")
            queue.async {
                let plugin = CAPPlugin()
                plugin.eventListeners = [:]
                plugin.retainedEventArguments = [:]
                let owner = PackingSDKOwner(id: UUID().uuidString)
                let listener = CAPPluginCall(callbackId: UUID().uuidString, methodName: "addListener", options: [:], success: { result, _ in
                    dispatchPrecondition(condition: .onQueue(queue))
                    let valid = result?.data?["lease"] as? String == "synthetic-lease"
                    plugin.eventListeners = [:]
                    owner.close("Fixture completed.")
                    continuation.resume(returning: valid)
                }, error: { _ in Issue.record("SDK listener unexpectedly rejected.") })!
                listener.keepAlive = true
                plugin.addEventListener("captureWorkspaceLocked", listener: listener)
                #expect(owner.bind(plugin, sdkQueue: queue))
                #expect(owner.notify("captureWorkspaceLocked", data: ["lease": "synthetic-lease"]))
                // The real listener intentionally retains its fixture plugin
                // until delivery; the callback clears that fixture-only cycle.
            }
        }
        #expect(observed)
    }

    @Test func ownerCloseDropsQueuedEventWhileFixtureRemainsAlive() async {
        let suppressed = await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "packing.scan.event-close")
            queue.async {
                let plugin = CAPPlugin()
                plugin.eventListeners = [:]
                plugin.retainedEventArguments = [:]
                let owner = PackingSDKOwner(id: UUID().uuidString)
                let listener = CAPPluginCall(callbackId: UUID().uuidString, methodName: "addListener", options: [:], success: { _, _ in
                    dispatchPrecondition(condition: .onQueue(queue))
                    Issue.record("A closed owner published a queued event.")
                }, error: { _ in Issue.record("Unexpected listener error.") })!
                plugin.addEventListener("captureWorkspaceLocked", listener: listener)
                #expect(owner.bind(plugin, sdkQueue: queue))
                #expect(owner.notify("captureWorkspaceLocked", data: ["lease": "must-not-publish"]))
                owner.close("Closed.")
                // A separate real SDK promise retains the fixture through the
                // event's queue position. Suppression cannot pass just because
                // the weak owner/plugin disappeared before the event ran.
                let drain = CAPPluginCall(callbackId: UUID().uuidString, methodName: "drain", options: [:], success: { _, _ in
                    dispatchPrecondition(condition: .onQueue(queue))
                    let stillAlive = plugin.hasListeners("captureWorkspaceLocked")
                    plugin.eventListeners = [:]
                    continuation.resume(returning: stillAlive)
                }, error: { _ in Issue.record("Drain rejected.") })!
                let token = PackingCallbackToken(call: drain, sdkQueue: queue, owner: UUID().uuidString)!
                #expect(token.resolve())
            }
        }
        #expect(suppressed)
    }
}
