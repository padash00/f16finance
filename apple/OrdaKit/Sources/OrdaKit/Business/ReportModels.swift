import Foundation

// ── Отчёты: /api/admin/reports/bundle ────────────────────────────────────────

/// Финансовые итоги периода.
public struct FinancialTotals: Decodable, Sendable, Hashable {
    public let incomeCash: Double
    public let incomeKaspi: Double
    public let incomeOnline: Double
    public let incomeCard: Double
    public let totalIncome: Double
    public let totalExpense: Double
    public let profit: Double
    public let transactionCount: Int
    public let avgTransaction: Double

    public static let zero = FinancialTotals(
        incomeCash: 0, incomeKaspi: 0, incomeOnline: 0, incomeCard: 0,
        totalIncome: 0, totalExpense: 0, profit: 0,
        transactionCount: 0, avgTransaction: 0
    )

    public init(
        incomeCash: Double, incomeKaspi: Double, incomeOnline: Double, incomeCard: Double,
        totalIncome: Double, totalExpense: Double, profit: Double,
        transactionCount: Int, avgTransaction: Double
    ) {
        self.incomeCash = incomeCash
        self.incomeKaspi = incomeKaspi
        self.incomeOnline = incomeOnline
        self.incomeCard = incomeCard
        self.totalIncome = totalIncome
        self.totalExpense = totalExpense
        self.profit = profit
        self.transactionCount = transactionCount
        self.avgTransaction = avgTransaction
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        incomeCash = try c.decodeFlexibleDouble(forKey: .incomeCash) ?? 0
        incomeKaspi = try c.decodeFlexibleDouble(forKey: .incomeKaspi) ?? 0
        incomeOnline = try c.decodeFlexibleDouble(forKey: .incomeOnline) ?? 0
        incomeCard = try c.decodeFlexibleDouble(forKey: .incomeCard) ?? 0
        totalIncome = try c.decodeFlexibleDouble(forKey: .totalIncome) ?? 0
        totalExpense = try c.decodeFlexibleDouble(forKey: .totalExpense) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
        transactionCount = Int(try c.decodeFlexibleDouble(forKey: .transactionCount) ?? 0)
        avgTransaction = try c.decodeFlexibleDouble(forKey: .avgTransaction) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case incomeCash, incomeKaspi, incomeOnline, incomeCard
        case totalIncome, totalExpense, profit, transactionCount, avgTransaction
    }

    /// Безналичная часть выручки — Kaspi, карта, онлайн вместе.
    public var incomeNonCash: Double { incomeKaspi + incomeCard + incomeOnline }
}

/// Одна точка на графике: день, неделя или месяц — сервер решает по периоду.
public struct ReportBucket: Decodable, Sendable, Identifiable, Hashable {
    public let key: String
    public let label: String
    public let sortISO: String
    public let income: Double
    public let expense: Double
    public let profit: Double
    public let count: Int

    public var id: String { key }

    public var date: Date? { DateParsing.parseDateOnly(sortISO) }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decodeFlexibleString(forKey: .key) ?? UUID().uuidString
        label = try c.decodeFlexibleString(forKey: .label) ?? ""
        sortISO = try c.decodeFlexibleString(forKey: .sortISO) ?? ""
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? 0
        count = Int(try c.decodeFlexibleDouble(forKey: .count) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case key, label, sortISO, income, expense, profit, count
    }
}

