import Foundation

enum PackingCaptureFileError: Error { case unsafePath, invalidID, unknownCapture, limit }

/** App-owned scan originals only. Does not follow links or clear unknown documents. */
struct PackingCaptureFiles {
    private let manager = FileManager.default
    let root: URL
    private let marker = ".packing-capture-v1"

    init(documents: URL) throws {
        let base = documents.standardizedFileURL.resolvingSymlinksInPath()
        guard base.isFileURL, try FileManager.default.attributesOfItem(atPath: base.path)[.type] as? FileAttributeType == .typeDirectory else {
            throw PackingCaptureFileError.unsafePath
        }
        root = base.appendingPathComponent("ScanCaptures", isDirectory: true)
        if !manager.fileExists(atPath: root.path) {
            try manager.createDirectory(at: root, withIntermediateDirectories: false)
        }
        try check(root, directory: true)
        try protect(root)
    }

    static func appStore() throws -> PackingCaptureFiles {
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return try PackingCaptureFiles(documents: documents)
    }

    private func folder(_ id: String) throws -> URL {
        guard UUID(uuidString: id)?.uuidString.lowercased() == id else { throw PackingCaptureFileError.invalidID }
        try check(root, directory: true)
        return root.appendingPathComponent(id, isDirectory: true)
    }

    func create(_ id: String) throws -> URL {
        let url = try folder(id)
        // Never reuse or overwrite a previous scan, including an interrupted scan.
        guard !manager.fileExists(atPath: url.path) else { throw PackingCaptureFileError.unknownCapture }
        try manager.createDirectory(at: url, withIntermediateDirectories: false)
        do {
            try protect(url)
            for name in ["Images", "Checkpoints"] {
                let child = url.appendingPathComponent(name, isDirectory: true)
                try manager.createDirectory(at: child, withIntermediateDirectories: false)
                try protect(child)
            }
            let ownership = url.appendingPathComponent(marker)
            try Data(("PackingScanningCapture/1\n" + id + "\n").utf8).write(to: ownership, options: .withoutOverwriting)
            try protect(ownership)
            return url
        } catch {
            // This freshly allocated folder is the only cleanup target.
            try? manager.removeItem(at: url)
            throw error
        }
    }

    private func check(_ url: URL, directory: Bool? = nil) throws {
        guard url.isFileURL, url.standardizedFileURL.path == url.resolvingSymlinksInPath().path,
              url.path == root.path || url.path.hasPrefix(root.path + "/") else { throw PackingCaptureFileError.unsafePath }
        let attributes = try manager.attributesOfItem(atPath: url.path)
        let kind = attributes[.type] as? FileAttributeType
        guard kind == .typeDirectory || kind == .typeRegular,
              directory == nil || (directory == true ? kind == .typeDirectory : kind == .typeRegular),
              kind != .typeRegular || (attributes[.referenceCount] as? NSNumber)?.intValue == 1 else {
            throw PackingCaptureFileError.unsafePath
        }
    }

    private func protect(_ url: URL) throws {
        try check(url)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var target = url
        try target.setResourceValues(values)
        #if os(iOS)
        try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
    }

    private func contents(_ url: URL, depth: Int = 0, count: inout Int) throws -> [URL] {
        try check(url, directory: true)
        guard depth <= 16 else { throw PackingCaptureFileError.limit }
        var result: [URL] = []
        for child in try manager.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
            count += 1
            guard count <= 20000 else { throw PackingCaptureFileError.limit }
            try check(child)
            result.append(child)
            if try manager.attributesOfItem(atPath: child.path)[.type] as? FileAttributeType == .typeDirectory {
                result += try contents(child, depth: depth + 1, count: &count)
            }
        }
        return result
    }

    private func owned(_ url: URL) throws -> [URL] {
        try check(url, directory: true)
        var count = 0
        let children = try contents(url, count: &count)
        let ownership = url.appendingPathComponent(marker)
        if manager.fileExists(atPath: ownership.path) {
            try check(ownership, directory: false)
            let expected = Data(("PackingScanningCapture/1\n" + url.lastPathComponent + "\n").utf8)
            guard (try manager.attributesOfItem(atPath: ownership.path)[.size] as? NSNumber)?.intValue == expected.count,
                  try Data(contentsOf: ownership) == expected else {
                throw PackingCaptureFileError.unknownCapture
            }
        } else {
            // Historical captures predate the marker. Recognize only their exact top-level layout.
            let names = Set(try manager.contentsOfDirectory(atPath: url.path))
            guard names.isSubset(of: ["Images", "Checkpoints", "Model.usdz"]), names.contains("Images"), names.contains("Checkpoints") else {
                throw PackingCaptureFileError.unknownCapture
            }
            try check(url.appendingPathComponent("Images"), directory: true)
            try check(url.appendingPathComponent("Checkpoints"), directory: true)
        }
        return children
    }

    /** Reapply policy to framework-created outputs before publishing a successful capture. */
    func finalize(_ id: String) throws {
        let url = try folder(id)
        for child in try owned(url) { try protect(child) }
        try protect(url)
    }

    @discardableResult func delete(_ id: String) throws -> Bool {
        let url = try folder(id)
        guard manager.fileExists(atPath: url.path) else { return false }
        _ = try owned(url)
        try check(root, directory: true)
        try manager.removeItem(at: url)
        return true
    }

    func clear() throws -> Int {
        try check(root, directory: true)
        let candidates = try manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        // Validate all recognized candidates before deleting any, preserving unsafe/unknown entries.
        var recognized: [String] = []
        for candidate in candidates {
            let id = candidate.lastPathComponent
            guard UUID(uuidString: id)?.uuidString.lowercased() == id else { continue }
            do { _ = try owned(candidate); recognized.append(id) }
            catch PackingCaptureFileError.unknownCapture { continue }
            catch PackingCaptureFileError.unsafePath { continue }
        }
        var deleted = 0
        for id in recognized { if try delete(id) { deleted += 1 } }
        return deleted
    }
}
