import Foundation

/// Уровень опасности действия. Права уровня `.high` (их 106 в каталоге) —
/// необратимые операции: «Удалить весь каталог», «Выгрузить логины и пароли»,
/// «Списать долг». Интерфейс подтверждает их биометрией.
public enum CapabilitySeverity: String, Codable, Sendable, CaseIterable {
    case low
    case medium
    case high
}

/// Одно право. ID всегда вида `<page>.<action>` — например `income.create`.
public struct Capability: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let label: String
    public let description: String?
    public let severity: CapabilitySeverity
    /// Права, без которых это не имеет смысла. Веб включает их вместе.
    public let deps: [String]

    public init(
        id: String,
        label: String,
        description: String? = nil,
        severity: CapabilitySeverity = .low,
        deps: [String] = []
    ) {
        self.id = id
        self.label = label
        self.description = description
        self.severity = severity
        self.deps = deps
    }

    /// `income.create` → `income`. Страница, к которой относится право.
    public var pageID: String {
        guard let dot = id.firstIndex(of: ".") else { return id }
        return String(id[id.startIndex..<dot])
    }

    /// `income.create` → `create`.
    public var action: String {
        guard let dot = id.firstIndex(of: ".") else { return "" }
        return String(id[id.index(after: dot)...])
    }
}

/// Страница системы со всеми доступными на ней действиями.
public struct CapabilityPage: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let path: String
    /// Альтернативные маршруты той же страницы (`/income/add`, `/income/analytics`).
    public let extraPaths: [String]
    public let label: String
    public let capabilities: [Capability]

    public init(
        id: String,
        path: String,
        extraPaths: [String] = [],
        label: String,
        capabilities: [Capability]
    ) {
        self.id = id
        self.path = path
        self.extraPaths = extraPaths
        self.label = label
        self.capabilities = capabilities
    }

    /// Право на просмотр страницы. Именно его проверяет серверный proxy.
    public var viewCapabilityID: String { "\(id).view" }

    public var allPaths: [String] { [path] + extraPaths }
}

/// Раздел настроек доступа (9 штук: Финансы, Склад, Смены, Персонал, …).
public struct CapabilityGroup: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let label: String
    public let pages: [CapabilityPage]

    public init(id: String, label: String, pages: [CapabilityPage]) {
        self.id = id
        self.label = label
        self.pages = pages
    }
}

/// Каталог прав — зеркало `lib/core/capabilities.ts`.
///
/// Содержимое генерируется скриптом `scripts/export-capabilities.mjs` в
/// `Generated/CapabilityCatalog+Generated.swift`. Руками сюда ничего не
/// добавляем: CI падает, если сгенерированное разошлось с вебом.
public enum CapabilityCatalog {
    public static var groups: [CapabilityGroup] { generatedGroups }

    /// Все страницы каталога, без группировки.
    public static let allPages: [CapabilityPage] = generatedGroups.flatMap(\.pages)

    /// Все ID прав. Порядок совпадает с вебом.
    public static let allCapabilityIDs: [String] = allPages
        .flatMap(\.capabilities)
        .map(\.id)

    private static let pagesByID: [String: CapabilityPage] = Dictionary(
        allPages.map { ($0.id, $0) },
        uniquingKeysWith: { first, _ in first }
    )

    private static let capabilitiesByID: [String: Capability] = Dictionary(
        allPages.flatMap(\.capabilities).map { ($0.id, $0) },
        uniquingKeysWith: { first, _ in first }
    )

    /// Индекс «маршрут → страница». Строится один раз, включая extraPaths.
    private static let pagesByPath: [String: CapabilityPage] = {
        var index: [String: CapabilityPage] = [:]
        for page in allPages {
            for path in page.allPaths where index[path] == nil {
                index[path] = page
            }
        }
        return index
    }()

    public static func page(id: String) -> CapabilityPage? { pagesByID[id] }

    public static func capability(id: String) -> Capability? { capabilitiesByID[id] }

    public static func group(id: String) -> CapabilityGroup? {
        generatedGroups.first { $0.id == id }
    }

    /// Страница по маршруту. Query и fragment отбрасываются — как в вебе.
    public static func page(path: String) -> CapabilityPage? {
        let clean = path
            .split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
            .split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]
        return pagesByPath[String(clean)]
    }

    /// Право и все его зависимости, рекурсивно. Зеркало `expandCapabilityDeps`.
    public static func expandingDeps(_ id: String, visited: inout Set<String>) -> [String] {
        guard !visited.contains(id) else { return [] }
        visited.insert(id)
        guard let capability = capabilitiesByID[id] else { return [id] }
        var result = [id]
        for dep in capability.deps {
            result.append(contentsOf: expandingDeps(dep, visited: &visited))
        }
        return result
    }

    public static func expandingDeps(_ id: String) -> [String] {
        var visited: Set<String> = []
        return expandingDeps(id, visited: &visited)
    }

    public static var summary: (groups: Int, pages: Int, capabilities: Int) {
        (generatedGroups.count, allPages.count, allCapabilityIDs.count)
    }
}
