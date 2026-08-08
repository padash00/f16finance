import Foundation

/// Способ тарификации модуля.
public enum AddonBilling: String, Codable, Sendable {
    case flat
    case per_operator
    case per_station
    case per_company
    case flag
}

/// Продаваемый модуль. Организация либо купила его, либо нет — и это
/// ортогонально правам: у сотрудника может быть `store-catalog.view`,
/// но если организация не оплатила «Магазин», раздела не существует вовсе.
public struct Addon: Codable, Sendable, Hashable, Identifiable {
    public let code: String
    public let name: String
    public let description: String
    /// Префиксы маршрутов, входящих в модуль.
    public let pages: [String]
    /// Все feature-коды, которые модуль выдаёт организации (включая легаси).
    public let grants: [String]
    public let priceKzt: Int
    public let billing: AddonBilling

    public var id: String { code }

    public init(
        code: String,
        name: String,
        description: String,
        pages: [String],
        grants: [String],
        priceKzt: Int,
        billing: AddonBilling
    ) {
        self.code = code
        self.name = name
        self.description = description
        self.pages = pages
        self.grants = grants
        self.priceKzt = priceKzt
        self.billing = billing
    }
}

/// Каталог модулей — зеркало `lib/core/addons.ts`.
public enum AddonCatalog {
    public static var addons: [Addon] { generatedAddons }

    private static let byCode: [String: Addon] = Dictionary(
        generatedAddons.map { ($0.code, $0) },
        uniquingKeysWith: { first, _ in first }
    )

    public static func addon(code: String) -> Addon? { byCode[code] }

    /// Модуль, которому принадлежит маршрут. Зеркало `getAddonForPath`.
    public static func addonCode(forPath path: String) -> String? {
        let clean = String(
            path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
        )
        for addon in generatedAddons {
            for page in addon.pages where clean == page || clean.hasPrefix(page + "/") {
                return addon.code
            }
        }
        return nil
    }

    /// Все feature-коды, которые даёт набор модулей. Зеркало `grantsForAddonCodes`.
    /// Неизвестный код пропускается как есть — обратная совместимость с вебом.
    public static func grants(forCodes codes: [String]) -> Set<String> {
        var result: Set<String> = []
        for code in codes {
            if let addon = byCode[code] {
                result.formUnion(addon.grants)
            } else {
                result.insert(code)
            }
        }
        return result
    }
}
