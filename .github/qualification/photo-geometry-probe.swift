import Foundation
import CoreGraphics

// The actual helper bytes are inserted above this owned program by the worker.
@main enum PhotoGeometryProbe {
    static func check(_ value: Bool, _ message: String) {
        if !value { fatalError(message) }
    }
    static func canvas(width: Int, height: Int, idealPhotoRect: CGRect, redPhoto: Bool, redPadding: Bool) -> CGImage {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)!
        context.setFillColor(red: redPadding ? 1 : 0.9, green: redPadding ? 0 : 0.9, blue: redPadding ? 0 : 0.9, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        context.setFillColor(red: redPhoto ? 1 : 0, green: 0, blue: redPhoto ? 0 : 1, alpha: 1)
        context.fill(idealPhotoRect)
        return context.makeImage()!
    }
    static func redPixels(_ image: CGImage) -> Int {
        var pixels = [UInt8](repeating: 0, count: 32 * 32 * 4)
        pixels.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: 32, height: 32, bitsPerComponent: 8, bytesPerRow: 128,
                                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: 32, height: 32))
        }
        return stride(from: 0, to: pixels.count, by: 4).filter { pixels[$0] > 150 && pixels[$0 + 1] < 100 && pixels[$0 + 2] < 100 }.count
    }
    static func main() throws {
        var results: [[String: Any]] = []
        // Fixed, independently specified layout oracles; the fixture painter
        // does not call the function under test.
        let layouts: [(Int, Int, CGRect, CGRect)] = [
            (400,140,CGRect(x:182.5,y:0,width:35,height:140),CGRect(x:182,y:0,width:36,height:140)),
            (280,130,CGRect(x:123.75,y:0,width:32.5,height:130),CGRect(x:123,y:0,width:34,height:130)),
            (130,130,CGRect(x:48.75,y:0,width:32.5,height:130),CGRect(x:48,y:0,width:34,height:130)),
            (35,140,CGRect(x:0,y:0,width:35,height:140),CGRect(x:0,y:0,width:35,height:140)),
            (20,140,CGRect(x:0,y:30,width:20,height:80),CGRect(x:0,y:30,width:20,height:80))
        ]
        for (width, height, ideal, expected) in layouts {
            for red in [true,false] {
                let image = canvas(width: width, height: height, idealPhotoRect: ideal, redPhoto: red, redPadding: !red)
                let crop = referencePhotoContentRect(CGSize(width: CGFloat(width), height: CGFloat(height)))!
                check(crop == expected, "Fitted crop differs from independent layout oracle")
                let content = image.cropping(to: crop)!
                let count = redPixels(content)
                check(red ? count > 512 : count <= 512, "Incorrect fitted-photo classification")
                results.append(["width":width,"height":height,"redPhoto":red,"fittedRedPixels":count,"passed":true])
            }
        }
        let red = canvas(width: 400,height: 140,idealPhotoRect: layouts[0].2,redPhoto: true,redPadding: false)
        check(redPixels(red) <= 512, "Expected original whole-element false negative was not reproduced")
        let blue = canvas(width: 400,height: 140,idealPhotoRect: layouts[0].2,redPhoto: false,redPadding: true)
        check(redPixels(blue) > 512, "Expected original whole-element false positive was not reproduced")
        for size in [CGSize.zero,CGSize(width: -1,height: 10),CGSize(width: 10,height: -1),CGSize(width: CGFloat.infinity,height: 10)] {
            check(referencePhotoContentRect(size) == nil, "Invalid geometry accepted")
        }
        let output: [String: Any] = ["cases":results,"originalFalseNegativeRedPixels":redPixels(red),"originalFalsePositiveRedPixels":redPixels(blue),"invalidGeometryCases":4,"threshold":512,"failed":0]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted,.sortedKeys])
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        print("Fitted-photo geometry: ten colour/shape controls, four invalid bounds and both original classifier defects verified.")
    }
}
