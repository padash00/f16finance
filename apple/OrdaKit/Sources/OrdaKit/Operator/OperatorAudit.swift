import Foundation

/// Акт ревизии, на который назначен оператор.
///
/// Оператор не начинает ревизию сам: акт открывает управляющий и назначает
/// кассиров на секции (категории товара). Оператор видит только свои акты и
/// считает только позиции своей секции — сервер это проверяет.
public struct AuditAct: Decodable, Sendable, Identifiable, Hashable {
    public let actID: String
    public let locationName: String
    public let comment: String?
    public let openedAt: Date?
    /// Что именно поручено считать: «Вся локация» или перечень категорий.
    public let sectionLabel: String

    public var id: String { actID }

    private enum CodingKeys: String, CodingKey {
        case actID = "act_id"
        case locationName
        case comment
        case openedAt = "opened_at"
        case sectionLabel
    }
}

/// Список актов — ответ `GET /api/operator/audit`.
public struct AuditActList: Decodable, Sendable {
    public let acts: [AuditAct]

    private enum CodingKeys: String, CodingKey { case data }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        acts = try container.decodeIfPresent([AuditAct].self, forKey: .data) ?? []
    }
}

/// Режим подсчёта.
public enum AuditMode: String, Decodable, Sendable {
    /// Совместный счёт: видно, что позицию уже посчитал коллега.
    case single
    /// Двойной слепой: чужие цифры скрыты, иначе смысл теряется.
    case double
}

/// Позиция акта для подсчёта.
///
/// Системного остатка здесь нет намеренно — счёт слепой. Иначе кассир видит
/// ожидаемое число и «подгоняет» под него, а ревизия перестаёт что-либо
/// показывать.
public struct AuditItem: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let barcode: String?
    public let unit: String?
    /// Мой подсчёт. `nil` — ещё не считал.
    public var counted: Double?
    /// Подсчёт коллеги (только в совместном режиме).
    public let otherQuantity: Double?
    public let otherBy: String?

    public var id: String { itemID }
    public var isCounted: Bool { counted != nil }
    public var isCountedByColleague: Bool { otherQuantity != nil }

    private enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case name, barcode, unit, counted
        case otherQuantity = "otherQty"
        case otherBy
    }
}

/// Содержимое акта — ответ `GET /api/operator/audit?act=<id>`.
public struct AuditSheet: Decodable, Sendable {
    public let actID: String
    public let mode: AuditMode
    public let items: [AuditItem]

    private enum RootKeys: String, CodingKey { case data }
    private enum DataKeys: String, CodingKey { case act_id, mode, items }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let data = try root.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        actID = try data.decodeIfPresent(String.self, forKey: .act_id) ?? ""
        mode = (try? data.decodeIfPresent(AuditMode.self, forKey: .mode)) ?? .single
        items = try data.decodeIfPresent([AuditItem].self, forKey: .items) ?? []
    }

    public var countedCount: Int { items.filter(\.isCounted).count }
    public var progress: Double {
        items.isEmpty ? 0 : Double(countedCount) / Double(items.count)
    }
}

/// Один подсчёт для отправки.
public struct AuditCount: Codable, Sendable, Hashable {
    public let itemID: String
    public let countedQuantity: Double

    public init(itemID: String, countedQuantity: Double) {
        self.itemID = itemID
        self.countedQuantity = countedQuantity
    }

    private enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case countedQuantity = "counted_qty"
    }
}

/// Результат сохранения подсчётов.
public struct AuditSaveResult: Decodable, Sendable {
    public let saved: Int

    private enum RootKeys: String, CodingKey { case data }
    private enum DataKeys: String, CodingKey { case saved }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let data = try root.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        saved = try data.decodeIfPresent(Int.self, forKey: .saved) ?? 0
    }
}
