import Foundation

// ── Подписка: /api/admin/my-subscription ─────────────────────────────────────

/// Тариф организации, подключённые модули и счета.
public struct OrganizationBilling: Decodable, Sendable {
    public let organizationName: String?
    public let primaryDomain: String?
    public let organizationStatus: String?
    public let subscription: Subscription?
    public let package: Package?
    public let addons: [Package]
    public let monthlyTotal: Double
    public let invoices: [Invoice]

    public struct Subscription: Decodable, Sendable, Hashable {
        public let status: String
        public let billingPeriod: String?
        public let startsAt: Date?
        public let endsAt: Date?
        public let planName: String?
        public let priceMonthly: Double?

        public var statusLabel: String {
            switch status {
            case "active": "Активна"
            case "trialing": "Пробный период"
            case "past_due": "Просрочена"
            case "canceled", "cancelled": "Отменена"
            default: StatusText.humanize(status)
            }
        }

        /// Сколько дней осталось. Отрицательное — уже просрочено, поэтому
        /// возвращаем как есть: экран сам решит, тревожиться или нет.
        public var daysLeft: Int? {
            guard let endsAt else { return nil }
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: Date())
            return calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: endsAt)).day
        }

        private struct PlanRef: Decodable {
            let code: String?
            let name: String?
            let priceMonthly: Double?
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            status = try c.decodeFlexibleString(forKey: .status) ?? "unknown"
            billingPeriod = try c.decodeFlexibleString(forKey: .billingPeriod)
            startsAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .startsAt))
            endsAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .endsAt))
            let plan = try? c.decodeIfPresent(PlanRef.self, forKey: .plan)
            planName = plan?.name
            priceMonthly = plan?.priceMonthly
        }

        private enum CodingKeys: String, CodingKey {
            case status, billingPeriod, startsAt, endsAt, plan
        }
    }

    /// Пакет или подключённый модуль — форма одинаковая.
    public struct Package: Decodable, Sendable, Identifiable, Hashable {
        public let code: String
        public let name: String
        public let priceKzt: Double
        public let billingUnit: String?

        public var id: String { code }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            code = try c.decodeFlexibleString(forKey: .code) ?? UUID().uuidString
            name = try c.decodeFlexibleString(forKey: .name) ?? code
            priceKzt = try c.decodeFlexibleDouble(forKey: .priceKzt) ?? 0
            billingUnit = try c.decodeFlexibleString(forKey: .billingUnit)
        }

        private enum CodingKeys: String, CodingKey {
            case code, name, priceKzt, billingUnit
        }
    }

    /// Счёт за период.
    public struct Invoice: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let amount: Double
        public let status: String
        public let periodStart: Date?
        public let periodEnd: Date?
        public let dueDate: Date?
        public let paidAt: Date?

        public var isPaid: Bool { status == "paid" || paidAt != nil }

        /// Просрочен — срок оплаты прошёл, а счёт не оплачен.
        public var isOverdue: Bool {
            guard !isPaid, let dueDate else { return false }
            return dueDate < Calendar.current.startOfDay(for: Date())
        }

        public var statusLabel: String {
            if isPaid { return "Оплачен" }
            if isOverdue { return "Просрочен" }
            switch status {
            case "draft": return "Черновик"
            case "issued", "open", "pending": return "Ждёт оплаты"
            case "void", "canceled", "cancelled": return "Аннулирован"
            default: return status
            }
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
            amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
            status = try c.decodeFlexibleString(forKey: .status) ?? "issued"
            periodStart = DateParsing.date(from: try c.decodeFlexibleString(forKey: .periodStart))
            periodEnd = DateParsing.date(from: try c.decodeFlexibleString(forKey: .periodEnd))
            dueDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .dueDate))
            paidAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .paidAt))
        }

        private enum CodingKeys: String, CodingKey {
            case id, amount, status
            case periodStart = "period_start"
            case periodEnd = "period_end"
            case dueDate = "due_date"
            case paidAt = "paid_at"
        }
    }

    private struct OrganizationRef: Decodable {
        let name: String?
        let slug: String?
        let status: String?
        let primaryDomain: String?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let org = try? c.decodeIfPresent(OrganizationRef.self, forKey: .organization)
        organizationName = org?.name
        primaryDomain = org?.primaryDomain
        organizationStatus = org?.status
        subscription = try? c.decodeIfPresent(Subscription.self, forKey: .subscription)
        package = try? c.decodeIfPresent(Package.self, forKey: .package)
        addons = (try? c.decodeIfPresent([Package].self, forKey: .addons)) ?? []
        monthlyTotal = try c.decodeFlexibleDouble(forKey: .monthlyTotal) ?? 0
        invoices = (try? c.decodeIfPresent([Invoice].self, forKey: .invoices)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case organization, subscription, package, addons, monthlyTotal, invoices
    }

    public var unpaidInvoices: [Invoice] {
        invoices.filter { !$0.isPaid && $0.status != "void" }
    }

    public var overdueCount: Int {
        invoices.filter(\.isOverdue).count
    }
}

// ── Инциденты: /api/admin/incidents ──────────────────────────────────────────

