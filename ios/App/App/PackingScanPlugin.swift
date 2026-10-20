import Capacitor
import ARKit
import RealityKit
import SwiftUI
import UIKit

private enum PackingCaptureIOFailure: Error, Sendable { case unconfirmed, reconstructionUnavailable(String), interiorUnavailable(String) }

/** The SDK call remains on the main actor; workers transfer only Sendable JSON bytes. */
@MainActor private final class PackingCaptureReply {
    private let call: CAPPluginCall
    private let access: PackingCaptureAuthority.Access
    private let budget: PackingCaptureQueueBudget
    private var completed = false
    init(call: CAPPluginCall, access: PackingCaptureAuthority.Access, budget: PackingCaptureQueueBudget) {
        self.call = call; self.access = access; self.budget = budget
    }
    func finish(_ result: Result<Data, PackingCaptureIOFailure>) {
        guard !completed else { return }; completed = true
        defer { budget.release() }
        do {
            try access.check()
            if case .failure(.reconstructionUnavailable(let message)) = result {
                call.reject("Reconstruction unavailable. " + message, "RECONSTRUCTION_UNAVAILABLE"); return
            }
            if case .failure(.interiorUnavailable(let message)) = result {
                call.reject("Interior reconstruction unavailable. " + message, "INTERIOR_UNAVAILABLE"); return
            }
            let data = try result.get()
            let reply = try access.checked {
                guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw PackingCaptureIOFailure.unconfirmed }
                return object
            }
            try access.check(); call.resolve(reply)
        } catch {
            call.reject("The original capture workspace or saved source could not be confirmed. Unlock it again before retrying.", "STORAGE_CHANGED")
        }
    }
}

