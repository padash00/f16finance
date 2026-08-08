import Foundation

/// Адреса и ключи. Читаются из Info.plist, куда попадают из `Config.xcconfig`,
/// чтобы не хранить их в исходниках и различать окружения (прод / стенд).
struct AppConfiguration: Sendable {
    let apiBaseURL: URL

    static let current: AppConfiguration = {
        let bundle = Bundle.main

        func string(_ key: String, fallback: String) -> String {
            let value = (bundle.object(forInfoDictionaryKey: key) as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return value.isEmpty ? fallback : value
        }

        // xcconfig не умеет хранить `//`, поэтому схема в Info.plist задана
        // отдельно от хоста — собираем адрес здесь.
        func url(_ key: String, fallback: String) -> URL {
            let raw = string(key, fallback: fallback)
            let normalized = raw.hasPrefix("http") ? raw : "https://\(raw)"
            return URL(string: normalized) ?? URL(string: fallback)!
        }

        return AppConfiguration(
            apiBaseURL: url("ORDA_API_BASE_URL", fallback: "https://www.ordaops.kz")
        )
    }()

    /// Адрес сайта для показа на экране входа — чтобы при отладке было видно,
    /// в какое окружение стучится сборка.
    var displayHost: String {
        apiBaseURL.host() ?? apiBaseURL.absoluteString
    }
}
