// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "PackingCallbackConsumer",
    platforms: [.iOS("15.4")],
    products: [.library(name: "PackingCallbackConsumer", targets: ["PackingCallbackConsumer"])],
    dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.0")],
    targets: [
        .target(name: "PackingSDKCallbacks", dependencies: [
            .product(name: "Capacitor", package: "capacitor-swift-pm"),
            .product(name: "Cordova", package: "capacitor-swift-pm")
        ], publicHeadersPath: "include"),
        .target(name: "PackingCallbackConsumer", dependencies: [
            "PackingSDKCallbacks",
            .product(name: "Capacitor", package: "capacitor-swift-pm"),
            .product(name: "Cordova", package: "capacitor-swift-pm")
        ]),
        .testTarget(name: "PackingCallbackConsumerTests", dependencies: [
            "PackingCallbackConsumer", "PackingSDKCallbacks",
            .product(name: "Capacitor", package: "capacitor-swift-pm")
        ]),
        .testTarget(name: "PackingPrintActorTests", dependencies: [
            "PackingCallbackConsumer", "PackingSDKCallbacks",
            .product(name: "Capacitor", package: "capacitor-swift-pm")
        ]),
        .testTarget(name: "PackingScanSupportTests", dependencies: [
            "PackingCallbackConsumer", "PackingSDKCallbacks",
            .product(name: "Capacitor", package: "capacitor-swift-pm")
        ])
        , .testTarget(name: "PackingReloadEpochTests", dependencies: [
            "PackingCallbackConsumer", "PackingSDKCallbacks",
            .product(name: "Capacitor", package: "capacitor-swift-pm")
        ])
        , .testTarget(name: "PackingCancellationCleanupTests", dependencies: [
            "PackingCallbackConsumer", "PackingSDKCallbacks",
            .product(name: "Capacitor", package: "capacitor-swift-pm")
        ])
        , .testTarget(name: "PackingGuestOwnershipTests", dependencies: [
            "PackingCallbackConsumer", "PackingSDKCallbacks",
            .product(name: "Capacitor", package: "capacitor-swift-pm")
        ])
    ],
    swiftLanguageModes: [.v6]
)
