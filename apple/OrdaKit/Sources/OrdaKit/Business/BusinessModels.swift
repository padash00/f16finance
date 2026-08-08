import Foundation

// ── Дашборд: /api/admin/dashboard ────────────────────────────────────────────

/// Выручка за день с разбивкой по способам оплаты.
public struct DayRevenue: Decodable, Sendable, Hashable {
    public let total: Double
    public let count: Int
    public let cash: Double
    public let kaspi: Double
    public let card: Double
    public let online: Double

    public static let zero = DayRevenue(total: 0, count: 0, cash: 0, kaspi: 0, card: 0, online: 0)

    public init(total: Double, count: Int, cash: Double, kaspi: Double, card: Double, online: Double) {
        self.total = total
        self.count = count
        self.cash = cash
        self.kaspi = kaspi
        self.card = card
        self.online = online
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = try c.decodeIfPresent(Double.self, forKey: .total) ?? 0
        count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 0
        cash = try c.decodeIfPresent(Double.self, forKey: .cash) ?? 0
        kaspi = try c.decodeIfPresent(Double.self, forKey: .kaspi) ?? 0
        card = try c.decodeIfPresent(Double.self, forKey: .card) ?? 0
        online = try c.decodeIfPresent(Double.self, forKey: .online) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case total, count, cash, kaspi, card, online }
}

/// Товар с остатком ниже порога.
public struct LowStockItem: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let threshold: Double
    public let balance: Double

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Товар"
        threshold = try c.decodeIfPresent(Double.self, forKey: .threshold) ?? 0
        balance = try c.decodeIfPresent(Double.self, forKey: .balance) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case id, name, threshold, balance }
}

/// Товар из топа продаж.
public struct TopItem: Decodable, Sendable, Identifiable, Hashable {
    public let itemID: String
    public let name: String
    public let quantity: Double

    public var id: String { itemID }

    private enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case name
        case quantity = "qty"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        itemID = try c.decodeIfPresent(String.self, forKey: .itemID) ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Товар"
        quantity = try c.decodeIfPresent(Double.self, forKey: .quantity) ?? 0
    }
}

/// Ответ `GET /api/admin/dashboard`.
public struct BusinessDashboard: Decodable, Sendable {
    public let today: DayRevenue
    public let yesterdayTotal: Double
    /// Изменение к вчера в процентах. `nil`, если вчера нуль — рост «с нуля»
    /// не процент, а отсутствие базы.
    public let changePercent: Double?
    public let monthTotal: Double
    /// Выручка по дням недели: ISO-дата → сумма.
    public let weekByDay: [String: Double]
    public let topItems: [TopItem]
    public let lowStock: [LowStockItem]

    private enum RootKeys: String, CodingKey { case data }
    private enum DataKeys: String, CodingKey {
        case today, yesterday, change_percent, month_total, week_by_day, top_items, low_stock
    }
    private struct Yesterday: Decodable { let total: Double? }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let data = try root.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
        today = try data.decodeIfPresent(DayRevenue.self, forKey: .today) ?? .zero
        yesterdayTotal = (try data.decodeIfPresent(Yesterday.self, forKey: .yesterday))?.total ?? 0
        changePercent = try data.decodeIfPresent(Double.self, forKey: .change_percent)
        monthTotal = try data.decodeIfPresent(Double.self, forKey: .month_total) ?? 0
        weekByDay = try data.decodeIfPresent([String: Double].self, forKey: .week_by_day) ?? [:]
        topItems = try data.decodeIfPresent([TopItem].self, forKey: .top_items) ?? []
        lowStock = try data.decodeIfPresent([LowStockItem].self, forKey: .low_stock) ?? []
    }

    /// Неделя по дням в хронологическом порядке.
    public var weekSeries: [(date: String, amount: Double)] {
        weekByDay.keys.sorted().map { ($0, weekByDay[$0] ?? 0) }
    }
}

// ── Расходы на одобрении: /api/admin/expenses/pending ────────────────────────

/// Расход, ожидающий решения владельца.
public struct PendingExpense: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let date: String?
    public let category: String?
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let comment: String?
    public let payee: String?
    public let reason: String?
    public let companyID: String?

    public var total: Double { cashAmount + kaspiAmount }

    private enum CodingKeys: String, CodingKey {
        case id, date, category, comment
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case payee = "one_off_payee"
        case reason = "one_off_reason"
        case companyID = "company_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        date = try c.decodeIfPresent(String.self, forKey: .date)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        cashAmount = try c.decodeIfPresent(Double.self, forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeIfPresent(Double.self, forKey: .kaspiAmount) ?? 0
        comment = try c.decodeIfPresent(String.self, forKey: .comment)
        payee = try c.decodeIfPresent(String.self, forKey: .payee)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        companyID = try c.decodeIfPresent(String.self, forKey: .companyID)
    }
}

// ── Доходы и расходы ─────────────────────────────────────────────────────────

/// Строка дохода за смену.
public struct IncomeRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let date: String
    public let shift: String?
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let onlineAmount: Double
    public let cardAmount: Double
    public let comment: String?
    public let companyID: String?

    public var total: Double { cashAmount + kaspiAmount + onlineAmount + cardAmount }

    private enum CodingKeys: String, CodingKey {
        case id, date, shift, comment
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case onlineAmount = "online_amount"
        case cardAmount = "card_amount"
        case companyID = "company_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        shift = try c.decodeIfPresent(String.self, forKey: .shift)
        cashAmount = try c.decodeIfPresent(Double.self, forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeIfPresent(Double.self, forKey: .kaspiAmount) ?? 0
        onlineAmount = try c.decodeIfPresent(Double.self, forKey: .onlineAmount) ?? 0
        cardAmount = try c.decodeIfPresent(Double.self, forKey: .cardAmount) ?? 0
        companyID = try c.decodeIfPresent(String.self, forKey: .companyID)
        comment = try c.decodeIfPresent(String.self, forKey: .comment)
    }
}

/// Строка расхода.
public struct ExpenseRow: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let date: String
    public let category: String?
    public let cashAmount: Double
    public let kaspiAmount: Double
    public let comment: String?
    public let status: String?
    public let companyID: String?

    public var total: Double { cashAmount + kaspiAmount }
    public var isPending: Bool { status == "pending_approval" }

    private enum CodingKeys: String, CodingKey {
        case id, date, category, comment, status
        case cashAmount = "cash_amount"
        case kaspiAmount = "kaspi_amount"
        case companyID = "company_id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        category = try c.decodeIfPresent(String.self, forKey: .category)
        cashAmount = try c.decodeIfPresent(Double.self, forKey: .cashAmount) ?? 0
        kaspiAmount = try c.decodeIfPresent(Double.self, forKey: .kaspiAmount) ?? 0
        comment = try c.decodeIfPresent(String.self, forKey: .comment)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        companyID = try c.decodeIfPresent(String.self, forKey: .companyID)
    }
}

/// Точка (компания) организации.
public struct Company: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let code: String?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "Точка"
        code = try c.decodeIfPresent(String.self, forKey: .code)
    }

    private enum CodingKeys: String, CodingKey { case id, name, code }
}

/// Обёртка `{ "data": [...] }` — общая форма списочных админских ответов.
public struct DataList<Element: Decodable & Sendable>: Decodable, Sendable {
    public let items: [Element]

    private enum CodingKeys: String, CodingKey { case data }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decodeIfPresent([Element].self, forKey: .data) ?? []
    }
}
