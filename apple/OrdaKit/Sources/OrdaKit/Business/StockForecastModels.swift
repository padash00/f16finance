import Foundation

/// Прогноз запаса: `GET /api/admin/inventory/forecast`.
///
/// Сервер считает скорость расхода за последние 30 дней и делит на неё
/// остаток. Ответ на вопрос «что закончится раньше всего» — и это другой
/// вопрос, чем «что продаётся лучше всего» из аналитики магазина, хотя оба
/// пункта меню вели на один экран.
public struct StockForecastRow: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let categoryName: String?
    public let balance: Double
    /// Сколько уходит в день. Ноль означает, что за период не продавали.
    public let dailyVelocity: Double
    /// На сколько дней хватит. `nil` — расхода не было, делить не на что.
    public let daysLeft: Int?
    public let threshold: Double?
    /// `critical` ≤ 3 дней, `warning` ≤ 7, `low` ≤ 14, `no_sales`, `ok`.
    public let status: String

    public var id: String { itemID }

    public var statusLabel: String {
        switch status {
        case "critical": "Кончается"
        case "warning": "На исходе"
        case "low": "Пора заказать"
        case "no_sales": "Не продаётся"
        default: "Хватает"
        }
    }

    /// Требует действия прямо сейчас.
    public var isUrgent: Bool { status == "critical" || status == "warning" }

    private enum CodingKeys: String, CodingKey {
        case name, category, balance, threshold, status
        case itemID = "item_id"
        case dailyVelocity = "daily_velocity"
        case daysLeft = "days_left"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemID = try c.decodeFlexibleString(forKey: .itemID) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без названия"
        categoryName = try c.decodeFlexibleString(forKey: .category)
        balance = try c.decodeFlexibleDouble(forKey: .balance) ?? 0
        dailyVelocity = try c.decodeFlexibleDouble(forKey: .dailyVelocity) ?? 0
        daysLeft = try c.decodeIfPresent(Int.self, forKey: .daysLeft)
        threshold = try c.decodeFlexibleDouble(forKey: .threshold)
        status = try c.decodeFlexibleString(forKey: .status) ?? "ok"
    }
}
