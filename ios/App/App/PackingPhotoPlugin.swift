import AVFoundation
import Capacitor
import PhotosUI
import UIKit
import UniformTypeIdentifiers

private enum PackingPhotoFailure: Error, Sendable { case unavailable }
private final class PackingPhotoPermit {
    private let budget: PackingCaptureQueueBudget
    init(_ budget: PackingCaptureQueueBudget) { self.budget = budget }
    deinit { budget.release() }
}
private struct PackingPreparedPhotoDraft: Sendable {
    let store: PackingPendingItemPhotoStore
    let receipt: PackingPendingItemPhotoStore.Receipt
}
@MainActor private final class PackingPhotoRequest {
    let call: CAPPluginCall
    let plugin: PackingPhotoPlugin
    init(_ call: CAPPluginCall, _ plugin: PackingPhotoPlugin) { self.call = call; self.plugin = plugin }
}
@MainActor private final class PackingPhotoOperation {
    let id = UUID()
    let channel: PackingPhotoRequest
    let prepared: PackingPreparedPhotoDraft
    var controller: UIViewController?
    var transfer: Progress?
    var timeout: Task<Void, Never>?
    init(_ channel: PackingPhotoRequest, _ prepared: PackingPreparedPhotoDraft) { self.channel = channel; self.prepared = prepared }
}

