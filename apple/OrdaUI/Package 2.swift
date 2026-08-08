// swift-tools-version: 6.0
import PackageDescription

/// OrdaUI — дизайн-система: токены, движение, базовые компоненты.
///
/// Отдельно от приложения, чтобы правила оформления нельзя было «случайно
/// обойти» инлайновыми стилями в экране — ровно та беда, из-за которой
/// прошлая версия приложения выглядела как веб в обёртке.
let package = Package(
    name: "OrdaUI",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "OrdaUI", targets: ["OrdaUI"]),
    ],
    dependencies: [
        .package(path: "../OrdaKit"),
    ],
    targets: [
        .target(
            name: "OrdaUI",
            dependencies: ["OrdaKit"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
