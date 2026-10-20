import Foundation
import Darwin
import ImageIO
import UniformTypeIdentifiers

enum PackingReferencePhotoError: Error { case unsupported, oversized, decodeFailed }

/** Only the ImageIO normalizer can create this value; consumers cannot attach raw provider bytes. */
struct PackingPreparedReferencePhoto: Sendable {
    let bytes: Data
    fileprivate init(_ bytes: Data) { self.bytes = bytes }
}

enum PackingReferencePhoto {
    static let maximumBytes = 12 * 1024 * 1024
    static let maximumPixels = 100_000_000.0
    static let maximumDimension = 2048
    static func validateDimensions(width: Double, height: Double) throws {
        guard width.isFinite, height.isFinite, width >= 1, height >= 1,
              width.rounded(.towardZero) == width, height.rounded(.towardZero) == height,
              width * height <= maximumPixels else { throw PackingReferencePhotoError.oversized }
    }
    /** Read only while NSItemProvider's callback owns its temporary source URL. No retained path. */
    static func readProviderFile(_ url: URL) throws -> Data {
        guard url.isFileURL else { throw PackingReferencePhotoError.unsupported }
        let descriptor = Darwin.open(url.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw PackingReferencePhotoError.unsupported }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true); defer { try? handle.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_nlink == 1,
              info.st_size > 0, info.st_size <= maximumBytes else { throw PackingReferencePhotoError.oversized }
        var data = Data()
        while let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty {
            guard chunk.count <= maximumBytes - data.count else { throw PackingReferencePhotoError.oversized }
            data.append(chunk)
        }
        guard !data.isEmpty else { throw PackingReferencePhotoError.unsupported }; return data
    }
    /** First frame only. Decode a transformed thumbnail before allocating a full-resolution image. */
    static func prepare(_ input: Data) throws -> PackingPreparedReferencePhoto {
        guard !input.isEmpty, input.count <= maximumBytes else { throw PackingReferencePhotoError.oversized }
        guard let source = CGImageSourceCreateWithData(input as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let identifier = CGImageSourceGetType(source), let type = UTType(identifier as String), type.conforms(to: .image),
              CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber else { throw PackingReferencePhotoError.unsupported }
        try validateDimensions(width: width.doubleValue, height: height.doubleValue)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumDimension,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              image.width > 0, image.height > 0, max(image.width, image.height) <= maximumDimension else { throw PackingReferencePhotoError.decodeFailed }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw PackingReferencePhotoError.decodeFailed }
        // Add decoded pixels, never AddImageFromSource: EXIF/GPS/source properties are not copied.
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85, kCGImagePropertyOrientation: 1] as CFDictionary)
        guard CGImageDestinationFinalize(destination), output.length > 0, output.length <= maximumBytes else { throw PackingReferencePhotoError.decodeFailed }
        return PackingPreparedReferencePhoto(output as Data)
    }
}
