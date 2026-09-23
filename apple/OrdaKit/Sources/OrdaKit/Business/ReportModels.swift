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
    /// База сравнения: прошлый период той же длины или тот же период год назад.
    public let prevFrom: String
    public let prevTo: String
    public let current: FinancialTotals
    public let previous: FinancialTotals
    public let buckets: [ReportBucket]
    public let expenseByCategory: [String: Double]
    /// Выручка точек: название и сумма.
    ///
    /// Сервер отдаёт по каждой точке объект `{name, value, cash, …}`, а не
    /// число. Раньше здесь ждали число, разбор молча падал, и блок «Выручка по
    /// точкам» был пуст всегда.
    public let companyIncome: [ReportCompanyIncome]
    /// Итоги точек за период: выручка, расходы, прибыль. Ключ — id точки.
    public let companyStats: [String: ReportCompanyStat]
    /// То же за базу сравнения.
    public let companyStatsPrev: [String: ReportCompanyStat]
    /// Доход и расход по дням периода — для тепловой карты прибыли.
    public let dailyIncome: [String: Double]
    public let dailyExpense: [String: Double]

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dateFrom = try c.decodeFlexibleString(forKey: .dateFrom) ?? ""
        dateTo = try c.decodeFlexibleString(forKey: .dateTo) ?? ""
        prevFrom = try c.decodeFlexibleString(forKey: .prevFrom) ?? ""
        prevTo = try c.decodeFlexibleString(forKey: .prevTo) ?? ""
        current = (try? c.decodeIfPresent(FinancialTotals.self, forKey: .totalsCur)) ?? .zero
        previous = (try? c.decodeIfPresent(FinancialTotals.self, forKey: .totalsPrev)) ?? .zero
        buckets = (try? c.decodeIfPresent([ReportBucket].self, forKey: .chartData)) ?? []
        expenseByCategory = (try? c.decodeIfPresent([String: Double].self, forKey: .expenseByCategory)) ?? [:]
        let incomeObjects = (try? c.decodeIfPresent([String: ReportCompanyIncome].self, forKey: .incomeByCompany)) ?? [:]
        companyIncome = incomeObjects.values.sorted { $0.amount > $1.amount }
        companyStats = (try? c.decodeIfPresent([String: ReportCompanyStat].self, forKey: .companyStats)) ?? [:]
        companyStatsPrev = (try? c.decodeIfPresent([String: ReportCompanyStat].self, forKey: .companyStatsPrev)) ?? [:]
        dailyIncome = (try? c.decodeIfPresent([String: Double].self, forKey: .dailyIncome)) ?? [:]
        dailyExpense = (try? c.decodeIfPresent([String: Double].self, forKey: .dailyExpense)) ?? [:]
    }

    private enum CodingKeys: String, CodingKey {
        case dateFrom, dateTo, prevFrom, prevTo, totalsCur, totalsPrev, chartData
        case expenseByCategory, incomeByCompany, companyStats, companyStatsPrev, dailyIncome, dailyExpense
    }

    /// Изменение выручки к базе сравнения. `nil`, когда сравнивать не с чем.
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
}

/// Выручка одной точки за период (`aggregate.incomeByCompany[id]`).
public struct ReportCompanyIncome: Decodable, Sendable, Hashable {
    public let companyID: String
    public let name: String
    public let amount: Double
    /// Разбивка по способам и число чеков — для PDF, как на сайте.
    public let cash: Double
    public let kaspi: Double
    public let online: Double
    public let card: Double
    public let count: Int

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        companyID = try c.decodeFlexibleString(forKey: .companyId) ?? ""
        name = try c.decodeFlexibleString(forKey: .name) ?? "Точка"
        amount = try c.decodeFlexibleDouble(forKey: .value) ?? 0
        cash = try c.decodeFlexibleDouble(forKey: .cash) ?? 0
        kaspi = try c.decodeFlexibleDouble(forKey: .kaspi) ?? 0
        online = try c.decodeFlexibleDouble(forKey: .online) ?? 0
        card = try c.decodeFlexibleDouble(forKey: .card) ?? 0
        count = Int(try c.decodeFlexibleDouble(forKey: .count) ?? 0)
    }

    private enum CodingKeys: String, CodingKey { case companyId, name, value, cash, kaspi, online, card, count }
}

/// Итоги точки (`aggregate.companyStats[id]`): для таблицы «Точки».
public struct ReportCompanyStat: Decodable, Sendable, Hashable {
    public let income: Double
    public let expense: Double
    public let profit: Double
    public let transactions: Int