/// Сводка отчёта: текущий период, прошлый и разрезы.
public struct ReportAggregate: Decodable, Sendable {
    public let dateFrom: String
    public let dateTo: String
    public let current: FinancialTotals
    public let previous: FinancialTotals
    public let buckets: [ReportBucket]
    public let expenseByCategory: [String: Double]
    public let incomeByCompany: [String: Double]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dateFrom = try c.decodeFlexibleString(forKey: .dateFrom) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .dateTo) ?? ""
        current = (try? c.decodeIfPresent(FinancialTotals.self, forKey: .totalsCur)) ?? .zero
        previous = (try? c.decodeIfPresent(FinancialTotals.self, forKey: .totalsPrev)) ?? .zero
        buckets = (try? c.decodeIfPresent([ReportBucket].self, forKey: .chartData)) ?? []
        expenseByCategory = (try? c.decodeIfPresent([String: Double].self, forKey: .expenseByCategory)) ?? [:]
        incomeByCompany = (try? c.decodeIfPresent([String: Double].self, forKey: .incomeByCompany)) ?? [:]
    }

    private enum CodingKeys: String, CodingKey {
        case dateFrom, dateTo, totalsCur, totalsPrev, chartData
        case expenseByCategory, incomeByCompany
    }

    /// Изменение выручки к прошлому периоду. `nil`, когда сравнивать не с чем.
    public var incomeChange: Double? {
        Percent.change(current: current.totalIncome, previous: previous.totalIncome)
    }

    public var profitChange: Double? {
        Percent.change(current: current.profit, previous: previous.profit)
    }

    public var expenseChange: Double? {
        Percent.change(current: current.totalExpense, previous: previous.totalExpense)
    }

    /// Расходы по категориям, от крупных к мелким.
    public var expenseCategories: [(name: String, amount: Double)] {
        expenseByCategory
            .map { (name: $0.key, amount: $0.value) }
            .sorted { $0.amount > $1.amount }
    }

    /// Выручка по точкам.
    public var companyIncome: [(name: String, amount: Double)] {
        incomeByCompany
            .map { (name: $0.key, amount: $0.value) }
            .sorted { $0.amount > $1.amount }
    }
}

/// Ответ `GET /api/admin/reports/bundle`.
public struct ReportBundle: Decodable, Sendable {
    public let aggregate: ReportAggregate

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        aggregate = try c.decode(ReportAggregate.self, forKey: .aggregate)
    }

    private enum CodingKeys: String, CodingKey { case aggregate }
}

// ── Задачи: /api/admin/tasks ─────────────────────────────────────────────────

/// Задача команды.
public struct TeamTask: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let number: Int?
    public let title: String
    public let details: String?
    public let status: String
    public let priority: String
    public let dueDate: Date?
    public let companyID: String?
    public let operatorID: String?
    public let commentsCount: Int
    public let checklist: [ChecklistItem]

    public struct ChecklistItem: Decodable, Sendable, Identifiable, Hashable {
        public let id: String
        public let text: String
        public let isDone: Bool

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
            text = try c.decodeFlexibleString(forKey: .text)
                ?? c.decodeFlexibleString(forKey: .title) ?? ""
            isDone = (try? c.decodeIfPresent(Bool.self, forKey: .done)) as? Bool
                ?? (try? c.decodeIfPresent(Bool.self, forKey: .completed)) as? Bool
                ?? false
        }

        private enum CodingKeys: String, CodingKey {
            case id, text, title, done, completed
        }
    }

    public var isDone: Bool { status == "done" || status == "completed" }

    public var statusLabel: String {
        switch status {
        case "todo", "new", "open": "К выполнению"
        case "in_progress", "doing": "В работе"
        case "done", "completed": "Готово"
        case "cancelled", "canceled": "Отменена"
        default: StatusText.humanize(status)
        }
    }

    public var priorityLabel: String {
        switch priority {
        case "high", "urgent": "Высокий"
        case "low": "Низкий"
        default: "Обычный"
        }
    }

    public var isUrgent: Bool { priority == "high" || priority == "urgent" }

    /// Просрочена — срок прошёл, а задача не закрыта. Закрытые с прошедшим
    /// сроком просроченными не считаем: работа сделана, ругаться не за что.
    public var isOverdue: Bool {
        guard let dueDate, !isDone else { return false }
        return dueDate < Calendar.current.startOfDay(for: Date())
    }

    public var doneCount: Int { checklist.filter(\.isDone).count }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        number = Int(try c.decodeFlexibleDouble(forKey: .number) ?? 0).nonZero
        title = try c.decodeFlexibleString(forKey: .title) ?? "Задача"
        details = try c.decodeFlexibleString(forKey: .details)
        status = try c.decodeFlexibleString(forKey: .status) ?? "todo"
        priority = try c.decodeFlexibleString(forKey: .priority) ?? "normal"
        dueDate = DateParsing.date(from: try c.decodeFlexibleString(forKey: .dueDate))
        companyID = try c.decodeFlexibleString(forKey: .companyID)
        operatorID = try c.decodeFlexibleString(forKey: .operatorID)
        commentsCount = Int(try c.decodeFlexibleDouble(forKey: .commentsCount) ?? 0)
        checklist = (try? c.decodeIfPresent([ChecklistItem].self, forKey: .checklist)) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, status, priority, checklist
        case number = "task_number"
        case details = "description"
        case dueDate = "due_date"
        case companyID = "company_id"
        case operatorID = "operator_id"
        case commentsCount = "comments_count"
    }
}

