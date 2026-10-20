import ARKit
import AVFoundation
import RealityKit
import UIKit

enum PackingDepthScreenError: LocalizedError {
    case cancelled, unavailable, interrupted, timedOut
    var errorDescription: String? {
        switch self {
        case .cancelled: return "Scan cancelled."
        case .unavailable: return "This device cannot start LiDAR capture. Enter or measure dimensions manually."
        case .interrupted: return "The scan stopped because the workspace or camera is no longer active. Unlock and start a new scan."
        case .timedOut: return "The scan reached its two-minute limit. Start again with the object in clear view."
        }
    }
}

/** Native protected-source capture UI. Its bridge must supply the original live authority/store. */
@MainActor
final class PackingDepthViewController: UIViewController {
    private let access: PackingCaptureAuthority.Access
    private let store: PackingEncryptedCaptureStore
    private let target: PackingPointCapture.Target
    private let completion: @MainActor (Result<PackingPointCapture, Error>) -> Void
    private var flow = PackingDepthFlow()
    private let worker = DispatchQueue(label: "com.packingscanning.depth-source")
    private let camera = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    private let review = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
    private let captureAnchor = AnchorEntity(world: matrix_identity_float4x4)
    private let reviewAnchor = AnchorEntity(world: matrix_identity_float4x4)
    private let overlay = Entity()
    private let reviewContent = Entity()
    private let reviewEye = PerspectiveCamera()
    private var reviewYaw: Float = 0
    private var reviewPitch: Float = 0
    private let countLabel = UILabel()
    private let instructions = UILabel()
    private let area = UISegmentedControl(items: ["60 cm", "1.2 m", "2 m"])
    private let primary = UIButton(type: .system)
    private let restart = UIButton(type: .system)
    private var source: PackingDepthSource?
    private var receiver: PackingARDepthReceiver?
    private var timer: Timer?
    private var startedAt: TimeInterval?
    private var halfExtent: Float { [Float(0.3), 0.6, 1][max(0, area.selectedSegmentIndex)] }

