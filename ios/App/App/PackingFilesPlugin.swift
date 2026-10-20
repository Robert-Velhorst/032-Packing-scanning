import Capacitor
import UIKit
import UniformTypeIdentifiers

private enum PackingFilesFailure: Error, Sendable { case unavailable }
private final class PackingFilesPermit {
    private let budget: PackingCaptureQueueBudget
    init(_ budget: PackingCaptureQueueBudget) { self.budget = budget }
    deinit { budget.release() }
}
private struct PackingPreparedBackup: Sendable {
    let store: PackingPendingBackupStore
    let scope: PackingPendingBackupStore.Scope
    let ticket: String?
}
@MainActor private final class PackingFilesRequest {
    let call: CAPPluginCall
    let plugin: PackingFilesPlugin
    init(_ call: CAPPluginCall, _ plugin: PackingFilesPlugin) { self.call = call; self.plugin = plugin }
}
@MainActor private final class PackingDocumentOperation {
    let call: CAPPluginCall
    let prepared: PackingPreparedBackup
    let picker: UIDocumentPickerViewController
    init(_ call: CAPPluginCall, _ prepared: PackingPreparedBackup, _ picker: UIDocumentPickerViewController) {
        self.call = call; self.prepared = prepared; self.picker = picker
    }
}

/** UIKit and Capacitor calls stay on MainActor. The provider worker receives only scoped values. */
@objc(PackingFilesPlugin)
public class PackingFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    public let identifier = "PackingFilesPlugin"
    public let jsName = "PackingFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardBackup", returnType: CAPPluginReturnPromise),
    ]
    @MainActor private var operation: PackingDocumentOperation?
    @MainActor private var permit: PackingFilesPermit?
    private let runtime = PackingBackupRuntime.shared

    @MainActor private func liveAccess(_ call: CAPPluginCall) throws -> PackingCaptureAuthority.Access {
        guard UIApplication.shared.isProtectedDataAvailable,
              bridge?.viewController?.view.window?.windowScene?.activationState == .foregroundActive,
              let lease = call.getString("lease"), let scan = bridge?.plugin(withName: "PackingScan") as? PackingScanPlugin else {
            throw PackingFilesFailure.unavailable
        }
        return try scan.documentAccess(lease: lease)
    }
    @MainActor private func claim(_ call: CAPPluginCall) -> Bool {
        guard permit == nil, runtime.budget.claim() else { call.reject("Finish the current file operation before continuing.", "FILES_BUSY"); return false }
        permit = PackingFilesPermit(runtime.budget); return true
    }
    @MainActor private func release() { permit = nil }
    @MainActor private func fail(_ call: CAPPluginCall) {
        release(); call.reject("The file operation could not be confirmed. Unlock the original workspace and choose the file or folder again.", "FILES_UNAVAILABLE")
    }
    @objc func pickBackup(_ call: CAPPluginCall) { Task { @MainActor in self.prepare(call, text: nil) } }
    @objc func saveBackup(_ call: CAPPluginCall) {
        Task { @MainActor in
            var options = call.jsObjectRepresentation
            let text = options.removeValue(forKey: "text") as? String; call.options = options
            guard let text, !text.isEmpty, text.utf8.count <= PackingPendingBackupStore.maximumBytes else {
                call.reject("Choose a nonempty backup under 80 MB.", "INVALID_BACKUP"); return
            }
            self.prepare(call, text: text)
        }
    }
    @MainActor private func prepare(_ call: CAPPluginCall, text: String?) {
        guard claim(call) else { return }
        let access: PackingCaptureAuthority.Access
        do {
            guard bridge?.viewController?.presentedViewController == nil else { throw PackingFilesFailure.unavailable }
            access = try liveAccess(call)
        } catch { fail(call); return }
        let runtime = runtime, request = PackingFilesRequest(call, self)
        runtime.worker.async {
            let result: Result<PackingPreparedBackup, PackingFilesFailure>
            do {
                let store = try runtime.pendingStore()
                let prepared = try access.checked { () throws -> PackingPreparedBackup in
                    let scope = try PackingPendingBackupStore.Scope(access: access)
                    var ticket: String?
                    if let text {
                        let bytes = text.utf8; var cursor = bytes.startIndex
                        ticket = try store.stage(scope: scope) { count in
                            let end = bytes.index(cursor, offsetBy: count, limitedBy: bytes.endIndex) ?? bytes.endIndex
                            defer { cursor = end }; return Data(bytes[cursor..<end])
                        }.ticket
                    }
                    return PackingPreparedBackup(store: store, scope: scope, ticket: ticket)
                }
                result = .success(prepared)
            } catch { result = .failure(.unavailable) }
            Task { @MainActor in request.plugin.present(request.call, access: access, result: result) }
        }
    }
    @MainActor private func present(_ call: CAPPluginCall, access: PackingCaptureAuthority.Access,
                                   result: Result<PackingPreparedBackup, PackingFilesFailure>) {
        var prepared: PackingPreparedBackup?
        do {
            prepared = try result.get(); try access.check(); _ = try liveAccess(call)
            guard let prepared, let controller = bridge?.viewController, controller.presentedViewController == nil else { throw PackingFilesFailure.unavailable }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: prepared.ticket == nil ? [.json, .plainText, .data] : [.folder], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.title = prepared.ticket == nil ? "Choose backup file" : "Choose folder for backup"
            picker.delegate = self
            guard let scan = bridge?.plugin(withName: "PackingScan") as? PackingScanPlugin else { throw PackingFilesFailure.unavailable }
            try scan.prepareDocumentHandoff(lease: access.lease)
            operation = PackingDocumentOperation(call, prepared, picker)
            controller.present(picker, animated: true)
            picker.presentationController?.delegate = self
        } catch {
            if let prepared, let ticket = prepared.ticket { runtime.worker.async { try? prepared.store.discard(ticket: ticket) } }
            fail(call)
        }
    }
    @MainActor public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { cancel(controller) }
    @MainActor public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if let picker = presentationController.presentedViewController as? UIDocumentPickerViewController { cancel(picker) }
    }
    @MainActor private func cancel(_ picker: UIDocumentPickerViewController) {
        guard let pending = operation, pending.picker === picker else { return }
        operation = nil
        let prepared = pending.prepared
        if let ticket = prepared.ticket { runtime.worker.async { try? prepared.store.discard(ticket: ticket) } }
        release(); pending.call.resolve(prepared.ticket == nil ? ["selected": false] : ["saved": false])
    }
    @MainActor public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let pending = operation, pending.picker === controller else { return }
        operation = nil
        let prepared = pending.prepared
        guard urls.count == 1, let url = urls.first, url.isFileURL else {
            if let ticket = prepared.ticket { runtime.worker.async { try? prepared.store.discard(ticket: ticket) } }
            fail(pending.call); return
        }
        // The picker may lock protected storage. Only the original frozen target can receive
        // this receipt; reading its plaintext later requires a new live lease for that target.
        let request = PackingFilesRequest(pending.call, self)
        runtime.worker.async {
            let result: Result<Data, PackingFilesFailure>
            do {
                if let ticket = prepared.ticket {
                    defer { try? prepared.store.discard(ticket: ticket) }
                    try PackingBackupProvider.exportFile(to: url, ticket: ticket, store: prepared.store, scope: prepared.scope)
                    result = .success(try JSONSerialization.data(withJSONObject: ["saved": true]))
                } else {
                    let receipt = try PackingBackupProvider.importFile(url, store: prepared.store, scope: prepared.scope)
                    result = .success(try JSONSerialization.data(withJSONObject: ["selected": true, "ticket": receipt.ticket, "target": receipt.target]))
                }
            } catch { result = .failure(.unavailable) }
            Task { @MainActor in request.plugin.finish(request.call, result: result) }
        }
    }
    @MainActor private func finish(_ call: CAPPluginCall, result: Result<Data, PackingFilesFailure>, access: PackingCaptureAuthority.Access? = nil) {
        do {
            if let access { try access.check(); _ = try liveAccess(call) }
            guard let object = try JSONSerialization.jsonObject(with: result.get()) as? [String: Any] else { throw PackingFilesFailure.unavailable }
            if let access { try access.check(); _ = try liveAccess(call) }
            release(); call.resolve(object)
        } catch { fail(call) }
    }
    @objc func readBackup(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.claim(call) else { return }
            let access: PackingCaptureAuthority.Access
            do { access = try self.liveAccess(call) } catch { self.fail(call); return }
            guard let ticket = call.getString("ticket") else { self.fail(call); return }
            let runtime = self.runtime, request = PackingFilesRequest(call, self)
            runtime.worker.async {
                let result: Result<Data, PackingFilesFailure>
                do {
                    var data = try runtime.pendingStore().read(ticket: ticket, access: access)
                    defer { data.resetBytes(in: 0..<data.count) }
                    guard let text = String(data: data, encoding: .utf8) else { throw PackingFilesFailure.unavailable }
                    result = .success(try JSONSerialization.data(withJSONObject: ["text": text]))
                } catch { result = .failure(.unavailable) }
                Task { @MainActor in request.plugin.finish(request.call, result: result, access: access) }
            }
        }
    }
    @objc func discardBackup(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard self.claim(call) else { return }
            guard let ticket = call.getString("ticket") else { self.fail(call); return }
            let runtime = self.runtime, request = PackingFilesRequest(call, self)
            runtime.worker.async {
                let result: Result<Data, PackingFilesFailure>
                do { try runtime.pendingStore().discard(ticket: ticket); result = .success(Data("{}".utf8)) }
                catch { result = .failure(.unavailable) }
                Task { @MainActor in request.plugin.finish(request.call, result: result) }
            }
        }
    }
}