@objc(PackingPhotoPlugin)
public class PackingPhotoPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    public let identifier = "PackingPhotoPlugin"
    public let jsName = "PackingPhoto"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickItemPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readItemPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardItemPhoto", returnType: CAPPluginReturnPromise),
    ]
    private let runtime = PackingItemPhotoRuntime.shared
    @MainActor private var permit: PackingPhotoPermit?
    @MainActor private var operation: PackingPhotoOperation?
    @MainActor private func liveAccess(_ call: CAPPluginCall) throws -> PackingCaptureAuthority.Access {
        guard UIApplication.shared.isProtectedDataAvailable,
              bridge?.viewController?.view.window?.windowScene?.activationState == .foregroundActive,
              let lease = call.getString("lease"), let scan = bridge?.plugin(withName: "PackingScan") as? PackingScanPlugin else { throw PackingPhotoFailure.unavailable }
        return try scan.documentAccess(lease: lease)
    }
    @MainActor private func claim(_ call: CAPPluginCall) -> Bool {
        guard permit == nil, runtime.budget.claim() else { call.reject("Finish the current photo operation first.", "PHOTO_BUSY"); return false }
        permit = PackingPhotoPermit(runtime.budget); return true
    }
    @MainActor private func fail(_ call: CAPPluginCall) {
        permit = nil; call.reject("The photo draft could not be confirmed. Unlock its original workspace, or start a new selection if it expired. Saved packing records have not changed.", "PHOTO_UNAVAILABLE")
    }
    @objc func pickItemPhoto(_ call: CAPPluginCall) {
        Task { @MainActor in
            var options = call.jsObjectRepresentation
            let draft = options.removeValue(forKey: "draftJson") as? String; call.options = options
            guard let draft, !draft.isEmpty, draft.utf8.count <= PackingPendingItemPhotoStore.maximumDraftBytes,
                  let source = call.getString("source"), ["camera", "library"].contains(source) else { call.reject("The photo draft or source is invalid.", "INVALID_PHOTO_DRAFT"); return }
            guard self.claim(call) else { return }
            let access: PackingCaptureAuthority.Access, scope: PackingPendingBackupStore.Scope
            do {
                guard self.bridge?.viewController?.presentedViewController == nil else { throw PackingPhotoFailure.unavailable }
                access = try self.liveAccess(call); scope = try PackingPendingBackupStore.Scope(access: access)
            } catch { self.fail(call); return }
            let channel = PackingPhotoRequest(call, self), runtime = self.runtime
            // The explicitly borrowed draft is staged against its original frozen scope. Even
            // a lock during preparation must return its receipt rather than silently lose it.
            runtime.worker.async {
                let result: Result<PackingPreparedPhotoDraft, PackingPhotoFailure>
                do { let store = try runtime.pendingStore(); result = .success(PackingPreparedPhotoDraft(store: store, receipt: try store.prepare(scope: scope, draftJSON: draft))) }
                catch { result = .failure(.unavailable) }
                Task { @MainActor in channel.plugin.prepared(channel, source: source, access: access, result: result) }
            }
        }
    }
    @MainActor private func prepared(_ channel: PackingPhotoRequest, source: String, access: PackingCaptureAuthority.Access,
                                    result: Result<PackingPreparedPhotoDraft, PackingPhotoFailure>) {
        do {
            let prepared = try result.get(), op = PackingPhotoOperation(channel, prepared); operation = op
            op.timeout = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 600_000_000_000) } catch { return }
                self?.receive(op.id, bytes: nil, notice: "Photo selection expired. Start again if the draft is no longer available.")
            }
            do {
                try access.check(); _ = try liveAccess(channel.call)
                guard let scan = bridge?.plugin(withName: "PackingScan") as? PackingScanPlugin else { throw PackingPhotoFailure.unavailable }
                try scan.prepareDocumentHandoff(lease: access.lease)
                if source == "library" { try showLibrary(op) }
                else {
                    switch AVCaptureDevice.authorizationStatus(for: .video) {
                    case .authorized: try showCamera(op)
                    case .notDetermined:
                        AVCaptureDevice.requestAccess(for: .video) { allowed in
                            Task { @MainActor in channel.plugin.cameraPermission(op.id, allowed: allowed) }
                        }
                    default: receive(op.id, bytes: nil, notice: "Camera permission was not granted. Your encrypted item draft can be resumed.")
                    }
                }
            } catch { receive(op.id, bytes: nil, notice: "The photo screen could not open or the workspace locked. Your encrypted item draft can be resumed.") }
        } catch { fail(channel.call) }
    }
    @MainActor private func presenter() throws -> UIViewController {
        guard UIApplication.shared.isProtectedDataAvailable,
              let controller = bridge?.viewController, controller.view.window?.windowScene?.activationState == .foregroundActive,
              controller.presentedViewController == nil else { throw PackingPhotoFailure.unavailable }; return controller
    }
    @MainActor private func showLibrary(_ op: PackingPhotoOperation) throws {
        let controller = try presenter()
        var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = 1; config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config); picker.delegate = self; op.controller = picker
        controller.present(picker, animated: true); picker.presentationController?.delegate = self
    }
    @MainActor private func cameraPermission(_ id: UUID, allowed: Bool) {
        guard let op = operation, op.id == id else { return }
        do { guard allowed else { throw PackingPhotoFailure.unavailable }; try showCamera(op) }
        catch { receive(id, bytes: nil, notice: "Camera permission or capture was unavailable. Your encrypted item draft can be resumed.") }
    }
    @MainActor private func showCamera(_ op: PackingPhotoOperation) throws {
        let controller = try presenter(), id = op.id, channel = op.channel
        let camera = PackingReferenceCamera { data in channel.plugin.receive(id, bytes: data, notice: "Camera closed or capture failed. Your encrypted item draft can be resumed.") }
        op.controller = camera; controller.present(camera, animated: true)
    }
    @MainActor public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard let op = operation, op.controller === presentationController.presentedViewController else { return }
        receive(op.id, bytes: nil, notice: "Photo selection cancelled. Your encrypted item draft can be resumed.")
    }
    @MainActor public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard let op = operation, op.controller === picker else { return }
        guard results.count == 1, let provider = results.first?.itemProvider, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else {
            receive(op.id, bytes: nil, notice: "Photo selection cancelled or unsupported. Your encrypted item draft can be resumed."); return
        }
        picker.dismiss(animated: true); op.controller = nil
        let id = op.id, channel = op.channel
        // NSItemProvider owns the temporary URL only for this callback. Read it synchronously
        // and bound the stream; never dispatch the URL, persist it or copy a plaintext file.
        op.transfer = provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
            let bytes = url.flatMap { try? PackingReferencePhoto.readProviderFile($0) }
            Task { @MainActor in channel.plugin.receive(id, bytes: bytes, notice: "The selected image could not be read. Your encrypted item draft can be resumed.") }
        }
    }
    @MainActor private func receive(_ id: UUID, bytes: Data?, notice: String) {
        guard let op = operation, op.id == id else { return }; operation = nil
        op.timeout?.cancel(); op.transfer?.cancel(); op.controller?.dismiss(animated: true); op.controller = nil
        let prepared = op.prepared, channel = op.channel
        runtime.worker.async {
            let result: Result<Data, PackingPhotoFailure>
            do {
                let receipt: PackingPendingItemPhotoStore.Receipt, message: String
                if var bytes {
                    defer { bytes.resetBytes(in: 0..<bytes.count) }
                    do {
                        receipt = try prepared.store.complete(prepared.receipt.ticket, photo: PackingReferencePhoto.prepare(bytes))
                        message = "Reference photo prepared. Unlock its original workspace, resume the item draft, and save explicitly."
                    } catch {
                        receipt = try prepared.store.cancelled(prepared.receipt.ticket)
                        message = "The photo could not be prepared. Your encrypted item draft can be resumed without it."
                    }
                } else { receipt = try prepared.store.cancelled(prepared.receipt.ticket); message = notice }
                result = .success(try JSONSerialization.data(withJSONObject: ["ticket": receipt.ticket, "target": receipt.target, "selected": receipt.selected, "notice": message]))
            } catch { result = .failure(.unavailable) }
            Task { @MainActor in channel.plugin.finish(channel.call, result: result) }
        }
    }
    @MainActor private func finish(_ call: CAPPluginCall, result: Result<Data, PackingPhotoFailure>, access: PackingCaptureAuthority.Access? = nil) {
        do {
            if let access { try access.check(); _ = try liveAccess(call) }
            guard let object = try JSONSerialization.jsonObject(with: result.get()) as? [String: Any] else { throw PackingPhotoFailure.unavailable }
            if let access { try access.check(); _ = try liveAccess(call) }
            permit = nil; call.resolve(object)
        } catch { fail(call) }
    }
    @objc func readItemPhoto(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.claim(call) else { return }
            let access: PackingCaptureAuthority.Access
            do { access = try self.liveAccess(call) } catch { self.fail(call); return }
            guard let ticket = call.getString("ticket") else { self.fail(call); return }
            let channel = PackingPhotoRequest(call, self), runtime = self.runtime
            runtime.worker.async {
                let result: Result<Data, PackingPhotoFailure>
                do {
                    var content = try runtime.pendingStore().read(ticket: ticket, access: access)
                    defer { if let count = content.jpeg?.count { content.jpeg?.resetBytes(in: 0..<count) } }
                    var object: [String: Any] = ["draftJson": content.draftJSON]
                    if let jpeg = content.jpeg { object["dataUrl"] = "data:image/jpeg;base64," + jpeg.base64EncodedString() }
                    result = .success(try JSONSerialization.data(withJSONObject: object))
                } catch { result = .failure(.unavailable) }
                Task { @MainActor in channel.plugin.finish(channel.call, result: result, access: access) }
            }
        }
    }
    @objc func discardItemPhoto(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.claim(call) else { return }
            guard let ticket = call.getString("ticket") else { self.fail(call); return }
            let channel = PackingPhotoRequest(call, self), runtime = self.runtime
            runtime.worker.async {
                let result: Result<Data, PackingPhotoFailure>
                do { try runtime.pendingStore().discard(ticket: ticket); result = .success(Data("{}".utf8)) }
                catch { result = .failure(.unavailable) }
                Task { @MainActor in channel.plugin.finish(channel.call, result: result) }
            }
        }
    }
}
