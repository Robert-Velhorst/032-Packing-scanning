// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "PackingBoundaryProbe",
    platforms: [.iOS("15.4")],
    products: [.library(name: "PackingBoundaryProbe", targets: ["PackingBoundaryProbe"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.0")
    ],
    targets: [
        .target(name: "PackingBoundaryProbe", dependencies: [
            .product(name: "Capacitor", package: "capacitor-swift-pm"),
            .product(name: "Cordova", package: "capacitor-swift-pm")
        ])
    ],
    swiftLanguageModes: [.v6]
)
