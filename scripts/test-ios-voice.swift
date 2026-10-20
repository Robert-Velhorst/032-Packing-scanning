import Foundation

@main enum VoiceResultChecks {
    static func main() {
        let command = "Packing packed"
        func check(_ condition: Bool, _ message: String) {
            precondition(condition, message)
        }
        check(PackingVoiceResult.make(command, final: false, confidences: [1]) == nil, "Partial commands must not cross the bridge")
        let valid = PackingVoiceResult.make(command, final: true, confidences: [0.99, 0.8])!
        check(valid.transcript == command && valid.confidence == 0.8, "Every word must meet the confidence threshold")
        let uncertain = PackingVoiceResult.make(command, final: true, confidences: [1, 0.2])!
        check(uncertain.confidence == 0.2, "A high-confidence word cannot conceal an uncertain command")
        let invalidScores: [[Float]] = [[], [-1, 1], [1, 1.1], [1, .nan], [.infinity, 1]]
        for scores in invalidScores {
            let invalid = PackingVoiceResult.make(command, final: true, confidences: scores)!
            check(invalid.confidence == 0 && invalid.transcript.isEmpty, "Missing or invalid word confidence must fail closed")
        }
        check(PackingVoiceResult.make("", final: true, confidences: [1])!.transcript.isEmpty, "Empty speech must stay empty")
        let long = String(repeating: "a", count: 257)
        check(PackingVoiceResult.make(long, final: true, confidences: [1])!.confidence == 0, "Overlong speech must fail closed")
        let unicode = String(repeating: "😀", count: 129)
        check(PackingVoiceResult.make(unicode, final: true, confidences: [1])!.confidence == 0, "Bounds must count UTF-16 units")
        print("iOS native voice result checks passed (11 cases).")
    }
}
