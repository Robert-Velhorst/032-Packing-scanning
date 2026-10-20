import Foundation

/** Final-result boundary shared by the real Speech bridge and native policy checks. */
struct PackingVoiceResult {
    let transcript: String
    let confidence: Float
    static func make(_ text: String, final: Bool, confidences: [Float]) -> PackingVoiceResult? {
        guard final else { return nil }
        guard !text.isEmpty, text.utf16.count <= 256, !confidences.isEmpty,
              confidences.allSatisfy({ $0.isFinite && (0...1).contains($0) }) else {
            return PackingVoiceResult(transcript: "", confidence: 0)
        }
        return PackingVoiceResult(transcript: text, confidence: confidences.min() ?? 0)
    }
}