@objc(PackingScanPlugin)
public class PackingScanPlugin: CAPPlugin, CAPBridgedPlugin {
    @MainActor private var captureBusy = false
    private let authority = PackingCaptureAuthority()
    @MainActor private var selectedLease: String?
    @MainActor private var protectedStore: PackingEncryptedCaptureStore?
    @MainActor private var cancelScan: (@MainActor () -> Void)?
    private let storageWorker = DispatchQueue(label: "com.packingscanning.capture-storage")
    private let storageBudget = PackingCaptureQueueBudget()
    public let identifier = "PackingScanPlugin"
    public let jsName = "PackingScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanObject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCaptures", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStorageState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selectGuestStorage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openWorkspaceStorage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockStorage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "touchStorage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCapturePreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconstructCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconstructInterior", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRetentionCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pruneExpiredSources", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        authority.close()
        for name in [UIApplication.didEnterBackgroundNotification, UIApplication.protectedDataWillBecomeUnavailableNotification] {
            NotificationCenter.default.addObserver(self, selector: #selector(storageUnavailable), name: name, object: nil)
        }
    }
    deinit { NotificationCenter.default.removeObserver(self); authority.close() }
    @objc private func storageUnavailable() {
        PackingCaptureBridgeValues.lockProtected(authority) // Key revocation does not wait for a queued UI task.
        Task { @MainActor in _ = self.storageState() }
    }
    @MainActor private func storageState() -> [String: Any] {
        let state = authority.state()
        if let previous = selectedLease, previous != state.lease {
            selectedLease = nil; protectedStore = nil
            let cancel = cancelScan; cancelScan = nil; cancel?()
            notifyListeners("captureWorkspaceLocked", data: ["lease": previous])
        }
        return PackingCaptureBridgeValues.state(state)
    }
    private func bound(_ call: CAPPluginCall) throws -> PackingCaptureAuthority.Access {
        guard let lease = call.getString("lease") else { throw PackingCaptureAuthorityError.changed }
        return try authority.access(lease: lease)
    }
    /** Internal file bridge uses this same authority and validated protected namespace. */
    @MainActor func documentAccess(lease: String) throws -> PackingCaptureAuthority.Access {
        do {
            let access = try authority.access(lease: lease)
            guard selectedLease == access.lease,
                  access.workspaceID == nil || protectedStore?.boundLease == access.lease else { throw PackingCaptureAuthorityError.changed }
            return access
        } catch { _ = storageState(); throw error }
    }
    @MainActor func prepareDocumentHandoff(lease: String) throws {
        guard !captureBusy else { throw PackingCaptureAuthorityError.changed }
        _ = try documentAccess(lease: lease)
        defer { _ = storageState() } // Emits the same lock event used by lifecycle revocation.
        try PackingCaptureBridgeValues.lockProtectedForHandoff(authority, lease: lease)
    }
    @MainActor private func didSelect(_ access: PackingCaptureAuthority.Access, store: PackingEncryptedCaptureStore?) {
        let previous = selectedLease
        selectedLease = access.lease; protectedStore = store
        if let previous, previous != access.lease { notifyListeners("captureWorkspaceLocked", data: ["lease": previous]) }
    }
    @MainActor private func prepareStore(_ access: PackingCaptureAuthority.Access) throws -> PackingEncryptedCaptureStore {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return try PackingEncryptedCaptureStore(directory: directory, access: access)
    }
    @objc func getStorageState(_ call: CAPPluginCall) { Task { @MainActor in call.resolve(self.storageState()) } }
    @objc func selectGuestStorage(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.captureBusy else { call.reject("Finish or cancel the current scan first.", "CAPTURE_BUSY"); return }
            do {
                guard let revision = call.getString("revision") else { throw PackingCaptureAuthorityError.changed }
                let access = try self.authority.selectGuest(expectedRevision: revision)
                self.didSelect(access, store: nil); call.resolve(self.storageState())
            } catch { call.reject("The capture selection changed. Reload saved workspaces.", "STORAGE_CHANGED") }
        }
    }
    @objc func openWorkspaceStorage(_ call: CAPPluginCall) {
        Task { @MainActor in
            var options = call.jsObjectRepresentation
            let raw = options.removeValue(forKey: "keyBytes"); call.options = options
            do {
                var key = try PackingCaptureBridgeValues.key(raw)
                defer { key.resetBytes(in: 0..<key.count) }
                guard !self.captureBusy, UIApplication.shared.isProtectedDataAvailable,
                      self.bridge?.viewController?.view.window?.windowScene?.activationState == .foregroundActive,
                      let revision = call.getString("revision"), let workspace = call.getString("workspaceId"), let account = call.getString("accountId") else {
                    throw PackingCaptureAuthorityError.changed
                }
                let access = try self.authority.openWorkspace(expectedRevision: revision, workspaceID: workspace, accountID: account, dataKey: key)
                do {
                    let store = try self.prepareStore(access)
                    self.didSelect(access, store: store); call.resolve(self.storageState())
                } catch {
                    self.authority.close(expectedRevision: access.lease); _ = self.storageState(); throw error
                }
            } catch { call.reject("The protected capture workspace could not be opened. Reload and unlock it again.", "STORAGE_CHANGED") }
        }
    }
    @objc func lockStorage(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let revision = call.getString("revision") else { call.reject("The capture revision is missing.", "STORAGE_CHANGED"); return }
            self.authority.close(expectedRevision: revision); call.resolve(self.storageState())
        }
    }
    @objc func touchStorage(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard UIApplication.shared.isProtectedDataAvailable,
                      self.bridge?.viewController?.view.window?.windowScene?.activationState == .foregroundActive else { throw PackingCaptureAuthorityError.changed }
                try self.bound(call).touch(); call.resolve()
            }
            catch { _ = self.storageState(); call.reject("The capture workspace is locked.", "STORAGE_CHANGED") }
        }
    }
    @MainActor private func runProtected(_ call: CAPPluginCall, access: PackingCaptureAuthority.Access,
        action: @escaping @Sendable (PackingEncryptedCaptureStore) throws -> [String: Any]) {
        guard let store = protectedStore, store.boundLease == access.lease, access.workspaceID != nil else {
            call.reject("The protected capture selection changed.", "STORAGE_CHANGED"); return
        }
        let budget = storageBudget
        guard budget.claim() else { call.reject("Wait for the current capture-storage request.", "STORAGE_BUSY"); return }
        let channel = PackingCaptureReply(call: call, access: access, budget: budget)
        storageWorker.async {
            let result: Result<Data, PackingCaptureIOFailure>
            do { result = .success(try access.checked { try JSONSerialization.data(withJSONObject: action(store)) }) }
            catch let error as PackingVoxelSolidError { result = .failure(.reconstructionUnavailable(error.localizedDescription)) }
            catch let error as PackingVoxelCavityError { result = .failure(.interiorUnavailable(error.localizedDescription)) }
            catch { result = .failure(.unconfirmed) }
            Task { @MainActor in channel.finish(result) }
        }
    }
    @objc func getCapturePreview(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.captureBusy, let id = call.getString("id") else { call.reject("Finish the active scan before reviewing saved geometry.", "CAPTURE_BUSY"); return }
            do {
                let access = try self.bound(call)
                self.runProtected(call, access: access) { try $0.readPointCapture(captureID: id).previewResult() }
            } catch { call.reject("The capture workspace is locked.", "STORAGE_CHANGED") }
        }
    }
    @objc func reconstructCapture(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.captureBusy, let id = call.getString("id") else { call.reject("Finish the active scan before reconstructing saved geometry.", "CAPTURE_BUSY"); return }
            do {
                let access = try self.bound(call)
                self.runProtected(call, access: access) { try $0.readPointCapture(captureID: id).reconstructedResult() }
            } catch { call.reject("The capture workspace is locked.", "STORAGE_CHANGED") }
        }
    }

    @objc func reconstructInterior(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.captureBusy, let id = call.getString("id") else { call.reject("Finish the active scan before reviewing an interior.", "CAPTURE_BUSY"); return }
            do {
                let access = try self.bound(call)
                let review = try PackingInteriorReview.parse(call.jsObjectRepresentation)
                self.runProtected(call, access: access) { try $0.readPointCapture(captureID: id).interiorResult(review: review) }
            } catch let error as PackingVoxelCavityError { call.reject(error.localizedDescription, "INTERIOR_UNAVAILABLE") }
            catch { call.reject("The capture workspace is locked.", "STORAGE_CHANGED") }
        }
    }

    @objc func getRetentionCapabilities(_ call: CAPPluginCall) {
        Task { @MainActor in
            _ = self.storageState()
            let state = self.authority.state()
            call.resolve(["version": 1,"supported": state.protectedWorkspace && state.lease != nil && state.lease == self.protectedStore?.boundLease])
        }
    }
    @objc func pruneExpiredSources(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.captureBusy else { call.reject("Finish the current scan before raw source cleanup.", "CAPTURE_BUSY"); return }
            do {
                let access = try self.bound(call)
                let policy = try PackingScanRetentionPolicy.parse(call.jsObjectRepresentation)
                self.runProtected(call, access: access) { try $0.pruneExpiredSources(policy) }
            } catch { call.reject("Choose a supported retention period in the original unlocked workspace.", "RETENTION_INVALID") }
        }
    }

    @objc func getCapabilities(_ call: CAPPluginCall) {
        Task { @MainActor in
            _ = self.storageState()
            if self.authority.state().protectedWorkspace {
                let supported = ARWorldTrackingConfiguration.isSupported && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
                call.resolve(["supported": supported, "platform": "ios", "minimumOsVersion": 15,
                    "reason": supported ? "" : "Protected depth capture requires a supported LiDAR device. Enter or measure dimensions manually."])
                return
            }
            guard #available(iOS 18.0, *) else {
                call.resolve(["supported": false, "platform": "ios", "minimumOsVersion": 18, "reason": "Guided 3D capture needs iOS 18 or later on a supported iPhone or iPad. You can enter or measure the dimensions here."])
                return
            }
            let supported = ObjectCaptureSession.isSupported && PhotogrammetrySession.isSupported
            call.resolve([
                "supported": supported,
                "platform": "ios",
                "minimumOsVersion": 18,
                "reason": supported ? "" : "This iPhone or iPad does not support guided 3D capture. You can enter or measure the dimensions here.",
            ])
        }
    }

    @objc func scanObject(_ call: CAPPluginCall) {
        guard let target = call.getString("target"), ["item", "container_interior"].contains(target) else {
            call.reject("Choose an item or bag-interior scan.", "INVALID_TARGET")
            return
        }

        Task { @MainActor in
            let access: PackingCaptureAuthority.Access
            do { access = try self.bound(call) }
            catch { _ = self.storageState(); call.reject("Unlock or select the original capture workspace before scanning.", "STORAGE_CHANGED"); return }
            if access.workspaceID != nil { self.scanDepth(call, access: access, target: target); return }
            guard #available(iOS 18.0, *) else {
                call.reject("Guided 3D capture needs iOS 18 or later on a supported iPhone or iPad.", "UNSUPPORTED_DEVICE")
                return
            }
            guard ObjectCaptureSession.isSupported && PhotogrammetrySession.isSupported else {
                call.reject("This iPhone or iPad does not support guided 3D capture.", "UNSUPPORTED_DEVICE")
                return
            }
            guard !self.captureBusy, let presenter = self.bridge?.viewController,
                  presenter.presentedViewController == nil,
                  presenter.view.window?.windowScene?.activationState == .foregroundActive,
                  UIApplication.shared.isProtectedDataAvailable else {
                call.reject("The camera screen could not be opened.", "PRESENTATION_FAILED")
                return
            }

            let scanId = UUID().uuidString.lowercased()
            do {
                let model = try NativeScanModel(scanId: scanId, target: target)
                let controller = NativeScanViewController(model: model)
                self.captureBusy = true
                self.cancelScan = { [weak controller] in controller?.cancelCapture() }
                controller.onComplete = { [weak self, weak presenter] result in
                    self?.captureBusy = false
                    self?.cancelScan = nil
                    guard let presenter else {
                        call.reject("The scan screen closed unexpectedly.", "PRESENTATION_FAILED")
                        return
                    }
                    presenter.dismiss(animated: true) {
                        do {
                            try access.check()
                            switch result {
                            case .success(let payload): call.resolve(payload)
                            case .failure(let error): call.reject(error.localizedDescription, "SCAN_FAILED")
                            }
                        } catch {
                            _ = try? PackingCaptureFiles.appStore().delete(scanId)
                            call.reject("The original capture selection changed before the scan returned.", "STORAGE_CHANGED")
                        }
                    }
                }
                controller.modalPresentationStyle = .fullScreen
                presenter.present(controller, animated: true)
            } catch {
                call.reject("A private scan folder could not be prepared.", "STORAGE_FAILED")
            }
        }
    }

    @MainActor private func scanDepth(_ call: CAPPluginCall, access: PackingCaptureAuthority.Access, target: String) {
        guard !captureBusy, let presenter = bridge?.viewController, presenter.presentedViewController == nil,
              presenter.view.window?.windowScene?.activationState == .foregroundActive, UIApplication.shared.isProtectedDataAvailable,
              let store = protectedStore, store.boundLease == access.lease,
              ARWorldTrackingConfiguration.isSupported, ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
              let target = PackingPointCapture.Target(rawValue: target) else {
            call.reject("The protected LiDAR camera screen could not be opened. Check device support and the active workspace.", "PRESENTATION_FAILED"); return
        }
        do {
            let controller = try PackingDepthViewController(access: access, store: store, target: target) { [weak self, weak presenter] result in
                self?.captureBusy = false; self?.cancelScan = nil
                guard let presenter else { call.reject("The scan screen closed unexpectedly.", "PRESENTATION_FAILED"); return }
                presenter.dismiss(animated: true) {
                    do {
                        try access.check()
                        switch result {
                        case .success(let capture): call.resolve(try access.checked { try capture.scanResult() })
                        case .failure(let error): call.reject(error.localizedDescription, "SCAN_FAILED")
                        }
                    } catch { call.reject("The original capture workspace changed before the scan returned.", "STORAGE_CHANGED") }
                }
            }
            captureBusy = true; cancelScan = { [weak controller] in controller?.cancelForWorkspaceChange() }
            presenter.present(controller, animated: true)
        } catch { call.reject("The protected camera could not confirm its original workspace. Unlock it again.", "STORAGE_CHANGED") }
    }

    @objc func deleteCapture(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), UUID(uuidString: id)?.uuidString.lowercased() == id else {
            call.reject("The scan identifier is invalid.", "INVALID_SCAN_ID")
            return
        }
        Task { @MainActor in
            guard !self.captureBusy else { call.reject("Finish or cancel the current scan before removing originals.", "CAPTURE_BUSY"); return }
            do {
                let access = try self.bound(call)
                if access.workspaceID != nil { self.runProtected(call, access: access) { ["deleted": try $0.delete(captureID: id)] } }
                else { call.resolve(["deleted": try access.checked { try PackingCaptureFiles.appStore().delete(id) }]) }
            }
            catch { call.reject("The saved scan could not be removed.", "DELETE_FAILED") }
        }
    }

    @objc func clearCaptures(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.captureBusy else { call.reject("Finish or cancel the current scan before removing originals.", "CAPTURE_BUSY"); return }
            do {
                let access = try self.bound(call)
                if access.workspaceID != nil { self.runProtected(call, access: access) { ["deleted": try $0.clearCaptures()] } }
                else { call.resolve(["deleted": try access.checked { try PackingCaptureFiles.appStore().clear() }]) }
            }
            catch { call.reject("Saved scans could not be removed.", "DELETE_FAILED") }
        }
    }
}

