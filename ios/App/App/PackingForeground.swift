import UIKit

/** Honor the owning scene when present; support the app-delegate lifecycle without assuming one. */
@MainActor enum PackingForeground {
    static func isActive(_ window: UIWindow?) -> Bool {
        guard let window, !window.isHidden, window.alpha > 0 else { return false }
        if let scene = window.windowScene { return scene.activationState == .foregroundActive }
        return UIApplication.shared.applicationState == .active
    }
}
