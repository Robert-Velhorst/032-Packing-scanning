import Foundation

@main enum DepthFlowChecks {
    static func main() {
        var flow = PackingDepthFlow()
        precondition(flow.save() == nil && !flow.review() && !flow.restart())
        let permission = flow.requestPermission()!
        precondition(flow.requestPermission() == nil && !flow.beginAuthorized())
        precondition(!flow.permissionReply(UUID(), granted: true) && flow.phase == .permission)
        precondition(!flow.permissionReply(permission, granted: false) && flow.phase == .ready)
        let next = flow.requestPermission()!
        precondition(next != permission && !flow.permissionReply(permission, granted: true))
        precondition(flow.permissionReply(next, granted: true) && flow.phase == .capturing)
        precondition(flow.save() == nil && flow.review() && !flow.review())
        let saving = flow.save()!
        precondition(flow.save() == nil && !flow.restart() && flow.acceptsSave(saving))
        precondition(!flow.acceptsSave(UUID()))
        precondition(flow.end() && !flow.end() && !flow.acceptsSave(saving))
        precondition(!flow.permissionReply(next, granted: true) && !flow.beginAuthorized())
        var cancelled = PackingDepthFlow()
        let late = cancelled.requestPermission()!
        precondition(cancelled.end() && !cancelled.permissionReply(late, granted: true))
        var restarted = PackingDepthFlow()
        precondition(restarted.beginAuthorized() && restarted.restart() && restarted.phase == .ready)
        precondition(restarted.beginAuthorized() && restarted.review() && restarted.restart())
        precondition(restarted.beginAuthorized() && restarted.review())
        let final = restarted.save()!
        precondition(restarted.acceptsSave(final) && restarted.end() && !restarted.acceptsSave(final))
        print("iOS depth flow checks passed: deliberate start/review/save, denied and stale permissions, restart, single completion and late-save rejection.")
    }
}