@available(iOS 18.0, *)
@MainActor
private final class NativeScanModel: ObservableObject {
    let session = ObjectCaptureSession()
    let scanId: String
    let target: String
    let scanFolder: URL
    let imagesDirectory: URL
    let checkpointDirectory: URL
    private let files: PackingCaptureFiles
    private var reconstruction: PhotogrammetrySession?

    @Published var phase = "initializing"
    @Published var passReady = false
    @Published var completedPasses = 0
    @Published var feedback: [String] = []
    @Published var progress = ""

    var onComplete: (@MainActor (Result<[String: Any], Error>) -> Void)?
    private var hasCompleted = false

    init(scanId: String, target: String) throws {
        self.scanId = scanId
        self.target = target
        files = try PackingCaptureFiles.appStore()
        scanFolder = try files.create(scanId)
        imagesDirectory = scanFolder.appendingPathComponent("Images", isDirectory: true)
        checkpointDirectory = scanFolder.appendingPathComponent("Checkpoints", isDirectory: true)
        var configuration = ObjectCaptureSession.Configuration()
        configuration.checkpointDirectory = checkpointDirectory
        session.start(imagesDirectory: imagesDirectory, configuration: configuration)
    }

    func observe() async {
        let feedbackTask = Task { @MainActor in
            for await values in session.feedbackUpdates {
                feedback = values.map(Self.feedbackMessage).sorted()
            }
        }
        let passTask = Task { @MainActor in
            for await complete in session.userCompletedScanPassUpdates {
                passReady = complete
                if complete { completedPasses += 1 }
            }
        }
        defer { feedbackTask.cancel(); passTask.cancel(); if !hasCompleted { cancel() } }

        for await state in session.stateUpdates {
            switch state {
            case .initializing: phase = "initializing"
            case .ready: phase = "ready"
            case .detecting: phase = "detecting"
            case .capturing: phase = "capturing"
            case .finishing: phase = "finishing"
            case .completed:
                phase = "reconstructing"
                do { finish(.success(try await reconstruct())) }
                catch { cleanup(); finish(.failure(error)) }
                return
            case .failed(let error):
                cleanup()
                finish(.failure(error))
                return
            @unknown default:
                cleanup()
                finish(.failure(NativeScanError.unknownState))
                return
            }
        }
    }

