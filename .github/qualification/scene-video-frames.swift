import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

@main struct SavedSceneFrames {
    static func main() async throws {
        let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)!.allObjects.compactMap { $0 as? URL }.filter { $0.pathExtension == "mp4" }.sorted { $0.path < $1.path }
        var records: [[String: Any]] = []
        for (index, file) in files.enumerated() {
            let asset = AVURLAsset(url: file)
            let duration = try await asset.load(.duration)
            let seconds = CMTimeGetSeconds(duration)
            guard seconds.isFinite, seconds > 0 else { continue }
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            for (frameIndex, fraction) in [0.1, 0.5, 0.9].enumerated() {
                let requested = CMTime(seconds: seconds * fraction, preferredTimescale: 600)
                let frame = try await generator.image(at: requested)
                let destination = folder.appendingPathComponent("video-\(index)-frame-\(frameIndex).png")
                guard let writer = CGImageDestinationCreateWithURL(destination as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw NSError(domain: "SavedSceneFrames", code: 1) }
                CGImageDestinationAddImage(writer, frame.image, nil)
                guard CGImageDestinationFinalize(writer) else { throw NSError(domain: "SavedSceneFrames", code: 2) }
                records.append(["sourceVideo": file.lastPathComponent, "durationSeconds": seconds, "requestedSeconds": seconds * fraction, "actualSeconds": CMTimeGetSeconds(frame.actualTime), "file": destination.lastPathComponent])
            }
        }
        let data = try JSONSerialization.data(withJSONObject: records, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: folder.appendingPathComponent("decoded-video-frames.json"))
        print("Decoded \(records.count) actual frames from \(files.count) retained synthetic UI videos.")
    }
}
