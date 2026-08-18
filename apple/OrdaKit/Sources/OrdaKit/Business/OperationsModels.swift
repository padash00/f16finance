import Foundation

// ── Ревизии: /api/admin/store/revisions ──────────────────────────────────────

/// Пересчёт остатков: сколько система ждала и сколько нашли.
public struct Stocktake: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let countedAt: Date?
    public let comment: String?
    public let locationName: String?
    public let companyName: String?
    public let authorName: String?
    public let items: [Line]

    /// Строка ревизии по одному товару.
    public struct Line: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let name: String
        public let unit: String
        public let expected: Double
        public let actual: Double
        public let delta: Double
        public let price: Double

        /// Расхождение в деньгах. Недостача отрицательна, излишек положителен.
        public var amount: Double { delta * price }

        public var isShortage: Bool { delta < 0 }
        public var isMatch: Bool { delta == 0 }

        private struct ItemRef: Decodable {
            let name: String?
            let unit: String?
            let salePrice: Double?
            let purchasePrice: Double?

            private enum CodingKeys: String, CodingKey {
                case name, unit
                case salePrice = "sale_price"
                case purchasePrice = "default_purchase_price"
            }

            init(from decoder: any Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                name = try c.decodeFlexibleString(forKey: .name)
                unit = try c.decodeFlexibleString(forKey: .unit)
                salePrice = try c.decodeFlexibleDouble(forKey: .salePrice)
                purchasePrice = try c.decodeFlexibleDouble(forKey: .purchasePrice)
            }
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
            let item = try? c.decodeIfPresent(ItemRef.self, forKey: .item)
            name = item?.name ?? "Товар"
            unit = item?.unit ?? "шт"
            expected = try c.decodeFlexibleDouble(forKey: .expected) ?? 0
            actual = try c.decodeFlexibleDouble(forKey: .actual) ?? 0

            // Сервер считает разницу сам, но на старых записях её может не
            // быть — тогда выводим из пересчёта, а не показываем ноль.
            if let stored = try c.decodeFlexibleDouble(forKey: .delta) {
                delta = stored
            } else {
                delta = actual - expected
            }

            // Недостачу оцениваем по закупочной цене: потеря для владельца —
            // то, что он заплатил, а не то, за сколько мог продать.
            price = item?.purchasePrice ?? item?.salePrice ?? 0
        }

        private enum CodingKeys: String, CodingKey {
            case id, item
            case expected = "expected_qty"
            case actual = "actual_qty"
            case delta = "delta_qty"
        }
    }

    /// Позиции, где нашли не то, что ждали.
    public var mismatches: [Line] {
        items.filter { !$0.isMatch }.sorted { abs($0.amount) > abs($1.amount) }
    }

    /// Итог расхождения в деньгах.
    public var totalAmount: Double {
        items.reduce(0) { $0 + $1.amount }
    }

    public var shortageAmount: Double {
        items.filter(\.isShortage).reduce(0) { $0 + abs($1.amount) }
    }

    private struct LocationRef: Decodable {
        let name: String?
        let company: CompanyRef?

        struct CompanyRef: Decodable { let name: String? }
    }

    private struct ActorRef: Decodable {
        let fullName: String?
        private enum CodingKeys: String, CodingKey { case fullName = "full_name" }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        countedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .countedAt))
        comment = try c.decodeFlexibleString(forKey: .comment)
        let location = (try? c.decodeIfPresent(LocationRef.self, forKey: .location)) ?? nil
        locationName = location?.name
        companyName = location?.company?.name
        authorName = ((try? c.decodeIfPresent(ActorRef.self, forKey: .author)) ?? nil)?.fullName
        items = (try? c.decodeIfPresent([Line].self, forKey: .items)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, comment, location, items
        case countedAt = "counted_at"
        case author = "created_by_staff"
    }
}

/// Ответ `GET /api/admin/store/revisions`.
public struct RevisionList: Decodable, Sendable {
    public let stocktakes: [Stocktake]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stocktakes = (try? c.decodeIfPresent([Stocktake].self, forKey: .stocktakes)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case stocktakes }
}