    func advance() {
        switch session.state {
        case .ready: _ = session.startDetecting()
        case .detecting: session.startCapturing()
        case .capturing: break
        default: break
        }
    }

    func scanAnotherPass() {
        guard case .capturing = session.state, passReady else { return }
        session.beginNewScanPass()
        passReady = false
    }

    func finishCapture() {
        guard case .capturing = session.state, passReady else { return }
        session.finish()
    }

    func cancel() {
        guard !hasCompleted else { return }
        session.cancel()
        reconstruction?.cancel()
        cleanup()
        finish(.failure(NativeScanError.cancelled))
    }

    private func reconstruct() async throws -> [String: Any] {
        guard !hasCompleted, !Task.isCancelled else { throw NativeScanError.cancelled }
        guard PhotogrammetrySession.isSupported else { throw NativeScanError.reconstructionUnsupported }
        let modelURL = scanFolder.appendingPathComponent("Model.usdz")
        let reconstruction = try PhotogrammetrySession(input: imagesDirectory, configuration: PhotogrammetrySession.Configuration())
        self.reconstruction = reconstruction
        defer { self.reconstruction = nil }
        try reconstruction.process(requests: [
            .modelFile(url: modelURL, detail: .reduced, geometry: nil),
            .bounds,
        ])

        var dimensions: [String: Double]?
        for try await output in reconstruction.outputs {
            guard !hasCompleted, !Task.isCancelled else { reconstruction.cancel(); throw NativeScanError.cancelled }
            switch output {
            case .requestProgress(_, let fraction): progress = "Making your 3D model · \(Int(fraction * 100))%"
            case .requestComplete(_, let result):
                if case .bounds(let bounds) = result {
                    let size = bounds.max - bounds.min
                    dimensions = ["length": Double(size.x) * 1000, "width": Double(size.y) * 1000, "height": Double(size.z) * 1000]
                }
            case .requestError(_, let error): throw error
            case .processingComplete:
                guard let dimensions, FileManager.default.fileExists(atPath: modelURL.path) else { throw NativeScanError.noModelResult }
                try files.finalize(scanId)
                let warnings = session.feedback.map(Self.feedbackMessage).sorted()
                return [
                    "record": [
                        "id": scanId,
                        "target": target,
                        "createdAt": ISO8601DateFormatter().string(from: Date()),
                        "platform": "ios",
                        "method": "guided_object_capture",
                        "completedPasses": max(1, completedPasses),
                        "modelStoredLocally": true,
                    ],
                    "dimensionsMm": dimensions,
                    "warnings": warnings,
                ]
            default: break
            }
        }
        throw NativeScanError.noModelResult
    }