    init(access: PackingCaptureAuthority.Access, store: PackingEncryptedCaptureStore,
         target: PackingPointCapture.Target, completion: @escaping @MainActor (Result<PackingPointCapture, Error>) -> Void) throws {
        try access.check()
        guard access.workspaceID != nil, store.boundLease == access.lease else { throw PackingDepthSourceError.wrongWorkspace }
        self.access = access; self.store = store; self.target = target; self.completion = completion
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen; isModalInPresentation = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        captureAnchor.addChild(overlay); camera.scene.addAnchor(captureAnchor)
        review.environment.background = .color(.black); review.isHidden = true
        review.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(rotateReview)))
        review.addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(zoomReview)))
        review.isAccessibilityElement = true
        review.accessibilityLabel = "Captured surface points. Drag to rotate and pinch to zoom."
        review.accessibilityCustomActions = [
            UIAccessibilityCustomAction(name: "Rotate left", target: self, selector: #selector(rotateLeft)),
            UIAccessibilityCustomAction(name: "Rotate right", target: self, selector: #selector(rotateRight)),
            UIAccessibilityCustomAction(name: "Reset view", target: self, selector: #selector(resetReview))]
        for surface in [camera, review] as [UIView] {
            surface.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(surface)
            NSLayoutConstraint.activate([surface.topAnchor.constraint(equalTo: view.topAnchor), surface.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                surface.leadingAnchor.constraint(equalTo: view.leadingAnchor), surface.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        }
        let cancel = UIButton(type: .system); cancel.setTitle("Cancel", for: .normal)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        cancel.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        let heading = UILabel(); heading.text = target == .item ? "Scan item" : "Scan empty bag"
        heading.font = .preferredFont(forTextStyle: .headline); heading.textColor = .white
        let header = UIStackView(arrangedSubviews: [cancel, heading]); header.axis = .horizontal; header.spacing = 24
        header.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(header)
        NSLayoutConstraint.activate([header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            header.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16), header.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)])
        for label in [countLabel, instructions] {
            label.numberOfLines = 0; label.textColor = .white; label.adjustsFontForContentSizeCategory = true
            label.font = .preferredFont(forTextStyle: .body)
        }
        area.selectedSegmentIndex = 0; area.accessibilityLabel = "Capture box width, height and depth"
        primary.configuration = .filled(); primary.addTarget(self, action: #selector(primaryTapped), for: .touchUpInside)
        restart.setTitle("Restart scan", for: .normal); restart.addTarget(self, action: #selector(restartTapped), for: .touchUpInside)
        for button in [primary, restart] { button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true }
        let stack = UIStackView(arrangedSubviews: [countLabel, instructions, area, primary, restart]); stack.axis = .vertical; stack.spacing = 12
        let panel = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterialDark))
        panel.layer.cornerRadius = 16; panel.clipsToBounds = true; panel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(panel)
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; panel.contentView.addSubview(scroll)
        stack.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            panel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            panel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            panel.heightAnchor.constraint(equalTo: view.safeAreaLayoutGuide.heightAnchor, multiplier: 0.43),
            scroll.topAnchor.constraint(equalTo: panel.contentView.topAnchor), scroll.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32)])
        instructions.text = "Choose a box that can contain the whole object. Aim at its center before starting. Keep the object still and remove neighbouring objects. Hidden surfaces and bag openings still need manual checks."
        refreshControls()
        for name in [UIApplication.didEnterBackgroundNotification, UIApplication.protectedDataWillBecomeUnavailableNotification] {
            NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: name, object: nil)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(resignedActive), name: UIApplication.willResignActiveNotification, object: nil)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }
    private func checkForeground() throws {
        try access.check()
        guard UIApplication.shared.isProtectedDataAvailable,
              view.window?.windowScene?.activationState == .foregroundActive else { throw PackingDepthScreenError.interrupted }
    }
    @objc private func primaryTapped() {
        switch flow.phase {
        case .ready: requestCamera()
        case .capturing: beginReview()
        case .reviewing: publish()
        default: break
        }
    }
    private func requestCamera() {
        do { try checkForeground() } catch { finish(.failure(error)); return }
        guard ARWorldTrackingConfiguration.isSupported, ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else {
            countLabel.text = PackingDepthScreenError.unavailable.localizedDescription; return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: if flow.beginAuthorized() { startSession() }
        case .notDetermined:
            guard let token = flow.requestPermission() else { return }; refreshControls()
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in
                    guard let self, self.flow.permissionReply(token, granted: granted) else {
                        if let self, self.flow.phase == .ready {
                            self.countLabel.text = "Allow Camera in Settings to scan, or cancel and enter measurements manually."
                        }
                        self?.refreshControls(); return
                    }
                    self.startSession()
                }
            }
        default: countLabel.text = "Allow Camera in Settings to scan, or cancel and enter measurements manually."
        }
    }
    private func startSession() {
        do {
            try checkForeground()
            let source = try PackingDepthSource(access: access, halfExtent: halfExtent)
            let receiver = PackingARDepthReceiver(source: source)
            self.source = source; self.receiver = receiver
            camera.session.delegateQueue = worker; camera.session.delegate = receiver
            camera.isHidden = false; review.isHidden = true
            let configuration = ARWorldTrackingConfiguration(); configuration.frameSemantics = .sceneDepth
            camera.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
            startedAt = ProcessInfo.processInfo.systemUptime
            instructions.text = "Move slowly around the stationary object. The box starts at the surface under the center of the camera. Restart if it clips the object or includes unwanted surfaces."
            refreshControls()
        } catch { finish(.failure(error)) }
    }
    private func refreshControls() {
        area.isEnabled = flow.phase == .ready
        restart.isHidden = flow.phase != .capturing && flow.phase != .reviewing
        switch flow.phase {
        case .ready: primary.setTitle("Start scan", for: .normal); primary.isEnabled = true
        case .permission: primary.setTitle("Waiting for camera permission…", for: .normal); primary.isEnabled = false
        case .capturing: primary.setTitle("Review scan", for: .normal); primary.isEnabled = false
        case .reviewing: primary.setTitle("Save scan", for: .normal); primary.isEnabled = true
        case .saving: primary.setTitle("Saving scan…", for: .normal); primary.isEnabled = false
        case .ended: primary.isEnabled = false
        }
    }
    private func tick() {
        guard flow.phase != .ended else { return }
        do {
            try access.check()
            guard flow.phase == .capturing || flow.phase == .reviewing else { return }
            try checkForeground()
            if flow.phase == .capturing, let startedAt, ProcessInfo.processInfo.systemUptime - startedAt >= 120 {
                throw PackingDepthScreenError.timedOut
            }
            guard let source else { throw PackingDepthScreenError.interrupted }
            let status = try source.status()
            countLabel.text = "\(status.pointCount.formatted()) surface points · \(status.viewCount) viewpoints. "
                + (status.capped ? "Point limit reached. " : "") + (status.readinessIssue ?? "Ready to review. Coverage is not a fit guarantee.")
            if flow.phase == .capturing {
                primary.isEnabled = status.readinessIssue == nil
                let preview = try source.preview()
                if let transform = preview.captureToWorld {
                    overlay.transform = Transform(matrix: transform)
                    overlay.children.removeAll()
                    overlay.addChild(box()); overlay.addChild(try pointNode(preview.points))
                }
            }
        } catch { finish(.failure(error)) }
    }
    private func box() -> Entity {
        let root = Entity(), size = halfExtent * 2, thickness = halfExtent * 0.006
        let material = UnlitMaterial(color: .systemCyan)
        for axis in 0..<3 {
            var dimensions = SIMD3<Float>(repeating: thickness); dimensions[axis] = size
            let mesh = MeshResource.generateBox(size: dimensions)
            for a in [Float(-1), 1] { for b in [Float(-1), 1] {
                let edge = ModelEntity(mesh: mesh, materials: [material])
                edge.position[(axis + 1) % 3] = a * halfExtent; edge.position[(axis + 2) % 3] = b * halfExtent
                root.addChild(edge)
            } }
        }
        return root
    }
    private func pointNode(_ points: [SIMD3<Float>]) throws -> Entity {
        guard !points.isEmpty else { return Entity() }
        let radius = halfExtent * 0.006
        let offsets: [SIMD3<Float>] = [SIMD3(radius,0,0), SIMD3(-radius,0,0), SIMD3(0,radius,0), SIMD3(0,-radius,0), SIMD3(0,0,radius), SIMD3(0,0,-radius)]
        let faces: [UInt32] = [2,4,0, 2,1,4, 2,5,1, 2,0,5, 3,0,4, 3,4,1, 3,1,5, 3,5,0]
        var positions: [SIMD3<Float>] = [], indices: [UInt32] = []
        for point in points {
            let base = UInt32(positions.count); positions.append(contentsOf: offsets.map { point + $0 })
            indices.append(contentsOf: faces.map { base + $0 })
        }
        var descriptor = MeshDescriptor(name: "captured-surface-points")
        descriptor.positions = MeshBuffers.Positions(positions); descriptor.primitives = .triangles(indices)
        return ModelEntity(mesh: try MeshResource.generate(from: [descriptor]), materials: [UnlitMaterial(color: .systemMint)])
    }
    private func beginReview() {
        do {
            try checkForeground()
            guard let source else { throw PackingDepthScreenError.interrupted }
            try source.freezeForReview(); camera.session.pause()
            let preview = try source.preview()
            guard flow.review() else { return }
            reviewContent.children.removeAll(); reviewAnchor.children.removeAll(); review.scene.anchors.removeAll()
            reviewContent.addChild(box()); reviewContent.addChild(try pointNode(preview.points))
            reviewEye.position = SIMD3(0, 0, halfExtent * 4)
            reviewYaw = 0; reviewPitch = 0; updateReviewRotation()
            reviewAnchor.addChild(reviewContent); reviewAnchor.addChild(reviewEye); review.scene.addAnchor(reviewAnchor)
            camera.isHidden = true; review.isHidden = false
            instructions.text = "Drag to inspect the captured points from different angles. Restart if you see nearby objects, clipped edges or missing surfaces. A point preview does not prove dimensions, usable space or closure."
            refreshControls()
        } catch { finish(.failure(error)) }
    }
    private func publish() {
        do { try checkForeground() } catch { finish(.failure(error)); return }
        guard let source, let token = flow.save() else { return }
        refreshControls()
        let store = store, target = target
        worker.async {
            let result = Result { try source.finish(target: target, store: store) }
            Task { @MainActor [weak self] in
                guard let self, self.flow.acceptsSave(token) else {
                    if case .success(let capture) = result { _ = try? store.delete(captureID: capture.id) }
                    return
                }
                do { try self.checkForeground(); self.finish(result) }
                catch {
                    if case .success(let capture) = result { _ = try? store.delete(captureID: capture.id) }
                    self.finish(.failure(error))
                }
            }
        }
    }
    @objc private func restartTapped() {
        guard flow.restart() else { return }
        stopCamera(); countLabel.text = "Aim at the center of the stationary object, then start a new scan."
        instructions.text = "Choose a box that contains the whole object. Keep the object still and remove neighbouring objects."
        refreshControls()
    }
    private func updateReviewRotation() {
        reviewContent.orientation = simd_quatf(angle: reviewYaw, axis: SIMD3(0,1,0))
            * simd_quatf(angle: reviewPitch, axis: SIMD3(1,0,0))
    }
    @objc private func rotateReview(_ gesture: UIPanGestureRecognizer) {
        guard flow.phase == .reviewing else { return }
        let delta = gesture.translation(in: review); gesture.setTranslation(.zero, in: review)
        reviewYaw += Float(delta.x) / 200; reviewPitch = min(.pi / 2, max(-.pi / 2, reviewPitch + Float(delta.y) / 200))
        updateReviewRotation()
    }
    @objc private func zoomReview(_ gesture: UIPinchGestureRecognizer) {
        guard flow.phase == .reviewing, gesture.scale.isFinite, gesture.scale > 0 else { return }
        reviewEye.position.z = min(halfExtent * 10, max(halfExtent * 1.3, reviewEye.position.z / Float(gesture.scale)))
        gesture.scale = 1
    }
    @objc private func rotateLeft() -> Bool {
        guard flow.phase == .reviewing else { return false }; reviewYaw -= .pi / 6; updateReviewRotation(); return true
    }
    @objc private func rotateRight() -> Bool {
        guard flow.phase == .reviewing else { return false }; reviewYaw += .pi / 6; updateReviewRotation(); return true
    }
    @objc private func resetReview() -> Bool {
        guard flow.phase == .reviewing else { return false }; reviewYaw = 0; reviewPitch = 0
        reviewEye.position.z = halfExtent * 4; updateReviewRotation(); return true
    }
    @objc private func cancelTapped() { finish(.failure(PackingDepthScreenError.cancelled)) }
    func cancelForWorkspaceChange() { finish(.failure(PackingDepthScreenError.interrupted)) }
    @objc private func interrupted() { finish(.failure(PackingDepthScreenError.interrupted)) }
    @objc private func resignedActive() {
        if flow.phase == .capturing || flow.phase == .reviewing || flow.phase == .saving { interrupted() }
    }
    private func stopCamera() {
        review.isHidden = true; camera.isHidden = true
        camera.session.pause(); camera.session.delegate = nil; receiver = nil
        source?.cancel(); source = nil; startedAt = nil
        overlay.children.removeAll(); reviewContent.children.removeAll(); review.scene.anchors.removeAll()
    }
    private func finish(_ result: Result<PackingPointCapture, Error>) {
        guard flow.end() else { return }
        timer?.invalidate(); timer = nil; stopCamera(); refreshControls(); completion(result)
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { finish(.failure(PackingDepthScreenError.cancelled)) }
    }
    deinit { timer?.invalidate(); NotificationCenter.default.removeObserver(self) }
}
