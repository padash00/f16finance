import Foundation

// ── Документы склада: приёмки и списания ─────────────────────────────────────

/// Строка складского документа. Форма одинакова у приёмки и списания.
public struct DocumentLine: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let unit: String
    public let quantity: Double
    public let unitCost: Double
    public let totalCost: Double
    public let comment: String?
    public let isBonus: Bool
    public let expiryDate: Date?

    /// Срок годности вышел или выйдет в ближайшую неделю.
    public var expiresSoon: Bool {
        guard let expiryDate else { return false }
        return expiryDate.timeIntervalSinceNow < 7 * 86_400
    }

    private struct ItemRef: Decodable {
        let name: String?
        let unit: String?
        let barcode: String?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        let item = (try? c.decodeIfPresent(ItemRef.self, forKey: .item)) ?? nil
        name = item?.name ?? "Товар"
        unit = item?.unit ?? "шт"
        quantity = try c.decodeFlexibleDouble(forKey: .quantity) ?? 0
        unitCost = try c.decodeFlexibleDouble(forKey: .unitCost) ?? 0

        // Сумму строки сервер считает сам, но на ручных документах её может
        // не быть — тогда выводим из количества и цены, а не показываем ноль.
        if let stored = try c.decodeFlexibleDouble(forKey: .totalCost), stored != 0 {
            totalCost = stored
        } else {
            totalCost = quantity * unitCost
        }

        comment = try c.decodeFlexibleString(forKey: .comment)
        isBonus = try c.decodeIfPresent(Bool.self, forKey: .isBonus) ?? false
        expiryDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .expiryDate))
    }

    private enum CodingKeys: String, CodingKey {
        case id, quantity, comment, item
        case unitCost = "unit_cost"
        case totalCost = "total_cost"
        case isBonus = "is_bonus"
        case expiryDate = "expiry_date"
    }
}

/// Приход товара: поставка от поставщика либо оприходование своими силами.
public struct Receipt: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let receivedAt: Date?
    public let invoiceNumber: String?
    public let comment: String?
    public let totalAmount: Double
    public let status: String
    public let cancelReason: String?
    public let locationName: String?
    public let supplierName: String?
    public let items: [DocumentLine]
    /// `supplier` — поставка по накладной, `posting` — оприходование излишков
    /// своими силами. На сайте это две разные страницы, и путать их нельзя:
    /// у поставки есть накладная и деньги поставщику, у оприходования нет.
    public let kind: String

    public var isPosting: Bool { kind == "posting" }

    public var isCancelled: Bool { status == "cancelled" || status == "canceled" }

    public var statusLabel: String {
        switch status {
        case "draft": "Черновик"
        case "posted", "completed", "done": "Проведена"
        case "cancelled", "canceled": "Отменена"
        default: status
        }
    }

    /// Позиции с истекающим сроком — то, из-за чего приёмку открывают повторно.
    public var expiring: [DocumentLine] { items.filter(\.expiresSoon) }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        receivedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .receivedAt))
        invoiceNumber = try c.decodeFlexibleString(forKey: .invoiceNumber)
        comment = try c.decodeFlexibleString(forKey: .comment)
        totalAmount = try c.decodeFlexibleDouble(forKey: .totalAmount) ?? 0
        status = try c.decodeFlexibleString(forKey: .status) ?? "posted"
        cancelReason = try c.decodeFlexibleString(forKey: .cancelReason)
        locationName = ((try? c.decodeIfPresent(NamedRef.self, forKey: .location)) ?? nil)?.name
        supplierName = ((try? c.decodeIfPresent(NamedRef.self, forKey: .supplier)) ?? nil)?.name
        items = (try? c.decodeIfPresent([DocumentLine].self, forKey: .items)) ?? []
        kind = try c.decodeFlexibleString(forKey: .kind) ?? "supplier"
    }

    private enum CodingKeys: String, CodingKey {
        case id, comment, status, location, supplier, items, kind
        case receivedAt = "received_at"
        case invoiceNumber = "invoice_number"
        case totalAmount = "total_amount"
        case cancelReason = "cancel_reason"
    }
}

