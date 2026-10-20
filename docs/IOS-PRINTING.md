# iOS packing-sequence printing

The packing sequence's explicit print button now uses the registered
`PackingPrint` bridge on iOS. The existing web preparation waits for deferred
photos and image loading, then checks that the same visible sequence is still
open. The native bridge checks the current document again before opening
[Apple's system print interface](https://developer.apple.com/documentation/uikit/uiprintinteractioncontroller).
It does not select a printer or start a print job automatically.

The current WKWebView supplies its print formatter, preserving the existing
print styles, diagrams and loaded photos. The job title is always **Packing
sequence**; trip and item names are not used as job metadata. The bridge does
not create an exported document or temporary PDF. Printer selection and any
system-managed spooling remain under iOS and the user's control.

iPhone uses the system sheet. iPad uses the documented
[view-anchored popover](https://developer.apple.com/documentation/uikit/uiprintinteractioncontroller/present(from:in:animated:completionhandler:)).
The bridge refuses duplicate requests, inactive scenes and another presented
controller. A failed presentation or printer error returns a generic error to
the existing interface. Canceling the dialog settles the pending request
without claiming a page was printed. Backgrounding or protected-data loss
invalidates the request, releases its formatter and dismisses its print UI;
late callbacks cannot finish a newer request.

## Verification boundary

The JavaScript tests cover native dispatch, unavailable bridges, interruption
errors and navigation/visibility changes during preparation. They do not
execute UIKit. The matching iOS CI run must compile both simulator Debug and
unsigned device Release outputs before claiming native compilation.

Device acceptance must check iPhone and iPad presentation, no-printer/error
states, cancel/retry, repeated taps, rotation and multitasking, background/lock
interruption, photo readiness, multi-page CSS pagination, diagram/photo output,
and the actual printer or system PDF workflow. No physical print, iOS runtime
acceptance or signing is inferred from source tests or compilation. Protected
workspace and encrypted capture parity on iOS remain separate unfinished work.
