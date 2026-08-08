#!/usr/bin/env swift
//
// Генератор иконки приложения из фирменного знака.
//
// Знак тот же, что в заставке (`OrdaMark`): шестиугольник из трёх граней куба.
// Рисуется кодом, поэтому иконка и заставка не могут разъехаться — меняется
// геометрия в одном месте.
//
// Запуск (из каталога apple/):
//   swift Tools/GenerateAppIcon.swift
//
// Кладёт PNG в Orda/Assets.xcassets/AppIcon.appiconset и переписывает
// Contents.json под сгенерированные файлы.

import AppKit
import SwiftUI

// ── Геометрия знака ──────────────────────────────────────────────────────────

/// Одна грань изометрического куба. Копия `RhombusFacet` из приложения —
/// скрипт standalone и не может импортировать модуль приложения.
struct IconFacet: Shape {
    let index: Int

    func path(in rect: CGRect) -> Path {
        let width = rect.width
        let height = rect.height
        let centerX = rect.midX
        let centerY = rect.midY

        let top = CGPoint(x: centerX, y: 0)
        let topRight = CGPoint(x: width, y: height * 0.25)
        let bottomRight = CGPoint(x: width, y: height * 0.75)
        let bottom = CGPoint(x: centerX, y: height)
        let bottomLeft = CGPoint(x: 0, y: height * 0.75)
        let topLeft = CGPoint(x: 0, y: height * 0.25)
        let center = CGPoint(x: centerX, y: centerY)

        var path = Path()
        switch index {
        case 0:
            path.move(to: topLeft); path.addLine(to: top)
            path.addLine(to: topRight); path.addLine(to: center)
        case 1:
            path.move(to: topRight); path.addLine(to: bottomRight)
            path.addLine(to: bottom); path.addLine(to: center)
        default:
            path.move(to: topLeft); path.addLine(to: center)
            path.addLine(to: bottom); path.addLine(to: bottomLeft)
        }
        path.closeSubpath()
        return path
    }
}

/// Полотно иконки.
///
/// Фон — глубокий тёмный с мягким изумрудным свечением от знака: на светлом
/// и на тёмном домашнем экране иконка одинаково читается. Скруглять углы не
/// нужно — маску накладывает система.
struct IconCanvas: View {
    /// Доля ширины, которую занимает знак. Apple рекомендует поля ~10–20%,
    /// иначе знак упирается в маску.
    private let markScale: CGFloat = 0.52

    var body: some View {
        GeometryReader { proxy in
            let side = proxy.size.width
            let markWidth = side * markScale
            let markHeight = markWidth * (108.0 / 96.0)

            ZStack {
                Color(red: 0.027, green: 0.031, blue: 0.035)

                RadialGradient(
                    colors: [
                        Color(red: 0.063, green: 0.725, blue: 0.506).opacity(0.30),
                        .clear,
                    ],
                    center: .center,
                    startRadius: side * 0.05,
                    endRadius: side * 0.55
                )

                ZStack {
                    ForEach(0..<3, id: \.self) { index in
                        IconFacet(index: index)
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color(red: 0.239, green: 0.941, blue: 0.714)
                                            .opacity(0.98 - Double(index) * 0.16),
                                        Color(red: 0.063, green: 0.725, blue: 0.506)
                                            .opacity(0.94 - Double(index) * 0.10),
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )
                    }
                }
                .frame(width: markWidth, height: markHeight)
                .shadow(color: Color(red: 0.063, green: 0.725, blue: 0.506).opacity(0.5), radius: side * 0.06)
            }
        }
    }
}

// ── Рендер ───────────────────────────────────────────────────────────────────

@MainActor
func renderPNG(side: CGFloat) -> Data? {
    let renderer = ImageRenderer(
        content: IconCanvas().frame(width: side, height: side)
    )
    renderer.scale = 1
    guard
        let image = renderer.nsImage,
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
    else { return nil }
    return png
}

/// Слоты каталога иконок: имя файла → сторона в пикселях.
let slots: [(file: String, side: CGFloat, idiom: String, size: String, scale: String?)] = [
    ("icon-1024.png", 1024, "universal", "1024x1024", nil),
    ("mac-16.png", 16, "mac", "16x16", "1x"),
    ("mac-32.png", 32, "mac", "16x16", "2x"),
    ("mac-32-1x.png", 32, "mac", "32x32", "1x"),
    ("mac-64.png", 64, "mac", "32x32", "2x"),
    ("mac-128.png", 128, "mac", "128x128", "1x"),
    ("mac-256.png", 256, "mac", "128x128", "2x"),
    ("mac-256-1x.png", 256, "mac", "256x256", "1x"),
    ("mac-512.png", 512, "mac", "256x256", "2x"),
    ("mac-512-1x.png", 512, "mac", "512x512", "1x"),
    ("mac-1024.png", 1024, "mac", "512x512", "2x"),
]

let output = URL(fileURLWithPath: "Orda/Assets.xcassets/AppIcon.appiconset")

MainActor.assumeIsolated {
    try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

    // Один и тот же размер рендерим один раз и переиспользуем.
    var cache: [CGFloat: Data] = [:]
    var written = 0

    for slot in slots {
        let data: Data?
        if let cached = cache[slot.side] {
            data = cached
        } else {
            data = renderPNG(side: slot.side)
            if let data { cache[slot.side] = data }
        }

        guard let data else {
            FileHandle.standardError.write(Data("не удалось отрисовать \(slot.file)\n".utf8))
            continue
        }
        try? data.write(to: output.appendingPathComponent(slot.file))
        written += 1
    }

    // Contents.json под сгенерированные файлы.
    var images: [String] = []
    for slot in slots {
        var entry = "    {\n      \"filename\" : \"\(slot.file)\",\n      \"idiom\" : \"\(slot.idiom)\""
        if slot.idiom == "universal" {
            entry += ",\n      \"platform\" : \"ios\""
        }
        entry += ",\n      \"size\" : \"\(slot.size)\""
        if let scale = slot.scale {
            entry += ",\n      \"scale\" : \"\(scale)\""
        }
        entry += "\n    }"
        images.append(entry)
    }

    let contents = """
    {
      "images" : [
    \(images.joined(separator: ",\n"))
      ],
      "info" : {
        "author" : "xcode",
        "version" : 1
      }
    }
    """
    try? contents.write(to: output.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)

    print("иконок записано: \(written)")
}