// ── Сотрудники: /api/admin/staff ─────────────────────────────────────────────

/// Административный сотрудник — в отличие от оператора, на окладе.
public struct StaffMember: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let fullName: String
    public let shortName: String?
    public let role: String
    public let monthlySalary: Double
    public let isActive: Bool
    public let phone: String?
    public let email: String?

    public var roleLabel: String {
        switch role {
        case "owner": "Владелец"
        case "manager": "Управляющий"
        case "accountant": "Бухгалтер"
        case "other": "Сотрудник"
        default: role
        }
    }

    public var initials: String {
        let parts = fullName.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        fullName = try c.decodeFlexibleString(forKey: .fullName) ?? "Сотрудник"
        shortName = try c.decodeFlexibleString(forKey: .shortName)
        role = try c.decodeFlexibleString(forKey: .role) ?? "other"
        monthlySalary = try c.decodeFlexibleDouble(forKey: .monthlySalary) ?? 0
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive) ?? true
        phone = try c.decodeFlexibleString(forKey: .phone)
        email = try c.decodeFlexibleString(forKey: .email)
    }

    private enum CodingKeys: String, CodingKey {
        case id, role, phone, email
        case fullName = "full_name"
        case shortName = "short_name"
        case monthlySalary = "monthly_salary"
        case isActive = "is_active"
    }
}

/// Выплата сотруднику.
public struct StaffPayment: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let staffID: String
    public let payDate: Date?
    public let amount: Double
    public let comment: String?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        staffID = try c.decodeFlexibleString(forKey: .staffID) ?? ""
        payDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .payDate))
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        comment = try c.decodeFlexibleString(forKey: .comment)
    }

    private enum CodingKeys: String, CodingKey {
        case id, amount, comment
        case staffID = "staff_id"
        case payDate = "pay_date"
    }
}

/// Ответ `GET /api/admin/staff`.
public struct StaffList: Decodable, Sendable {
    public let staff: [StaffMember]
    public let payments: [StaffPayment]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        staff = (try? c.decodeIfPresent([StaffMember].self, forKey: .staff)) ?? []
        payments = (try? c.decodeIfPresent([StaffPayment].self, forKey: .payments)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case staff, payments }

    /// Выплачено сотруднику за текущий месяц.
    public func paidThisMonth(_ staffID: String, now: Date = Date()) -> Double {
        let calendar = Calendar.current
        return payments
            .filter { $0.staffID == staffID }
            .filter { payment in
                guard let date = payment.payDate else { return false }
                return calendar.isDate(date, equalTo: now, toGranularity: .month)
            }
            .reduce(0) { $0 + $1.amount }
    }
}

// ── Поставщики: /api/admin/store/suppliers ───────────────────────────────────

/// Поставщик с историей приёмок и открытыми долгами.
public struct Supplier: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let organizationName: String?
    public let binIIN: String?
    public let contactName: String?
    public let phone: String?
    public let receiptsCount: Int
    public let receiptsTotal: Double
    public let lastReceiptDate: Date?
    public let openDebtsCount: Int
    public let openDebtsAmount: Double

    public var hasDebt: Bool { openDebtsAmount > 0 }

    public var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Поставщик"
        organizationName = try c.decodeFlexibleString(forKey: .organizationName)
        binIIN = try c.decodeFlexibleString(forKey: .binIIN)
        contactName = try c.decodeFlexibleString(forKey: .contactName)
        phone = try c.decodeFlexibleString(forKey: .phone)
        receiptsCount = Int(try c.decodeFlexibleDouble(forKey: .receiptsCount) ?? 0)
        receiptsTotal = try c.decodeFlexibleDouble(forKey: .receiptsTotal) ?? 0
        lastReceiptDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .lastReceiptDate))
        openDebtsCount = Int(try c.decodeFlexibleDouble(forKey: .openDebtsCount) ?? 0)
        openDebtsAmount = try c.decodeFlexibleDouble(forKey: .openDebtsAmount) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, phone
        case organizationName = "organization_name"
        case binIIN = "bin_iin"
        case contactName = "contact_name"
        case receiptsCount = "receipts_count"
        case receiptsTotal = "receipts_total"
        case lastReceiptDate = "last_receipt_date"
        case openDebtsCount = "open_debts_count"
        case openDebtsAmount = "open_debts_sum"
    }
}

