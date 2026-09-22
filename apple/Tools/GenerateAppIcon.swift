#!/usr/bin/env swift
//
// Генератор иконки приложения из фирменного знака.
//
// Знак ORDA CONTROL — тот же, что в заставке (`OrdaControlMark`): белое
// кольцо и кобальтовый сегмент справа сверху на Deep Navy. Геометрия — из
// docs/design/ORDA_CONTROL_DESIGN_SYSTEM.md; рисуется кодом, поэтому иконка и
// заставка не разъедутся.
//
// Запуск (из каталога apple/):
//   swift Tools/GenerateAppIcon.swift
//
// Кладёт PNG в Orda/Assets.xcassets/AppIcon.appiconset и переписывает
// Contents.json под сгенерированные файлы.

import AppKit
import SwiftUI

// ── Знак ─────────────────────────────────────────────────────────────────────

/// Дуга с центром в середине рамки: углы в градусах, 0 — вправо, по часовой.
struct IconArc: Shape {
    let from: Double
    let to: Double
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addArc(
            center: CGPoint(x: rect.midX, y: rect.midY),
            radius: radius,
            startAngle: .degrees(from),
            endAngle: .degrees(to),
            clockwise: false
        )
        return path
    }
}

/// Полотно иконки. Скруглять углы не нужно: маску накладывает система.
///
/// Свечения нет: на маленьком размере оно пропадает первым, и от иконки
/// остаётся мутное пятно. Только плотный navy, белое кольцо и кобальт.
struct IconCanvas: View {
    /// Доля стороны под знак (кольцо r=0.29 в поле знака).
    private let markScale: CGFloat = 0.8

    var body: some View {
        GeometryReader { proxy in
            let side = proxy.size.width
            let mark = side * markScale
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0x17 / 255, green: 0x35 / 255, blue: 0x63 / 255),
                        Color(red: 0x0B / 255, green: 0x1F / 255, blue: 0x3B / 255),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                Circle()
                    .inset(by: mark * (0.5 - 0.29))
                    .stroke(Color.white, lineWidth: mark * 0.15)
                    .frame(width: mark, height: mark)
                IconArc(from: -104, to: -14, radius: mark * 0.29)
                    .stroke(
                        Color(red: 0x25 / 255, green: 0x63 / 255, blue: 0xEB / 255),
                        style: StrokeStyle(lineWidth: mark * 0.19, lineCap: .round)
                    )
                    .frame(width: mark, height: mark)
            }
            .frame(width: side, height: side)
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