/// Штраф, бонус или заметка по сотруднику.
public struct Incident: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let kind: String
    public let title: String
    public let details: String?
    public let fineAmount: Double
    public let bonusAmount: Double
    public let severity: String?
    public let status: String
    public let occurredAt: Date?
    public let companyName: String?
    public let subjectName: String?
    public let photoCount: Int

    /// Итог для сотрудника: бонус в плюс, штраф в минус.
    public var netAmount: Double { bonusAmount - fineAmount }

    public var isFine: Bool { fineAmount > 0 }
    public var isBonus: Bool { bonusAmount > 0 }

    public var kindLabel: String {
        switch kind {
        case "fine", "penalty": "Штраф"
        case "bonus", "reward": "Бонус"
        case "note", "remark": "Заметка"
        case "violation": "Нарушение"
        default: "Запись"
        }
    }

    public var statusLabel: String {
        switch status {
        case "pending", "new", "open": "На рассмотрении"
        case "approved", "confirmed": "Подтверждён"
        case "rejected", "declined": "Отклонён"
        case "closed": "Закрыт"
        default: StatusText.humanize(status)
        }
    }

    public var isPending: Bool { status == "pending" || status == "new" || status == "open" }

    private struct NamedRef: Decodable {
        let name: String?
        let fullName: String?
        let shortName: String?

        private enum CodingKeys: String, CodingKey {
            case name
            case fullName = "full_name"
            case shortName = "short_name"
        }

        var display: String? { fullName ?? name ?? shortName }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        kind = try c.decodeFlexibleString(forKey: .kind) ?? "note"
        title = try c.decodeFlexibleString(forKey: .title) ?? "Без названия"
        details = try c.decodeFlexibleString(forKey: .details)
        fineAmount = try c.decodeFlexibleDouble(forKey: .fineAmount) ?? 0
        bonusAmount = try c.decodeFlexibleDouble(forKey: .bonusAmount) ?? 0
        severity = try c.decodeFlexibleString(forKey: .severity)
        status = try c.decodeFlexibleString(forKey: .status) ?? "pending"
        occurredAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .occurredAt))
        companyName = (try? c.decodeIfPresent(NamedRef.self, forKey: .company))??.display
        subjectName = (try? c.decodeIfPresent(NamedRef.self, forKey: .subject))??.display
        photoCount = ((try? c.decodeIfPresent([String].self, forKey: .photoURLs)) ?? [])?.count ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, title, severity, status, company, subject
        case details = "description"
        case fineAmount = "fine_amount"
        case bonusAmount = "bonus_amount"
        case occurredAt = "occurred_at"
        case photoURLs = "photo_urls"
    }
}

/// Ответ `GET /api/admin/incidents`.
public struct IncidentList: Decodable, Sendable {
    public let incidents: [Incident]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        incidents = (try? c.decodeIfPresent([Incident].self, forKey: .incidents)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case incidents }
}

// ── Долги с точки: /api/admin/point-debts ────────────────────────────────────

/// Долг клиента, записанный оператором на точке.
public struct PointDebt: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let clientName: String
    public let amount: Double
    public let comment: String?
    public let weekStart: String?
    public let status: String
    public let createdAt: Date?
    public let companyID: String?
    public let operatorID: String?

    public var isPaid: Bool { status == "paid" || status == "closed" }

    public var statusLabel: String {
        switch status {
        case "open", "active", "pending": "Не погашен"
        case "paid", "closed": "Погашен"
        case "written_off": "Списан"
        default: StatusText.humanize(status)
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        clientName = try c.decodeFlexibleString(forKey: .clientName) ?? "Без имени"
        // Долги приходят двумя видами строк. Новые — позиции с товаром, там
        // сумма лежит в `total_amount`. Старые — одна строка на человека с
        // полем `amount`. Приложение знало только второе, и весь список
        // показывал нули, хотя итог недели считался верно.
        amount = try c.decodeFlexibleDouble(forKey: .totalAmount)
            ?? c.decodeFlexibleDouble(forKey: .amount)
            ?? 0
        comment = try c.decodeFlexibleString(forKey: .comment)
        weekStart = try c.decodeFlexibleString(forKey: .weekStart)
        status = try c.decodeFlexibleString(forKey: .status) ?? "open"
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        operatorID = try c.decodeFlexibleString(forKey: .operatorID)
    }

    private enum CodingKeys: String, CodingKey {
        case id, amount, comment, status
        case totalAmount = "total_amount"
        case clientName = "client_name"
        case weekStart = "week_start"
        case createdAt = "created_at"
        case companyID = "company_id"
        case operatorID = "operator_id"
    }
}

/// Ответ `GET /api/admin/point-debts?weekStart=…`.
public struct PointDebtWeek: Decodable, Sendable {
    public let weekStart: String
    public let weekEnd: String
    public let companies: [Company]
    public let items: [PointDebt]
    public let totalAmount: Double
    public let totalCount: Int

    private struct Totals: Decodable {
        let count: Int?
        let amount: Double?
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        weekStart = try c.decodeFlexibleString(forKey: .weekStart) ?? ""
        weekEnd = try c.decodeFlexibleString(forKey: .weekEnd) ?? ""
        companies = (try? c.decodeIfPresent([Company].self, forKey: .companies)) ?? []
        items = (try? c.decodeIfPresent([PointDebt].self, forKey: .items)) ?? []
        let totals = (try? c.decodeIfPresent(Totals.self, forKey: .totals)) ?? nil
        totalAmount = totals?.amount ?? 0
        totalCount = totals?.count ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case weekStart, weekEnd, companies, items, totals
    }

    public var unpaid: [PointDebt] { items.filter { !$0.isPaid } }

    public var unpaidAmount: Double { unpaid.reduce(0) { $0 + $1.amount } }
}
