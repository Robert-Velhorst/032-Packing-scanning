import Foundation

@main enum CaptureAuthorityChecks {
    static func main() throws {
        let workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        let account = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        let capture = "cccccccc-cccc-cccc-cccc-cccccccccccc"
        let other = "dddddddd-dddd-dddd-dddd-dddddddddddd"
        let key = Data(0..<32)
        let text = "{\"fixture\":\"independent OpenSSL provider\"}"
        let plain = Data(text.utf8)
        func check(_ value: Bool, _ label: String) { precondition(value, label) }
        func refuses(_ label: String, _ operation: () throws -> Void) {
            do { try operation(); preconditionFailure(label) } catch {}
        }
        func bytes(_ hex: String) -> Data {
            var result = Data(); var index = hex.startIndex
            while index < hex.endIndex {
                let end = hex.index(index, offsetBy: 2)
                result.append(UInt8(hex[index..<end], radix: 16)!); index = end
            }
            return result
        }
        func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
        var now: TimeInterval = 100
        let authority = PackingCaptureAuthority(clock: { now })
        let initial = authority.state()
        check(initial.lease == nil && !initial.protectedWorkspace, "Authority must start locked")
        refuses("Locked storage must refuse leases") { _ = try authority.access(lease: other) }
        refuses("Stale selection revisions must fail") { _ = try authority.selectGuest(expectedRevision: other) }
        let guest = try authority.selectGuest(expectedRevision: initial.revision)
        refuses("Guest access must not encrypt workspace files") { _ = try guest.seal(captureID: capture, name: "capture.json", plaintext: plain) }
        let active = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        refuses("Replacing guest must revoke it") { try guest.check() }
        check(authority.state().protectedWorkspace, "Protected state must be explicit")
        let sealed = try active.seal(captureID: capture, name: "capture.json", plaintext: plain)
        check(sealed.count == plain.count + 32 && sealed.prefix(4) == Data("PSC1".utf8), "Envelope must match PSC1")
        try check(active.unseal(captureID: capture, name: "capture.json", ciphertext: sealed) == plain, "Round trip")
        try check(active.seal(captureID: capture, name: "capture.json", plaintext: plain) != sealed, "Each encryption needs a fresh nonce")
        let fixture = bytes("50534331000102030405060708090a0b3c20b072bd91b769e863ada9d8871c08f3b3e95095152b5c771780eb4e3a4c927162c18ac6a577ea56d9c1516852bd0b35e23a0939712ba67c8e")
        try check(active.unseal(captureID: capture, name: "capture.json", ciphertext: fixture) == plain, "OpenSSL fixture must authenticate with CryptoKit")
        for position in [0, 4, 16, sealed.count - 1] {
            var damaged = sealed; damaged[position] ^= 1
            refuses("Changed header/nonce/ciphertext/tag must fail") { _ = try active.unseal(captureID: capture, name: "capture.json", ciphertext: damaged) }
        }
        refuses("Truncation must fail") { _ = try active.unseal(captureID: capture, name: "capture.json", ciphertext: Data(sealed.prefix(31))) }
        refuses("Capture identity must authenticate") { _ = try active.unseal(captureID: other, name: "capture.json", ciphertext: sealed) }
        refuses("Purpose must authenticate") { _ = try active.unseal(captureID: capture, name: "points.ply", ciphertext: sealed) }
        refuses("Traversal names must fail") { _ = try active.seal(captureID: capture, name: "../capture.json", plaintext: plain) }
        refuses("Unknown file purposes must fail") { _ = try active.seal(captureID: capture, name: "Model.usdz", plaintext: plain) }
        refuses("Metadata size must be bounded") { _ = try active.seal(captureID: capture, name: "capture.json", plaintext: Data(repeating: 1, count: 20_001)) }
        refuses("Encrypted size must be bounded") { _ = try active.unseal(captureID: capture, name: "capture.json", ciphertext: Data(repeating: 1, count: 20_033)) }
        refuses("Invalid workspace IDs must fail") { _ = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace.uppercased(), accountID: account, dataKey: key) }
        refuses("Short keys must fail") { _ = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(repeating: 1, count: 31)) }
        try active.check() // Refused selections must preserve the current valid access.
        now = 399
        _ = try active.seal(captureID: capture, name: "capture.json", plaintext: plain)
        now = 400
        refuses("Storage traffic must not renew the idle deadline") { try active.check() }
        refuses("Late interaction cannot revive expired access") { try active.touch() }
        let renewed = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        now = 699; try renewed.touch(); now = 700; try renewed.check()
        now = 999
        refuses("Touch must expire at its exact deadline") { try renewed.check() }
        var borrowed = key
        let copied = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: borrowed)
        borrowed.resetBytes(in: 0..<borrowed.count)
        try check(copied.unseal(captureID: capture, name: "capture.json", ciphertext: sealed) == plain, "Borrowed key ownership must be independent")
        let previousRevision = authority.state().revision
        let wrongAccount = try authority.openWorkspace(expectedRevision: previousRevision, workspaceID: workspace, accountID: other, dataKey: key)
        check(!authority.close(expectedRevision: previousRevision), "Stale closes must not lock a newer selection")
        try wrongAccount.check()
        refuses("Old access must remain revoked") { try copied.check() }
        refuses("Account identity must authenticate") { _ = try wrongAccount.unseal(captureID: capture, name: "capture.json", ciphertext: sealed) }
        let wrongWorkspace = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: other, accountID: account, dataKey: key)
        refuses("Workspace identity must authenticate") { _ = try wrongWorkspace.unseal(captureID: capture, name: "capture.json", ciphertext: sealed) }
        let wrongKey = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(repeating: 255, count: 32))
        refuses("Wrong keys must fail authentication") { _ = try wrongKey.unseal(captureID: capture, name: "capture.json", ciphertext: sealed) }
        authority.close()
        refuses("Unconditional teardown must revoke access") { try wrongKey.check() }
        let rollback = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        now = 998
        refuses("A backwards monotonic clock must fail closed") { try rollback.check() }
        let invalidClock = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        now = .nan
        refuses("Invalid clocks must fail closed") { try invalidClock.check() }
        now = 1000
        var temporary: PackingCaptureAuthority? = PackingCaptureAuthority(clock: { now })
        let orphan = try temporary!.selectGuest(expectedRevision: temporary!.state().revision)
        temporary = nil
        refuses("A retained access must not retain its manager") { try orphan.check() }
        let independent = PackingCaptureAuthority(clock: { now })
        let final = try independent.openWorkspace(expectedRevision: independent.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        refuses("Operations crossing expiry must not return stale results") {
            _ = try final.checked { now += 300; return plain }
        }
        var pausedTime: TimeInterval = 1000
        var pauseAfterRead = false
        let suspended = PackingCaptureAuthority(clock: {
            let snapshot = pausedTime
            if pauseAfterRead { pausedTime += 300; pauseAfterRead = false }
            return snapshot
        })
        let interruptedTouch = try suspended.openWorkspace(expectedRevision: suspended.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
        pauseAfterRead = true
        refuses("A touch suspended across expiry must not revive the key") { try interruptedTouch.touch() }
        if CommandLine.arguments.count == 2 {
            let provider = PackingCaptureAuthority()
            let access = try provider.openWorkspace(expectedRevision: provider.state().revision, workspaceID: workspace, accountID: account, dataKey: key)
            let payload = try access.seal(captureID: capture, name: "capture.json", plaintext: plain)
            let json = try JSONSerialization.data(withJSONObject: ["sealed": hex(payload), "plaintext": text], options: [.sortedKeys])
            try json.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .withoutOverwriting)
        }
        print("iOS capture authority checks passed: revision/lease revocation, idle limits, authenticated context, corruption, bounds and provider fixture.")
    }
}
