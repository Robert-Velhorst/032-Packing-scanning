import XCTest
import CoreGraphics
import ImageIO

final class PackingPhotoUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func retainFailure(_ app: XCUIApplication) {
        if let testRun, testRun.hasSucceeded { return }
        let screen = XCTAttachment(screenshot: app.screenshot()); screen.name = "Failure screen"; screen.lifetime = .keepAlways; add(screen)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = "Failure accessibility tree"; tree.lifetime = .keepAlways; add(tree)
    }

    @MainActor private func tapWeb(_ name: String, app: XCUIApplication) {
        let query = app.webViews.buttons.matching(identifier: name)
        XCTAssertTrue(query.firstMatch.waitForExistence(timeout: 30), "Missing web button: \(name)")
        let done = app.toolbars.buttons["Done"].firstMatch
        if app.keyboards.count > 0, done.exists, done.isHittable { done.tap() }
        for _ in 0..<8 {
            // WebKit can throw while computing hittability for a zoomed/offscreen
            // element. Check its screen bounds before asking accessibility to hit-test.
            let visible = app.frame.insetBy(dx: 2, dy: 2)
            if let button = query.allElementsBoundByIndex.first(where: {
                let frame = $0.frame
                return !frame.isEmpty && visible.contains(CGPoint(x: frame.midX, y: frame.midY)) && $0.isHittable
            }) {
                XCTAssertTrue(button.isEnabled, "Disabled web button: \(name)"); button.tap(); return
            }
            if query.firstMatch.frame.midY > app.webViews.firstMatch.frame.midY { app.webViews.firstMatch.swipeUp() }
            else { app.webViews.firstMatch.swipeDown() }
        }
        XCTFail("Web button is not reachable: \(name)")
    }
    @MainActor private func launchGuest(_ app: XCUIApplication) {
        app.launch()
        let guest = app.webViews.buttons["Use guest packs"]
        if guest.waitForExistence(timeout: 10) { guest.tap() }
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
    }
    @MainActor private func openItems(_ app: XCUIApplication) {
        let mobile = app.webViews.buttons["Items"]
        if mobile.exists && mobile.isHittable { mobile.tap() }
        else {
            let desktop = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "My items")).firstMatch
            XCTAssertTrue(desktop.waitForExistence(timeout: 30)); desktop.tap()
        }
        XCTAssertTrue(app.webViews.buttons["Add item"].waitForExistence(timeout: 30))
    }
    @MainActor private func prepareDraft(_ name: String, app: XCUIApplication) {
        openItems(app); tapWeb("Add item", app: app)
        let field = app.webViews.textFields["Item name"]
        XCTAssertTrue(field.waitForExistence(timeout: 30)); field.tap(); field.typeText(name)
    }
    @MainActor private func cancelSystemPicker(_ app: XCUIApplication) {
        let cancel = app.navigationBars.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 30), "System picker did not open"); cancel.tap()
    }
    @MainActor private func resumeDraft(_ name: String, app: XCUIApplication) {
        tapWeb("Resume item photo draft", app: app)
        let field = app.webViews.textFields["Item name"]
        XCTAssertTrue(field.waitForExistence(timeout: 30)); XCTAssertEqual(field.value as? String, name)
    }
    @MainActor private func assertRedReference(_ app: XCUIApplication) {
        let element = app.webViews.images["Item reference"]
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Prepared/saved image was not loaded")
        app.webViews.firstMatch.swipeDown()
        let screenshot = element.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot); attachment.name = "Rendered synthetic reference photo"; attachment.lifetime = .keepAlways; add(attachment)
        guard let source = CGImageSourceCreateWithData(screenshot.pngRepresentation as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { XCTFail("Reference screenshot could not be decoded"); return }
        var pixels = [UInt8](repeating: 0, count: 32 * 32 * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: 32, height: 32, bitsPerComponent: 8, bytesPerRow: 32 * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: 32, height: 32)); return true
        }
        XCTAssertTrue(drawn)
        let red = stride(from: 0, to: pixels.count, by: 4).filter { pixels[$0] > 150 && pixels[$0 + 1] < 100 && pixels[$0 + 2] < 100 }.count
        XCTAssertGreaterThan(red, 32 * 32 / 2, "The actual WebView image is not the seeded red JPEG")
    }
    @MainActor func testLibraryCancellationPreservesUnsavedDraft() {
        let app = XCUIApplication(bundleIdentifier: "com.packingscanning.app"), name = "Cancelled photo QA " + String(UUID().uuidString.prefix(8))
        defer { retainFailure(app) }
        launchGuest(app); prepareDraft(String(name), app: app)
        tapWeb("Choose reference photo", app: app); cancelSystemPicker(app)
        resumeDraft(String(name), app: app)
        XCTAssertFalse(app.webViews.images["Item reference"].exists)
        tapWeb("Close", app: app)
        XCTAssertFalse(app.webViews.staticTexts[String(name)].exists, "Cancelled draft was saved as an item")
        XCTAssertFalse(app.webViews.buttons["Resume item photo draft"].exists)
        app.terminate()
    }
    @MainActor func testSelectedPhotoSavesAndReloadsThroughRealBridge() {
        let app = XCUIApplication(bundleIdentifier: "com.packingscanning.app"), name = "Saved photo QA " + String(UUID().uuidString.prefix(8))
        defer { retainFailure(app) }
        launchGuest(app); prepareDraft(String(name), app: app); tapWeb("Choose reference photo", app: app)
        // iOS 26 exposes PHPicker thumbnails as images, not collection cells.
        // The fresh simulator also includes six old sample images. Match today's
        // imported fixture explicitly and still verify its red pixels after save.
        let date = DateFormatter(); date.locale = Locale(identifier: "en_US"); date.dateFormat = "MMMM dd"
        let fixture = app.images.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@",
            "PXGGridLayout-Info", "Photo, " + date.string(from: Date()) + ",")).firstMatch
        XCTAssertTrue(fixture.waitForExistence(timeout: 30), "Today's seeded simulator photo is missing"); fixture.tap()
        let add = app.navigationBars.buttons["Add"].firstMatch
        if add.waitForExistence(timeout: 2), add.isHittable { add.tap() }
        resumeDraft(String(name), app: app); assertRedReference(app)
        for (label, value) in [("Length", "100"), ("Width", "80"), ("Height", "40")] {
            let field = app.webViews.textFields.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
            XCTAssertTrue(field.exists); field.tap(); field.typeText(value)
        }
        tapWeb("Save item", app: app)
        XCTAssertTrue(app.webViews.staticTexts[String(name)].waitForExistence(timeout: 30))
        app.terminate(); launchGuest(app); openItems(app)
        tapWeb("Edit " + String(name), app: app); assertRedReference(app)
        tapWeb("Close", app: app); app.terminate()
    }
    @MainActor func testCameraCancellationOrUnavailabilityPreservesUnsavedDraft() {
        let app = XCUIApplication(bundleIdentifier: "com.packingscanning.app"), name = "Camera photo QA " + String(UUID().uuidString.prefix(8))
        defer { retainFailure(app) }
        launchGuest(app); prepareDraft(String(name), app: app); tapWeb("Take reference photo", app: app)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let denied = NSPredicate(format: "label == %@ OR label == %@", "Don't Allow", "Don’t Allow")
        let appDeny = app.alerts.buttons.matching(denied).firstMatch
        let systemDeny = springboard.alerts.buttons.matching(denied).firstMatch
        // Permission alerts may belong to the app or SpringBoard. A simulator
        // without a camera may instead immediately return the recovery receipt.
        for _ in 0..<30 {
            if app.webViews.buttons["Resume item photo draft"].exists { break }
            if appDeny.exists { appDeny.tap(); break }
            if systemDeny.exists { systemDeny.tap(); break }
            let cancel = app.buttons["packing.camera.cancel"]
            if cancel.exists, cancel.isHittable { cancel.tap(); break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        resumeDraft(String(name), app: app)
        XCTAssertFalse(app.webViews.images["Item reference"].exists)
        tapWeb("Close", app: app); XCTAssertFalse(app.webViews.staticTexts[String(name)].exists)
        app.terminate()
    }
    @MainActor func testBackupDestinationCancellationDoesNotReportSaved() {
        let app = XCUIApplication(bundleIdentifier: "com.packingscanning.app")
        defer { retainFailure(app) }
        launchGuest(app); tapWeb("Settings", app: app); tapWeb("Save backup file", app: app)
        cancelSystemPicker(app)
        let cancelled = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Backup saving cancelled.")).firstMatch
        XCTAssertTrue(cancelled.waitForExistence(timeout: 30)); app.terminate()
    }
}