/// Ответ `GET /api/admin/store/suppliers`.
public struct SupplierList: Decodable, Sendable {
    public let suppliers: [Supplier]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        suppliers = (try? c.decodeIfPresent([Supplier].self, forKey: .suppliers)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case suppliers }

    public var totalDebt: Double {
        suppliers.reduce(0) { $0 + $1.openDebtsAmount }
    }
}

// ── Акты ревизии: /api/admin/store/audit ─────────────────────────────────────

/// Акт пересчёта глазами владельца: то, что считают сейчас или уже посчитали.
///
/// Отличается от `Stocktake`: тот — результат, уже проведённый и попавший в
/// остатки. Акт — процесс, и с ним можно что-то сделать: отменить открытый по
/// ошибке или откатить проведённый.
///
/// Имя не `AuditAct` намеренно: так называется акт в операторском контуре, где
/// у него другой состав полей — оператору не нужны ни статус проведения, ни
/// доля посчитанного по всей точке.
public struct RevisionAct: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let status: String
    public let comment: String?
    public let locationName: String
    public let openedAt: Date?
    public let closedAt: Date?
    /// Сколько позиций в снимке и сколько уже посчитано.
    public let totalItems: Int
    public let countedItems: Int

    public var isOpen: Bool { status == "open" }
    public var isClosed: Bool { status == "closed" }
    public var isCancelled: Bool { status == "cancelled" }

    public var statusLabel: String {
        switch status {
        case "open": "Идёт пересчёт"
        case "closed": "Проведён"
        case "cancelled": "Отменён"
        default: status
        }
    }

    /// Доля посчитанного. `nil` — снимок пуст, делить не на что.
    public var progress: Double? {
        guard totalItems > 0 else { return nil }
        return Double(countedItems) / Double(totalItems)
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, comment, locationName, totalItems, countedItems
        case openedAt = "opened_at"
        case closedAt = "closed_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        status = try c.decodeFlexibleString(forKey: .status) ?? "open"
        comment = try c.decodeFlexibleString(forKey: .comment)
        locationName = try c.decodeFlexibleString(forKey: .locationName) ?? "—"
        openedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .openedAt))
        closedAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .closedAt))
        totalItems = Int(try c.decodeFlexibleDouble(forKey: .totalItems) ?? 0)
        countedItems = Int(try c.decodeFlexibleDouble(forKey: .countedItems) ?? 0)
    }
}

// ── Движения товара: /api/admin/store/movements ──────────────────────────────

/// Полная история движений: `{ data: { movements: [...] } }`.
///
/// Сводка склада отдаёт только шестнадцать последних движений — этого хватает
/// на «что было сейчас», но не на «куда делись двадцать кол». Отдельный
/// маршрут отдаёт сто шестьдесят и умеет фильтр по складу или витрине.
///
/// Модель строки — та же `StockMovement`, что и в сводке: поля у ответов
/// одинаковые, и второе описание разошлось бы с первым на первой же правке.
public struct StoreMovementList: Decodable, Sendable {
    public let movements: [StockMovement]

    /// Разбираем через вложенный тип, а не через `nestedContainer`.
    ///
    /// На `nestedContainer` с последующим `decodeIfPresent([StockMovement])`
    /// тест падал с обращением к чужой памяти — воспроизводилось стабильно и
    /// только на этой паре. Обычный вложенный `Decodable` делает то же самое и
    /// работает; спорить с компилятором дороже, чем описать данные прямо.
    private struct Payload: Decodable {
        let movements: [StockMovement]?
    }

    private enum RootKeys: String, CodingKey { case data }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        movements = (try root.decodeIfPresent(Payload.self, forKey: .data))?.movements ?? []
    }
}
