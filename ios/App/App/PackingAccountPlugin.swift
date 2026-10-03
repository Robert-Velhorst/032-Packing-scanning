import Capacitor
import Foundation
import Security
import UIKit

private enum AccountBridgeFailure: Error { case unavailable, invalid, unconfirmed }
private func accountMatches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: "^(?:" + pattern + ")$", options: .regularExpression) != nil
}
private let accountUUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
private let accountMaximumRequest = 16 * 1024 * 1024 + 65536
private let accountMaximumResponse = 32 * 1024 * 1024
private func accountOrigin(_ value: String) -> String? {
    guard let url = URLComponents(string: value), url.scheme == "https", let host = url.host,
          !host.isEmpty, url.user == nil, url.password == nil, url.path.isEmpty,
          url.query == nil, url.fragment == nil, (url.port == nil || (1...65535).contains(url.port!)),
          url.url?.absoluteString == value else { return nil }
    return value
}
private func accountAllowed(_ path: String, _ method: String) -> Bool {
    let methods: [String: [String]] = ["/session": ["GET", "DELETE"], "/sessions": ["POST", "DELETE"],
        "/registrations": ["POST"], "/recovery": ["POST"], "/password": ["POST"], "/vault": ["GET", "PUT"],
        "/vault/backup": ["GET"], "/export": ["GET"], "": ["DELETE"], "/households": ["GET", "POST"], "/households/memberships": ["POST"]]
    if let allowed = methods[path] { return allowed.contains(method) }
    if accountMatches(path, "/households/" + accountUUID) { return ["GET", "DELETE"].contains(method) }
    if accountMatches(path, "/households/" + accountUUID + "/(ownership|invitations)") { return method == "POST" }
    if accountMatches(path, "/households/" + accountUUID + "/(members|invitations)/" + accountUUID) { return method == "DELETE" }
    if accountMatches(path, "/households/" + accountUUID + "/packs") { return ["GET", "POST"].contains(method) }
    if accountMatches(path, "/households/" + accountUUID + "/packs/" + accountUUID) { return ["GET", "PUT", "DELETE"].contains(method) }
    return false
}

private struct AccountSavedSession: Codable { let origin: String; let token: String; let expiresAt: Double }
private final class AccountKeychain {
    private let origin: String
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.packingscanning.app.account-session-v1", kSecAttrAccount as String: "session",
        kSecAttrSynchronizable as String: false] }
    init(origin: String) { self.origin = origin }
    private func prepareInstall() throws {
        // Keychain entries can outlive uninstall. A fresh app container must not inherit a sign-in.
        if !UserDefaults.standard.bool(forKey: "packing.account.install.v1") {
            try clear(); UserDefaults.standard.set(true, forKey: "packing.account.install.v1")
        }
    }
    func read() throws -> AccountSavedSession? {
        try prepareInstall()
        var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count <= 2048 else { throw AccountBridgeFailure.unconfirmed }
        let saved = try JSONDecoder().decode(AccountSavedSession.self, from: data)
        guard saved.origin == origin, accountMatches(saved.token, "[A-Za-z0-9_-]{43}"), saved.expiresAt.isFinite else { throw AccountBridgeFailure.unconfirmed }
        if saved.expiresAt <= Date().timeIntervalSince1970 { try clear(); return nil }
        return saved
    }
    func write(_ saved: AccountSavedSession) throws {
        try prepareInstall()
        let data = try JSONEncoder().encode(saved)
        let updates: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, updates as CFDictionary)
        if status == errSecItemNotFound {
            let add = query.merging(updates) { _, replacement in replacement }
            guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw AccountBridgeFailure.unconfirmed }
        } else if status != errSecSuccess { throw AccountBridgeFailure.unconfirmed }
    }
    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AccountBridgeFailure.unconfirmed }
    }
}

