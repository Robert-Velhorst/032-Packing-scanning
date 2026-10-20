import Foundation

@main enum BridgeValueChecks {
    static func main() throws {
        func refuses(_ label: String, _ work: () throws -> Void) {
            do { try work(); preconditionFailure(label) } catch {}
        }
        let values: [Any] = Array(0..<32)
        let key = try PackingCaptureBridgeValues.key(values)
        precondition(key == Data(0..<32))
        let invalidScalars: [Any] = [true, false, "7", -1, 256, 0.5, Double.nan, Double.infinity, NSNull()]
        for invalid in invalidScalars {
            var changed = values; changed[7] = invalid
            refuses("Invalid key scalar") { _ = try PackingCaptureBridgeValues.key(changed) }
        }
        let invalidContainers: [Any?] = [nil, "private", Data(0..<32), Array(0..<31), Array(0..<33)]
        for invalid in invalidContainers {
            refuses("Invalid key container") { _ = try PackingCaptureBridgeValues.key(invalid) }
        }
        let authority = PackingCaptureAuthority()
        let locked = authority.state(), lockedWire = PackingCaptureBridgeValues.state(locked)
        precondition(lockedWire.count == 4 && lockedWire["lease"] is NSNull)
        precondition(lockedWire["version"] as? Int == 1 && lockedWire["protectedWorkspace"] as? Bool == false)
        let guest = try authority.selectGuest(expectedRevision: locked.revision)
        let guestState = authority.state(), guestWire = PackingCaptureBridgeValues.state(guestState)
        precondition(guestWire["lease"] as? String == guest.lease && guestWire["protectedWorkspace"] as? Bool == false)
        PackingCaptureBridgeValues.lockProtected(authority)
        precondition(authority.state().lease == guest.lease)
        try PackingCaptureBridgeValues.lockProtectedForHandoff(authority, lease: guest.lease)
        precondition(authority.state().lease == guest.lease && authority.state().revision == guestState.revision)
        precondition(!authority.close(expectedRevision: locked.revision) && authority.state().lease == guest.lease)
        let access = try authority.openWorkspace(expectedRevision: guestState.revision, workspaceID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            accountID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", dataKey: key)
        let wire = PackingCaptureBridgeValues.state(authority.state())
        precondition(wire["lease"] as? String == access.lease && wire["protectedWorkspace"] as? Bool == true)
        PackingCaptureBridgeValues.lockProtected(authority)
        refuses("Lifecycle revocation keeps old accesses unusable") { try access.check() }
        precondition(PackingCaptureBridgeValues.state(authority.state())["lease"] is NSNull)
        let modal = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            accountID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", dataKey: key)
        refuses("A stale modal cannot close another selected lease") { try PackingCaptureBridgeValues.lockProtectedForHandoff(authority, lease: access.lease) }
        try modal.check()
        try PackingCaptureBridgeValues.lockProtectedForHandoff(authority, lease: modal.lease)
        refuses("Explicit handoff revokes protected access without lifecycle notifications") { try modal.check() }
        precondition(PackingCaptureBridgeValues.state(authority.state())["lease"] is NSNull)
        let resumedGuest = try authority.selectGuest(expectedRevision: authority.state().revision)
        refuses("An old protected handoff cannot close guest storage") { try PackingCaptureBridgeValues.lockProtectedForHandoff(authority, lease: modal.lease) }
        try resumedGuest.check()
        let budget = PackingCaptureQueueBudget()
        for _ in 0..<8 { precondition(budget.claim()) }; precondition(!budget.claim())
        for _ in 0..<8 { budget.release() }
        DispatchQueue.concurrentPerform(iterations: 100) { _ in if budget.claim() { budget.release() } }
        for _ in 0..<8 { precondition(budget.claim()) }; precondition(!budget.claim())
        for _ in 0..<8 { budget.release() }
        print("iOS bridge value checks passed: exact integer key bytes, Boolean/nonfinite refusal, null/guest/protected state and stale-revision/lifecycle authority.")
    }
}
