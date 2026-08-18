import Foundation

/// Последний удачный ответ на каждый GET — на диске.
///
/// Приложение, которое на каждом экране показывает скелет и ждёт сеть, не
/// ощущается приложением: у человека в клубе интернет через телефон соседа, и
/// полсекунды превращаются в три. При этом почти всё, что он открывает, он уже
/// видел минуту назад.
///
/// Поэтому храним сырой ответ, а не разобранную модель: модели у нас только
/// `Decodable`, и заводить им вторую половину ради кэша значило бы держать в
/// синхроне два описания одного и того же.
///
/// Кэш — не источник правды: экран рисует его сразу и тут же уходит за
/// свежими данными. Устаревшее показывается ровно до первого ответа сервера.
public actor ResponseCache {
    private let directory: URL
    private let maximumAge: TimeInterval

    /// Сутки. Данные старше суток скорее собьют с толку, чем помогут: смена
    /// давно закрыта, остатки другие.
    public init(directory: URL? = nil, maximumAge: TimeInterval = 24 * 60 * 60) {
        let base = directory ?? FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("orda-responses", isDirectory: true)
        self.directory = base
        self.maximumAge = maximumAge
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    /// Ключ — путь и параметры: один и тот же экран с другой неделей это
    /// другой ответ, и путать их нельзя.
    private func fileName(for request: APIRequest) -> String {
        let query = request.query
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "&")
        let raw = query.isEmpty ? request.path : "\(request.path)?\(query)"
        // Имя файла из пути: слэши и знаки вопроса в нём жить не могут.
        let safe = raw.unicodeScalars.map { scalar -> String in
            CharacterSet.alphanumerics.contains(scalar) ? String(scalar) : "-"
        }.joined()
        return String(safe.suffix(180))
    }

    private func url(for request: APIRequest) -> URL {
        directory.appendingPathComponent(fileName(for: request))
    }

    public func store(_ data: Data, for request: APIRequest) {
        guard request.method == .get, !data.isEmpty else { return }
        try? data.write(to: url(for: request), options: .atomic)
    }

    public func data(for request: APIRequest) -> Data? {
        let file = url(for: request)
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              let modified = attributes[.modificationDate] as? Date,
              Date().timeIntervalSince(modified) < maximumAge
        else { return nil }
        return try? Data(contentsOf: file)
    }

    /// Всё стереть. Зовётся при выходе из аккаунта: следующий вошедший не
    /// должен увидеть чужую выручку, пока грузится своя.
    public func clear() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files { try? FileManager.default.removeItem(at: file) }
    }
}
