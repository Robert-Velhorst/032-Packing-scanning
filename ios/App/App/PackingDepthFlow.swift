import Foundation

/** Main-thread controller policy. Tokens reject stale permission and publication callbacks. */
struct PackingDepthFlow {
    enum Phase { case ready, permission, capturing, reviewing, saving, ended }
    private(set) var phase: Phase = .ready
    private(set) var generation = UUID()

    mutating func requestPermission() -> UUID? {
        guard phase == .ready else { return nil }
        generation = UUID(); phase = .permission; return generation
    }
    mutating func permissionReply(_ token: UUID, granted: Bool) -> Bool {
        guard phase == .permission, generation == token else { return false }
        phase = granted ? .capturing : .ready; return granted
    }
    mutating func beginAuthorized() -> Bool {
        guard phase == .ready else { return false }
        generation = UUID(); phase = .capturing; return true
    }
    mutating func review() -> Bool {
        guard phase == .capturing else { return false }
        phase = .reviewing; return true
    }
    mutating func restart() -> Bool {
        guard phase == .capturing || phase == .reviewing else { return false }
        generation = UUID(); phase = .ready; return true
    }
    mutating func save() -> UUID? {
        guard phase == .reviewing else { return nil }
        generation = UUID(); phase = .saving; return generation
    }
    func acceptsSave(_ token: UUID) -> Bool { phase == .saving && generation == token }
    @discardableResult mutating func end() -> Bool {
        guard phase != .ended else { return false }
        generation = UUID(); phase = .ended; return true
    }
}