    /// Маржа — прибыль к выручке. `nil`, когда выручки нет.
    public var margin: Double? { income > 0 ? profit / income : nil }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        income = try c.decodeFlexibleDouble(forKey: .income) ?? 0
        expense = try c.decodeFlexibleDouble(forKey: .expense) ?? 0
        profit = try c.decodeFlexibleDouble(forKey: .profit) ?? (income - expense)
        transactions = Int(try c.decodeFlexibleDouble(forKey: .transactions) ?? 0)
    }

    private enum CodingKeys: String, CodingKey { case income, expense, profit, transactions }
}

/// Статья расходов ОПиУ за период (`expenseByGroup`): сумма, база сравнения
/// и категории внутри.
public struct ReportExpenseArticle: Decodable, Sendable, Hashable, Identifiable {
    public struct Category: Decodable, Sendable, Hashable {
        public let name: String
        public let amount: Double

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeFlexibleString(forKey: .name) ?? "Без категории"
            amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        }

        private enum CodingKeys: String, CodingKey { case name, amount }
    }

    public let group: String
    public let label: String
    /// CAPEX и выплаты партнёрам: в ОПиУ не вычитаются.
    public let offChain: Bool
    public let amount: Double
    public let prevAmount: Double
    public let categories: [Category]

    public var id: String { group }
    public var change: Double? { Percent.change(current: amount, previous: prevAmount) }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        group = try c.decodeFlexibleString(forKey: .group) ?? UUID().uuidString
        label = try c.decodeFlexibleString(forKey: .label) ?? "Статья"
        offChain = (try? c.decodeIfPresent(Bool.self, forKey: .offChain)) ?? false
        amount = try c.decodeFlexibleDouble(forKey: .amount) ?? 0
        prevAmount = try c.decodeFlexibleDouble(forKey: .prevAmount) ?? 0
        categories = (try? c.decodeIfPresent([Category].self, forKey: .categories)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case group, label, offChain, amount, prevAmount, categories }
}

/// Операция периода для вкладки «Операции» (`rows=current`).
public struct ReportOperation: Sendable, Hashable, Identifiable {
    public enum Kind: Sendable, Hashable { case income, expense }

    public let id: String
    public let kind: Kind
    public let date: String
    public let companyID: String?
    /// Смена у дохода, статья у расхода.
    public let title: String?
    public let amount: Double
    public let comment: String?
    /// Разбивка по способам — для строк PDF.
    public var cash: Double = 0
    public var kaspi: Double = 0
    public var online: Double = 0
    public var card: Double = 0
    public var zone: String?
    /// Смена как в базе («day» / «night») — у дохода.
    public var shift: String?
}

/// Строка дохода из `rows=current`.
struct ReportIncomeRowDTO: Decodable {
    let id: String
    let date: String
    let companyID: String?
    let shift: String?
    let zone: String?
    let cash: Double
    let kaspi: Double
    let online: Double
    let card: Double
    let comment: String?

    var total: Double { cash + kaspi + online + card }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        companyID = try c.decodeFlexibleString(forKey: .companyId)
        shift = try c.decodeFlexibleString(forKey: .shift)
        zone = try c.decodeFlexibleString(forKey: .zone)
        cash = try c.decodeFlexibleDouble(forKey: .cash) ?? 0
        kaspi = try c.decodeFlexibleDouble(forKey: .kaspi) ?? 0
        online = try c.decodeFlexibleDouble(forKey: .online) ?? 0
        card = try c.decodeFlexibleDouble(forKey: .card) ?? 0
        comment = try c.decodeFlexibleString(forKey: .comment)
    }

    private enum CodingKeys: String, CodingKey {
        case id, date, shift, zone, comment
        case companyId = "company_id"
        case cash = "cash_amount"
        case kaspi = "kaspi_amount"
        case online = "online_amount"
        case card = "card_amount"
    }
}

/// Строка расхода из `rows=current`.
struct ReportExpenseRowDTO: Decodable {
    let id: String
    let date: String
    let companyID: String?
    let category: String?
    let cash: Double
    let kaspi: Double
    let comment: String?

    var total: Double { cash + kaspi }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeFlexibleString(forKey: .id) ?? UUID().uuidString
        date = try c.decodeFlexibleString(forKey: .date) ?? ""
        companyID = try c.decodeFlexibleString(forKey: .companyId)
        category = try c.decodeFlexibleString(forKey: .category)
        cash = try c.decodeFlexibleDouble(forKey: .cash) ?? 0
        kaspi = try c.decodeFlexibleDouble(forKey: .kaspi) ?? 0
        comment = try c.decodeFlexibleString(forKey: .comment)
    }

    private enum CodingKeys: String, CodingKey {
        case id, date, category, comment
        case companyId = "company_id"
        case cash = "cash_amount"
        case kaspi = "kaspi_amount"
    }
}

