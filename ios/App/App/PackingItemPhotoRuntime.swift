import Foundation

/** Mutable fields are confined to worker; keys survive bridge reloads, never process restart. */
final class PackingItemPhotoRuntime: @unchecked Sendable {
    static let shared = PackingItemPhotoRuntime()
    let worker = DispatchQueue(label: "com.packingscanning.item-photo")
    let budget = PackingCaptureQueueBudget()
    private var store: PackingPendingItemPhotoStore?
    private var timer: DispatchSourceTimer?
    private init() {
        let timer = DispatchSource.makeTimerSource(queue: worker)
        timer.schedule(deadline: .now() + 60, repeating: 60)
        timer.setEventHandler { [weak self] in try? self?.store?.expire() }
        self.timer = timer; timer.resume()
    }
    func pendingStore() throws -> PackingPendingItemPhotoStore {
        dispatchPrecondition(condition: .onQueue(worker))
        if let store { return store }
        let cache = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = try PackingBackupDirectory.prepare(parent: cache, kind: .itemPhoto)
        let value = try PackingPendingItemPhotoStore(directory: root); store = value; return value
    }
}