/// Списание товара.
public struct Writeoff: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let writtenAt: Date?
    public let reason: String?
    public let comment: String?
    public let totalAmount: Double
    public let status: String
    public let locationName: String?
    public let companyName: String?
    public let items: [DocumentLine]

    public var isCancelled: Bool { status == "cancelled" || status == "canceled" }

    public var reasonLabel: String {
        switch reason {
        case "expired": "Истёк срок"
        case "damaged", "broken": "Порча"
        case "shortage": "Недостача"
        case "internal": "Внутреннее потребление"
        default: reason ?? "Списание"
        }
    }

    private struct LocationRef: Decodable {
        let name: String?
        let company: CompanyRef?
        struct CompanyRef: Decodable { let name: String? }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        writtenAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .writtenAt))
        reason = try c.decodeFlexibleString(forKey: .reason)
        comment = try c.decodeFlexibleString(forKey: .comment)
        totalAmount = try c.decodeFlexibleDouble(forKey: .totalAmount) ?? 0
        status = try c.decodeFlexibleString(forKey: .status) ?? "posted"
        let location = (try? c.decodeIfPresent(LocationRef.self, forKey: .location)) ?? nil
        locationName = location?.name
        companyName = location?.company?.name
        items = (try? c.decodeIfPresent([DocumentLine].self, forKey: .items)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, reason, comment, status, location, items
        case writtenAt = "written_at"
        case totalAmount = "total_amount"
    }
}

/// Ответ `GET /api/admin/store/receipts`.
public struct ReceiptList: Decodable, Sendable {
    public let receipts: [Receipt]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        receipts = (try? c.decodeIfPresent([Receipt].self, forKey: .receipts)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case receipts }

    /// Сумма проведённых приёмок. Отменённые не считаем — товар не пришёл.
    public var totalAmount: Double {
        receipts.filter { !$0.isCancelled }.reduce(0) { $0 + $1.totalAmount }
    }
}

/// Ответ `GET /api/admin/store/writeoffs`.
public struct WriteoffList: Decodable, Sendable {
    public let writeoffs: [Writeoff]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        writeoffs = (try? c.decodeIfPresent([Writeoff].self, forKey: .writeoffs)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case writeoffs }

    public var totalAmount: Double {
        writeoffs.filter { !$0.isCancelled }.reduce(0) { $0 + $1.totalAmount }
    }
}

// ── Отчёты смен: /api/admin/shifts/reports ───────────────────────────────────

/// Закрытая или открытая смена точки.
public struct ShiftReport: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let status: String
    public let shiftType: String?
    public let openedAt: Date?
    public let closedAt: Date?
    public let openingCash: Double
    public let closingCash: Double
    public let closingKaspi: Double
    public let companyName: String?
    public let hasZReport: Bool
    public let totals: Totals

    /// Итоги смены. У открытой считаются на лету из продаж.
    public struct Totals: Sendable, Hashable {
        public let sales: Double
        public let cash: Double
        public let kaspi: Double
        public let count: Int

        public static let zero = Totals(sales: 0, cash: 0, kaspi: 0, count: 0)
    }

    public var isOpen: Bool { status == "open" }

    public var statusLabel: String {
        switch status {
        case "open": "Открыта"
        case "closed": "Закрыта"
        default: status
        }
    }

    public var typeLabel: String {
        switch shiftType {
        case "day": "День"
        case "night": "Ночь"
        default: shiftType ?? "Смена"
        }
    }

    /// Расхождение по кассе: сколько должно было остаться против факта.
    ///
    /// Считаем только у закрытой смены: у открытой наличные ещё в обороте,
    /// и «недостача» на середине смены — не недостача.
    public var cashDifference: Double? {
        guard !isOpen else { return nil }
        return closingCash - (openingCash + totals.cash)
    }

    private struct NamedRef: Decodable { let name: String? }

    private struct RawTotals: Decodable {
        let sales: Double?
        let cash: Double?
        let kaspi: Double?
        let count: Int?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            sales = try c.decodeFlexibleDouble(forKey: .sales)
                ?? c.decodeFlexibleDouble(forKey: .total)
            cash = try c.decodeFlexibleDouble(forKey: .cash)
            kaspi = try c.decodeFlexibleDouble(forKey: .kaspi)
            count = Int(try c.decodeFlexibleDouble(forKey: .count) ?? 0)
        }

        private enum CodingKeys: String, CodingKey { case sales, total, cash, kaspi, count }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        status = try c.decodeFlexibleString(forKey: .status) ?? "closed"
        shiftType = try c.decodeFlexibleString(forKey: .shiftType)
        openedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .openedAt))
        closedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .closedAt))
        openingCash = try c.decodeFlexibleDouble(forKey: .openingCash) ?? 0
        closingCash = try c.decodeFlexibleDouble(forKey: .closingCash) ?? 0
        closingKaspi = try c.decodeFlexibleDouble(forKey: .closingKaspi) ?? 0
        companyName = ((try? c.decodeIfPresent(NamedRef.self, forKey: .company)) ?? nil)?.name
        hasZReport = (try c.decodeFlexibleString(forKey: .zReportURL))?.isEmpty == false

        // У закрытой смены итоги лежат в totals_json, у открытой сервер
        // досчитывает live_totals из продаж — берём то, что пришло.
        let raw = ((try? c.decodeIfPresent(RawTotals.self, forKey: .totals)) ?? nil)
            ?? ((try? c.decodeIfPresent(RawTotals.self, forKey: .liveTotals)) ?? nil)
        totals = Totals(
            sales: raw?.sales ?? 0,
            cash: raw?.cash ?? 0,
            kaspi: raw?.kaspi ?? 0,
            count: raw?.count ?? 0
        )
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, company
        case shiftType = "shift_type"
        case openedAt = "opened_at"
        case closedAt = "closed_at"
        case openingCash = "opening_cash"
        case closingCash = "closing_cash"
        case closingKaspi = "closing_kaspi"
        case totals = "totals_json"
        case liveTotals = "live_totals"
        case zReportURL = "z_report_url"
    }
}

