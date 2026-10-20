import CoreGraphics
import Darwin
import Foundation
import ImageIO
import UniformTypeIdentifiers

private final class PhotoClock: @unchecked Sendable {
    private let lock = NSLock(); private var value: TimeInterval = 100
    var now: TimeInterval { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ time: TimeInterval) { lock.lock(); defer { lock.unlock() }; value = time }
}
private final class PhotoReplies: @unchecked Sendable {
    private let lock = NSLock(); private var values: [PackingPendingItemPhotoStore.Receipt] = []
    func add(_ value: PackingPendingItemPhotoStore.Receipt) { lock.lock(); defer { lock.unlock() }; values.append(value) }
    var snapshot: [PackingPendingItemPhotoStore.Receipt] { lock.lock(); defer { lock.unlock() }; return values }
}
@main enum ItemPhotoChecks {
    static func check(_ value: Bool, line: UInt = #line) { if !value { fatalError("Item photo assertion failed at line \(line)") } }
    static func refuses(_ action: () throws -> Void) { do { try action(); fatalError("Unsafe photo handoff accepted") } catch {} }
    static func image(width: Int, height: Int, red: CGFloat = 1) -> CGImage {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(red: red, green: 0, blue: 1 - red, alpha: 1); context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        return context.makeImage()!
    }
    static func encode(_ image: CGImage, type: UTType = .png, properties: [CFString: Any] = [:]) -> Data {
        let bytes = NSMutableData(), destination = CGImageDestinationCreateWithData(bytes, type.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, properties as CFDictionary); check(CGImageDestinationFinalize(destination)); return bytes as Data
    }
    static func properties(_ bytes: Data) -> [CFString: Any] {
        let source = CGImageSourceCreateWithData(bytes as CFData, nil)!
        return CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as! [CFString: Any]
    }
    static func main() throws {
        func phase(_ name: String) { FileHandle.standardOutput.write(Data(("Reference photo fixture: " + name + "\n").utf8)) }
        let fm = FileManager.default, parent = fm.temporaryDirectory.resolvingSymlinksInPath()
        let fixture = parent.appendingPathComponent("packing-ios-item-photos-" + UUID().uuidString, isDirectory: true)
        check(fixture.deletingLastPathComponent().path == parent.path)
        try fm.createDirectory(at: fixture, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: fixture) }
        let comment = "PRIVATE-GPS-and-camera-owner-never-copy"
        let input = encode(image(width: 4096, height: 1024), type: .jpeg, properties: [
            kCGImagePropertyOrientation: 6,
            kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 42.5, kCGImagePropertyGPSLatitudeRef: "N", kCGImagePropertyGPSLongitude: 51.25, kCGImagePropertyGPSLongitudeRef: "E"],
            kCGImagePropertyExifDictionary: [kCGImagePropertyExifUserComment: comment],
            kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFSoftware: comment],
        ])
        check(properties(input)[kCGImagePropertyGPSDictionary] != nil)
        phase("oriented JPEG with GPS/EXIF")
        let photo = try PackingReferencePhoto.prepare(input), output = properties(photo.bytes)
        check(output[kCGImagePropertyPixelWidth] as? Int == 512 && output[kCGImagePropertyPixelHeight] as? Int == 2048)
        check((output[kCGImagePropertyOrientation] as? Int ?? 1) == 1 && output[kCGImagePropertyGPSDictionary] == nil)
        check(photo.bytes.prefix(3) == Data([0xff, 0xd8, 0xff]) && photo.bytes.range(of: Data(comment.utf8)) == nil)
        if let exif = output[kCGImagePropertyExifDictionary] as? [CFString: Any] { check(exif[kCGImagePropertyExifUserComment] == nil) }
        phase("small PNG")
        let small = encode(image(width: 32, height: 16)), smallPhoto = try PackingReferencePhoto.prepare(small)
        check(properties(smallPhoto.bytes)[kCGImagePropertyPixelWidth] as? Int == 32)
        let provider = fixture.appendingPathComponent("provider", isDirectory: true)
        try fm.createDirectory(at: provider, withIntermediateDirectories: false)
        let sourceFile = provider.appendingPathComponent("selected.png"); try small.write(to: sourceFile)
        try check(PackingReferencePhoto.readProviderFile(sourceFile) == small)
        let longSource = provider.appendingPathComponent("multiple-chunks"), sourceBytes = Data(repeating: 7, count: 3 * 64 * 1024 + 1)
        try sourceBytes.write(to: longSource); try check(PackingReferencePhoto.readProviderFile(longSource) == sourceBytes)
        let link = provider.appendingPathComponent("link"); try fm.createSymbolicLink(at: link, withDestinationURL: sourceFile)
        refuses { _ = try PackingReferencePhoto.readProviderFile(link) }
        let hardlink = provider.appendingPathComponent("hardlink"); try fm.linkItem(at: sourceFile, to: hardlink)
        refuses { _ = try PackingReferencePhoto.readProviderFile(hardlink) }; try fm.removeItem(at: hardlink)
        let sparse = provider.appendingPathComponent("over-limit"); try Data([1]).write(to: sparse)
        let sparseHandle = try FileHandle(forWritingTo: sparse)
        try sparseHandle.truncate(atOffset: UInt64(PackingReferencePhoto.maximumBytes + 1)); try sparseHandle.close()
        refuses { _ = try PackingReferencePhoto.readProviderFile(sparse) }
        refuses { _ = try PackingReferencePhoto.readProviderFile(provider) }
        let animated = NSMutableData(), gif = CGImageDestinationCreateWithData(animated, UTType.gif.identifier as CFString, 2, nil)!
        CGImageDestinationAddImage(gif, image(width: 32, height: 16), nil)
        CGImageDestinationAddImage(gif, image(width: 32, height: 16, red: 0), nil); check(CGImageDestinationFinalize(gif))
        phase("animated GIF")
        let still = try PackingReferencePhoto.prepare(animated as Data)
        check(CGImageSourceGetCount(CGImageSourceCreateWithData(still.bytes as CFData, nil)!) == 1)
        for invalid in [Data(), Data("<svg><script>no active image</script></svg>".utf8), Data(small.prefix(40)), Data(repeating: 1, count: PackingReferencePhoto.maximumBytes + 1)] {
            refuses { _ = try PackingReferencePhoto.prepare(invalid) }
        }
        // Exercise the exact input-pixel policy without allocating a 100-megapixel image.
        try PackingReferencePhoto.validateDimensions(width: 10_000, height: 10_000)
        for (width, height) in [(10_001.0, 10_000.0), (0.0, 10.0), (-1.0, 10.0), (0.5, 2.0), (Double.nan, 2.0), (2.0, Double.infinity)] {
            refuses { try PackingReferencePhoto.validateDimensions(width: width, height: height) }
        }
        // A CRC-correct huge header has an inconsistent original PNG pixel stream.
        // ImageIO may reject it before exposing dimensions; both early refusals are safe.
        var huge = small
        func put(_ value: UInt32, at offset: Int) { for i in 0..<4 { huge[offset + i] = UInt8((value >> (24 - i * 8)) & 255) } }
        put(100_001, at: 16); put(1000, at: 20)
        var crc: UInt32 = 0xffff_ffff
        for byte in huge[12..<29] { crc ^= UInt32(byte); for _ in 0..<8 { crc = (crc >> 1) ^ (crc & 1 == 1 ? 0xedb8_8320 : 0) } }
        put(crc ^ 0xffff_ffff, at: 29)
        phase("CRC-correct oversized PNG header")
        do { _ = try PackingReferencePhoto.prepare(huge); fatalError("Oversized source accepted") }
        catch PackingReferencePhotoError.oversized {}
        catch PackingReferencePhotoError.unsupported {}

        let clock = PhotoClock(), store = try PackingPendingItemPhotoStore(directory: fixture, clock: { clock.now })
        let authority = PackingCaptureAuthority(), workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", account = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        let access = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(0..<32))
        let scope = try PackingPendingBackupStore.Scope(access: access)
        let draft = #"{"version":1,"unit":"imperial","name":"","category":"medicine","length":"","width":"2.25","height":"","mass":"","dimensionSource":"estimated","massSource":"known","flexibility":"rigid","fragile":false,"topLoad":"0","topLoadSource":"known","keepUpright":false,"formsNeedRecovery":false,"packingForms":[],"scannedEstimate":false,"scanDimensionsEdited":true,"scaleReference":"","removePhoto":true}"#
        let first = try store.prepare(scope: scope, draftJSON: draft)
        check(!first.selected && first.target == workspace)
        refuses { _ = try store.prepare(scope: scope, draftJSON: draft) }
        refuses { _ = try store.read(ticket: first.ticket, access: access) }
        try store.checkRequest(first.ticket)
        authority.close(expectedRevision: access.lease)
        let cancelled = try store.cancelled(first.ticket); check(!cancelled.selected && cancelled.ticket == first.ticket)
        refuses { _ = try store.read(ticket: first.ticket, access: access) }
        refuses { _ = try store.complete(first.ticket, photo: photo) }
        let reopened = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(0..<32))
        let recovered = try store.read(ticket: first.ticket, access: reopened)
        check(recovered.draftJSON == draft && recovered.jpeg == nil)
        try store.discard(ticket: first.ticket)
        let second = try store.prepare(scope: scope, draftJSON: draft)
        authority.close(expectedRevision: reopened.lease)
        clock.set(699)
        let completed = try store.complete(second.ticket, photo: photo)
        check(completed.selected && completed.ticket != second.ticket)
        let replay = try store.cancelled(second.ticket); check(replay.ticket == completed.ticket && replay.selected)
        refuses { try store.checkRequest(completed.ticket) }
        refuses { _ = try store.complete(second.ticket, photo: photo) }
        let current = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: account, dataKey: Data(0..<32))
        let selected = try store.read(ticket: completed.ticket, access: current)
        check(selected.draftJSON == draft && selected.jpeg == photo.bytes)
        if CommandLine.arguments.count == 2 {
            let result: [String: Any] = ["draftJson": selected.draftJSON, "dataUrl": "data:image/jpeg;base64," + selected.jpeg!.base64EncodedString()]
            try JSONSerialization.data(withJSONObject: result).write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .withoutOverwriting)
        }
        for url in try fm.contentsOfDirectory(at: fixture, includingPropertiesForKeys: nil) where url.pathExtension == "sealed" {
            let data = try Data(contentsOf: url); check(data.range(of: Data("medicine".utf8)) == nil && data.range(of: photo.bytes) == nil)
        }
        // Even knowing its path cannot reinterpret a photo bundle with the backup-purpose AAD.
        let backup = try PackingPendingBackupStore(directory: fixture)
        refuses { _ = try backup.read(ticket: completed.ticket, access: current) }
        let restarted = try PackingPendingItemPhotoStore(directory: fixture)
        refuses { _ = try restarted.read(ticket: completed.ticket, access: current) }; try restarted.close()
        authority.close(expectedRevision: current.lease)
        let guest = try authority.selectGuest(expectedRevision: authority.state().revision)
        refuses { _ = try store.read(ticket: completed.ticket, access: guest) }
        let wrong = try authority.openWorkspace(expectedRevision: authority.state().revision, workspaceID: workspace, accountID: "cccccccc-cccc-cccc-cccc-cccccccccccc", dataKey: Data(0..<32))
        refuses { _ = try store.read(ticket: completed.ticket, access: wrong) }
        clock.set(700); try store.expire()
        check(!fm.fileExists(atPath: fixture.appendingPathComponent(completed.ticket + ".sealed").path))
        refuses { _ = try store.result(request: second.ticket, ticket: completed.ticket) }
        clock.set(701)
        let last = try store.prepare(scope: scope, draftJSON: draft); _ = try store.cancelled(last.ticket)
        clock.set(700); try store.expire()
        refuses { _ = try store.result(request: last.ticket, ticket: last.ticket) }
        refuses { _ = try store.prepare(scope: scope, draftJSON: "") }
        refuses { _ = try store.prepare(scope: scope, draftJSON: String(repeating: "x", count: PackingPendingItemPhotoStore.maximumDraftBytes + 1)) }
        try store.close(); refuses { _ = try store.prepare(scope: scope, draftJSON: draft) }
        let raceRoot = fixture.appendingPathComponent("race", isDirectory: true)
        try fm.createDirectory(at: raceRoot, withIntermediateDirectories: false)
        clock.set(800)
        let raceStore = try PackingPendingItemPhotoStore(directory: raceRoot, clock: { clock.now })
        let raceAccess = try authority.selectGuest(expectedRevision: authority.state().revision)
        let racing = try raceStore.prepare(scope: PackingPendingBackupStore.Scope(access: raceAccess), draftJSON: draft)
        let replies = PhotoReplies()
        DispatchQueue.concurrentPerform(iterations: 12) { index in
            do {
                let answer = index.isMultiple(of: 2) ? try raceStore.complete(racing.ticket, photo: photo) : try raceStore.cancelled(racing.ticket)
                replies.add(answer)
            }
            catch { /* A completed/cancelled request rejects subsequent completion. */ }
        }
        let answers = replies.snapshot; check(answers.count >= 6)
        let winner = answers[0]
        check(answers.allSatisfy { $0.ticket == winner.ticket && $0.selected == winner.selected })
        let raceContent = try raceStore.read(ticket: winner.ticket, access: raceAccess)
        check(raceContent.draftJSON == draft && (raceContent.jpeg != nil) == winner.selected)
        try raceStore.close()
        let cache = fixture.appendingPathComponent("cache", isDirectory: true)
        try fm.createDirectory(at: cache, withIntermediateDirectories: false)
        let photoRoot = try PackingBackupDirectory.prepare(parent: cache, kind: .itemPhoto)
        let backupRoot = try PackingBackupDirectory.prepare(parent: cache)
        check(photoRoot != backupRoot)
        let ownedPhotos = try PackingPendingItemPhotoStore(directory: photoRoot)
        let orphan = try ownedPhotos.prepare(scope: scope, draftJSON: draft)
        let backupStore = try PackingPendingBackupStore(directory: backupRoot)
        var delivered = false
        let backupReceipt = try backupStore.stage(scope: scope) { _ in defer { delivered = true }; return delivered ? Data() : Data("private backup".utf8) }
        let unknown = photoRoot.appendingPathComponent("unknown.txt"); try Data("keep".utf8).write(to: unknown)
        _ = try PackingBackupDirectory.prepare(parent: cache, kind: .itemPhoto)
        check(!fm.fileExists(atPath: photoRoot.appendingPathComponent(orphan.ticket + ".sealed").path))
        check(fm.fileExists(atPath: backupRoot.appendingPathComponent(backupReceipt.ticket + ".sealed").path))
        try check(Data(contentsOf: unknown) == Data("keep".utf8))
        print("ImageIO JPEG preparation, metadata removal and encrypted item-draft handoff passed.")
    }
}
