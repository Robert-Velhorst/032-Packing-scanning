import Capacitor
import RealityKit
import SwiftUI
import UIKit

@objc(PackingScanPlugin)
public class PackingScanPlugin: CAPPlugin, CAPBridgedPlugin {
    private var captureBusy = false
    public let identifier = "PackingScanPlugin"
    public let jsName = "PackingScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanObject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCaptures", returnType: CAPPluginReturnPromise),
    ]

    @objc func getCapabilities(_ call: CAPPluginCall) {
        Task { @MainActor in
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
                controller.onComplete = { [weak self, weak presenter] result in
                    self?.captureBusy = false
                    guard let presenter else {
                        call.reject("The scan screen closed unexpectedly.", "PRESENTATION_FAILED")
                        return
                    }
                    presenter.dismiss(animated: true) {
                        switch result {
                        case .success(let payload): call.resolve(payload)
                        case .failure(let error): call.reject(error.localizedDescription, "SCAN_FAILED")
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

    @objc func deleteCapture(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), UUID(uuidString: id)?.uuidString.lowercased() == id else {
            call.reject("The scan identifier is invalid.", "INVALID_SCAN_ID")
            return
        }
        Task { @MainActor in
            guard !self.captureBusy else { call.reject("Finish or cancel the current scan before removing originals.", "CAPTURE_BUSY"); return }
            do { call.resolve(["deleted": try PackingCaptureFiles.appStore().delete(id)]) }
            catch { call.reject("The saved scan could not be removed.", "DELETE_FAILED") }
        }
    }

    @objc func clearCaptures(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !self.captureBusy else { call.reject("Finish or cancel the current scan before removing originals.", "CAPTURE_BUSY"); return }
            do { call.resolve(["deleted": try PackingCaptureFiles.appStore().clear()]) }
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

    var onComplete: ((Result<[String: Any], Error>) -> Void)?
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
    var onComplete: ((Result<[String: Any], Error>) -> Void)? {
        didSet { model.onComplete = onComplete }
    }

    init(model: NativeScanModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
        model.onComplete = { [weak self] result in self?.onComplete?(result) }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

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
        bridge?.registerPluginInstance(PackingAccountPlugin())
    }
}
