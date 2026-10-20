import Foundation

@main enum CaptureFileChecks {
    static func main() throws {
        let manager = FileManager.default
        let temp = manager.temporaryDirectory.resolvingSymlinksInPath()
        let fixture = temp.appendingPathComponent("packing-ios-files-" + UUID().uuidString, isDirectory: true)
        precondition(fixture.deletingLastPathComponent().path == temp.path)
        try manager.createDirectory(at: fixture, withIntermediateDirectories: false)
        defer { try? manager.removeItem(at: fixture) }
        let documents = fixture.appendingPathComponent("Documents", isDirectory: true)
        try manager.createDirectory(at: documents, withIntermediateDirectories: false)
        func stage(_ value: String) { FileHandle.standardError.write(Data(("Capture check: " + value + "\n").utf8)) }
        stage("initialize canonical root")
        let files = try PackingCaptureFiles(documents: documents)
        func id() -> String { UUID().uuidString.lowercased() }
        func exists(_ url: URL) -> Bool { manager.fileExists(atPath: url.path) }
        func check(_ value: Bool) { precondition(value) }
        func refuses(_ message: String, _ action: () throws -> Void) {
            do { try action(); preconditionFailure(message) } catch {}
        }
        refuses("Remote URLs must not become storage roots") { _ = try PackingCaptureFiles(documents: URL(string: "https://example.invalid/tmp")!) }

        stage("create new owned capture")
        let firstID = id(), first = try files.create(firstID)
        let model = first.appendingPathComponent("Model.usdz")
        refuses("A missing model must not publish success") { try files.finalize(firstID) }
        try manager.createDirectory(at: model, withIntermediateDirectories: false)
        refuses("A directory must not count as a completed model") { try files.finalize(firstID) }
        try manager.removeItem(at: model)
        try Data().write(to: model)
        refuses("An empty model must not publish success") { try files.finalize(firstID) }
        try Data("synthetic model".utf8).write(to: model)
        stage("finalize framework model output")
        try files.finalize(firstID)
        try check(model.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        refuses("Reusing a capture must not overwrite it") { _ = try files.create(firstID) }
        try check(Data(contentsOf: model) == Data("synthetic model".utf8))
        refuses("Traversal must be refused") { _ = try files.delete("../outside") }
        refuses("Noncanonical IDs must be refused") { _ = try files.create(firstID.uppercased()) }
        try check(files.delete(id()) == false)

        let unknown = files.root.appendingPathComponent("keep.txt")
        try Data("keep".utf8).write(to: unknown)
        let unknownID = id(), unknownFolder = files.root.appendingPathComponent(unknownID, isDirectory: true)
        try manager.createDirectory(at: unknownFolder, withIntermediateDirectories: false)
        try Data("unrelated".utf8).write(to: unknownFolder.appendingPathComponent("notes.txt"))
        refuses("Unknown UUID folders must be preserved") { _ = try files.delete(unknownID) }

        let legacyID = id(), legacy = files.root.appendingPathComponent(legacyID, isDirectory: true)
        try manager.createDirectory(at: legacy.appendingPathComponent("Images"), withIntermediateDirectories: true)
        try manager.createDirectory(at: legacy.appendingPathComponent("Checkpoints"), withIntermediateDirectories: false)
        stage("create and corrupt owned marker")
        let corruptID = id(), corrupt = try files.create(corruptID)
        try Data("wrong marker".utf8).write(to: corrupt.appendingPathComponent(".packing-capture-v1"))
        refuses("Invalid ownership must be preserved") { try files.finalize(corruptID) }

        let outside = fixture.appendingPathComponent("outside", isDirectory: true)
        try manager.createDirectory(at: outside, withIntermediateDirectories: false)
        let sentinel = outside.appendingPathComponent("sentinel.txt")
        try Data("must survive".utf8).write(to: sentinel)
        let linkedID = id(), linked = files.root.appendingPathComponent(linkedID)
        try manager.createSymbolicLink(at: linked, withDestinationURL: outside)
        refuses("Capture symlinks must not be followed") { _ = try files.delete(linkedID) }
        stage("create nested link fixture")
        let nestedID = id(), nested = try files.create(nestedID)
        try manager.createSymbolicLink(at: nested.appendingPathComponent("Images/outside"), withDestinationURL: outside)
        refuses("Nested symlinks must prevent deletion") { _ = try files.delete(nestedID) }
        refuses("Nested symlinks must prevent policy mutation") { try files.finalize(nestedID) }
        stage("create hard link fixture")
        let hardID = id(), hard = try files.create(hardID)
        try manager.linkItem(at: sentinel, to: hard.appendingPathComponent("Model.usdz"))
        refuses("Hard-linked files must not change outside policy") { try files.finalize(hardID) }

        stage("clear while preserving unknown and linked fixtures")
        let deleted = try files.clear()
        precondition(deleted == 2 && !exists(first) && !exists(legacy))
        precondition(exists(unknown) && exists(unknownFolder) && exists(corrupt) && exists(nested) && exists(hard))
        try check(Data(contentsOf: sentinel) == Data("must survive".utf8))

        stage("replace root and refuse all subsequent operations")
        let oldRoot = files.root.appendingPathExtension("saved")
        try manager.moveItem(at: files.root, to: oldRoot)
        try manager.createSymbolicLink(at: files.root, withDestinationURL: outside)
        refuses("Replaced roots must refuse access") { _ = try files.create(id()) }
        refuses("Replaced roots must refuse clearing") { _ = try files.clear() }
        refuses("Symlink roots must refuse initialization") { _ = try PackingCaptureFiles(documents: documents) }
        try check(Data(contentsOf: sentinel) == Data("must survive".utf8))
        print("iOS capture file checks passed: ownership, preservation, backup flags, canonical paths, links and relocated roots.")
    }
}
