import Capacitor
import UIKit
import WebKit

/** Explicit system printing of the open sequence; no document files or private job titles. */
@objc(PackingPrintPlugin)
public class PackingPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PackingPrintPlugin"
    public let jsName = "PackingPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printSequence", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private var requestID: UUID?
    private var controller: UIPrintInteractionController?

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted),
            name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted),
            name: PackingCaptureBridgeValues.storageChanged, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc func printSequence(_ call: CAPPluginCall) {
        // Capacitor 8.6 invokes plugin selectors on its serial background bridge queue.
        // Borrow its non-Sendable call only during this bounded main-queue handoff;
        // WebKit evaluation and system-print completion remain asynchronous.
        dispatchPrecondition(condition: .notOnQueue(.main))
        DispatchQueue.main.sync { [weak self] in
            guard let self else { call.reject("Printing is unavailable."); return }
            guard self.pending == nil else {
                call.reject("Finish or cancel the current print request before starting another."); return
            }
            guard UIPrintInteractionController.isPrintingAvailable,
                  let webView = self.bridge?.webView, self.isForeground(webView),
                  self.bridge?.viewController?.presentedViewController == nil else {
                call.reject("Return to the packing sequence before printing. The sequence remains available offline."); return
            }
            let id = UUID()
            self.pending = call
            self.requestID = id
            // Check the real document again after the asynchronous bridge handoff. Do not return its content.
            webView.evaluateJavaScript("Boolean(!document.hidden && document.querySelector('.packing-sequence-page'))") { [weak self, weak webView] value, error in
                guard let self, self.requestID == id else { return }
                guard error == nil, value as? Bool == true, let webView, self.isForeground(webView),
                      self.bridge?.viewController?.presentedViewController == nil else {
                    self.finish(id, error: "Open the packing sequence before printing."); return
                }
                let controller = UIPrintInteractionController.shared
                let info = UIPrintInfo(dictionary: nil)
                info.jobName = "Packing sequence"
                info.outputType = .general
                controller.printInfo = info
                controller.printFormatter = webView.viewPrintFormatter()
                self.controller = controller
                let completion: UIPrintInteractionController.CompletionHandler = { [weak self] _, _, error in
                    self?.finish(id, error: error == nil ? nil : "Printing could not finish. The sequence remains available offline.")
                }
                let shown: Bool
                if webView.traitCollection.userInterfaceIdiom == .pad {
                    let anchor = CGRect(x: webView.bounds.midX, y: webView.bounds.minY, width: 1, height: 1)
                    shown = controller.present(from: anchor, in: webView, animated: true, completionHandler: completion)
                } else {
                    shown = controller.present(animated: true, completionHandler: completion)
                }
                if !shown { self.finish(id, error: "The print dialog could not open. The sequence remains available offline.") }
            }
        }
    }

    @MainActor private func isForeground(_ webView: WKWebView) -> Bool {
        UIApplication.shared.isProtectedDataAvailable && PackingForeground.isActive(webView.window)
    }

    private func finish(_ id: UUID, error: String?) {
        guard requestID == id else { return }
        let call = pending
        pending = nil
        requestID = nil
        controller?.printFormatter = nil
        controller?.printInfo = nil
        controller = nil
        if let error { call?.reject(error) } else { call?.resolve() }
    }

    @objc private func interrupted() {
        guard let id = requestID else { return }
        let activeController = controller
        // Invalidate before dismissing: a late completion must not resolve an interrupted or newer request.
        finish(id, error: "Printing was interrupted. Return to the packing sequence and try again.")
        activeController?.dismiss(animated: false)
    }
}
