// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VisualTypist",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "VisualTypist", targets: ["VisualTypist"]),
        .library(name: "VisualTypistCore", targets: ["VisualTypistCore"]),
    ],
    targets: [
        .target(name: "VisualTypistCore"),
        .executableTarget(
            name: "VisualTypist",
            dependencies: ["VisualTypistCore"],
            resources: [.copy("Resources/Web")]
        ),
        .testTarget(name: "VisualTypistCoreTests", dependencies: ["VisualTypistCore"]),
    ],
    swiftLanguageModes: [.v5]
)
