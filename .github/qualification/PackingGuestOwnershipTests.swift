import Foundation
import Testing
@testable import PackingCallbackConsumer

@Suite(.serialized)
@MainActor
struct PackingGuestOwnershipTests {
    private let id = "00000000-0000-4000-8000-000000000001"
    private enum TestFailure: Error { case failed }

    @Test func cancellationBeforeCreationCleansWhenCreated() throws {
        var removed: [String] = []
        let owner = PackingGuestScanOwnership { removed.append($0) }
        try owner.abandon()
        #expect(try !owner.registerCreated(id))
        #expect(removed == [id])
        #expect(owner.phase == .abandoned)
    }

    @Test func cancellationAfterCreationCleansOnce() throws {
        var removed: [String] = []
        let owner = PackingGuestScanOwnership { removed.append($0) }
        #expect(try owner.registerCreated(id))
        try owner.abandon(); try owner.abandon()
        #expect(removed == [id])
        #expect(!owner.markDelivered())
    }

    @Test func deliveredScanIsNotRemovedByLateCancellation() throws {
        var removed: [String] = []
        let owner = PackingGuestScanOwnership { removed.append($0) }
        #expect(try owner.registerCreated(id))
        #expect(owner.markDelivered())
        try owner.abandon()
        #expect(removed.isEmpty)
        #expect(owner.phase == .delivered(id))
    }

    @Test func failedCleanupRemainsRetryable() throws {
        var attempts = 0
        let owner = PackingGuestScanOwnership { _ in
            attempts += 1
            if attempts == 1 { throw TestFailure.failed }
        }
        #expect(try owner.registerCreated(id))
        #expect(throws: TestFailure.self) { try owner.abandon() }
        #expect(owner.phase == .cleanupPending(id))
        try owner.retryCleanup()
        #expect(attempts == 2)
        #expect(owner.phase == .abandoned)
    }

    @Test func repeatedOrInvalidIdDoesNotChangeOwnership() throws {
        var removed: [String] = []
        let owner = PackingGuestScanOwnership { removed.append($0) }
        #expect(try !owner.registerCreated("not-a-canonical-id"))
        #expect(try owner.registerCreated(id))
        #expect(try !owner.registerCreated(id))
        #expect(owner.phase == .owned(id))
        #expect(removed.isEmpty)
    }
}
