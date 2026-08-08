import SwiftUI

#if canImport(UIKit)
import UIKit
public typealias PlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
public typealias PlatformImage = NSImage
#endif

import ImageIO
import UniformTypeIdentifiers

/// Кэш миниатюр товаров.
///
/// Каталог точки — это тысячи позиций, и наивная загрузка убивает приложение
/// двумя способами сразу:
///
/// 1. **Память.** Фото товара в оригинале — это 2000×2000 пикселей, около
///    16 МБ в распакованном виде. Сотня таких карточек в прокрутке — полтора
///    гигабайта, и система выгружает приложение.
/// 2. **Процессор.** Распаковка полноразмерного JPEG на каждой ячейке при
///    прокрутке даёт заметные подвисания.
///
/// Поэтому изображение **уменьшается при декодировании** (`CGImageSource` с
/// `kCGImageSourceThumbnailMaxPixelSize`): в памяти оказывается ровно та
/// картинка, которая нужна ячейке, а не оригинал. Готовые миниатюры лежат в
/// памяти и на диске, поэтому повторная прокрутка не трогает сеть вовсе.
public actor ImageCache {
    public static let shared = ImageCache()

    /// Память: ограничение по числу объектов, не по байтам — миниатюры
    /// предсказуемо мелкие, а считать байты дороже, чем экономия.
    private let memory: NSCache<NSString, PlatformImage> = {
        let cache = NSCache<NSString, PlatformImage>()
        cache.countLimit = 400
        return cache
    }()

    private let directory: URL
    private let session: URLSession
    /// Идущие загрузки: одна и та же картинка в десяти ячейках не должна
    /// качаться десять раз.
    private var inFlight: [String: Task<PlatformImage?, Never>] = [:]

    private init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        directory = base.appending(path: "orda-thumbnails")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        // Ограничиваем параллелизм: при быстрой прокрутке иначе стартуют сотни
        // соединений, и полезные загрузки встают в очередь за бесполезными.
        configuration.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: configuration)
    }

    /// Миниатюра для указанного размера в пикселях.
    public func thumbnail(for urlString: String?, maxPixel: Int) async -> PlatformImage? {
        guard
            let urlString,
            !urlString.isEmpty,
            let url = URL(string: urlString)
        else { return nil }

        let key = cacheKey(urlString, maxPixel: maxPixel)

        if let cached = memory.object(forKey: key as NSString) {
            return cached
        }

        if let existing = inFlight[key] {
            return await existing.value
        }

        let task = Task<PlatformImage?, Never> { [session, directory] in
            let fileURL = directory.appending(path: key)

            // Диск: миниатюра уже уменьшена, декодируем как есть.
            if let data = try? Data(contentsOf: fileURL),
               let image = PlatformImage(data: data) {
                return image
            }

            guard let data = try? await session.data(from: url).0 else { return nil }
            guard let downsampled = Self.downsample(data: data, maxPixel: maxPixel) else { return nil }

            if let encoded = Self.encode(downsampled) {
                try? encoded.write(to: fileURL, options: .atomic)
            }
            return downsampled
        }

        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil

        if let image {
            memory.setObject(image, forKey: key as NSString)
        }
        return image
    }

    private func cacheKey(_ urlString: String, maxPixel: Int) -> String {
        // Имя файла из хэша адреса: сам адрес содержит символы, недопустимые
        // в пути, и бывает длиннее лимита файловой системы.
        "\(abs(urlString.hashValue))-\(maxPixel).jpg"
    }

    /// Уменьшение при декодировании — полноразмерное изображение в память
    /// не попадает вообще.
    private nonisolated static func downsample(data: Data, maxPixel: Int) -> PlatformImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }

        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ] as CFDictionary

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }

        #if canImport(UIKit)
        return UIImage(cgImage: cgImage)
        #else
        return NSImage(cgImage: cgImage, size: .zero)
        #endif
    }

    private nonisolated static func encode(_ image: PlatformImage) -> Data? {
        #if canImport(UIKit)
        return image.jpegData(compressionQuality: 0.8)
        #else
        guard
            let tiff = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff)
        else { return nil }
        return bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.8])
        #endif
    }

    /// Очистить кэш (например, из настроек).
    public func clear() {
        memory.removeAllObjects()
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
}

/// Миниатюра товара с заглушкой.
///
/// Загрузка стартует при появлении и **отменяется при исчезновении**: без
/// этого быстрая прокрутка тысячи позиций оставляет за собой сотни ненужных
/// запросов, которые забивают канал.
public struct Thumbnail: View {
    private let urlString: String?
    private let side: CGFloat
    private let cornerRadius: CGFloat
    /// Подпись для заглушки — первая буква названия читается лучше, чем
    /// одинаковая иконка на всех товарах без фото.
    private let fallbackText: String?

    @State private var image: PlatformImage?
    @State private var didFail = false

    public init(
        url: String?,
        side: CGFloat,
        cornerRadius: CGFloat = Radius.sm,
        fallbackText: String? = nil
    ) {
        self.urlString = url
        self.side = side
        self.cornerRadius = cornerRadius
        self.fallbackText = fallbackText
    }

    public var body: some View {
        Group {
            if let image {
                #if canImport(UIKit)
                Image(uiImage: image).resizable()
                #else
                Image(nsImage: image).resizable()
                #endif
            } else {
                placeholder
            }
        }
        .aspectRatio(contentMode: .fill)
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .task(id: urlString) {
            guard image == nil, !didFail else { return }
            // Просим ровно тот размер, что нужен экрану: запас на Retina — ×3.
            let loaded = await ImageCache.shared.thumbnail(for: urlString, maxPixel: Int(side * 3))
            if let loaded {
                image = loaded
            } else {
                didFail = true
            }
        }
    }

    private var placeholder: some View {
        ZStack {
            Theme.surfaceRaised
            if let letter = fallbackText?.trimmingCharacters(in: .whitespaces).first {
                Text(String(letter).uppercased())
                    .font(.system(size: side * 0.42, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.textDim)
            } else {
                Image(systemName: "shippingbox")
                    .font(.system(size: side * 0.34, weight: .light))
                    .foregroundStyle(Theme.textDim)
            }
        }
    }
}