/// Ответ `GET /api/admin/shifts/reports`.
public struct ShiftReportList: Decodable, Sendable {
    public let shifts: [ShiftReport]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shifts = (try? c.decodeIfPresent([ShiftReport].self, forKey: .shifts)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case shifts }

    public var open: [ShiftReport] { shifts.filter(\.isOpen) }
}

// ── Дни рождения: /api/admin/birthdays ───────────────────────────────────────

/// Ближайший день рождения сотрудника.
public struct Birthday: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let position: String?
    public let photoURL: String?
    public let companyName: String?
    public let daysUntil: Int
    public let age: Int?

    public var isToday: Bool { daysUntil == 0 }
    public var isThisWeek: Bool { daysUntil >= 0 && daysUntil <= 7 }

    public var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    /// «сегодня», «завтра», «через 5 дней».
    public var whenLabel: String {
        switch daysUntil {
        case 0: "сегодня"
        case 1: "завтра"
        default: "через \(daysUntil) \(pluralDays(daysUntil))"
        }
    }

    private func pluralDays(_ count: Int) -> String {
        let mod100 = count % 100
        if (11...14).contains(mod100) { return "дней" }
        return switch count % 10 {
        case 1: "день"
        case 2, 3, 4: "дня"
        default: "дней"
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Сотрудник"
        position = try c.decodeFlexibleString(forKey: .position)
        photoURL = try c.decodeFlexibleString(forKey: .photoURL)
        companyName = try c.decodeFlexibleString(forKey: .companyName)
        daysUntil = Int(try c.decodeFlexibleDouble(forKey: .daysUntil) ?? 0)
        age = (try c.decodeFlexibleDouble(forKey: .age)).map(Int.init)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, position, age
        case photoURL = "photo_url"
        case companyName = "company_name"
        case daysUntil
    }
}

/// Ответ `GET /api/admin/birthdays`.
public struct BirthdayList: Decodable, Sendable {
    public let items: [Birthday]
    public let withoutBirthDate: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = (try? c.decodeIfPresent([Birthday].self, forKey: .items)) ?? []

        let stats = (try? c.nestedContainer(keyedBy: StatsKeys.self, forKey: .stats))
        withoutBirthDate = Int((try? stats?.decodeFlexibleDouble(forKey: .withoutBirthDate)) as? Double ?? 0)
    }

    private enum CodingKeys: String, CodingKey { case items, stats }
    private enum StatsKeys: String, CodingKey { case withoutBirthDate }

    public var today: [Birthday] { items.filter(\.isToday) }
    public var thisWeek: [Birthday] { items.filter { $0.isThisWeek && !$0.isToday } }
}