/// Ответ `GET /api/admin/reports/bundle`.
public struct ReportBundle: Decodable, Sendable {
    public let aggregate: ReportAggregate
    /// Расходы по статьям ОПиУ — вкладка «Расходы».
    public let expenseArticles: [ReportExpenseArticle]
    /// Операции периода — только при `rows=current`, иначе пусто.
    public let operations: [ReportOperation]
    /// Строк ночной смены, где Kaspi не разделён по полуночи: суммы по дням
    /// у них приблизительные.
    public let impreciseNightKaspiCount: Int
    /// День, на который сервер считал («сегодня» в его часовом поясе).
    public let asOf: String?
    /// Прошлый месяц целиком и его начало — для прогноза на конец месяца.
    /// Есть только когда выбран ровно календарный месяц.
    public let forecastHints: ReportForecastHints?

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        aggregate = try c.decode(ReportAggregate.self, forKey: .aggregate)
        asOf = try c.decodeFlexibleString(forKey: .asOf)
        forecastHints = try? c.decodeIfPresent(ReportForecastHints.self, forKey: .forecastHints)
        expenseArticles = (try? c.decodeIfPresent([ReportExpenseArticle].self, forKey: .expenseByGroup)) ?? []
        impreciseNightKaspiCount = Int(try c.decodeFlexibleDouble(forKey: .impreciseNightKaspiCount) ?? 0)
        let incomes = (try? c.decodeIfPresent([ReportIncomeRowDTO].self, forKey: .incomes)) ?? []
        let expenses = (try? c.decodeIfPresent([ReportExpenseRowDTO].self, forKey: .expenses)) ?? []
        let shiftTitle: (String?) -> String? = { shift in
            switch shift {
            case "day": "Дневная смена"
            case "night": "Ночная смена"
            default: nil
            }
        }
        operations = (
            incomes.map {
                ReportOperation(id: "i." + $0.id, kind: .income, date: $0.date, companyID: $0.companyID,
                                title: shiftTitle($0.shift) ?? $0.zone, amount: $0.total, comment: $0.comment,
                                cash: $0.cash, kaspi: $0.kaspi, online: $0.online, card: $0.card, zone: $0.zone, shift: $0.shift)
            }
            + expenses.map {
                ReportOperation(id: "e." + $0.id, kind: .expense, date: $0.date, companyID: $0.companyID,
                                title: $0.category, amount: $0.total, comment: $0.comment,
                                cash: $0.cash, kaspi: $0.kaspi)
            }
        )
        .sorted { $0.date == $1.date ? $0.amount > $1.amount : $0.date > $1.date }
    }

    private enum CodingKeys: String, CodingKey {
        case aggregate, expenseByGroup, incomes, expenses, impreciseNightKaspiCount, asOf, forecastHints
    }
}

/// Параметры отчёта — те же, что у страницы /reports на сайте.
public struct ReportQuery: Sendable, Hashable {
    public enum Grouping: String, Sendable, CaseIterable {
        case auto, day, week, month

        public var title: String {
            switch self {
            case .auto: "Авто"
            case .day: "Дни"
            case .week: "Недели"
            case .month: "Месяцы"
            }
        }
    }

    public enum Shift: String, Sendable, CaseIterable {
        case all, day, night

        public var title: String {
            switch self {
            case .all: "Все смены"
            case .day: "День"
            case .night: "Ночь"
            }
        }
    }

    public var from: String
    public var to: String
    public var companyID: String?
    public var shift: Shift = .all
    public var grouping: Grouping = .auto
    /// Сравнивать с тем же периодом год назад, а не с прошлым той же длины.
    public var compareYear = false
    public var includeExtra = false

    public init(from: String, to: String) {
        self.from = from
        self.to = to
    }

    /// Шаг графика для «Авто»: неделя — по дням, квартал — по неделям, год —
    /// по месяцам. Сервер без `group` всегда считает по дням, и за год
    /// получалось 365 столбиков.
    public var resolvedGroup: String {
        guard grouping == .auto else { return grouping.rawValue }
        return Self.autoGroup(from: from, to: to)
    }

    public static func autoGroup(from: String, to: String) -> String {
        guard let start = DateParsing.parseDateOnly(from), let end = DateParsing.parseDateOnly(to) else { return "day" }
        let days = (Calendar(identifier: .gregorian).dateComponents([.day], from: start, to: end).day ?? 0) + 1
        if days <= 31 { return "day" }
        if days <= 120 { return "week" }
        return "month"
    }

    /// Параметры запроса. `rows` — «0» для итогов и графиков (ответ в разы
    /// легче), «current» — строки выбранного периода для «Операций».
    public func queryItems(rows: String, asOf: String) -> [String: String] {
        var query = ["from": from, "to": to, "group": resolvedGroup, "rows": rows, "as_of": asOf]
        if let companyID, !companyID.isEmpty { query["company_id"] = companyID }
        if shift != .all { query["shift"] = shift.rawValue }
        if compareYear { query["compare"] = "year" }
        if includeExtra { query["include_extra"] = "1" }
        return query
    }
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