    private func finish(_ result: Result<[String: Any], Error>) {
        guard !hasCompleted else { return }
        hasCompleted = true
        onComplete?(result)
    }

    func cleanup() {
        _ = try? files.delete(scanId)
    }

    private static func feedbackMessage(_ feedback: ObjectCaptureSession.Feedback) -> String {
        switch feedback {
        case .environmentLowLight: return "More light may improve the scan."
        case .environmentTooDark: return "Add light before continuing."
        case .movingTooFast: return "Move more slowly."
        case .objectNotDetected: return "Adjust the scan box around the object."
        case .objectNotFlippable: return "Keep the object in place and scan from another height."
        case .objectTooClose: return "Move the camera farther away."
        case .objectTooFar: return "Move the camera closer."
        case .outOfFieldOfView: return "Keep the scan box in view."
        case .overCapturing: return "The device reached its image limit. Finish this scan."
        @unknown default: return "Adjust the camera position for better coverage."
        }
    }
}

@available(iOS 18.0, *)
private enum NativeScanError: LocalizedError {
    case cancelled
    case reconstructionUnsupported
    case noModelResult
    case unknownState

    var errorDescription: String? {
        switch self {
        case .cancelled: return "Scan cancelled."
        case .reconstructionUnsupported: return "This device can capture images but cannot build the 3D model on-device."
        case .noModelResult: return "The scan did not produce a complete 3D model and size estimate."
        case .unknownState: return "The scan entered an unsupported state."
        }
    }
}