/** Bounded streaming reply; TLS uses OS trust/hostname checks and redirects are refused. */
private final class AccountReply: NSObject, URLSessionDataDelegate {
    let done = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var response: HTTPURLResponse?
    private var bytes = Data()
    private var failed = false
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard let http = response as? HTTPURLResponse, (200...599).contains(http.statusCode), !(300...399).contains(http.statusCode),
              http.expectedContentLength <= Int64(accountMaximumResponse),
              http.statusCode == 204 || http.mimeType?.lowercased() == "application/json" else {
            failed = true; completionHandler(.cancel); return
        }
        self.response = http; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); defer { lock.unlock() }
        if bytes.count + data.count > accountMaximumResponse { failed = true; dataTask.cancel() }
        else { bytes.append(data) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); failed = failed || error != nil; lock.unlock(); done.signal()
    }
    func result() throws -> (HTTPURLResponse, Data) {
        lock.lock(); defer { lock.unlock() }
        guard !failed, let response else { throw AccountBridgeFailure.unconfirmed }; return (response, bytes)
    }
}

@objc(PackingAccountPlugin)
public class PackingAccountPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "PackingAccountPlugin"
    public let jsName = "PackingAccount"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forgetSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise)]
    private let worker = DispatchQueue(label: "com.packingscanning.account")
    private let pendingLock = NSLock()
    private var pending = 0
    private var exportCall: CAPPluginCall?
    private var exportURL: URL?
    private var origin: String? { accountOrigin(getConfig().getString("serviceOrigin") ?? "") }
    @objc func getAvailability(_ call: CAPPluginCall) {
        if let origin { call.resolve(["configured": true, "serviceOrigin": origin]) } else { call.resolve(["configured": false]) }
    }
    private func enqueue(_ call: CAPPluginCall, action: @escaping () throws -> [String: Any]) {
        pendingLock.lock()
        guard pending < 8 else { pendingLock.unlock(); call.reject("Wait for the current account request.", "account_busy"); return }
        pending += 1; pendingLock.unlock()
        worker.async {
            defer { self.pendingLock.lock(); self.pending -= 1; self.pendingLock.unlock() }
            do { call.resolve(try action()) }
            catch { call.reject("The account request was not confirmed. Check your connection or forget this device sign-in if its saved session cannot be opened.", "account_unconfirmed") }
        }
    }
    @objc func forgetSession(_ call: CAPPluginCall) {
        guard let origin else { call.reject("Accounts are not configured.", "account_unavailable"); return }
        enqueue(call) { try AccountKeychain(origin: origin).clear(); return [:] }
    }
    @objc func request(_ call: CAPPluginCall) {
        guard let origin else { call.reject("Accounts are not configured.", "account_unavailable"); return }
        let path = call.getString("path") ?? "?", method = call.getString("method") ?? "GET"
        let body = call.getString("bodyJson"), csrf = call.getString("csrf")
        enqueue(call) {
            guard accountAllowed(path, method), !(method == "GET" && body != nil), csrf == nil || accountMatches(csrf!, "[a-f0-9]{64}"),
                  let url = URL(string: origin + "/api/v1/account" + path) else { throw AccountBridgeFailure.invalid }
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 20)
            request.httpMethod = method; request.httpShouldHandleCookies = false
            request.setValue(origin, forHTTPHeaderField: "Origin"); request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
            if let csrf { request.setValue(csrf, forHTTPHeaderField: "X-Packing-CSRF") }
            if let body {
                let bytes = Data(body.utf8)
                let large = path == "/vault" || accountMatches(path, "/households/" + accountUUID + "/packs(?:/" + accountUUID + ")?")
                guard bytes.count <= (large ? accountMaximumRequest : 16384), try JSONSerialization.jsonObject(with: bytes) is [String: Any] else { throw AccountBridgeFailure.invalid }
                request.httpBody = bytes; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            let credentials = AccountKeychain(origin: origin)
            if let saved = try credentials.read() { request.setValue("__Host-packing_session=" + saved.token, forHTTPHeaderField: "Cookie") }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false; configuration.urlCache = nil; configuration.urlCredentialStorage = nil
            configuration.timeoutIntervalForRequest = 20; configuration.timeoutIntervalForResource = 30
            let reply = AccountReply(), session = URLSession(configuration: configuration, delegate: reply, delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            let task = session.dataTask(with: request); task.resume()
            guard reply.done.wait(timeout: .now() + 35) == .success else { task.cancel(); throw AccountBridgeFailure.unconfirmed }
            let (response, bytes) = try reply.result()
            var envelope: [String: Any] = [:], text = ""
            if response.statusCode != 204 {
                guard let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], let json = String(data: bytes, encoding: .utf8),
                      (response.statusCode < 300 ? value.keys.contains("data") : value["error"] is [String: Any]) else { throw AccountBridgeFailure.invalid }
                envelope = value; text = json
            }
            let anonymous = path == "/session" && method == "GET" && response.statusCode == 200 && (envelope["data"] as? [String: Any])?["profile"] is NSNull
            if response.statusCode == 401 || anonymous { try credentials.clear() }
            if let cookie = response.value(forHTTPHeaderField: "Set-Cookie"), cookie.hasPrefix("__Host-packing_session=") {
                let parts = cookie.components(separatedBy: ";")
                let token = String(parts[0].dropFirst("__Host-packing_session=".count))
                var attributes: [String: String] = [:]
                for part in parts.dropFirst() {
                    let pair = part.trimmingCharacters(in: .whitespaces).split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                    let key = String(pair[0]).lowercased()
                    guard ["path", "secure", "httponly", "samesite", "max-age"].contains(key), attributes[key] == nil else { throw AccountBridgeFailure.invalid }
                    attributes[key] = pair.count == 2 ? String(pair[1]) : ""
                }
                guard attributes["path"] == "/", attributes["secure"] == "", attributes["httponly"] == "", attributes["samesite"] == "Strict", let age = Int(attributes["max-age"] ?? "") else { throw AccountBridgeFailure.invalid }
                if age == 0 && token.isEmpty { try credentials.clear() }
                else {
                    guard (1...43200).contains(age), accountMatches(token, "[A-Za-z0-9_-]{43}") else { throw AccountBridgeFailure.invalid }
                    if response.statusCode < 300 { try credentials.write(AccountSavedSession(origin: origin, token: token, expiresAt: Date().timeIntervalSince1970 + Double(age))) }
                }
            }
            return ["status": response.statusCode, "bodyJson": text]
        }
    }
    @objc func exportFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), accountMatches(name, "packing-(account-(backup|export)\\.json|account-recovery\\.txt|household-invitation\\.txt|household-pack\\.json)"),
              let text = call.getString("text"), text.utf8.count <= accountMaximumResponse else { call.reject("Choose a supported account export.", "invalid_export"); return }
        DispatchQueue.main.async {
            guard self.exportCall == nil, let presenter = self.bridge?.viewController, presenter.presentedViewController == nil else { call.reject("Finish the current file save first.", "export_busy"); return }
            self.exportCall = call
            self.worker.async {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("packing-account-" + UUID().uuidString, isDirectory: true)
                let url = folder.appendingPathComponent(name)
                do {
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
                    try Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtection])
                    DispatchQueue.main.async {
                        self.exportURL = url
                        guard presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else { self.finishExport(saved: false); return }
                        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true); picker.delegate = self
                        presenter.present(picker, animated: true)
                    }
                } catch {
                    try? FileManager.default.removeItem(at: url); try? FileManager.default.removeItem(at: folder)
                    DispatchQueue.main.async { self.exportCall = nil; call.reject("The system file-save dialog could not open.", "export_failed") }
                }
            }
        }
    }
    private func finishExport(saved: Bool) {
        if let url = exportURL { try? FileManager.default.removeItem(at: url); try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        exportURL = nil; let call = exportCall; exportCall = nil; call?.resolve(["saved": saved])
    }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finishExport(saved: !urls.isEmpty) }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishExport(saved: false) }
}
