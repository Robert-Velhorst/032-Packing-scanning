import AVFAudio
import Capacitor
import Speech
import UIKit

/** Serializes audio callbacks with cancellation; never appends after endAudio. */
private final class PackingVoiceInput {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    init(_ request: SFSpeechAudioBufferRecognitionRequest) { self.request = request }
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        request?.append(buffer)
    }
    func end() {
        lock.lock(); defer { lock.unlock() }
        request?.endAudio(); request = nil
    }
}

/** Optional foreground-only English commands. Recognition never falls back to a server. */
@objc(PackingVoicePlugin)
public class PackingVoicePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "PackingVoicePlugin"
    public let jsName = "PackingVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "installModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readStep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopReading", returnType: CAPPluginReturnPromise)
    ]
    private var activeID: String?
    private var pending: CAPPluginCall?
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    private var engine: AVAudioEngine?
    private var input: PackingVoiceInput?
    private var watchdog: DispatchWorkItem?
    private var audioActive = false
    private var reading: CAPPluginCall?
    private var readingID: UUID?
    private var synthesizer: AVSpeechSynthesizer?
    private var utterance: AVSpeechUtterance?
    private var readingTimeout: DispatchWorkItem?
    @MainActor private var foreground: Bool {
        UIApplication.shared.isProtectedDataAvailable && PackingForeground.isActive(bridge?.webView?.window)
    }
    private func localRecognizer() -> SFSpeechRecognizer? {
        guard let candidate = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              candidate.supportsOnDeviceRecognition, candidate.isAvailable else { return nil }
        return candidate
    }

    public override func load() {
        for name in [UIApplication.didEnterBackgroundNotification, UIApplication.protectedDataWillBecomeUnavailableNotification,
                     AVAudioSession.mediaServicesWereLostNotification, PackingCaptureBridgeValues.storageChanged] {
            NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: name, object: nil)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(audioInterrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
    }
    deinit {
        NotificationCenter.default.removeObserver(self)
        closeVoice(); closeReader()
    }

    @objc func getAvailability(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status = SFSpeechRecognizer.authorizationStatus()
            let allowed = status != .denied && status != .restricted
            let available = allowed && self.localRecognizer() != nil
            call.resolve(["available": available, "downloadable": false,
                "message": available ? "On-device English voice is available. Enable voice to grant permission and listen."
                    : "Local English recognition is unavailable or permission was denied. Use touch controls or review Speech Recognition in Settings."])
        }
    }

    @objc func listen(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("id"), id.count == 36, UUID(uuidString: id) != nil else {
                call.reject("Invalid voice session."); return
            }
            guard self.foreground, self.localRecognizer() != nil, self.reading == nil else {
                call.reject("On-device listening is unavailable. Return to the packing screen and use touch controls if needed."); return
            }
            self.closeVoice()
            self.activeID = id; self.pending = call
            // Bound a stalled permission callback; cancellation never starts a microphone later.
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, self.activeID == id else { return }
                self.failVoice(id, "Voice permission or listening timed out. Enable voice again if needed.")
            }
            self.watchdog = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: timeout)
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                DispatchQueue.main.async {
                    guard let self, self.activeID == id else { return }
                    guard status == .authorized, self.foreground else {
                        self.failVoice(id, "Speech permission was not granted or the app is inactive. Use touch controls."); return
                    }
                    let permission: (Bool) -> Void = { [weak self] granted in
                        DispatchQueue.main.async {
                            guard let self, self.activeID == id else { return }
                            guard granted, self.foreground else {
                                self.failVoice(id, "Microphone permission was not granted or the app is inactive. Use touch controls."); return
                            }
                            self.startVoice(id)
                        }
                    }
                    if #available(iOS 17.0, *) { AVAudioApplication.requestRecordPermission(completionHandler: permission) }
                    else { AVAudioSession.sharedInstance().requestRecordPermission(permission) }
                }
            }
        }
    }

    @MainActor private func startVoice(_ id: String) {
        guard activeID == id, foreground, let recognizer = localRecognizer() else {
            failVoice(id, "The local English recognizer is unavailable. Use touch controls."); return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement)
            try session.setActive(true)
            audioActive = true
            let engine = AVAudioEngine()
            let format = engine.inputNode.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                failVoice(id, "No microphone input is available. Use touch controls."); return
            }
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = false
            request.taskHint = .confirmation
            let input = PackingVoiceInput(request)
            self.input = input; self.recognizer = recognizer
            engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in input.append(buffer) }
            self.engine = engine
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, self.activeID == id else { return }
                    guard self.foreground else { self.interrupted(); return }
                    if let result, let final = PackingVoiceResult.make(result.bestTranscription.formattedString,
                            final: result.isFinal, confidences: result.bestTranscription.segments.map(\.confidence)) {
                        self.event(id, "result", transcript: final.transcript, confidence: final.confidence)
                        self.event(id, "end")
                        self.closeVoice()
                    } else if error != nil {
                        self.failVoice(id, "On-device voice recognition stopped. Use touch controls or enable voice again.")
                    }
                }
            }
            engine.prepare()
            try engine.start()
            watchdog?.cancel()
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, self.activeID == id else { return }
                self.event(id, "error", message: "Listening timed out. Preparing another command.", recoverable: true)
                self.closeVoice()
            }
            watchdog = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
            let call = pending; pending = nil; call?.resolve()
            event(id, "ready")
        } catch { failVoice(id, "On-device listening could not start. Use touch controls.") }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let id = call.getString("id"), id == self.activeID { self.closeVoice() }
            call.resolve()
        }
    }
    @objc func installModel(_ call: CAPPluginCall) {
        call.reject("This app does not download iOS speech models. Review local English speech support in device Settings, or use touch controls.")
    }

    private func event(_ id: String, _ kind: String, transcript: String? = nil, confidence: Float = 0,
                       message: String? = nil, recoverable: Bool = false) {
        var value: [String: Any] = ["id": id, "kind": kind, "confidence": confidence, "recoverable": recoverable]
        if let transcript { value["transcript"] = transcript }
        if let message { value["message"] = message }
        notifyListeners("voiceEvent", data: value)
    }
    private func failVoice(_ id: String, _ message: String) {
        guard activeID == id else { return }
        event(id, "error", message: message)
        closeVoice()
    }
    private func closeVoice() {
        activeID = nil
        watchdog?.cancel(); watchdog = nil
        let call = pending; pending = nil
        input?.end(); input = nil
        if let engine { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        engine = nil
        task?.cancel(); task = nil; recognizer = nil
        deactivateAudio()
        call?.reject("Voice listening cancelled. Enable voice again if needed.")
    }
    private func deactivateAudio() {
        if audioActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        audioActive = false
    }

    @objc func readStep(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.foreground, let text = call.getString("text"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  text.utf16.count <= 2000,
                  let voice = AVSpeechSynthesisVoice.speechVoices().first(where: {
                      $0.language.lowercased().hasPrefix("en-") && $0.identifier.hasPrefix("com.apple.") && $0.quality == .default
                  }) else { call.reject("No installed standard Apple English reading voice is available. Follow the text on screen."); return }
            self.closeVoice(); self.closeReader()
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .spokenAudio)
                try session.setActive(true)
                self.audioActive = true
                let synthesizer = AVSpeechSynthesizer()
                synthesizer.delegate = self
                let utterance = AVSpeechUtterance(string: text)
                utterance.voice = voice
                let readingID = UUID()
                self.reading = call; self.readingID = readingID; self.synthesizer = synthesizer; self.utterance = utterance
                let timeout = DispatchWorkItem { [weak self] in
                    guard let self, self.readingID == readingID else { return }
                    self.closeReader()
                }
                self.readingTimeout = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 180, execute: timeout)
                synthesizer.speak(utterance)
            } catch { self.closeReader(); call.reject("Reading could not start. Follow the text on screen.") }
        }
    }
    @objc func stopReading(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.closeReader(); call.resolve() }
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            guard self.utterance === utterance else { return }
            let call = self.reading; self.reading = nil
            self.closeReader(); call?.resolve()
        }
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { if self.utterance === utterance { self.closeReader() } }
    }
    private func closeReader() {
        let call = reading; reading = nil; readingID = nil; utterance = nil
        readingTimeout?.cancel(); readingTimeout = nil
        synthesizer?.delegate = nil
        synthesizer?.stopSpeaking(at: .immediate); synthesizer = nil
        if activeID == nil { deactivateAudio() }
        call?.reject("Reading stopped. Follow the text on screen.")
    }
    @objc private func audioInterrupted(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        interrupted()
    }
    @objc private func interrupted() {
        DispatchQueue.main.async {
            if let id = self.activeID { self.event(id, "error", message: "Audio stopped while the app was interrupted. Explicitly enable voice to continue.") }
            self.closeVoice(); self.closeReader()
        }
    }
}