private extension Int {
    /// Ноль здесь означает «номера нет», а не «номер нулевой».
    var nonZero: Int? { self == 0 ? nil : self }
}

// ── Смены: /api/admin/shifts ─────────────────────────────────────────────────

/// Смена в графике точки.
///
/// Не `ScheduledShift` — так называется смена в личном расписании оператора,
/// и это другой смысл: там «моя смена», здесь «кто стоит на точке».
public struct RosterShift: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let date: String
    public let operatorName: String
    public let shiftType: String
    public let companyID: String?

    public var day: Date? { DateParsing.parseDateOnly(date) }

    /// Дневная и ночная смены различаются на графике цветом и иконкой.
    public var isNight: Bool { shiftType.contains("night") || shiftType == "ночь" }

    public var typeLabel: String {
        switch shiftType {
        case "day", "день": "День"
        case "night", "ночь": "Ночь"
        default: shiftType
        }
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        operatorName = try c.decodeFlexibleString(forKey: .operatorName) ?? ""
        shiftType = try c.decodeFlexibleString(forKey: .shiftType) ?? "day"
        companyID = try c.decodeFlexibleString(forKey: .companyID)
    }

    private enum CodingKeys: String, CodingKey {
        case id, date
        case operatorName = "operator_name"
        case shiftType = "shift_type"
        case companyID = "company_id"
    }
}

/// Ответ `GET /api/admin/shifts?includeSchedule=1`.
public struct ShiftSchedule: Decodable, Sendable {
    public let companies: [Company]
    public let shifts: [RosterShift]
    /// Заявки «не смогу выйти» по этой неделе.
    ///
    /// Приходят тем же ответом, что и сетка смен, но раньше отбрасывались:
    /// решение по ним принимали только на сайте, а руководитель за неделю в
    /// кабинет заходит не каждый день.
    public let requests: [ShiftIssue]

    /// Заявки, которые ждут решения руководителя.
    public var openRequests: [ShiftIssue] { requests.filter(\.isOpen) }

    public init(from decoder: any Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let nested = try? root.nestedContainer(keyedBy: ScheduleKeys.self, forKey: .schedule)
        companies = (try? nested?.decodeIfPresent([Company].self, forKey: .companies)) as? [Company] ?? []
        shifts = (try? nested?.decodeIfPresent([RosterShift].self, forKey: .shifts)) as? [RosterShift] ?? []
        // Заявки лежат в корне ответа, рядом со `schedule`, а не внутри него.
        requests = (try? root.decodeIfPresent([ShiftIssue].self, forKey: .requests)) as? [ShiftIssue] ?? []
    }

    private enum RootKeys: String, CodingKey { case schedule, requests }
    private enum ScheduleKeys: String, CodingKey { case companies, shifts, operators }

    /// Смены за конкретный день указанной точки.
    public func shifts(on day: String, companyID: String?) -> [RosterShift] {
        shifts.filter { shift in
            shift.date == day && (companyID == nil || shift.companyID == companyID)
        }
    }
}

