// swift-tools-version: 6.0
import PackageDescription

/// OrdaKit — вся логика приложения без единой строки UI.
///
/// Здесь живёт самое ошибкоопасное: расчёт доступа (397 прав × 4 слоя гейтинга),
/// сетевой слой и доменные вычисления. Отдельный пакет — чтобы это можно было
/// покрыть тестами и запускать на CI без симулятора.
let package = Package(
    name: "OrdaKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "OrdaKit", targets: ["OrdaKit"]),
    ],
    targets: [
        .target(
            name: "OrdaKit",
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "OrdaKitTests",
            dependencies: ["OrdaKit"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