@available(iOS 18.0, *)
@MainActor
private final class NativeScanViewController: UIViewController {
    private let model: NativeScanModel
    var onComplete: (@MainActor (Result<[String: Any], Error>) -> Void)? {
        didSet { model.onComplete = onComplete }
    }

    init(model: NativeScanModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
        model.onComplete = { [weak self] result in self?.onComplete?(result) }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func cancelCapture() { model.cancel() }

    override func loadView() {
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        let content = NativeScanFlow(model: model, onCancel: { [weak self] in self?.model.cancel() })
        let hosting = UIHostingController(rootView: content)
        let container = UIView()
        container.backgroundColor = .black
        addChild(hosting)
        view = container
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: container.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    @objc private func interrupted() { model.cancel() }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { model.cancel() }
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}

@available(iOS 18.0, *)
private struct NativeScanFlow: View {
    @ObservedObject var model: NativeScanModel
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            ObjectCaptureView(session: model.session).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Button("Cancel", action: onCancel).buttonStyle(.borderedProminent)
                    Spacer()
                    Text(model.target == "item" ? "Scan item" : "Scan empty bag").font(.headline)
                    Spacer()
                    Color.clear.frame(width: 64, height: 1)
                }
                .padding()
                Spacer()
                VStack(alignment: .leading, spacing: 12) {
                    Text(instruction).font(.headline)
                    if model.target == "container_interior" && model.phase == "ready" {
                        Text("Open the empty bag fully. Scan the inside with the camera pointed at its inner surfaces.").font(.subheadline)
                    }
                    ForEach(model.feedback, id: \.self) { Text($0).font(.subheadline).foregroundStyle(.yellow) }
                    if !model.progress.isEmpty { Text(model.progress).font(.subheadline) }
                    if model.phase == "ready" {
                        Button("Continue", action: model.advance).buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                    } else if model.phase == "detecting" {
                        Button("Start scan", action: model.advance).buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                    } else if model.phase == "capturing" {
                        if model.passReady {
                            Text("One full pass is ready.").font(.subheadline)
                            HStack {
                                Button("Another pass", action: model.scanAnotherPass).buttonStyle(.bordered)
                                Button("Finish scan", action: model.finishCapture).buttonStyle(.borderedProminent)
                            }.frame(maxWidth: .infinity)
                        } else {
                            Text("Move slowly around the scan box until the coverage dial is complete.").font(.subheadline)
                        }
                    } else if model.phase == "reconstructing" || model.phase == "finishing" {
                        ProgressView("Preparing your 3D model…")
                    } else if model.phase == "initializing" {
                        ProgressView("Starting the camera…")
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                .padding()
            }
            .foregroundStyle(.white)
        }
        .task { await model.observe() }
        .preferredColorScheme(.dark)
    }

    private var instruction: String {
        switch model.phase {
        case "ready": return "Place the object in view."
        case "detecting": return "Adjust the box so it covers only the object."
        case "capturing": return "Slowly circle the object."
        case "finishing", "reconstructing": return "Keeping the scan on this device."
        default: return "Get ready to scan."
        }
    }
}

@objc(ScanBridgeViewController)
class ScanBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PackingScanPlugin())
        bridge?.registerPluginInstance(PackingVoicePlugin())
        bridge?.registerPluginInstance(PackingAccountPlugin())
        bridge?.registerPluginInstance(PackingPrintPlugin())
        bridge?.registerPluginInstance(PackingFilesPlugin())
        bridge?.registerPluginInstance(PackingPhotoPlugin())
    }
}