/// Заявка оператора «не смогу выйти» глазами руководителя.
///
/// Путь заявки: оператор её подал, старший на точке предложил, кем закрыть, —
/// решение принимает руководитель. Предложение старшего видно здесь же, иначе
/// решать пришлось бы вслепую.
public struct ShiftIssue: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let companyID: String
    public let operatorName: String
    /// `YYYY-MM-DD`.
    public let shiftDate: String
    public let shiftType: String
    public let status: String
    public let reason: String?
    public let createdAt: Date?

    /// Что предложил старший: `keep` / `remove` / `replace`.
    public let leadAction: String?
    public let leadStatus: String?
    public let leadNote: String?
    public let leadOperatorName: String?
    public let replacementName: String?
    public let resolutionNote: String?

    public var isOpen: Bool { status == "open" || status == "awaiting_reason" }
    public var isNight: Bool { shiftType == "night" }
    public var hasProposal: Bool { (leadStatus ?? "") == "proposed" }

    public var proposalLabel: String? {
        switch leadAction {
        case "keep": "Старший: оставить смену"
        case "remove": "Старший: снять со смены"
        case "replace": replacementName.map { "Старший: заменить на \($0)" } ?? "Старший: заменить"
        default: nil
        }
    }

    public var statusLabel: String {
        switch status {
        case "open", "awaiting_reason": hasProposal ? "Есть предложение" : "Ждёт решения"
        case "resolved": "Решено"
        case "dismissed", "rejected": "Отклонено"
        case "closed": "Закрыто"
        default: StatusText.humanize(status)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, status, reason
        case companyID = "company_id"
        case operatorName = "operator_name"
        case shiftDate = "shift_date"
        case shiftType = "shift_type"
        case createdAt = "created_at"
        case leadAction = "lead_action"
        case leadStatus = "lead_status"
        case leadNote = "lead_note"
        case leadOperatorName = "lead_operator_name"
        case replacementName = "lead_replacement_operator_name"
        case resolutionNote = "resolution_note"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? ""
        companyID = try c.decodeFlexibleString(forKey: .companyID) ?? ""
        operatorName = try c.decodeFlexibleString(forKey: .operatorName) ?? "Оператор"
        shiftDate = try c.decodeFlexibleString(forKey: .shiftDate) ?? ""
        shiftType = try c.decodeFlexibleString(forKey: .shiftType) ?? "day"
        status = try c.decodeFlexibleString(forKey: .status) ?? "open"
        reason = try c.decodeFlexibleString(forKey: .reason)
        createdAt = DateParsing.date(from: try c.decodeFlexibleString(forKey: .createdAt))
        leadAction = try c.decodeFlexibleString(forKey: .leadAction)
        leadStatus = try c.decodeFlexibleString(forKey: .leadStatus)
        leadNote = try c.decodeFlexibleString(forKey: .leadNote)
        leadOperatorName = try c.decodeFlexibleString(forKey: .leadOperatorName)
        replacementName = try c.decodeFlexibleString(forKey: .replacementName)
        resolutionNote = try c.decodeFlexibleString(forKey: .resolutionNote)
    }
}

// ── Клиенты: /api/admin/customers ────────────────────────────────────────────

/// Клиент точки: лояльность, траты, визиты.
public struct Customer: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let phone: String?
    public let cardNumber: String?
    public let loyaltyPoints: Double
    public let totalSpent: Double
    public let visitsCount: Int
    public let companyName: String?

    /// Средний чек. Без визитов делить не на что — и «средний чек» без визитов
    /// не имеет смысла, поэтому ноль, а не деление на ноль.
    public var averageCheck: Double {
        visitsCount > 0 ? totalSpent / Double(visitsCount) : 0
    }

    public var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    private struct NamedRef: Decodable { let name: String? }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        name = try c.decodeFlexibleString(forKey: .name) ?? "Без имени"
        phone = try c.decodeFlexibleString(forKey: .phone)
        cardNumber = try c.decodeFlexibleString(forKey: .cardNumber)
        loyaltyPoints = try c.decodeFlexibleDouble(forKey: .loyaltyPoints) ?? 0
        totalSpent = try c.decodeFlexibleDouble(forKey: .totalSpent) ?? 0
        visitsCount = Int(try c.decodeFlexibleDouble(forKey: .visitsCount) ?? 0)
        companyName = try c.decodeIfPresent(NamedRef.self, forKey: .company)?.name
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, phone, company
        case cardNumber = "card_number"
        case loyaltyPoints = "loyalty_points"
        case totalSpent = "total_spent"
        case visitsCount = "visits_count"
    }
}
