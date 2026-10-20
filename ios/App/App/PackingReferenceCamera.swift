import AVFoundation
import UIKit

private enum PackingCameraOrientation: Sendable { case portrait, upsideDown, landscapeLeft, landscapeRight }

/** Session state is confined to one queue; no UIKit object or file URL reaches it. */
private final class PackingReferenceCameraEngine: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "com.packingscanning.reference-camera")
    private let output = AVCapturePhotoOutput()
    private let completion: @Sendable (Data?) -> Void
    private var closed = false
    private var takingPhoto = false
    init(completion: @escaping @Sendable (Data?) -> Void) { self.completion = completion }
    func start() {
        queue.async {
            guard !self.closed else { return }
            do {
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { throw PackingReferencePhotoError.unsupported }
                let input = try AVCaptureDeviceInput(device: device)
                self.session.beginConfiguration()
                self.session.sessionPreset = .photo
                guard self.session.canAddInput(input), self.session.canAddOutput(self.output) else {
                    self.session.commitConfiguration(); throw PackingReferencePhotoError.unsupported
                }
                self.session.addInput(input); self.session.addOutput(self.output); self.session.commitConfiguration()
                self.output.maxPhotoQualityPrioritization = .balanced
                if #available(iOS 16.0, *) {
                    let sizes = device.activeFormat.supportedMaxPhotoDimensions.filter {
                        $0.width > 0 && $0.height > 0 && max($0.width, $0.height) <= 4096 && Int64($0.width) * Int64($0.height) <= 16_000_000
                    }.sorted { Int64($0.width) * Int64($0.height) < Int64($1.width) * Int64($1.height) }
                    guard let size = sizes.last(where: { max($0.width, $0.height) <= 2048 }) ?? sizes.first else { throw PackingReferencePhotoError.unsupported }
                    self.output.maxPhotoDimensions = size
                }
                self.session.startRunning()
                guard self.session.isRunning else { throw PackingReferencePhotoError.unsupported }
            } catch { self.finish(nil) }
        }
    }
    func takePhoto(orientation: PackingCameraOrientation) {
        queue.async {
            guard !self.closed, !self.takingPhoto else { return }
            guard self.session.isRunning, self.output.availablePhotoCodecTypes.contains(.jpeg) else { self.finish(nil); return }
            self.takingPhoto = true
            if let connection = self.output.connection(with: .video) {
                if #available(iOS 17.0, *) {
                    let angle: CGFloat
                    switch orientation { case .portrait: angle = 90; case .upsideDown: angle = 270; case .landscapeLeft: angle = 180; default: angle = 0 }
                    if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
                } else if connection.isVideoOrientationSupported {
                    switch orientation { case .portrait: connection.videoOrientation = .portrait; case .upsideDown: connection.videoOrientation = .portraitUpsideDown; case .landscapeLeft: connection.videoOrientation = .landscapeLeft; case .landscapeRight: connection.videoOrientation = .landscapeRight }
                }
            }
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            settings.photoQualityPrioritization = .balanced
            if #available(iOS 16.0, *) { settings.maxPhotoDimensions = self.output.maxPhotoDimensions }
            self.output.capturePhoto(with: settings, delegate: self)
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let bytes = error == nil ? photo.fileDataRepresentation() : nil
        queue.async { self.finish(bytes) }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        if error != nil { queue.async { self.finish(nil) } }
    }
    func stop() { queue.async { self.finish(nil) } }
    private func finish(_ data: Data?) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !closed else { return }; closed = true
        if session.isRunning { session.stopRunning() }
        for input in session.inputs { session.removeInput(input) }
        for output in session.outputs { session.removeOutput(output) }
        completion(data)
    }
}

/** Captures in-memory JPEG bytes, never a camera-output/gallery/temp file. */
@MainActor final class PackingReferenceCamera: UIViewController {
    private let completion: @MainActor (Data?) -> Void
    private var engine: PackingReferenceCameraEngine?
    private var preview: AVCaptureVideoPreviewLayer?
    private var completed = false
    private var timeout: Task<Void, Never>?
    private let shutter = UIButton(type: .system)
    init(completion: @escaping @MainActor (Data?) -> Void) { self.completion = completion; super.init(nibName: nil, bundle: nil); modalPresentationStyle = .fullScreen }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        let engine = PackingReferenceCameraEngine { [weak self] data in Task { @MainActor in self?.finish(data) } }
        self.engine = engine
        let preview = AVCaptureVideoPreviewLayer(session: engine.session); preview.videoGravity = .resizeAspect
        self.preview = preview; view.layer.addSublayer(preview)
        let label = UILabel(); label.text = "Take a reference photo"; label.textColor = .white; label.font = .preferredFont(forTextStyle: .headline)
        label.textAlignment = .center; label.numberOfLines = 0; label.adjustsFontForContentSizeCategory = true
        let cancel = UIButton(type: .system); cancel.setTitle("Cancel", for: .normal); cancel.addTarget(self, action: #selector(cancelled), for: .touchUpInside)
        shutter.setTitle("Take photo", for: .normal); shutter.addTarget(self, action: #selector(capture), for: .touchUpInside)
        for button in [cancel, shutter] { button.titleLabel?.font = .preferredFont(forTextStyle: .title3); button.tintColor = .white; button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true }
        let buttons = UIStackView(arrangedSubviews: [cancel, shutter]); buttons.axis = .horizontal; buttons.distribution = .fillEqually
        let controls = UIStackView(arrangedSubviews: [label, buttons]); controls.axis = .vertical; controls.spacing = 12; controls.translatesAutoresizingMaskIntoConstraints = false
        controls.backgroundColor = UIColor.black.withAlphaComponent(0.8); view.addSubview(controls)
        NSLayoutConstraint.activate([controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12), controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12), controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)])
        NotificationCenter.default.addObserver(self, selector: #selector(cancelled), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(cancelled), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(cancelled), name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(sessionStarted), name: AVCaptureSession.didStartRunningNotification, object: engine.session)
        engine.start()
        timeout = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 90_000_000_000) } catch { return }
            self?.finish(nil)
        }
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds; updatePreview() }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); finish(nil) }
    @objc private func cancelled() { finish(nil) }
    @objc private func capture() {
        guard !completed, shutter.isEnabled else { return }; shutter.isEnabled = false
        engine?.takePhoto(orientation: orientation)
    }
    private var orientation: PackingCameraOrientation {
        switch view.window?.windowScene?.interfaceOrientation {
        case .landscapeLeft: return .landscapeLeft
        case .landscapeRight: return .landscapeRight
        case .portraitUpsideDown: return .upsideDown
        default: return .portrait
        }
    }
    @objc nonisolated private func sessionStarted() { Task { @MainActor in self.updatePreview() } }
    private func updatePreview() {
        guard let connection = preview?.connection else { return }
        if #available(iOS 17.0, *) {
            let angle: CGFloat
            switch orientation { case .portrait: angle = 90; case .upsideDown: angle = 270; case .landscapeLeft: angle = 180; case .landscapeRight: angle = 0 }
            if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
        } else if connection.isVideoOrientationSupported {
            switch orientation { case .portrait: connection.videoOrientation = .portrait; case .upsideDown: connection.videoOrientation = .portraitUpsideDown; case .landscapeLeft: connection.videoOrientation = .landscapeLeft; case .landscapeRight: connection.videoOrientation = .landscapeRight }
        }
    }
    private func finish(_ data: Data?) {
        guard !completed else { return }; completed = true
        timeout?.cancel(); timeout = nil; engine?.stop(); engine = nil
        NotificationCenter.default.removeObserver(self); completion(data)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}
