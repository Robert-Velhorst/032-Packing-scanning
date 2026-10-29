import Capacitor
import UIKit
import WebKit
#if canImport(PackingSDKCallbacks)
import PackingSDKCallbacks
#endif

/** Explicit system printing of the open sequence; no document files or private job titles. */
@objc(PackingPrintPlugin)
public class PackingPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PackingPrintPlugin"
    public let jsName = "PackingPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printSequence", returnType: CAPPluginReturnPromise)
    ]
    private let callbackOwner: String
    private let ui: PackingPrintUIState

    public override init() {
        let owner = UUID().uuidString
        callbackOwner = owner
        ui = PackingPrintUIState(owner: owner)
        super.init()
    }

    public override func load() {
        // Observe the UI owner itself; no SDK plugin/call enters actor state.
        // Delivery must honor the UI actor. Synthetic notification controls
        // accompany this port; real OS/scene/print acceptance remains required.
        for name in [UIApplication.didEnterBackgroundNotification,
                     UIApplication.protectedDataWillBecomeUnavailableNotification,
                     PackingCaptureBridgeValues.storageChanged] {
            NotificationCenter.default.addObserver(ui, selector: #selector(PackingPrintUIState.interrupted),
                name: name, object: nil)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(ui)
        PackingCallbacksCancelOwner(callbackOwner, "Printing is unavailable.", nil)
        let state = ui
        Task { @MainActor in state.interrupted() }
    }

    @objc func printSequence(_ call: CAPPluginCall) {
        guard let bridge = bridge as? CapacitorBridge else {
            call.reject("Printing is unavailable."); return
        }
        let sdkQueue = bridge.dispatchQueue
        dispatchPrecondition(condition: .onQueue(sdkQueue))
        guard let reply = PackingCallbackToken(call: call, sdkQueue: sdkQueue, owner: callbackOwner) else {
            call.reject("Finish or cancel the current print request before starting another."); return
        }
        let state = ui
        let webView = bridge.webView
        let presenter = bridge.viewController
        Task { @MainActor in state.start(reply, webView: webView, presenter: presenter) }
    }
}

/** UI lifetime is actor-owned; the stored promise is an immutable string token. */
@MainActor
final class PackingPrintUIState: NSObject {
    private let owner: String
    private var pending: PackingCallbackToken?
    private var requestID: UUID?
    private var controller: UIPrintInteractionController?

    nonisolated init(owner: String) {
        self.owner = owner
        super.init()
    }

    func start(_ reply: PackingCallbackToken, webView: WKWebView?, presenter: UIViewController?) {
        // Deinitialization or interruption can cancel the SDK promise before
        // its queued UI handoff runs. Never open a dialog for that stale token.
        guard reply.isPending else { return }
        guard pending == nil else {
            reply.reject("Finish or cancel the current print request before starting another."); return
        }
        guard UIPrintInteractionController.isPrintingAvailable,
              let webView, isForeground(webView), presenter?.presentedViewController == nil else {
            reply.reject("Return to the packing sequence before printing. The sequence remains available offline."); return
        }
        let id = UUID()
        pending = reply
        requestID = id
        webView.evaluateJavaScript("Boolean(!document.hidden && document.querySelector('.packing-sequence-page'))") { [weak self, weak webView, weak presenter] value, error in
            let valid = error == nil && value as? Bool == true
            Task { @MainActor in
                self?.checkedDocument(id, valid: valid, webView: webView, presenter: presenter)
            }
        }
    }

    private func checkedDocument(_ id: UUID, valid: Bool, webView: WKWebView?, presenter: UIViewController?) {
        guard requestID == id else { return }
        guard valid, pending?.isPending == true, let webView, isForeground(webView),
              presenter?.presentedViewController == nil else {
            finish(id, error: "Open the packing sequence before printing."); return
        }
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = "Packing sequence"
        info.outputType = .general
        controller.printInfo = info
        controller.printFormatter = webView.viewPrintFormatter()
        self.controller = controller
        let completion: UIPrintInteractionController.CompletionHandler = { [weak self] _, _, error in
            let message = error == nil ? nil : "Printing could not finish. The sequence remains available offline."
            Task { @MainActor in self?.finish(id, error: message) }
        }
        let shown: Bool
        if webView.traitCollection.userInterfaceIdiom == .pad {
            let anchor = CGRect(x: webView.bounds.midX, y: webView.bounds.minY, width: 1, height: 1)
            shown = controller.present(from: anchor, in: webView, animated: true, completionHandler: completion)
        } else {
            shown = controller.present(animated: true, completionHandler: completion)
        }
        if !shown { finish(id, error: "The print dialog could not open. The sequence remains available offline.") }
    }

    private func isForeground(_ webView: WKWebView) -> Bool {
        UIApplication.shared.isProtectedDataAvailable && PackingForeground.isActive(webView.window)
    }

    private func finish(_ id: UUID, error: String?) {
        guard requestID == id else { return }
        let reply = pending
        pending = nil
        requestID = nil
        controller?.printFormatter = nil
        controller?.printInfo = nil
        controller = nil
        if let error { reply?.reject(error) } else { reply?.resolve() }
    }

    @objc func interrupted() {
        // Cancel even a request whose UI handoff has not run yet. The SDK queue
        // registry also lets this override a terminal reply queued for delivery.
        PackingCallbacksCancelOwner(owner,
            "Printing was interrupted. Return to the packing sequence and try again.", nil)
        guard let id = requestID else { return }
        let activeController = controller
        // Invalidate before dismissing: late completion cannot finish a newer request.
        finish(id, error: "Printing was interrupted. Return to the packing sequence and try again.")
        activeController?.dismiss(animated: false)
    }
}
